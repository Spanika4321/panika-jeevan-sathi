'use strict';
/**
 * SEVA MARKET INDIA — Appwrite Cloud REST client (Database collections only).
 *
 * Zero npm dependencies (Node 22 global fetch). Every column value is stored
 * as JSON.stringify(value) inside a string attribute, so types (INTEGER,
 * REAL, TEXT) and SQL NULL survive the round trip losslessly. Only the
 * remote *mirror* reads these documents; SQLite stays the query engine, so
 * no query translation is ever needed.
 *
 * Document ids:
 *   • tables with an integer primary key  → $id = String(row id)
 *   • service_areas (composite key)       → $id = "<provider_id>-<pin_code>"
 *
 * Env (SEVA_APPWRITE_* canonical; APPWRITE_* accepted as aliases so one
 * deployment can share a single Appwrite API key across apps):
 *   SEVA_APPWRITE_ENDPOINT      default https://cloud.appwrite.io/v1
 *   SEVA_APPWRITE_PROJECT_ID
 *   SEVA_APPWRITE_API_KEY       server key with databases.* scopes
 *   SEVA_APPWRITE_DATABASE_ID   the Database holding the collections
 */

const DEFAULTS = {
  endpoint: 'https://cloud.appwrite.io/v1',
  timeoutMs: 20000,
  maxRetries: 3,
  retryBaseMs: 250,
  maxRetryDelayMs: 5000,
  pageSize: 5000,
  maxAttrSize: 16384,
};

class AppwriteError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'AppwriteError';
    Object.assign(this, extra);
  }
}

function configFromEnv(env = process.env) {
  const pick = (a, b) => String(env[a] || env[b] || '').trim();
  const projectId = pick('SEVA_APPWRITE_PROJECT_ID', 'APPWRITE_PROJECT_ID');
  const apiKey = pick('SEVA_APPWRITE_API_KEY', 'APPWRITE_API_KEY');
  const databaseId = pick('SEVA_APPWRITE_DATABASE_ID', 'APPWRITE_DATABASE_ID');
  const endpoint = (
    env.SEVA_APPWRITE_ENDPOINT ||
    env.APPWRITE_ENDPOINT ||
    DEFAULTS.endpoint
  ).replace(/\/+$/, '');
  if (!projectId || !apiKey || !databaseId) return null;
  return {
    endpoint,
    projectId,
    apiKey,
    databaseId,
    autoSchema: String(env.SEVA_APPWRITE_AUTO_SCHEMA || env.APPWRITE_AUTO_SCHEMA || '') === '1',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} config configFromEnv() output
 * @param {{log?: Function, fetchImpl?: Function}} [options]
 */
function createClient(config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = options.log || (() => {});
  const limits = Object.assign({}, DEFAULTS, options.limits || {});
  const base = config.endpoint;
  const dbPath = `/databases/${encodeURIComponent(config.databaseId)}/collections`;

  let requestCount = 0;
  let lastError = null;

  function headers(extra) {
    return Object.assign(
      {
        'X-Appwrite-Project': config.projectId,
        'X-Appwrite-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
      extra || {},
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
          signal: AbortSignal.timeout(limits.timeoutMs),
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
            retryable: true,
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
            body: text,
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

  function collUrl(table) {
    return `${base}${dbPath}/${encodeURIComponent(table)}`;
  }

  /** Idempotent schema: string attributes for every column except `id`. */
  async function ensureSchema(collections) {
    for (const table of Object.keys(collections)) {
      const def = collections[table];
      const columns = Array.isArray(def) ? def : def.columns;
      let info = null;
      try {
        const { json } = await send('GET', collUrl(table));
        info = json;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      if (!info) {
        log(`[appwrite] creating collection ${table}`);
        const { json } = await send('POST', `${base}${dbPath}`, {
          body: JSON.stringify({
            collectionId: table,
            name: table,
            permissions: [],
          }),
        });
        if (!json || json.$id !== table) throw new AppwriteError('Collection creation failed.', { status: 502 });
        info = { attributes: [] };
      }
      const existing = new Map((info.attributes || []).map((a) => [a.key, a]));
      const pending = [];
      for (const col of columns) {
        if (col === 'id') continue;
        if (existing.has(col)) continue;
        log(`[appwrite] collection ${table}: attribute ${col}`);
        const { json } = await send('POST', `${collUrl(table)}/attributes/string`, {
          body: JSON.stringify({
            key: col,
            xsize: limits.maxAttrSize,
            xrequired: false,
            xarray: false,
          }),
        });
        if (!json || json.key !== col) throw new AppwriteError(`Attribute ${col} creation failed.`, { status: 502 });
        pending.push(col);
      }
      if (pending.length) {
        // The real service creates attributes asynchronously: wait until
        // they are all 'available' before writing documents.
        for (let i = 0; i < 120; i += 1) {
          const { json } = await send('GET', collUrl(table));
          const attrs = new Map((json.attributes || []).map((a) => [a.key, a]));
          const failed = pending.find((k) => attrs.get(k) && attrs.get(k).status === 'failed');
          if (failed) {
            throw new AppwriteError(
              `Appwrite attribute '${failed}' on '${table}' failed: ${attrs.get(failed).error || 'unknown'}`,
              { status: 400 },
            );
          }
          if (pending.every((k) => attrs.get(k) && attrs.get(k).status === 'available')) break;
          if (i === 119) throw new AppwriteError(`Appwrite attributes on '${table}' did not become available.`, { status: 408 });
          await sleep(600);
        }
      }
    }
    return { collections: Object.keys(collections).length };
  }

  async function listAll(table) {
    const out = [];
    let cursor = null;
    for (;;) {
      const qs = new URLSearchParams();
      qs.append('queries[]', `limit(${limits.pageSize})`);
      if (cursor !== null) qs.append('queries[]', `cursorAfter(${JSON.stringify(String(cursor))})`);
      let json = null;
      try {
        ({ json } = await send('GET', `${collUrl(table)}/documents?${qs.toString()}`));
      } catch (err) {
        // Collection not provisioned yet (fresh mirror): that is an empty
        // collection, not an error. A missing *database* surfaces loudly a
        // moment later via ensureSchema, so this cannot hide misconfig.
        if (err.status === 404) return out;
        throw err;
      }
      const docs = Array.isArray(json && json.documents) ? json.documents : [];
      out.push(...docs);
      if (docs.length < limits.pageSize) return out;
      cursor = docs[docs.length - 1].$id;
    }
  }

  async function createDoc(table, documentId, data) {
    const { json } = await send('POST', `${collUrl(table)}/documents`, {
      body: JSON.stringify({ documentId, data, permissions: [] }),
    });
    return json;
  }

  async function updateDoc(table, documentId, data) {
    const { json } = await send(
      'PATCH',
      `${collUrl(table)}/documents/${encodeURIComponent(String(documentId))}`,
      { body: JSON.stringify({ data }) },
    );
    return json;
  }

  async function deleteDoc(table, documentId) {
    try {
      await send('DELETE', `${collUrl(table)}/documents/${encodeURIComponent(String(documentId))}`);
    } catch (err) {
      if (err.status !== 404) throw err; // already gone is fine
    }
    return true;
  }

  /** True when any collection holds at least one document. */
  async function hasAnyData(tables) {
    for (const table of tables) {
      const docs = await listAll(table);
      if (docs.length) return true;
    }
    return false;
  }

  return {
    ensureSchema,
    listAll,
    createDoc,
    updateDoc,
    deleteDoc,
    hasAnyData,
    stats() {
      return { requests: requestCount, lastError: lastError ? lastError.message : null };
    },
  };
}

module.exports = { DEFAULTS, AppwriteError, configFromEnv, createClient };
