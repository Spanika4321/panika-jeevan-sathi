'use strict';
/**
 * PANIKA JEEVAN SATHI — profile photo storage.
 *
 * Priority:
 *   1. Supabase Storage when SUPABASE_URL + key are set (write-through)
 *   2. Cloudflare R2 when R2_* is set (write-through)
 *   3. Local folder only (dev machines with a real disk)
 *
 * save() awaits the remote put. If the remote call fails, the API fails —
 * the member is not told the photo was saved.
 */

const fs = require('node:fs');
const path = require('node:path');

const r2Lib = require('./r2');
const supabaseLib = require('./supabase');

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
  const remoteKind = options.remoteKind || (client ? 'remote' : 'local');

  fs.mkdirSync(dir, { recursive: true });

  let lastError = null;
  let lastFlushAt = 0;
  let uploads = 0;
  let downloads = 0;

  function localPath(name) {
    const file = path.join(dir, name);
    return fs.existsSync(file) ? file : null;
  }

  return {
    kind: client ? `${remoteKind}+cache` : 'local',
    dir,
    remote: Boolean(client),

    localPath,

    async save(name, buffer, contentType) {
      const clean = safeName(name);
      if (!clean) throw new Error('Invalid photo name.');
      // Remote first: a local write is only a cache. If the remote put fails,
      // the member is not told the photo was saved.
      if (client) {
        try {
          await client.put(clean, buffer, contentType || 'application/octet-stream');
        } catch (err) {
          lastError = err;
          throw err;
        }
        uploads += 1;
        lastFlushAt = Date.now();
        lastError = null;
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, clean), buffer);
      return `/${dirName}/${clean}`;
    },

    async remove(photoPathOrName) {
      const clean = safeName(photoPathOrName);
      if (!clean) return;
      try {
        fs.unlinkSync(path.join(dir, clean));
      } catch (_) {
        /* already gone */
      }
      if (client) {
        try {
          await client.remove(clean);
        } catch (err) {
          lastError = err;
          throw err;
        }
      }
    },

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
        lastError = null;
        return path.join(dir, clean);
      } catch (err) {
        lastError = err;
        log(`[photos] could not fetch ${clean} from remote storage: ${err.message}`);
        return null;
      }
    },

    flush() {
      return Promise.resolve(0);
    },

    async close() {},

    stats() {
      return {
        kind: this.kind,
        remote: Boolean(client),
        pending: 0,
        uploads,
        downloads,
        lastFlushAt,
        lastError: lastError ? lastError.message : null
      };
    }
  };
}

function configFromEnv(env = process.env) {
  return supabaseLib.configFromEnv(env) || r2Lib.configFromEnv(env);
}

function createFromEnv(options) {
  const env = options.env || process.env;
  const sb = supabaseLib.configFromEnv(env);
  if (sb) {
    const sbClient = supabaseLib.createClient(sb, { log: options.log });
    const client = supabaseLib.storageAdapter(sbClient);
    return {
      store: createStore({ ...options, client, remoteKind: 'supabase' }),
      client,
      config: sb
    };
  }
  const r2 = r2Lib.configFromEnv(env);
  const client = r2 ? r2Lib.createClient(r2, { log: options.log }) : null;
  return {
    store: createStore({ ...options, client, remoteKind: client ? 'r2' : 'local' }),
    client,
    config: r2
  };
}

module.exports = { createStore, createFromEnv, configFromEnv, safeName };
