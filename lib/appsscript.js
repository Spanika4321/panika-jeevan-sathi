'use strict';
/**
 * PANIKA JEEVAN SATHI — Google Apps Script bridge client.
 *
 * The site can keep its member database in a Google Sheet through a small Apps
 * Script Web App (apps-script/Code.gs in this repository). This module is the
 * only place that knows how to talk to it.
 *
 * Protocol: pjs-bridge/1   (see apps-script/Code.gs for the server side)
 *
 *   POST https://script.google.com/macros/s/<id>/exec
 *   body: { "v": 1, "action": "ping|dump|mutate|query|setup", "token": "...", ... }
 *
 * Zero dependencies: Node 22's global fetch is used.
 */

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = 'apps-script.json';

const DEFAULTS = {
  timeoutMs: 20000,
  maxRetries: 3,
  retryBaseMs: 400,
  maxRetryDelayMs: 6000,
  // Apps Script web apps are slow to wake up; keep payloads modest.
  maxOpsPerRequest: 150
};

class AppsScriptError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'AppsScriptError';
    Object.assign(this, extra);
  }
}

/* --------------------------------------------------------------- configuration */

function normaliseUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return '';
  // Accept the /dev (editor) URL too, but remember it is not a deployment.
  return url.replace(/\/+$/, '');
}

function configFromEnv(env = process.env) {
  const url = normaliseUrl(env.PJS_SHEETS_URL);
  if (!url) return null;
  return {
    url,
    token: String(env.PJS_SHEETS_TOKEN || '').trim(),
    mode: String(env.PJS_SHEETS_MODE || '').trim().toLowerCase(),
    timeoutMs: Number(env.PJS_SHEETS_TIMEOUT_MS || DEFAULTS.timeoutMs),
    source: 'env'
  };
}

function configPath(dataDir) {
  return path.join(dataDir, CONFIG_FILE);
}

function readStoredConfig(dataDir) {
  if (!dataDir) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(dataDir), 'utf8'));
    if (!raw || !raw.url) return null;
    return {
      url: normaliseUrl(raw.url),
      token: String(raw.token || '').trim(),
      mode: String(raw.mode || '').trim().toLowerCase(),
      timeoutMs: Number(raw.timeoutMs || DEFAULTS.timeoutMs),
      source: 'file',
      savedAt: raw.savedAt || null
    };
  } catch (_) {
    return null;
  }
}

/** Environment wins, then the file written from the admin panel. */
function resolveConfig(dataDir, env = process.env) {
  return configFromEnv(env) || readStoredConfig(dataDir);
}

function saveConfig(dataDir, values = {}) {
  const url = normaliseUrl(values.url);
  if (!url) throw new AppsScriptError('A web app URL is required.');
  const payload = {
    url,
    token: String(values.token || '').trim(),
    mode: String(values.mode || '').trim().toLowerCase(),
    savedAt: new Date().toISOString()
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configPath(dataDir), JSON.stringify(payload, null, 2), { mode: 0o600 });
  return Object.assign({ timeoutMs: DEFAULTS.timeoutMs }, payload);
}

function clearConfig(dataDir) {
  try {
    fs.rmSync(configPath(dataDir), { force: true });
    return true;
  } catch (_) {
    return false;
  }
}

/** Never show the deployment id in full in the admin panel. */
function describe(config) {
  if (!config) return { configured: false, url: '', tokenSet: false, mode: '' };
  const masked = config.url.replace(/(\/macros\/s\/)([A-Za-z0-9_-]{6})([A-Za-z0-9_-]*)/, '$1$2…');
  return {
    configured: true,
    url: masked,
    urlIsDeployment: /\/exec$/.test(config.url),
    source: config.source || 'env',
    mode: config.mode || (process.env.PJS_STORAGE === 'sheets' ? 'sheets' : 'mirror'),
    tokenSet: Boolean(config.token),
    timeoutMs: config.timeoutMs || DEFAULTS.timeoutMs
  };
}

/* ---------------------------------------------------------------------- client */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  const base = DEFAULTS.retryBaseMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 120);
  return Math.min(DEFAULTS.maxRetryDelayMs, base + jitter);
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/**
 * @param {{url:string, token?:string, timeoutMs?:number}} config
 * @param {{log?:(message:string)=>void, fetchImpl?:Function, retries?:number}} options
 */
function createClient(config, options = {}) {
  const log = options.log || (() => {});
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const url = normaliseUrl(config && config.url);
  if (!url) throw new AppsScriptError('No Apps Script web app URL configured.');
  const token = String((config && config.token) || '').trim();
  const timeoutMs = Number((config && config.timeoutMs) || DEFAULTS.timeoutMs);
  const maxRetries = options.retries === undefined ? DEFAULTS.maxRetries : Number(options.retries);

  let lastError = null;
  let calls = 0;

  async function call(action, payload = {}, opts = {}) {
    const body = JSON.stringify(Object.assign({ v: 1, action, token }, payload));
    const attempts = Math.max(1, maxRetries + 1);
    let last = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs || timeoutMs);
      try {
        // text/plain avoids a CORS preflight and is what Apps Script expects.
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
          body,
          redirect: 'follow',
          signal: controller.signal
        });
        const text = await res.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch (_) {
          const head = String(text || '').replace(/\s+/g, ' ').slice(0, 180);
          throw new AppsScriptError(
            `The Apps Script web app did not answer with JSON (HTTP ${res.status}). ${head}`,
            { status: res.status, action, html: !/^\s*\{/.test(String(text || '')) }
          );
        }
        if (!res.ok || data.ok === false) {
          const message = (data && data.error) || `HTTP ${res.status}`;
          throw new AppsScriptError(`Apps Script said: ${message}`, {
            status: res.status,
            action,
            remote: data
          });
        }
        calls++;
        lastError = null;
        return data;
      } catch (err) {
        last = err;
        const transient =
          err.name === 'AbortError' ||
          err.name === 'TypeError' ||
          (err.status && err.status >= 500) ||
          /did not answer with JSON/.test(err.message || '');
        if (!transient || attempt === attempts - 1) break;
        await sleep(backoffDelay(attempt));
      } finally {
        clearTimeout(timer);
      }
    }

    lastError = last;
    const reason = last && last.name === 'AbortError'
      ? `timed out after ${Math.round((opts.timeoutMs || timeoutMs) / 1000)}s`
      : (last && last.message) || 'unknown error';
    const wrapped = new AppsScriptError(`Apps Script ${action} failed: ${reason}`, {
      action,
      cause: last
    });
    log(`[apps-script] ${action} failed — ${reason}`);
    throw wrapped;
  }

  return {
    url,
    tokenSet: Boolean(token),

    call,

    /** Cheap health check; also reports the spreadsheet and tab sizes. */
    async ping() {
      const res = await call('ping');
      return res.data || {};
    },

    /** Whole-database read, used once at boot (and by "Reload from sheet"). */
    async dump(tables) {
      const res = await call('dump', tables && tables.length ? { tables: tables.join(',') } : {}, {
        timeoutMs: Math.max(timeoutMs, 60000)
      });
      const data = res.data || {};
      return { tables: data.tables || {}, counts: data.counts || {}, rows: data.rows || 0 };
    },

    /** Apply queued insert / update / remove operations. */
    async mutate(ops) {
      if (!ops.length) return { applied: 0, touched: [] };
      const batches = chunk(ops, DEFAULTS.maxOpsPerRequest);
      let applied = 0;
      const touched = [];
      for (const batch of batches) {
        const res = await call('mutate', { ops: batch });
        const data = res.data || {};
        applied += data.applied || 0;
        if (Array.isArray(data.touched)) touched.push(...data.touched);
      }
      return { applied, touched };
    },

    async query(table, where, opts) {
      const res = await call('query', { table, where: where || null, opts: opts || {} });
      const data = res.data || {};
      return data.rows || [];
    },

    async setup(newToken) {
      const res = await call('setup', newToken ? { token: newToken } : {});
      return res.data || {};
    },

    stats() {
      return { calls, url: describe({ url, token }).url, lastError: lastError ? lastError.message : null };
    }
  };
}

module.exports = {
  AppsScriptError,
  DEFAULTS,
  CONFIG_FILE,
  configFromEnv,
  configPath,
  readStoredConfig,
  resolveConfig,
  saveConfig,
  clearConfig,
  describe,
  normaliseUrl,
  createClient
};
