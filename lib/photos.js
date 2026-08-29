'use strict';
/**
 * PANIKA JEEVAN SATHI — profile photo storage.
 *
 * On a host with a disk, photos are simply files in `<dataDir>/uploads`.
 * On Render's Free plan the filesystem is wiped whenever the instance sleeps,
 * so photos are additionally pushed to Cloudflare R2 (S3-compatible) and
 * pulled back on demand:
 *
 *   save()      → write to the local cache + queue an upload
 *   flush()     → perform the queued upload/delete (awaited by the server
 *                 before the HTTP response completes, and on shutdown)
 *   ensure()    → return the cached file, or download it from R2 and cache it
 *
 * When R2 is not configured the store is a plain local folder, which is exactly
 * how the site behaved before.
 */

const fs = require('node:fs');
const path = require('node:path');

const r2Lib = require('./r2');

/** Only ever serve/accept these names — never a path someone typed in. */
function safeName(name) {
  const base = path.basename(String(name || ''));
  return /^[A-Za-z0-9._-]+$/.test(base) && base !== '.' && base !== '..' ? base : null;
}

function createStore(options) {
  const dataDir = options.dataDir;
  const dirName = options.dirName || 'uploads';
  const dir = path.join(dataDir, dirName);
  const client = options.client || null;
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
    kind: client ? 'r2+cache' : 'local',
    dir,
    remote: Boolean(client),

    /** Path of a cached photo, or null when it is not on this machine. */
    localPath,

    /** Save a photo (sync: the file is on disk before the caller continues). */
    save(name, buffer, contentType) {
      const clean = safeName(name);
      if (!clean) throw new Error('Invalid photo name.');
      fs.writeFileSync(path.join(dir, clean), buffer);
      if (client) enqueue({ type: 'put', name: clean, buffer, contentType });
      return `/${dirName}/${clean}`;
    },

    /** Delete a photo from the cache and (queued) from R2. */
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

    /** Cached path, downloading from R2 first when the instance lost its disk. */
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
        log(`[photos] could not fetch ${clean} from R2: ${err.message}`);
        return null;
      }
    },

    /** Push queued uploads/deletes to R2. No-op when R2 is not configured. */
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
      if (queue.length) log(`[photos] ${queue.length} photo operation(s) could not reach R2`);
    },

    stats() {
      return {
        kind: this.kind,
        remote: Boolean(client),
        pending: queue.length,
        uploads,
        downloads,
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
  const config = configFromEnv(options.env || process.env);
  const client = config ? r2Lib.createClient(config, { log: options.log }) : null;
  return { store: createStore({ ...options, client }), client, config };
}

module.exports = { createStore, createFromEnv, configFromEnv, safeName };
