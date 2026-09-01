'use strict';
/**
 * PANIKA JEEVAN SATHI — durable profile-photo storage.
 *
 * Storage priority:
 *   1. Cloudflare R2, when all R2_* variables are configured.
 *   2. Cloudflare D1 photo_blobs, when the member database uses D1 but R2 is
 *      unavailable. This bridge mode is intentionally capped at 512 KB/photo
 *      so the same free D1 database can safely carry the site for 3–4 months.
 *   3. A plain local folder on hosts with a persistent disk / during tests.
 *
 * Every remote mode keeps a disposable local cache:
 *   save()   → local cache + queue remote upload
 *   flush()  → persist queued uploads/deletes before the response finishes
 *   ensure() → local cache, or fetch from remote after a cold start
 */

const fs = require('node:fs');
const path = require('node:path');

const r2Lib = require('./r2');

const DEFAULT_D1_PHOTO_MAX_BYTES = 512 * 1024;

/** Only ever serve/accept these names — never a path someone typed in. */
function safeName(name) {
  const base = path.basename(String(name || ''));
  return /^[A-Za-z0-9._-]+$/.test(base) && base !== '.' && base !== '..' ? base : null;
}

/**
 * Adapt D1's HTTPS client to the tiny object client expected by createStore().
 * Blobs are queried one-at-a-time instead of entering the relational in-memory
 * mirror; otherwise a mature 350 MB photo table would make every boot download
 * 350 MB before the site could answer.
 */
function createD1Client(db) {
  const remote = db && db.kind === 'd1' && db.remoteClient;
  if (!remote) return null;

  let objects = 0;
  let bytes = 0;

  async function metadata(name) {
    const result = await remote.query(
      'SELECT size_bytes FROM "photo_blobs" WHERE "name" = ? LIMIT 1',
      [name]
    );
    return result.results && result.results[0] ? result.results[0] : null;
  }

  return {
    kind: 'd1',

    async ready() {
      const result = await remote.query(
        'SELECT COUNT(*) AS objects, COALESCE(SUM(size_bytes), 0) AS bytes FROM "photo_blobs"'
      );
      const row = (result.results && result.results[0]) || {};
      objects = Number(row.objects || 0);
      bytes = Number(row.bytes || 0);
    },

    async put(name, buffer, contentType) {
      const previous = await metadata(name);
      await remote.query(
        'INSERT OR REPLACE INTO "photo_blobs" ("name", "content_type", "data_base64", "size_bytes", "updated_at") VALUES (?, ?, ?, ?, ?)',
        [
          name,
          contentType || 'application/octet-stream',
          Buffer.from(buffer).toString('base64'),
          buffer.length,
          Date.now()
        ]
      );
      if (!previous) objects += 1;
      bytes += buffer.length - Number((previous && previous.size_bytes) || 0);
    },

    async get(name) {
      const result = await remote.query(
        'SELECT data_base64 FROM "photo_blobs" WHERE "name" = ? LIMIT 1',
        [name]
      );
      const row = result.results && result.results[0];
      if (!row || !row.data_base64) return null;
      return Buffer.from(String(row.data_base64), 'base64');
    },

    async remove(name) {
      const previous = await metadata(name);
      if (!previous) return;
      await remote.query('DELETE FROM "photo_blobs" WHERE "name" = ?', [name]);
      objects = Math.max(0, objects - 1);
      bytes = Math.max(0, bytes - Number(previous.size_bytes || 0));
    },

    stats() {
      return { objects, bytes };
    }
  };
}

/**
 * Once R2 becomes available, keep old D1 photos readable and move each one to
 * R2 on first access. New uploads go straight to R2; deletes clear both. This
 * makes the eventual upgrade a config change instead of a risky flag day.
 */
function createR2WithD1Fallback(r2, d1, log = () => {}) {
  if (!d1) return r2;
  return {
    kind: 'r2',

    ready() {
      return typeof d1.ready === 'function' ? d1.ready() : Promise.resolve();
    },

    put(name, buffer, contentType) {
      return r2.put(name, buffer, contentType);
    },

    async get(name) {
      let remote = null;
      try {
        remote = await r2.get(name);
      } catch (err) {
        log(`[photos] R2 read failed; checking the D1 bridge: ${err.message}`);
      }
      if (remote) return remote;

      const legacy = await d1.get(name);
      if (!legacy) return null;
      try {
        await r2.put(name, legacy, 'application/octet-stream');
        await d1.remove(name);
        log(`[photos] migrated ${name} from D1 to R2`);
      } catch (err) {
        // Serving the D1 copy is more important than completing migration now.
        log(`[photos] ${name} is still in D1; R2 migration will retry later: ${err.message}`);
      }
      return legacy;
    },

    async remove(name) {
      try {
        await r2.remove(name);
      } finally {
        await d1.remove(name);
      }
    },

    stats() {
      return {
        r2: typeof r2.stats === 'function' ? r2.stats() : null,
        d1Fallback: typeof d1.stats === 'function' ? d1.stats() : null
      };
    }
  };
}

function createStore(options) {
  const dataDir = options.dataDir;
  const dirName = options.dirName || 'uploads';
  const dir = path.join(dataDir, dirName);
  const client = options.client || null;
  const remoteKind = client ? String(options.remoteKind || client.kind || 'remote') : null;
  const maxBytes = Number(options.maxBytes || 4 * 1024 * 1024);
  const log = options.log || (() => {});

  fs.mkdirSync(dir, { recursive: true });

  let queue = [];
  let chain = Promise.resolve();
  let lastError = null;
  let lastFlushAt = 0;
  let uploads = 0;
  let downloads = 0;

  function enqueue(op) {
    queue.push(op);
  }

  function localPath(name) {
    const file = path.join(dir, name);
    return fs.existsSync(file) ? file : null;
  }

  async function runQueue() {
    if (!queue.length) return 0;
    const ops = queue;
    queue = [];
    try {
      for (const op of ops) {
        if (op.type === 'put') {
          await client.put(op.name, op.buffer, op.contentType || 'application/octet-stream');
          uploads += 1;
        } else if (op.type === 'delete') {
          await client.remove(op.name);
        }
      }
      lastError = null;
      lastFlushAt = Date.now();
      return ops.length;
    } catch (err) {
      queue = ops.concat(queue);
      lastError = err;
      throw err;
    }
  }

  return {
    kind: client ? `${remoteKind}+cache` : 'local',
    backend: remoteKind || 'local',
    dir,
    remote: Boolean(client),
    maxBytes,

    /** Initialise backend usage counters after the D1 schema is ready. */
    ready() {
      return client && typeof client.ready === 'function' ? client.ready() : Promise.resolve();
    },

    /** Path of a cached photo, or null when it is not on this machine. */
    localPath,

    /** Save a photo (sync: the cache file exists before the caller continues). */
    save(name, buffer, contentType) {
      const clean = safeName(name);
      if (!clean) throw new Error('Invalid photo name.');
      if (buffer.length > maxBytes) {
        const kb = Math.floor(maxBytes / 1024);
        throw Object.assign(new Error(`Image is too large for ${remoteKind || 'local'} storage (max ${kb} KB).`), {
          status: 413
        });
      }
      fs.writeFileSync(path.join(dir, clean), buffer);
      if (client) enqueue({ type: 'put', name: clean, buffer, contentType });
      return `/${dirName}/${clean}`;
    },

    /** Delete a photo from the cache and queued remote storage. */
    remove(photoPathOrName) {
      const clean = safeName(photoPathOrName);
      if (!clean) return;
      try {
        fs.unlinkSync(path.join(dir, clean));
      } catch (_) {
        /* already gone */
      }
      if (client) enqueue({ type: 'delete', name: clean });
    },

    /** Cached path, downloading from the configured backend after a cold start. */
    async ensure(photoPathOrName) {
      const clean = safeName(photoPathOrName);
      if (!clean) return null;
      const cached = localPath(clean);
      if (cached) return cached;
      if (!client) return null;
      try {
        const buffer = await client.get(clean);
        if (!buffer) return null;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, clean), buffer);
        downloads += 1;
        return path.join(dir, clean);
      } catch (err) {
        log(`[photos] could not fetch ${clean} from ${remoteKind}: ${err.message}`);
        return null;
      }
    },

    /** Push queued uploads/deletes to the configured remote backend. */
    flush() {
      if (!client) return Promise.resolve(0);
      const run = chain.then(() => runQueue());
      chain = run.then(
        () => {},
        () => {}
      );
      return run;
    },

    async close() {
      if (!client) return;
      for (let attempt = 0; attempt < 3 && queue.length; attempt += 1) {
        try {
          await runQueue();
        } catch (err) {
          log(`[photos] flush on shutdown failed: ${err.message}`);
        }
      }
      if (queue.length) log(`[photos] ${queue.length} photo operation(s) could not reach ${remoteKind}`);
    },

    stats() {
      return {
        kind: this.kind,
        backend: this.backend,
        remote: Boolean(client),
        pending: queue.length,
        uploads,
        downloads,
        maxBytes,
        usage: client && typeof client.stats === 'function' ? client.stats() : null,
        lastFlushAt,
        lastError: lastError ? lastError.message : null
      };
    }
  };
}

function configFromEnv(env = process.env) {
  return r2Lib.configFromEnv(env);
}

function createFromEnv(options) {
  const env = options.env || process.env;
  const config = configFromEnv(env);
  let client = null;
  let backend = null;
  let maxBytes = Number(options.maxBytes || 4 * 1024 * 1024);

  const d1Client = createD1Client(options.db);
  if (config) {
    const r2Client = r2Lib.createClient(config, { log: options.log });
    client = createR2WithD1Fallback(r2Client, d1Client, options.log);
    backend = 'r2';
  } else if (d1Client) {
    client = d1Client;
    backend = 'd1';
    const requested = Number(env.PJS_D1_PHOTO_MAX_BYTES || DEFAULT_D1_PHOTO_MAX_BYTES);
    maxBytes = Math.min(
      Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_D1_PHOTO_MAX_BYTES,
      // Base64 adds ~33%; 640 KB keeps both the row and the conservative
      // 900 KB D1 REST request envelope safe if the setting is raised.
      640 * 1024
    );
  }

  return {
    store: createStore({ ...options, client, remoteKind: backend, maxBytes }),
    client,
    config,
    backend
  };
}

module.exports = {
  createStore,
  createFromEnv,
  createD1Client,
  createR2WithD1Fallback,
  configFromEnv,
  safeName,
  DEFAULT_D1_PHOTO_MAX_BYTES
};
