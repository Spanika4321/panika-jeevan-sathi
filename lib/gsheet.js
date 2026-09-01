'use strict';
/**
 * PANIKA JEEVAN SATHI — Google Sheets registration backup connector.
 *
 * After a successful registration the API calls `pushRegistration()` which
 * fires an asynchronous, fire-and-forget POST to a Google Apps Script Web App.
 * Registration is NEVER blocked or failed because of the sheet backup — any
 * error is caught and logged but swallowed.
 *
 * Protocol (must match apps-script/Code.gs exactly):
 *   POST <GAS_WEBAPP_URL>
 *   Content-Type: application/json
 *   Body:
 *     {
 *       event : "registration",
 *       ts    : <unix-ms>,
 *       nonce : <hex>,
 *       sig   : HMAC-SHA256(secret, ts + "|" + nonce + "|" + canonicalJSON(data)),
 *       data  : { whitelisted fields only — no passwords/tokens/secrets }
 *     }
 *
 * canonicalJSON = JSON.stringify with keys sorted recursively (deterministic
 * across Node.js V8 and Apps Script V8).
 */

const crypto = require('node:crypto');

/* --------------------------------------------------------------- config */

const GAS_WEBAPP_URL = (process.env.GAS_WEBAPP_URL || '').trim();
const GAS_SHARED_SECRET = (process.env.GAS_SHARED_SECRET || '').trim();
const TIMEOUT_MS = 8000;

function isConfigured() {
  return Boolean(GAS_WEBAPP_URL && GAS_SHARED_SECRET);
}

/* --------------------------------------------------------- canonical JSON */

function canonicalJSON(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSON).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(value[k]));
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(value);
}

/* ---------------------------------------------------------- HMAC signing */

function sign(secret, ts, nonce, data) {
  const canonical = canonicalJSON(data);
  const message = `${ts}|${nonce}|${canonical}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/* ------------------------------------------------------ whitelisted data */

/**
 * Build a data object containing ONLY safe, non-sensitive registration fields.
 * Never include: password, passwordHash, password_hash, OTP, verification_token,
 * reset_token, reset_expires, token_version, session tokens, or any credential.
 */
function buildRegistrationData(user, profile) {
  const data = {
    user_id: Number(user.id) || 0,
    email: String(user.email || '').slice(0, 254),
    name: String(user.name || '').slice(0, 160),
    role: String(user.role || 'user').slice(0, 20),
    status: String(user.status || 'active').slice(0, 20),
    created_at: Number(user.created_at) || 0
  };

  if (profile) {
    if (profile.gender) data.gender = String(profile.gender).slice(0, 40);
    if (profile.city) data.city = String(profile.city).slice(0, 120);
    if (profile.state) data.state = String(profile.state).slice(0, 120);
    if (profile.community) data.community = String(profile.community).slice(0, 120);
    if (profile.religion) data.religion = String(profile.religion).slice(0, 120);
    if (profile.pref_gender) data.pref_gender = String(profile.pref_gender).slice(0, 40);
  }

  return data;
}

/* ------------------------------------------------------------- push call */

/**
 * Fire-and-forget push of registration data to the Google Apps Script Web App.
 * Never throws — errors are caught and logged.
 */
function pushRegistration(user, profile) {
  if (!isConfigured()) return;

  const ts = Date.now();
  const nonce = crypto.randomBytes(16).toString('hex');
  const data = buildRegistrationData(user, profile);
  const sig = sign(GAS_SHARED_SECRET, ts, nonce, data);

  const body = JSON.stringify({
    event: 'registration',
    ts,
    nonce,
    sig,
    data
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  fetch(GAS_WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
    signal: controller.signal,
    redirect: 'follow'
  })
    .then((res) => {
      clearTimeout(timer);
      if (!res.ok) {
        console.warn(`[gsheet] Sheet backup returned HTTP ${res.status} — registration unaffected.`);
      }
    })
    .catch((err) => {
      clearTimeout(timer);
      console.warn(`[gsheet] Sheet backup failed: ${err.message} — registration unaffected.`);
    });
}

/* ---------------------------------------------------------------- exports */

module.exports = {
  isConfigured,
  pushRegistration,
  /* exported for testing / Code.gs protocol documentation */
  _canonicalJSON: canonicalJSON,
  _sign: sign,
  _buildRegistrationData: buildRegistrationData
};
