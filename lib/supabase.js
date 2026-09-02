'use strict';
/**
 * PANIKA JEEVAN SATHI — Supabase (PostgREST + Storage) client and DB driver.
 *
 * Production user data lives in Supabase Postgres, not on Render's disk.
 * Every insert/update/delete/select is an awaited HTTPS call (write-through).
 * There is no in-memory queue: if Supabase does not ACK, the API call fails.
 *
 * Zero npm dependencies: Node 22 global fetch.
 *
 * Env:
 *   SUPABASE_URL                 https://<ref>.supabase.co  (or a compatible mock)
 *   SUPABASE_SERVICE_ROLE_KEY    server-side key (never sent to the browser)
 *   SUPABASE_STORAGE_BUCKET      default "uploads"
 */

const TABLES = {
  users: 'id',
  profiles: 'user_id',
  interests: 'id',
  shortlist: 'id',
  messages: 'id',
  notifications: 'id',
  reports: 'id',
  stories: 'id',
  contact_messages: 'id',
  settings: 'key',
  audit_logs: 'id'
};

const DEFAULTS = {
  timeoutMs: 20000,
  maxRetries: 3,
  retryBaseMs: 200,
  maxRetryDelayMs: 4000
};

class SupabaseError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'SupabaseError';
    Object.assign(this, extra);
  }
}

function configFromEnv(env = process.env) {
  const url = String(env.SUPABASE_URL || env.PJS_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(
    env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || env.PJS_SUPABASE_KEY || ''
  ).trim();
  if (!url || !key) return null;
  return {
    url,
    key,
    bucket: String(env.SUPABASE_STORAGE_BUCKET || 'uploads').replace(/^\/+|\/+$/g, '') || 'uploads'
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function conditions(where) {
  const out = [];
  if (!where) return out;
  for (const [col, raw] of Object.entries(where)) {
    if (raw === undefined) continue;
    if (raw === null) {
      out.push({ col, op: 'is_null' });
    } else if (isPlainObject(raw)) {
      if (Array.isArray(raw.in)) out.push({ col, op: 'in', value: raw.in });
      if (raw.gte !== undefined) out.push({ col, op: 'gte', value: raw.gte });
      if (raw.lte !== undefined) out.push({ col, op: 'lte', value: raw.lte });
      if (raw.gt !== undefined) out.push({ col, op: 'gt', value: raw.gt });
      if (raw.lt !== undefined) out.push({ col, op: 'lt', value: raw.lt });
      if (raw.like !== undefined) out.push({ col, op: 'like', value: raw.like });
      if (raw.ne !== undefined) out.push({ col, op: 'ne', value: raw.ne });
    } else {
      out.push({ col, op: 'eq', value: raw });
    }
  }
  return out;
}

function encValue(value) {
  if (value === null || value === undefined) return 'null';
  const text = String(value);
  return encodeURIComponent(text);
}

function restQuery(where, opts = {}) {
  const parts = [];
  const conds = conditions(where);
  if (!conds.length && opts.requireFilter) {
    /* PostgREST refuses unfiltered PATCH/DELETE. */
    parts.push('id=eq.-1');
  }
  for (const c of conds) {
    switch (c.op) {
      case 'eq':
        parts.push(`${encodeURIComponent(c.col)}=eq.${encValue(c.value)}`);
        break;
      case 'ne':
        parts.push(`${encodeURIComponent(c.col)}=neq.${encValue(c.value)}`);
        break;
      case 'is_null':
        parts.push(`${encodeURIComponent(c.col)}=is.null`);
        break;
      case 'in': {
        const vals = Array.isArray(c.value) ? c.value : [];
        if (!vals.length) {
          parts.push('id=eq.-9007199254740991');
        } else {
          parts.push(
            `${encodeURIComponent(c.col)}=in.(${vals.map((v) => encValue(v)).join(',')})`
          );
        }
        break;
      }
      case 'gte':
        parts.push(`${encodeURIComponent(c.col)}=gte.${encValue(c.value)}`);
        break;
      case 'lte':
        parts.push(`${encodeURIComponent(c.col)}=lte.${encValue(c.value)}`);
        break;
      case 'gt':
        parts.push(`${encodeURIComponent(c.col)}=gt.${encValue(c.value)}`);
        break;
      case 'lt':
        parts.push(`${encodeURIComponent(c.col)}=lt.${encValue(c.value)}`);
        break;
      case 'like': {
        const pattern = String(c.value || '').replace(/%/g, '*').replace(/_/g, '?');
        parts.push(`${encodeURIComponent(c.col)}=ilike.${encValue(pattern)}`);
        break;
      }
      default:
        break;
    }
  }
  if (opts.order) {
    const list = Array.isArray(opts.order) ? opts.order : [opts.order];
    const order = list
      .map((o) => {
        const desc = String(o).startsWith('-');
        const col = desc ? String(o).slice(1) : String(o);
        return `${col}.${desc ? 'desc' : 'asc'}`;
      })
      .join(',');
    if (order) parts.push(`order=${order}`);
  }
  if (opts.limit !== undefined) parts.push(`limit=${Math.max(0, Number(opts.limit) | 0)}`);
  if (opts.offset) parts.push(`offset=${Math.max(0, Number(opts.offset) | 0)}`);
  if (opts.select) parts.push(`select=${opts.select}`);
  return parts.join('&');
}

function createClient(config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = options.log || (() => {});
  const limits = Object.assign({}, DEFAULTS, options.limits || {});
  const restBase = `${config.url}/rest/v1`;
  const storageBase = `${config.url}/storage/v1`;
  const bucket = config.bucket || 'uploads';

  let lastError = null;
  let requestCount = 0;

  function authHeaders(extra) {
    return Object.assign(
      {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json'
      },
      extra || {}
    );
  }

  async function send(url, init) {
    let attempt = 0;
    for (;;) {
      try {
        const res = await fetchImpl(url, {
          ...init,
          headers: init.headers,
          signal: AbortSignal.timeout(limits.timeoutMs)
        });
        requestCount += 1;
        const text = await res.text();
        if (res.status === 429 || res.status >= 500) {
          throw new SupabaseError(`Supabase HTTP ${res.status}: ${text.slice(0, 240)}`, {
            status: res.status,
            retryable: true
          });
        }
        if (!res.ok) {
          throw new SupabaseError(`Supabase HTTP ${res.status}: ${text.slice(0, 300)}`, {
            status: res.status,
            retryable: false,
            body: text
          });
        }
        lastError = null;
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch (_) {
            json = text;
          }
        }
        return { res, json, text };
      } catch (err) {
        const retryable =
          err.retryable === true ||
          err.name === 'TimeoutError' ||
          err.name === 'AbortError' ||
          err.code === 'ECONNRESET';
        lastError = err;
        if (!retryable || attempt >= limits.maxRetries) throw err;
        const delay = Math.min(limits.maxRetryDelayMs, limits.retryBaseMs * 2 ** attempt);
        log(`[supabase] ${err.message} — retrying in ${delay} ms`);
        await sleep(delay);
        attempt += 1;
      }
    }
  }

  async function ensureBucket() {
    try {
      await send(`${storageBase}/bucket/${encodeURIComponent(bucket)}`, {
        method: 'GET',
        headers: authHeaders()
      });
      return;
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    try {
      await send(`${storageBase}/bucket`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id: bucket, name: bucket, public: false })
      });
    } catch (err) {
      if (err.status === 409) return;
      throw err;
    }
  }

  return {
    kind: 'supabase',
    url: config.url,
    bucket,

    async ping() {
      const { json } = await send(`${restBase}/users?select=id&limit=1`, {
        method: 'GET',
        headers: authHeaders({ Prefer: 'count=exact' })
      });
      return Array.isArray(json);
    },

    async select(table, where, opts = {}) {
      const qs = restQuery(where, Object.assign({ select: '*' }, opts));
      const url = `${restBase}/${encodeURIComponent(table)}${qs ? `?${qs}` : ''}`;
      const headers = authHeaders();
      if (opts.count) headers.Prefer = 'count=exact';
      const { res, json } = await send(url, { method: 'GET', headers });
      const rows = Array.isArray(json) ? json : [];
      const range = res.headers.get('content-range') || '';
      const totalMatch = /\/(\d+|\*)$/.exec(range);
      const total = totalMatch && totalMatch[1] !== '*' ? Number(totalMatch[1]) : rows.length;
      return { rows, total };
    },

    async insert(table, row) {
      const body = {};
      for (const [k, v] of Object.entries(row || {})) {
        if (v !== undefined) body[k] = v;
      }
      const { json } = await send(`${restBase}/${encodeURIComponent(table)}`, {
        method: 'POST',
        headers: authHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify(body)
      });
      const rows = Array.isArray(json) ? json : json ? [json] : [];
      return rows[0] || body;
    },

    async update(table, where, patch) {
      const body = {};
      for (const [k, v] of Object.entries(patch || {})) {
        if (v !== undefined) body[k] = v;
      }
      if (!Object.keys(body).length) return 0;
      const qs = restQuery(where, { requireFilter: true });
      const { json } = await send(`${restBase}/${encodeURIComponent(table)}?${qs}`, {
        method: 'PATCH',
        headers: authHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify(body)
      });
      const rows = Array.isArray(json) ? json : json ? [json] : [];
      return rows.length;
    },

    async remove(table, where) {
      const qs = restQuery(where, { requireFilter: true });
      const { json } = await send(`${restBase}/${encodeURIComponent(table)}?${qs}`, {
        method: 'DELETE',
        headers: authHeaders({ Prefer: 'return=representation' })
      });
      const rows = Array.isArray(json) ? json : json ? [json] : [];
      return rows.length;
    },

    async count(table, where) {
      const pk = TABLES[table] || 'id';
      const qs = restQuery(where, { select: pk, limit: 1 });
      const url = `${restBase}/${encodeURIComponent(table)}${qs ? `?${qs}` : `?select=${pk}&limit=1`}`;
      const { res } = await send(url, {
        method: 'HEAD',
        headers: authHeaders({ Prefer: 'count=exact' })
      });
      const range = res.headers.get('content-range') || '';
      const totalMatch = /\/(\d+|\*)$/.exec(range);
      if (totalMatch && totalMatch[1] !== '*') return Number(totalMatch[1]);
      const full = await this.select(table, where, { select: 'id' });
      return full.rows.length;
    },

    async put(key, data, contentType = 'application/octet-stream') {
      await ensureBucket();
      const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const url = `${storageBase}/object/${encodeURIComponent(bucket)}/${String(key)
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
      await send(url, {
        method: 'POST',
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${config.key}`,
          'Content-Type': contentType,
          'x-upsert': 'true'
        },
        body
      });
      return { key, size: body.length };
    },

    async get(key) {
      const url = `${storageBase}/object/${encodeURIComponent(bucket)}/${String(key)
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
      try {
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: {
            apikey: config.key,
            Authorization: `Bearer ${config.key}`
          },
          signal: AbortSignal.timeout(limits.timeoutMs)
        });
        requestCount += 1;
        if (res.status === 404) return null;
        if (!res.ok) {
          throw new SupabaseError(`Supabase storage GET HTTP ${res.status}`, { status: res.status });
        }
        return Buffer.from(await res.arrayBuffer());
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },

    async removeObject(key) {
      const url = `${storageBase}/object/${encodeURIComponent(bucket)}`;
      try {
        await send(url, {
          method: 'DELETE',
          headers: authHeaders(),
          body: JSON.stringify({ prefixes: [String(key)] })
        });
        return true;
      } catch (err) {
        if (err.status === 404) return false;
        throw err;
      }
    },

    ensureBucket,
    stats() {
      return { requests: requestCount, lastError: lastError ? lastError.message : null };
    }
  };
}

const INT_KEYS = new Set([
  'id',
  'user_id',
  'from_user_id',
  'to_user_id',
  'sender_id',
  'receiver_id',
  'reporter_id',
  'target_user_id',
  'actor_id',
  'target_id',
  'age',
  'height_cm',
  'email_verified',
  'token_version',
  'reset_expires',
  'last_login',
  'created_at',
  'updated_at',
  'responded_at',
  'read_at',
  'is_read',
  'hide_photo',
  'hide_contact',
  'searchable',
  'profile_complete',
  'approved',
  'handled',
  'pref_age_min',
  'pref_age_max'
]);

function coerceRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (INT_KEYS.has(k) && v !== null && v !== undefined && v !== '') {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function createDriver(client, options = {}) {
  const log = options.log || (() => {});
  let loaded = false;
  let lastError = null;

  return {
    kind: 'supabase',

    async load() {
      try {
        await client.ping();
        try {
          await client.ensureBucket();
        } catch (err) {
          log(`[supabase] storage bucket: ${err.message}`);
        }
        loaded = true;
        lastError = null;
        let rows = 0;
        for (const table of Object.keys(TABLES)) {
          try {
            rows += await client.count(table, null);
          } catch (_) {
            /* table may be empty-count via HEAD; ignore */
          }
        }
        return { tables: Object.keys(TABLES).length, rows };
      } catch (err) {
        lastError = err;
        throw new SupabaseError(
          `Supabase is not reachable or schema is missing: ${err.message}. Run supabase/schema.sql in the Supabase SQL editor.`,
          { cause: err }
        );
      }
    },

    async insert(table, row) {
      const created = coerceRow(await client.insert(table, row));
      const pk = TABLES[table];
      if (pk && created && created[pk] !== undefined) row[pk] = created[pk];
      return Object.assign({}, row, created || {});
    },

    async update(table, where, patch) {
      return client.update(table, where, patch);
    },

    async remove(table, where) {
      return client.remove(table, where);
    },

    async one(table, where) {
      const { rows } = await client.select(table, where, { limit: 1 });
      return rows[0];
    },

    async all(table, where, opts = {}) {
      const { rows } = await client.select(table, where, opts);
      return rows;
    },

    async count(table, where) {
      return client.count(table, where);
    },

    exec() {},
    raw() {
      return [];
    },
    async flush() {
      return 0;
    },
    async close() {},
    stats() {
      return {
        kind: 'supabase',
        loaded,
        pending: 0,
        lastError: lastError ? lastError.message : null,
        ...client.stats()
      };
    }
  };
}

function storageAdapter(client) {
  return {
    kind: 'supabase',
    async put(key, data, contentType) {
      return client.put(key, data, contentType);
    },
    async get(key) {
      return client.get(key);
    },
    async remove(key) {
      return client.removeObject(key);
    }
  };
}

module.exports = {
  TABLES,
  DEFAULTS,
  SupabaseError,
  configFromEnv,
  createClient,
  createDriver,
  storageAdapter,
  restQuery,
  conditions
};
