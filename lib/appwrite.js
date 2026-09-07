'use strict';
/**
 * PANIKA JEEVAN SATHI — Appwrite Cloud Database driver (classic
 * "Database / collections" REST API).
 *
 * Appwrite stores every row as a JSON document, so this driver follows the
 * exact same architecture as the proven Cloudflare D1 driver in lib/db.js:
 *
 *   reads  → in-memory mirror (the same engine as the JSON store, which the
 *            test suite proves is behaviour-identical to SQLite for this app)
 *   writes → applied to the mirror immediately, then each mutation is
 *            written through to Appwrite over HTTPS and the flush is awaited
 *            before the HTTP response completes (nothing is silently queued
 *            for long; a failed write makes the API call fail).
 *
 * Row identity rules (see lib/schema-map.js):
 *   • tables whose SQLite primary key is `id` use that number AS the Appwrite
 *     document id ($id), so ids stay small and match across backends;
 *   • profiles use "p{user_id}", settings use "k{key}" as their $id.
 * Appwrite cannot store SQL NULL: columns that SQLite keeps null use a
 * lossless marker (0 for ints, '' for strings) and are converted back to
 * null on every read.
 *
 * Zero npm dependencies — Node 22 global fetch.
 *
 * Env (canonical names, PJS_APPWRITE_* aliases also accepted):
 *   APPWRITE_ENDPOINT      default https://cloud.appwrite.io/v1
 *   APPWRITE_PROJECT_ID    e.g. 6a9e5230000b2f752e11
 *   APPWRITE_API_KEY       server API key (scopes: databases.*)
 *   APPWRITE_DATABASE_ID   the Database id that holds the collections
 *   APPWRITE_AUTO_SCHEMA   set '1' to auto-provision missing collections
 *                          (used by tests; normally run npm run appwrite:setup)
 */

const schemaMap = require('./schema-map');

const { TABLE_ORDER, TABLES, pkOf, intColumns, nullMarkerOf, docIdFor } = schemaMap;

const DEFAULTS = {
  timeoutMs: 20000,
  maxRetries: 3,
  retryBaseMs: 250,
  maxRetryDelayMs: 5000,
  pageSize: 5000
};

class AppwriteError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'AppwriteError';
    Object.assign(this, extra);
  }
}

function configFromEnv(env = process.env) {
  const endpoint = String(
    env.APPWRITE_ENDPOINT || env.PJS_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1'
  )
    .trim()
    .replace(/\/+$/, '');
  const projectId = String(env.APPWRITE_PROJECT_ID || env.PJS_APPWRITE_PROJECT_ID || '').trim();
  const apiKey = String(env.APPWRITE_API_KEY || env.PJS_APPWRITE_API_KEY || '').trim();
  const databaseId = String(env.APPWRITE_DATABASE_ID || env.PJS_APPWRITE_DATABASE_ID || '').trim();
  if (!projectId || !apiKey || !databaseId) return null;
  return {
    endpoint,
    projectId,
    apiKey,
    databaseId,
    autoSchema: String(env.APPWRITE_AUTO_SCHEMA || '') === '1',
    timeoutMs: Number(env.APPWRITE_TIMEOUT_MS || DEFAULTS.timeoutMs),
    pageSize: Number(env.APPWRITE_PAGE_SIZE || DEFAULTS.pageSize)
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/* ----------------------------------------------------------- REST client */

function createClient(config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = options.log || (() => {});
  const limits = Object.assign({}, DEFAULTS, options.limits || {});
  const base = config.endpoint.replace(/\/+$/, '');
  const coll = (table) =>
    `${base}/databases/${encodeURIComponent(config.databaseId)}/collections/${encodeURIComponent(table)}`;

  let lastError = null;
  let requestCount = 0;

  function headers(extra) {
    return Object.assign(
      {
        'X-Appwrite-Project': config.projectId,
        'X-Appwrite-Key': config.apiKey,
        'Content-Type': 'application/json'
      },
      extra || {}
    );
  }

  async function send(method, url, init = {}) {
    let attempt = 0;
    for (;;) {
      try {
        const res = await fetchImpl(url, {
          method,
          headers: headers(init.headers),
          ...(init.body === undefined ? {} : { body: init.body }),
          signal: AbortSignal.timeout(limits.timeoutMs)
        });
        requestCount += 1;
        const text = await res.text();
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch (_) {
            json = text;
          }
        }
        if (res.status === 429 || res.status >= 500) {
          throw new AppwriteError(`Appwrite HTTP ${res.status}: ${text.slice(0, 240)}`, {
            status: res.status,
            retryable: true
          });
        }
        if (!res.ok) {
          const message =
            (json && typeof json.message === 'string' ? json.message : text).slice(0, 300) ||
            `Appwrite HTTP ${res.status}`;
          throw new AppwriteError(message, {
            status: res.status,
            type: json && typeof json.type === 'string' ? json.type : undefined,
            retryable: false,
            body: text
          });
        }
        lastError = null;
        return { status: res.status, json };
      } catch (err) {
        const retryable =
          err.retryable === true ||
          err.name === 'TimeoutError' ||
          err.name === 'AbortError' ||
          err.code === 'ECONNRESET' ||
          err.code === 'UND_ERR_CONNECT_TIMEOUT' ||
          err.code === 'ENOTFOUND';
        lastError = err;
        if (!retryable || attempt >= limits.maxRetries) throw err;
        const delay = Math.min(limits.maxRetryDelayMs, limits.retryBaseMs * 2 ** attempt);
        log(`[appwrite] ${err.message} — retrying in ${delay} ms`);
        await sleep(delay);
        attempt += 1;
      }
    }
  }

  /** GET with repeated queries[] parameters, URL-encoded per query string. */
  async function listDocuments(table, queries = []) {
    const qs = new URLSearchParams();
    for (const q of queries) qs.append('queries[]', String(q));
    const suffix = qs.toString();
    const { json } = await send('GET', `${coll(table)}/documents${suffix ? `?${suffix}` : ''}`);
    if (!json || !Array.isArray(json.documents)) {
      throw new AppwriteError('Appwrite returned an unexpected documents response.', {
        status: 502
      });
    }
    return { total: Number(json.total || 0), documents: json.documents };
  }

  async function createDocument(table, documentId, data) {
    const { json } = await send('POST', `${coll(table)}/documents`, {
      body: JSON.stringify({ documentId, data, permissions: [] })
    });
    return json;
  }

  async function updateDocument(table, documentId, data) {
    const { json } = await send(
      'PATCH',
      `${coll(table)}/documents/${encodeURIComponent(String(documentId))}`,
      { body: JSON.stringify({ data }) }
    );
    return json;
  }

  async function deleteDocument(table, documentId) {
    try {
      await send('DELETE', `${coll(table)}/documents/${encodeURIComponent(String(documentId))}`);
    } catch (err) {
      // Deleting something that is already gone (e.g. removed in the Appwrite
      // console) is not an error for the mirror.
      if (err.status !== 404) throw err;
    }
    return true;
  }

  async function getCollection(table) {
    const { json } = await send('GET', coll(table));
    return json;
  }

  async function createCollection(table) {
    const { json } = await send('POST', `${base}/databases/${encodeURIComponent(config.databaseId)}/collections`, {
      body: JSON.stringify({ collectionId: table, name: table, permissions: [] })
    });
    return json;
  }

  async function createAttribute(table, col) {
    const typePath = col.type === 'int' ? 'integer' : 'string';
    const payload = { key: col.name, xrequired: false, xarray: false };
    if (col.type === 'str') payload.xsize = Math.max(1, Number(col.size || 255));
    const { json } = await send(
      'POST',
      `${coll(table)}/attributes/${typePath}`,
      { body: JSON.stringify(payload) }
    );
    return json;
  }

  async function createIndex(table, key, type, attributes) {
    const { json } = await send('POST', `${coll(table)}/indexes`, {
      body: JSON.stringify({
        key: `${table}_${key}`,
        type,
        attributes: Array.isArray(attributes) ? attributes : [attributes],
        orders: ['ASC']
      })
    });
    return json;
  }

  /** Wait until every expected attribute is present and 'available'. */
  async function waitForAttributes(table, expectedKeys, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const info = await getCollection(table);
      const attrs = {};
      for (const a of info.attributes || []) attrs[a.key] = a;
      if (expectedKeys.every((key) => attrs[key] && attrs[key].status === 'available')) return;
      const failed = expectedKeys.find((key) => attrs[key] && attrs[key].status === 'failed');
      if (failed) {
        throw new AppwriteError(
          `Appwrite attribute '${failed}' on collection '${table}' failed to create: ${attrs[failed].error || 'unknown error'}`,
          { status: 400 }
        );
      }
      if (Date.now() > deadline) {
        const missing = expectedKeys.filter((key) => !(attrs[key] && attrs[key].status === 'available'));
        throw new AppwriteError(
          `Appwrite attributes on collection '${table}' did not become available: ${missing.join(', ')}`,
          { status: 408 }
        );
      }
      await sleep(700);
    }
  }

  /**
   * Idempotent provisioning: create the database collections, attributes and
   * the single UNIQUE index (users.email) that Appwrite needs. Everything
   * else is queried from the in-memory mirror, so no extra indexes are
   * required — exactly like the SQLite/JSON backends.
   */
  async function ensureSchema() {
    for (const table of TABLE_ORDER) {
      const def = TABLES[table];
      let info = null;
      try {
        info = await getCollection(table);
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      if (!info) {
        log(`[appwrite] creating collection ${table}`);
        await createCollection(table);
        info = { attributes: [] };
      } else {
        log(`[appwrite] collection ${table} exists`);
      }
      const existing = new Map((info.attributes || []).map((a) => [a.key, a]));
      const created = [];
      for (const col of def.columns) {
        // The numeric `id` column lives in the Appwrite $id — no attribute.
        if (col.name === 'id' && pkOf(table) === 'id') continue;
        const have = existing.get(col.name);
        if (have && have.type === (col.type === 'int' ? 'integer' : 'string')) continue;
        if (have) {
          log(`[appwrite] collection ${table}: attribute ${col.name} type mismatch — leaving it untouched`);
          continue;
        }
        log(`[appwrite] collection ${table}: creating attribute ${col.name} (${col.type})`);
        await createAttribute(table, col);
        created.push(col.name);
      }
      if (created.length) await waitForAttributes(table, created);
    }
    // Unique guard on users.email (register race / console edits).
    try {
      const info = await getCollection('users');
      const indexes = (info.indexes || []).map((i) => i.key);
      if (!indexes.includes('users_email')) {
        await createIndex('users', 'email', 'unique', ['email']);
      }
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    return { collections: TABLE_ORDER.length };
  }

  async function ping() {
    const info = await getCollection(TABLE_ORDER[0]);
    return Boolean(info && info.$id);
  }

  return {
    kind: 'appwrite',
    url: base,
    databaseId: config.databaseId,
    projectId: config.projectId,
    listDocuments,
    createDocument,
    updateDocument,
    deleteDocument,
    getCollection,
    ensureSchema,
    waitForAttributes,
    ping,
    stats() {
      return { requests: requestCount, lastError: lastError ? lastError.message : null };
    }
  };
}

/* ------------------------------------------------------------- mirror core */

/** Same helpers as lib/db.js createMemoryDriver (JSON store engine). */
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

function likeToRegExp(pattern) {
  const esc = String(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
  return new RegExp('^' + esc + '$', 'i');
}

function matches(row, cond) {
  const v = row[cond.col];
  switch (cond.op) {
    case 'eq':
      return v == cond.value; // eslint-disable-line eqeqeq
    case 'ne':
      return !(v == cond.value); // eslint-disable-line eqeqeq
    case 'is_null':
      return v === null || v === undefined;
    case 'in':
      return cond.value.some((x) => x == v); // eslint-disable-line eqeqeq
    case 'gte':
      return v !== null && v !== undefined && v >= cond.value;
    case 'lte':
      return v !== null && v !== undefined && v <= cond.value;
    case 'gt':
      return v !== null && v !== undefined && v > cond.value;
    case 'lt':
      return v !== null && v !== undefined && v < cond.value;
    case 'like':
      return v !== null && v !== undefined && likeToRegExp(cond.value).test(String(v));
    default:
      return false;
  }
}

function orderKeys(order) {
  if (!order) return [];
  const list = Array.isArray(order) ? order : [order];
  return list.map((o) => {
    const desc = String(o).startsWith('-');
    return { col: desc ? String(o).slice(1) : String(o), desc };
  });
}

/* ------------------------------------------------------------ row bridge */

/** Appwrite document → SQLite-shaped row (markers converted back to null). */
function rowFromDocument(table, doc) {
  const ints = intColumns(table);
  const markers = nullMarkerOf(table);
  const row = {};
  for (const [key, value] of Object.entries(doc || {})) {
    if (key.startsWith('$') || key === 'permissions') continue;
    let v = value;
    if (ints.has(key) && typeof v === 'string' && v !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) v = n;
    }
    if (Object.prototype.hasOwnProperty.call(markers, key) && v === markers[key]) v = null;
    row[key] = v;
  }
  if (pkOf(table) === 'id' && typeof doc.$id === 'string' && /^\d+$/.test(doc.$id)) {
    row.id = Number(doc.$id);
  }
  return row;
}

/** SQLite-shaped row → Appwrite document data (nulls become markers). */
function dataFromRow(table, row) {
  const pk = pkOf(table);
  const ints = intColumns(table);
  const markers = nullMarkerOf(table);
  const data = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (key === undefined || value === undefined) continue;
    if (key === 'id' && pk === 'id') continue; // id lives in $id
    let v = value;
    if (v === null) v = Object.prototype.hasOwnProperty.call(markers, key) ? markers[key] : '';
    if (ints.has(key) && typeof v === 'string' && v !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) v = n;
    }
    data[key] = v;
  }
  return data;
}

/**
 * Mirror driver: same table API as every other driver; writes are queued and
 * written through to Appwrite by flush(), which the server awaits before the
 * response is finished (see lib/db.js asAsyncDriver).
 */
function createDriver(client, options = {}) {
  const log = options.log || (() => {});
  const autoSchema = options.autoSchema === true;
  const state = { tables: {}, seq: {} };
  for (const t of Object.keys(TABLES)) state.tables[t] = [];

  // row object → Appwrite document id
  const docIds = new Map();

  let queue = [];
  let chain = Promise.resolve();
  let lastError = null;
  let lastFlushAt = 0;
  let flushCount = 0;
  let loaded = false;

  function filterRowsRefs(table, where) {
    const rows = state.tables[table] || [];
    const conds = conditions(where);
    if (!conds.length) return rows.slice();
    return rows.filter((r) => conds.every((c) => matches(r, c)));
  }

  function enqueue(job) {
    queue.push(job);
  }

  function snapshot(table, row) {
    return dataFromRow(table, row);
  }

  async function flushOnce() {
    if (!queue.length) return 0;
    const jobs = queue;
    queue = [];
    try {
      for (const job of jobs) {
        if (job.kind === 'create') {
          try {
            await client.createDocument(job.table, job.docId, job.data);
          } catch (err) {
          if (err.status === 409 && /^\d+$/.test(String(job.docId))) {
            // Document id collision (rare, e.g. a row created in the Appwrite
            // console after boot): retry once with the next free numeric id.
            const fresh = await nextFreeNumericId(job.table, Number(job.docId));
            if (fresh === null) throw err;
            job.docId = String(fresh);
            await client.createDocument(job.table, job.docId, job.data);
          } else {
            throw err;
          }
          }
        } else if (job.kind === 'update') {
          await client.updateDocument(job.table, job.docId, job.data);
        } else if (job.kind === 'delete') {
          await client.deleteDocument(job.table, job.docId);
        }
      }
      lastError = null;
      lastFlushAt = Date.now();
      flushCount += 1;
      return jobs.length;
    } catch (err) {
      // Keep the failing batch so the next flush (next request, timer or
      // shutdown) retries it — same policy as the D1 mirror.
      queue = jobs.concat(queue);
      lastError = err;
      throw err;
    }
  }

  function flush() {
    const run = chain.then(() => flushOnce());
    chain = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  /** Scan remote ids after a numeric collision; returns a free id or null. */
  async function nextFreeNumericId(table, preferred) {
    try {
      const rows = await fetchAllPages(client, table);
      let max = Math.max(0, Number(preferred) || 0);
      for (const doc of rows) {
        if (doc && typeof doc.$id === 'string' && /^\d+$/.test(doc.$id)) {
          const n = Number(doc.$id);
          if (Number.isFinite(n) && n > max) max = n;
        }
      }
      return String(max + 1);
    } catch (_) {
      return null;
    }
  }

  const driver = {
    kind: 'appwrite',

    async load() {
      loaded = false;
      try {
        if (autoSchema) {
          log('[appwrite] APPWRITE_AUTO_SCHEMA=1 — provisioning collections');
          await client.ensureSchema();
        }
        for (const table of Object.keys(TABLES)) {
          const rows = await client.listAllDocuments
            ? await client.listAllDocuments(table)
            : await fetchAllPages(client, table);
          state.tables[table] = [];
          let max = 0;
          for (const doc of rows) {
            const row = rowFromDocument(table, doc);
            state.tables[table].push(row);
            docIds.set(row, doc.$id);
            const id = Number(row.id);
            if (Number.isFinite(id) && id > max) max = id;
          }
          state.seq[table] = max;
        }
        loaded = true;
        lastError = null;
        const total = Object.keys(TABLES).reduce((n, t) => n + state.tables[t].length, 0);
        return { tables: Object.keys(TABLES).length, rows: total };
      } catch (err) {
        lastError = err;
        if (err.status === 404 && /not (found|exist)/i.test(err.message)) {
          throw new AppwriteError(
            `Appwrite schema is missing (${err.message}). Run 'npm run appwrite:setup' once, or set APPWRITE_AUTO_SCHEMA=1.`,
            { cause: err }
          );
        }
        throw new AppwriteError(
          `Appwrite is not reachable or the API key is not authorised: ${err.message} (check APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_API_KEY / APPWRITE_DATABASE_ID).`,
          { cause: err }
        );
      }
    },

    /* ------------------------------------------------------- synchronous mirror reads (same engine as the JSON store) */

    one(table, where) {
      const rows = filterRowsRefs(table, where);
      return rows.length ? Object.assign({}, rows[0]) : undefined;
    },

    all(table, where, opts = {}) {
      let rows = filterRowsRefs(table, where);
      const keys = orderKeys(opts.order);
      if (keys.length) {
        rows = rows.slice().sort((a, b) => {
          for (const k of keys) {
            const av = a[k.col];
            const bv = b[k.col];
            if (av === bv) continue;
            const cmp =
              av === null || av === undefined
                ? -1
                : bv === null || bv === undefined
                  ? 1
                  : av < bv
                    ? -1
                    : 1;
            return k.desc ? -cmp : cmp;
          }
          return 0;
        });
      }
      if (opts.offset) rows = rows.slice(Number(opts.offset));
      if (opts.limit !== undefined) rows = rows.slice(0, Math.max(0, Number(opts.limit) | 0));
      return rows.map((r) => Object.assign({}, r));
    },

    count(table, where) {
      return filterRowsRefs(table, where).length;
    },

    /* ----------------------------------------------------- writes: mirror first, Appwrite second (flushed) */

    insert(table, row) {
      const pk = pkOf(table);
      const clone = Object.assign({}, row);
      if (pk === 'id' && clone.id === undefined) {
        state.seq[table] = (state.seq[table] || 0) + 1;
        clone.id = state.seq[table];
      } else if (pk === 'id' && clone.id !== undefined) {
        state.seq[table] = Math.max(state.seq[table] || 0, Number(clone.id) || 0);
      }
      state.tables[table].push(clone);
      const docId = docIdFor(table, clone);
      docIds.set(clone, docId);
      enqueue({ kind: 'create', table, docId, data: snapshot(table, clone) });
      return clone;
    },

    update(table, where, row) {
      const targets = filterRowsRefs(table, where);
      const cols = Object.keys(row || {});
      for (const r of targets) Object.assign(r, row);
      if (targets.length && cols.length) {
        for (const r of targets) {
          const docId = docIds.get(r);
          if (docId) enqueue({ kind: 'update', table, docId, data: snapshot(table, r) });
        }
      }
      return targets.length;
    },

    remove(table, where) {
      const conds = conditions(where);
      const keep = [];
      let removed = 0;
      for (const r of state.tables[table] || []) {
        if (conds.length && conds.every((c) => matches(r, c))) {
          removed += 1;
          const docId = docIds.get(r);
          if (docId) enqueue({ kind: 'delete', table, docId });
          docIds.delete(r);
        } else {
          keep.push(r);
        }
      }
      state.tables[table] = keep;
      return removed;
    },

    exec() {},
    raw() {
      return [];
    },
    flush,
    async close() {
      for (let attempt = 0; attempt < 3 && queue.length; attempt += 1) {
        try {
          await flushOnce();
        } catch (err) {
          log(`[appwrite] flush on shutdown failed: ${err.message}`);
        }
      }
      if (queue.length) log(`[appwrite] ${queue.length} change(s) could not be saved to Appwrite`);
    },
    stats() {
      return {
        kind: 'appwrite',
        loaded,
        pending: queue.length,
        flushes: flushCount,
        lastFlushAt,
        lastError: lastError ? lastError.message : null,
        rows: Object.keys(TABLES).reduce((n, t) => n + state.tables[t].length, 0),
        ...client.stats()
      };
    }
  };
  return driver;
}

/** Page through every document of a collection (limit(5000) + cursor). */
async function fetchAllPages(client, table, pageSize = DEFAULTS.pageSize) {
  const out = [];
  let cursor = null;
  for (;;) {
    const queries = [`limit(${Math.min(5000, Math.max(1, pageSize))})`];
    if (cursor !== null) queries.push(`cursorAfter(${JSON.stringify(String(cursor))})`);
    const { documents } = await client.listDocuments(table, queries);
    out.push(...documents);
    if (!documents.length || documents.length < Math.min(5000, Math.max(1, pageSize))) return out;
    cursor = documents[documents.length - 1].$id;
  }
}

module.exports = {
  DEFAULTS,
  AppwriteError,
  configFromEnv,
  createClient,
  createDriver,
  ensureSchemaOf: (client) => client.ensureSchema(),
  rowFromDocument,
  dataFromRow,
  fetchAllPages
};
