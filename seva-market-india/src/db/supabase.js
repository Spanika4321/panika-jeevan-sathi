'use strict';
/**
 * SEVA MARKET INDIA — Supabase (PostgREST) remote-mirror client.
 *
 * Same shape as the Appwrite client (src/db/appwrite.js) so the whole sync
 * engine in src/db/remote.js works unchanged: ensureSchema / createDoc /
 * updateDoc / deleteDoc / listAll / hasAnyData. The mirror stores every
 * SQLite row as one JSON document in a SINGLE table (default `seva_mirror`)
 * inside the SAME Supabase project Panika Jeevan Sathi already uses — the
 * table name is unique, so Panika's tables are never touched or mixed in.
 *
 * Zero npm dependencies: Node 22 global fetch against PostgREST.
 *
 * Env (SEVA_SUPABASE_* canonical; plain SUPABASE_* accepted so a host that
 * already exports Panika's Supabase credentials works unchanged):
 *   SEVA_SUPABASE_URL                https://<ref>.supabase.co
 *   SEVA_SUPABASE_SERVICE_ROLE_KEY   server-side key (never to the browser)
 *   SEVA_SUPABASE_TABLE              mirror table, default `seva_mirror`
 *
 * One-time manual step (SQL DDL cannot go through PostgREST):
 *   run scripts/supabase-init.sql once in the Supabase SQL editor.
 */

const DEFAULTS = {
  timeoutMs: 20000,
  maxRetries: 3,
  retryBaseMs: 200,
  maxRetryDelayMs: 4000,
  table: 'seva_mirror',
  pageSize: 1000,
};

class SupabaseError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'SupabaseError';
    Object.assign(this, extra);
  }
}

function configFromEnv(env = process.env) {
  const pick = (a, b) => String(env[a] || env[b] || '').trim();
  const url = pick('SEVA_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
  const key = pick('SEVA_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return {
    provider: 'supabase',
    url,
    key,
    table: String(env.SEVA_SUPABASE_TABLE || env.SUPABASE_TABLE || DEFAULTS.table).trim() || DEFAULTS.table,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the error means "mirror table does not exist yet". */
function isMissingTable(err) {
  return Boolean(err && (err.code === 'PGRST205' || /PGRST205/i.test(err.message || '')));
}

/**
 * @param {object} config configFromEnv() output
 * @param {{log?: Function}} [options]
 */
function createClient(config, options = {}) {
  const log = options.log || (() => {});
  const limits = Object.assign({}, DEFAULTS, config.limits || {});
  const base = `${config.url}/rest/v1`;
  const tableUrl = `${base}/${encodeURIComponent(config.table)}`;
  const headers = {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
  };
  let requestCount = 0;
  let lastError = null;

  async function send(method, url, { body, extraHeaders } = {}) {
    let attempt = 0;
    for (;;) {
      requestCount += 1;
      try {
        const res = await fetch(url, {
          method,
          headers: Object.assign({}, headers, extraHeaders),
          body,
          signal: AbortSignal.timeout(limits.timeoutMs),
        });
        const text = await res.text();
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch (_) {
            /* non-JSON body — keep as text below */
          }
        }
        if (res.status >= 200 && res.status < 300) {
          lastError = null;
          const contentRange = res.headers.get('content-range') || '';
          return { status: res.status, json, contentRange };
        }
        // 404 with PGRST205 = table not provisioned (fresh mirror).
        const err = new SupabaseError(
          (json && (json.message || json.error)) || `Supabase ${method} ${url} → ${res.status}`,
          {
            status: res.status,
            code: json && json.code,
            retryable: res.status === 429 || res.status >= 500,
            body: text,
          },
        );
        lastError = err;
        if (!err.retryable || attempt >= limits.maxRetries) throw err;
      } catch (err) {
        const retryable =
          err.retryable === true ||
          err.name === 'TimeoutError' ||
          err.name === 'AbortError' ||
          err.code === 'ECONNRESET' ||
          err.code === 'ENOTFOUND' ||
          err.code === 'ECONNREFUSED';
        lastError = err;
        if (!retryable || attempt >= limits.maxRetries) throw err;
        const delay = Math.min(limits.maxRetryDelayMs, limits.retryBaseMs * 2 ** attempt);
        log(`[supabase] ${err.message} — retrying in ${delay} ms`);
        await sleep(delay);
        attempt += 1;
      }
    }
  }

  function rangeOf(total) {
    // Range: 0-999 → "0-999/N"; empty → "*/0"
    return total === 0 ? '*/0' : `0-${Math.min(limits.pageSize, total) - 1}/${total}`;
  }

  /**
   * Mirror table presence check. DDL is a one-time manual step, so this
   * never auto-creates; instead it throws an actionable SupabaseError with
   * `provisionRequired: true` when scripts/supabase-init.sql still has to
   * be run once in the SQL editor.
   */
  async function ensureSchema(_tables) {
    try {
      const { json } = await send('GET', `${tableUrl}?select=id&limit=1`);
      return { collections: 1, ready: true, rows: Array.isArray(json) ? json.length : 0 };
    } catch (err) {
      if (isMissingTable(err)) {
        throw new SupabaseError(
          `Supabase mirror table '${config.table}' does not exist yet — run scripts/supabase-init.sql ` +
            'once in the Supabase SQL editor (dashboard → SQL Editor → paste → Run).',
          { status: 404, code: 'PGRST205', provisionRequired: true },
        );
      }
      throw err;
    }
  }

  /** Insert-or-update one mirrored row (PostgREST upsert, merge-duplicates). */
  async function createDoc(_table, pk, doc) {
    const id = String(pk);
    const qs = new URLSearchParams();
    qs.append('on_conflict', 'tbl,id');
    const { status } = await send('POST', `${tableUrl}?${qs.toString()}`, {
      body: JSON.stringify({ tbl: String(_table), id, doc }),
      extraHeaders: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    return { ok: status >= 200 && status < 300 };
  }

  /** Mirror uses upsert for updates too — createDoc covers both. */
  async function updateDoc(table, pk, doc) {
    return createDoc(table, pk, doc);
  }

  /** Remove one mirrored row. PostgREST returns 204 even when absent. */
  async function deleteDoc(table, pk) {
    const qs = new URLSearchParams();
    qs.append('tbl', `eq.${String(table)}`);
    qs.append('id', `eq.${String(pk)}`);
    await send('DELETE', `${tableUrl}?${qs.toString()}`);
    return true;
  }

  /** All docs for one logical table (mirror rows carry tbl+id+doc). */
  async function listAll(table) {
    const out = [];
    let offset = 0;
    for (;;) {
      const qs = new URLSearchParams();
      qs.append('select', 'tbl,id,doc');
      qs.append('tbl', `eq.${String(table)}`);
      qs.append('order', 'id.asc');
      const { json, contentRange } = await send('GET', `${tableUrl}?${qs.toString()}`, {
        extraHeaders: { Range: `${offset}-${offset + limits.pageSize - 1}`, Prefer: 'count=exact' },
      });
      const rows = Array.isArray(json) ? json : [];
      for (const row of rows) {
        // Re-shape to the engine's document contract: $id (String pk) +
        // column values exactly as rowToDoc produced them.
        const doc = row && typeof row.doc === 'object' && row.doc !== null ? row.doc : {};
        out.push(Object.assign({ $id: String(row.id) }, doc));
      }
      const total = parseInt(String(contentRange || '').split('/')[1], 10);
      const got = rows.length;
      if (got === 0 || got < limits.pageSize || (Number.isFinite(total) && offset + got >= total)) return out;
      offset += got;
    }
  }

  /** True when the mirror holds at least one document (table missing = empty). */
  async function hasAnyData() {
    try {
      const { json, contentRange } = await send('GET', `${tableUrl}?select=id`, {
        extraHeaders: { Range: '0-0', Prefer: 'count=exact' },
      });
      const total = parseInt(String(contentRange || '').split('/')[1], 10);
      return (Array.isArray(json) ? json.length : 0) > 0 || (Number.isFinite(total) && total > 0);
    } catch (err) {
      if (isMissingTable(err)) return false; // mirror never provisioned → empty
      throw err;
    }
  }

  return {
    ensureSchema,
    createDoc,
    updateDoc,
    deleteDoc,
    listAll,
    hasAnyData,
    stats() {
      return { requests: requestCount, lastError: lastError ? lastError.message : null };
    },
  };
}

module.exports = { DEFAULTS, SupabaseError, configFromEnv, createClient, isMissingTable };
