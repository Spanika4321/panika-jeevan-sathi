'use strict';
/**
 * SEVA MARKET INDIA — PostgREST (Supabase) client.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The catalog (locations, categories, providers, services) is seed data: it
 * can be rebuilt from src/db/seed-data.js on any machine, at any time, so a
 * throwaway SQLite file is a perfectly good home for it.
 *
 * User-generated rows — accounts and enquiries — cannot be rebuilt. On a
 * free PaaS host the filesystem is ephemeral (Render wipes it on every
 * deploy and every wake-from-sleep), so those rows must leave the box on
 * the way in. Every write here is an awaited HTTPS call: if Supabase does
 * not acknowledge it, the API request fails loudly instead of pretending
 * the lead was captured. There is no in-memory queue to lose.
 *
 * Zero npm dependencies: Node 22 global fetch.
 *
 * Env:
 *   SUPABASE_URL                https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   server-side key — never sent to a browser
 */

const DEFAULTS = {
  timeoutMs: 15_000,
  retries: 2,
  retryBaseMs: 200,
  maxRetryDelayMs: 2_000,
};

class RemoteError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'RemoteError';
    Object.assign(this, extra);
  }
}

/** Read Supabase credentials from the environment (SEVA_* wins). */
function readEnvConfig(env = process.env) {
  const url = String(env.SEVA_SUPABASE_URL || env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(
    env.SEVA_SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || '',
  ).trim();
  return { url, key };
}

/**
 * Classify a Supabase key without verifying it.
 *
 * Legacy keys are JWTs whose payload carries `role`. The anon key is
 * public and, with RLS on plus grants revoked, cannot write a single row —
 * pasting it here would produce a site that looks fine until the first
 * signup fails. Catching that at boot is much kinder than at 2 a.m.
 *
 * @returns {{kind: 'jwt'|'secret'|'publishable'|'unknown', role: string|null}}
 */
function describeKey(key) {
  const value = String(key || '').trim();
  if (!value) return { kind: 'unknown', role: null };
  if (value.startsWith('sb_secret_')) return { kind: 'secret', role: 'service_role' };
  if (value.startsWith('sb_publishable_')) return { kind: 'publishable', role: 'anon' };

  const parts = value.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return { kind: 'jwt', role: typeof payload.role === 'string' ? payload.role : null };
    } catch (_) {
      return { kind: 'jwt', role: null };
    }
  }
  return { kind: 'unknown', role: null };
}

/** True when the key is certainly a browser-safe (write-incapable) key. */
function isPublicKey(key) {
  const { role } = describeKey(key);
  return role === 'anon';
}

/** Encode one value for a PostgREST filter. */
function encodeFilterValue(value) {
  if (value === null || value === undefined) return 'null';
  const raw = String(value);
  // PostgREST treats , . : ( ) and quotes as syntax; quote anything risky.
  return /[,.:()"'\s]/.test(raw) ? `"${raw.replace(/"/g, '\\"')}"` : raw;
}

/**
 * Build a PostgREST query string.
 *
 * `where` accepts `{ col: value }` for equality and `{ col: { gte, lte, gt,
 * lt, ne, like, in } }` for everything else — the same shape the models
 * already think in, so call sites stay readable.
 */
function buildQuery({ columns, where, order, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (columns) params.set('select', Array.isArray(columns) ? columns.join(',') : columns);

  for (const [col, raw] of Object.entries(where || {})) {
    if (raw === undefined) continue;
    if (raw === null) {
      params.append(col, 'is.null');
      continue;
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [op, value] of Object.entries(raw)) {
        if (value === undefined) continue;
        if (op === 'in') {
          params.append(col, `in.(${[].concat(value).map(encodeFilterValue).join(',')})`);
        } else {
          params.append(col, `${op}.${encodeFilterValue(value)}`);
        }
      }
      continue;
    }
    params.append(col, `eq.${encodeFilterValue(raw)}`);
  }

  if (order) params.set('order', order);
  if (limit !== undefined && limit !== null) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  return params.toString();
}

/** Total row count out of a `Content-Range: 0-24/1234` header. */
function parseContentRange(header) {
  const total = String(header || '').split('/')[1];
  const parsed = Number(total);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A 4xx will fail again identically; a 5xx, 429 or dropped socket may not. */
function isRetryable(status) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** Turn a PostgREST failure into something a human can act on. */
function describeFailure(status, table, body) {
  if (status === 404) {
    return [
      `Supabase does not know the table "${table}" (HTTP 404).`,
      'Run `npm run storage:sql`, paste the output into the Supabase SQL editor,',
      'press Run, then restart the service.',
    ].join('\n');
  }
  if (status === 401 || status === 403) {
    return [
      `Supabase rejected the credentials (HTTP ${status}).`,
      'SUPABASE_SERVICE_ROLE_KEY must be the service-role key, not the anon key.',
    ].join('\n');
  }
  return `Supabase returned HTTP ${status} for "${table}".\n${String(body || '').slice(0, 600)}`;
}

/**
 * Create a thin PostgREST client.
 *
 * @param {object} options
 * @param {string} options.url      https://<ref>.supabase.co
 * @param {string} options.key      service-role key
 * @param {Function} [options.fetchImpl]  injected in tests — no socket needed
 */
function createRemoteClient({
  url,
  key,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULTS.timeoutMs,
  retries = DEFAULTS.retries,
  log = () => {},
} = {}) {
  const baseUrl = String(url || '').trim().replace(/\/+$/, '');
  const apiKey = String(key || '').trim();
  if (!baseUrl) throw new RemoteError('Missing SUPABASE_URL.');
  if (!apiKey) throw new RemoteError('Missing SUPABASE_SERVICE_ROLE_KEY.');
  if (typeof fetchImpl !== 'function') throw new RemoteError('No fetch implementation available.');

  const endpoint = (table, query) => `${baseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`;

  function headers(extra = {}) {
    return {
      apikey: apiKey,
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...extra,
    };
  }

  /** One request, with bounded retries on transport-ish failures. */
  async function send(table, url_, init) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url_, {
          ...init,
          signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
        });
      } catch (err) {
        lastError = new RemoteError(`Supabase request failed: ${err.message}`, { table, cause: err });
        if (attempt === retries) throw lastError;
        await sleep(Math.min(DEFAULTS.retryBaseMs * 2 ** attempt, DEFAULTS.maxRetryDelayMs));
        continue;
      }

      if (response.ok) return response;

      const body = await response.text().catch(() => '');
      lastError = new RemoteError(describeFailure(response.status, table, body), {
        table,
        status: response.status,
      });
      if (!isRetryable(response.status) || attempt === retries) throw lastError;
      log(`retrying ${table} after HTTP ${response.status}`);
      await sleep(Math.min(DEFAULTS.retryBaseMs * 2 ** attempt, DEFAULTS.maxRetryDelayMs));
    }
    throw lastError || new RemoteError('Supabase request failed.', { table });
  }

  async function json(response) {
    const text = await response.text().catch(() => '');
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  return {
    baseUrl,
    /** INSERT ... RETURNING *. Returns the inserted rows. */
    async insert(table, rows, { returning = 'representation', upsert = false } = {}) {
      const payload = [].concat(rows);
      const prefer = [
        `return=${returning}`,
        upsert ? 'resolution=merge-duplicates' : null,
      ].filter(Boolean).join(',');
      const response = await send(table, endpoint(table), {
        method: 'POST',
        headers: headers({ prefer }),
        body: JSON.stringify(payload),
      });
      const data = await json(response);
      return Array.isArray(data) ? data : [];
    },

    /** SELECT with filters. Returns an array (possibly empty). */
    async select(table, options = {}) {
      const response = await send(table, endpoint(table, buildQuery(options)), {
        method: 'GET',
        headers: headers(),
      });
      const data = await json(response);
      return Array.isArray(data) ? data : [];
    },

    /** SELECT ... LIMIT 1. Returns a row or null. */
    async first(table, options = {}) {
      const rows = await this.select(table, { ...options, limit: 1 });
      return rows[0] ?? null;
    },

    /** UPDATE ... WHERE. Returns the updated rows. */
    async update(table, patch, where) {
      const response = await send(table, endpoint(table, buildQuery({ where })), {
        method: 'PATCH',
        headers: headers({ prefer: 'return=representation' }),
        body: JSON.stringify(patch),
      });
      const data = await json(response);
      return Array.isArray(data) ? data : [];
    },

    /**
     * DELETE ... WHERE. Returns the deleted rows.
     *
     * A filter is mandatory: PostgREST refuses a filter-less DELETE, and so
     * does this client, because "purge the token table" and "purge every
     * durable row" are one typo apart.
     */
    async remove(table, where, { returning = 'representation' } = {}) {
      const keys = Object.keys(where || {}).filter((key) => where[key] !== undefined);
      if (!keys.length) throw new RemoteError(`Refusing to DELETE from "${table}" without a filter.`);
      const response = await send(table, endpoint(table, buildQuery({ where })), {
        method: 'DELETE',
        headers: headers({ prefer: `return=${returning}` }),
      });
      const data = await json(response);
      return Array.isArray(data) ? data : [];
    },

    /** Exact COUNT(*) via the Content-Range header — no rows transferred. */
    async count(table, where = {}) {
      const query = buildQuery({ columns: 'id', where, limit: 1 });
      const response = await send(table, endpoint(table, query), {
        method: 'GET',
        headers: headers({ prefer: 'count=exact' }),
      });
      const range = response.headers?.get ? response.headers.get('content-range') : null;
      return parseContentRange(range);
    },

    /** Cheap reachability probe used by /api/v1/health/deep. */
    async ping(table) {
      const started = Date.now();
      await this.count(table, {});
      return { ok: true, ms: Date.now() - started };
    },
  };
}

module.exports = {
  DEFAULTS,
  RemoteError,
  readEnvConfig,
  describeKey,
  isPublicKey,
  buildQuery,
  parseContentRange,
  isRetryable,
  describeFailure,
  createRemoteClient,
};
