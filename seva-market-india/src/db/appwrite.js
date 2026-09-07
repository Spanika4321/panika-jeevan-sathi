'use strict';
/**
 * SEVA MARKET INDIA — Appwrite Databases REST client.
 *
 * Zero npm dependencies: Node 22 global fetch, same philosophy as the rest
 * of the codebase. This client only speaks to the Appwrite server API with
 * an API key — nothing here ever runs in a browser.
 *
 * Storage model: one Appwrite collection per SQLite table, one document per
 * row. Each document has a single `json` string attribute holding the full
 * row as JSON. That keeps Appwrite schema-agnostic: a new SQL migration
 * never needs a matching Appwrite attribute migration.
 *
 * Env:
 *   APPWRITE_ENDPOINT     default https://cloud.appwrite.io/v1
 *   APPWRITE_PROJECT_ID   required
 *   APPWRITE_API_KEY      required (server key with Databases scopes)
 *   APPWRITE_DATABASE_ID  default "seva-market"
 */

const DEFAULTS = {
  timeoutMs: 20000,
  maxRetries: 3,
  retryBaseMs: 250,
  maxRetryDelayMs: 4000,
  pageSize: 100,
  attributePollMs: 500,
  attributePollTries: 60,
};

class AppwriteError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'AppwriteError';
    Object.assign(this, extra);
  }
}

/**
 * Build a config from explicit values + environment, or null when the
 * required pieces are missing (meaning: run without Appwrite).
 */
function configFrom(explicit = {}, env = process.env) {
  let endpoint = String(explicit.endpoint || env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .trim()
    .replace(/\/+$/, '');
  // People paste "https://cloud.appwrite.io" from the console; normalise.
  if (endpoint && !/\/v\d+$/.test(endpoint)) endpoint += '/v1';

  const projectId = String(explicit.projectId || env.APPWRITE_PROJECT_ID || '').trim();
  const apiKey = String(explicit.apiKey || env.APPWRITE_API_KEY || '').trim();
  const databaseId = String(explicit.databaseId || env.APPWRITE_DATABASE_ID || 'seva-market').trim();

  if (!endpoint || !projectId || !apiKey) return null;
  return { endpoint, projectId, apiKey, databaseId };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Encode one Appwrite query object for the `queries[]` URL parameter. */
function q(method, values) {
  return `queries[]=${encodeURIComponent(JSON.stringify({ method, values }))}`;
}

function createClient(config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = options.log || (() => {});
  const limits = Object.assign({}, DEFAULTS, options.limits || {});
  const base = config.endpoint;
  const dbId = config.databaseId;

  function headers() {
    return {
      'X-Appwrite-Project': config.projectId,
      'X-Appwrite-Key': config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /** One HTTP call with timeout + retry on 429/5xx/network errors. */
  async function send(path, init = {}) {
    const url = `${base}${path}`;
    let attempt = 0;
    for (;;) {
      try {
        const res = await fetchImpl(url, {
          method: init.method || 'GET',
          headers: headers(),
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: AbortSignal.timeout(limits.timeoutMs),
        });
        const text = await res.text();
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch (_) {
            json = null;
          }
        }
        if (res.status === 429 || res.status >= 500) {
          throw new AppwriteError(`Appwrite HTTP ${res.status}: ${text.slice(0, 240)}`, {
            status: res.status,
            retryable: true,
          });
        }
        if (!res.ok) {
          throw new AppwriteError(
            `Appwrite HTTP ${res.status}: ${(json && json.message) || text.slice(0, 300)}`,
            { status: res.status, retryable: false, type: json && json.type }
          );
        }
        return json;
      } catch (err) {
        const retryable =
          err.retryable === true ||
          err.name === 'TimeoutError' ||
          err.name === 'AbortError' ||
          err.code === 'ECONNRESET' ||
          err.cause?.code === 'ECONNREFUSED' ||
          err.cause?.code === 'ECONNRESET';
        if (!retryable || attempt >= limits.maxRetries) throw err;
        const delay = Math.min(limits.maxRetryDelayMs, limits.retryBaseMs * 2 ** attempt);
        log(`[appwrite] ${err.message} — retrying in ${delay} ms`);
        await sleep(delay);
        attempt += 1;
      }
    }
  }

  /** Create the database if it does not exist yet. */
  async function ensureDatabase() {
    try {
      await send(`/databases/${encodeURIComponent(dbId)}`);
      return;
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    try {
      await send('/databases', { method: 'POST', body: { databaseId: dbId, name: dbId } });
    } catch (err) {
      if (err.status !== 409) throw err; // 409: someone else created it first
    }
  }

  /** Wait until the `json` attribute of a collection is usable. */
  async function waitForJsonAttribute(collectionId) {
    for (let i = 0; i < limits.attributePollTries; i += 1) {
      const list = await send(
        `/databases/${encodeURIComponent(dbId)}/collections/${encodeURIComponent(collectionId)}/attributes`
      );
      const attr = (list.attributes || []).find((a) => a.key === 'json');
      if (attr && attr.status === 'available') return;
      if (attr && attr.status === 'failed') {
        throw new AppwriteError(`Attribute "json" failed to build on collection ${collectionId}.`);
      }
      await sleep(limits.attributePollMs);
    }
    throw new AppwriteError(`Attribute "json" on ${collectionId} never became available.`);
  }

  /** Create the collection + `json` attribute if missing. */
  async function ensureCollection(collectionId) {
    let exists = true;
    try {
      await send(
        `/databases/${encodeURIComponent(dbId)}/collections/${encodeURIComponent(collectionId)}`
      );
    } catch (err) {
      if (err.status !== 404) throw err;
      exists = false;
    }
    if (!exists) {
      try {
        await send(`/databases/${encodeURIComponent(dbId)}/collections`, {
          method: 'POST',
          body: {
            collectionId,
            name: collectionId,
            // No user-facing permissions: only the server API key can touch
            // these documents. The browser never sees Appwrite directly.
            permissions: [],
            documentSecurity: false,
          },
        });
      } catch (err) {
        if (err.status !== 409) throw err;
      }
    }

    const list = await send(
      `/databases/${encodeURIComponent(dbId)}/collections/${encodeURIComponent(collectionId)}/attributes`
    );
    const attr = (list.attributes || []).find((a) => a.key === 'json');
    if (!attr) {
      try {
        await send(
          `/databases/${encodeURIComponent(dbId)}/collections/${encodeURIComponent(collectionId)}/attributes/string`,
          { method: 'POST', body: { key: 'json', size: 65535, required: false } }
        );
      } catch (err) {
        if (err.status !== 409) throw err;
      }
    }
    await waitForJsonAttribute(collectionId);
  }

  /** Ensure the database and one collection per table exist. */
  async function ensureSchema(tables) {
    await ensureDatabase();
    for (const table of tables) {
      await ensureCollection(table); // sequential: attribute builds are async server-side
    }
  }

  /** Every document in a collection, paginated with a cursor. */
  async function listAllDocuments(collectionId) {
    const docs = [];
    let cursor = null;
    for (;;) {
      let path =
        `/databases/${encodeURIComponent(dbId)}/collections/${encodeURIComponent(collectionId)}` +
        `/documents?${q('limit', [limits.pageSize])}`;
      if (cursor) path += `&${q('cursorAfter', [cursor])}`;
      const page = await send(path);
      const batch = Array.isArray(page.documents) ? page.documents : [];
      docs.push(...batch);
      if (batch.length < limits.pageSize) return docs;
      cursor = batch[batch.length - 1].$id;
    }
  }

  async function createDocument(collectionId, documentId, data) {
    return send(
      `/databases/${encodeURIComponent(dbId)}/collections/${encodeURIComponent(collectionId)}/documents`,
      { method: 'POST', body: { documentId, data, permissions: [] } }
    );
  }

  async function updateDocument(collectionId, documentId, data) {
    return send(
      `/databases/${encodeURIComponent(dbId)}/collections/${encodeURIComponent(collectionId)}` +
        `/documents/${encodeURIComponent(documentId)}`,
      { method: 'PATCH', body: { data } }
    );
  }

  /** Create-or-update without caring which one it turns out to be. */
  async function upsertDocument(collectionId, documentId, data) {
    try {
      return await createDocument(collectionId, documentId, data);
    } catch (err) {
      if (err.status !== 409) throw err;
      return updateDocument(collectionId, documentId, data);
    }
  }

  async function deleteDocument(collectionId, documentId) {
    try {
      return await send(
        `/databases/${encodeURIComponent(dbId)}/collections/${encodeURIComponent(collectionId)}` +
          `/documents/${encodeURIComponent(documentId)}`,
        { method: 'DELETE' }
      );
    } catch (err) {
      if (err.status === 404) return null; // already gone: that is the goal
      throw err;
    }
  }

  /** Reachability probe used at boot. */
  async function ping() {
    await ensureDatabase();
    return true;
  }

  return {
    kind: 'appwrite',
    endpoint: config.endpoint,
    databaseId: dbId,
    send,
    ensureSchema,
    listAllDocuments,
    createDocument,
    updateDocument,
    upsertDocument,
    deleteDocument,
    ping,
  };
}

module.exports = { AppwriteError, configFrom, createClient, DEFAULTS };
