'use strict';
/**
 * PANIKA JEEVAN SATHI - Google Apps Script (Google Sheet) connector.
 *
 * Push-only: when a new member registers, a row is sent to a Google Apps Script
 * Web App which appends it to a Google Sheet.
 *
 * Configuration (all optional - the site works perfectly without it):
 *   GAS_WEBAPP_URL     https://script.google.com/macros/s/AKfy.../exec
 *   GAS_SHARED_SECRET  long random string, must match SHARED_SECRET in Code.gs
 *   GAS_TIMEOUT_MS     request timeout, default 8000
 *   GAS_DISABLED       set to "1" to hard-disable even if a URL is present
 *
 * Design rules:
 *   - Registration must NEVER fail or slow down because of this connector.
 *     Every push is fire-and-forget and every error is swallowed.
 *   - Nothing is silently lost: a failed push is appended to
 *     <dataDir>/gsheet-queue.jsonl and retried on the next successful push.
 *   - No passwords, hashes or tokens are ever sent. Only the fields listed in
 *     buildRow() leave the server.
 *   - Zero third-party dependencies (uses global fetch, Node >= 22).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const QUEUE_FILE = 'gsheet-queue.jsonl';
const MAX_QUEUE_ROWS = 500;
const DEFAULT_TIMEOUT_MS = 8000;

/* ------------------------------------------------------------------ config */

function webappUrl() {
  return String(process.env.GAS_WEBAPP_URL || '').trim();
}

function sharedSecret() {
  return String(process.env.GAS_SHARED_SECRET || '').trim();
}

function timeoutMs() {
  const n = Number(process.env.GAS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/** True when the connector has everything it needs to talk to Apps Script. */
function configured() {
  if (String(process.env.GAS_DISABLED || '') === '1') return false;
  const url = webappUrl();
  if (!url || !sharedSecret()) return false;
  // GAS_ALLOW_INSECURE_URL is for the local test harness only, which points the
  // connector at a stand-in server on 127.0.0.1. In production only real
  // Apps Script HTTPS endpoints are accepted.
  if (String(process.env.GAS_ALLOW_INSECURE_URL || '') === '1') return true;
  return /^https:\/\/script\.google\.com\//.test(url);
}

/** Human-readable state, used by the health check and the admin panel. */
function status() {
  const url = webappUrl();
  return {
    configured: configured(),
    disabled: String(process.env.GAS_DISABLED || '') === '1',
    has_url: Boolean(url),
    url_valid: Boolean(url) && /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url),
    has_secret: Boolean(sharedSecret()),
    timeout_ms: timeoutMs()
  };
}

/* ------------------------------------------------------------------ crypto */

/**
 * HMAC-SHA256 over the exact JSON payload string. Apps Script recomputes this
 * with Utilities.computeHmacSha256Signature and compares, so a leaked /exec URL
 * alone cannot be used to write junk into the Sheet.
 */
function sign(payloadJson, secret) {
  return crypto.createHmac('sha256', secret).update(payloadJson, 'utf8').digest('hex');
}

/* -------------------------------------------------------------------- rows */

function str(v) {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Whitelist of fields that may leave the server. Anything not listed here
 * (password_hash, tokens, session data) can never reach the Sheet.
 */
function buildRow(user, profile) {
  const p = profile || {};
  return {
    event: 'registration',
    user_id: str(user.id),
    name: str(user.name),
    email: str(user.email),
    role: str(user.role),
    status: str(user.status),
    email_verified: user.email_verified ? 'yes' : 'no',
    gender: str(p.gender),
    looking_for: str(p.pref_gender),
    city: str(p.city),
    state: str(p.state),
    community: str(p.community),
    religion: str(p.religion),
    phone: str(p.phone),
    registered_at: new Date(Number(user.created_at) || Date.now()).toISOString()
  };
}

/* ------------------------------------------------------------------- queue */

function queuePath(dataDir) {
  return path.join(dataDir, QUEUE_FILE);
}

function enqueue(dataDir, row, reason) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const line = JSON.stringify({ row, reason: str(reason), queued_at: Date.now() });
    fs.appendFileSync(queuePath(dataDir), `${line}\n`, 'utf8');
    trimQueue(dataDir);
  } catch (_) {
    /* disk problems must not break registration */
  }
}

function readQueue(dataDir) {
  try {
    return fs
      .readFileSync(queuePath(dataDir), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function writeQueue(dataDir, entries) {
  try {
    if (!entries.length) {
      try {
        fs.unlinkSync(queuePath(dataDir));
      } catch (_) {
        /* already gone */
      }
      return;
    }
    fs.writeFileSync(
      dataDir ? queuePath(dataDir) : QUEUE_FILE,
      `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`,
      'utf8'
    );
  } catch (_) {
    /* ignore */
  }
}

/** Keep the retry file bounded so a long outage cannot fill the disk. */
function trimQueue(dataDir) {
  const entries = readQueue(dataDir);
  if (entries.length > MAX_QUEUE_ROWS) {
    writeQueue(dataDir, entries.slice(entries.length - MAX_QUEUE_ROWS));
  }
}

function queueSize(dataDir) {
  return readQueue(dataDir).length;
}

/* ---------------------------------------------------------------- transport */

/** One signed POST to the Apps Script Web App. Resolves, never throws. */
async function postRows(rows) {
  const url = webappUrl();
  const secret = sharedSecret();
  if (!url || !secret) return { ok: false, error: 'not configured' };

  // Apps Script's doPost does NOT expose custom request headers, so the
  // signature travels inside the body. We sign the inner `payload` STRING and
  // send it verbatim, so Apps Script verifies the exact same bytes we signed -
  // no JSON re-serialisation ambiguity (key order, spacing) can break it.
  const payload = JSON.stringify({ sent_at: Date.now(), rows });
  const envelope = JSON.stringify({ payload, sig: sign(payload, secret) });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const res = await fetch(url, {
      method: 'POST',
      // text/plain avoids the CORS preflight that Apps Script rejects.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: envelope,
      redirect: 'follow',
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, body: text.slice(0, 300) };
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      return { ok: false, error: 'non-JSON response (check Web App access = Anyone)' };
    }
    if (!parsed || parsed.ok !== true)
      return { ok: false, error: str((parsed && parsed.error) || 'rejected by Apps Script') };
    return { ok: true, appended: Number(parsed.appended) || rows.length };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : str(err.message) };
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------- public API */

/**
 * Push one registration. Returns a promise that always resolves; callers may
 * ignore it entirely (fire-and-forget).
 */
async function pushRegistration({ user, profile, dataDir }) {
  if (!configured()) return { ok: false, skipped: true, reason: 'not configured' };

  const row = buildRow(user, profile);

  // Drain anything left over from a previous outage, oldest first.
  const pending = readQueue(dataDir).map((e) => e.row);
  const batch = pending.concat([row]);

  const result = await postRows(batch);
  if (result.ok) {
    writeQueue(dataDir, []);
    return { ok: true, appended: result.appended, drained: pending.length };
  }

  enqueue(dataDir, row, result.error);
  return { ok: false, queued: true, error: result.error };
}

/** Retry the backlog without adding a new row. Used by scripts/CLI. */
async function flushQueue(dataDir) {
  if (!configured()) return { ok: false, skipped: true, reason: 'not configured' };
  const pending = readQueue(dataDir);
  if (!pending.length) return { ok: true, appended: 0, drained: 0 };

  const result = await postRows(pending.map((e) => e.row));
  if (result.ok) {
    writeQueue(dataDir, []);
    return { ok: true, appended: result.appended, drained: pending.length };
  }
  return { ok: false, error: result.error, pending: pending.length };
}

/** Connectivity probe - sends a single ping row the Sheet script ignores. */
async function ping() {
  if (!configured()) return { ok: false, skipped: true, reason: 'not configured' };
  return postRows([{ event: 'ping', registered_at: new Date().toISOString() }]);
}

module.exports = {
  configured,
  status,
  buildRow,
  sign,
  pushRegistration,
  flushQueue,
  queueSize,
  ping,
  QUEUE_FILE
};
