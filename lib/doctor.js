'use strict';
/**
 * PANIKA JEEVAN SATHI — cloud configuration doctor.
 *
 * Answers one question: “why is the site not using Cloudflare D1 / R2?”
 *
 *   • envStatus()  — which storage environment variables are present on this
 *                    host (names + shape only, NEVER the values), which are
 *                    missing, and plain-English warnings for partial setups.
 *   • liveCheck()  — optionally (» /api/health?doctor=1 «) proves the
 *                    credentials really work by pinging D1 and R2, with the
 *                    exact error message when they do not.
 *
 * Used by the /api/health endpoint so the site owner (or support) can see a
 * misconfigured deployment at a glance without access to the host dashboard.
 */

const d1Lib = require('./d1');
const r2Lib = require('./r2');

const DATABASE_VARS = ['CF_ACCOUNT_ID', 'CF_D1_DATABASE_ID', 'CF_D1_API_TOKEN'];
const PHOTO_VARS = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
const ALL_VARS = [...new Set([...DATABASE_VARS, ...PHOTO_VARS, 'CF_API_TOKEN'])];

const SHAPES = {
  CF_ACCOUNT_ID: { re: /^[0-9a-f]{32}$/i, hint: '32-character hex Account ID from the Cloudflare dashboard' },
  R2_ACCOUNT_ID: { re: /^[0-9a-f]{32}$/i, hint: '32-character hex Account ID (same as CF_ACCOUNT_ID)' },
  CF_D1_DATABASE_ID: {
    re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    hint: 'UUID of the D1 database (Storage & Databases → D1 → the database)'
  },
  CF_D1_API_TOKEN: { min: 20, hint: 'API token created under Profile → API Tokens (Account · D1 · Edit)' },
  CF_API_TOKEN: { min: 20, hint: 'alternative name for CF_D1_API_TOKEN' },
  R2_BUCKET: { re: /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, hint: 'R2 bucket name, lowercase letters/digits/hyphens only' },
  R2_ACCESS_KEY_ID: { min: 16, hint: 'Access Key ID from R2 → Manage R2 API tokens' },
  R2_SECRET_ACCESS_KEY: { min: 30, hint: 'Secret Access Key from R2 → Manage R2 API tokens' }
};

function shapeOf(name, value) {
  if (!value) return 'absent';
  const rule = SHAPES[name];
  if (!rule) return 'present';
  if (rule.re) return rule.re.test(value) ? 'ok' : 'unexpected-format';
  if (rule.min) return value.length >= rule.min ? 'ok' : 'too-short';
  return 'present';
}

/**
 * Environment keys that LOOK like storage configuration but are not names the
 * app reads — catches spelling mistakes like CF_D1_TOKEN or R2_BUCKET_NAME.
 * (Names only; values are never exposed.)
 */
function unrecognizedStorageVars(env = process.env) {
  const out = [];
  for (const key of Object.keys(env)) {
    if (!/^(CF_|R2_|CLOUDFLARE|D1_|RAILWAY_STORAGE)/i.test(key)) continue;
    if (ALL_VARS.includes(key)) continue;
    if (['CF_D1_API_URL', 'R2_ENDPOINT', 'R2_REGION', 'R2_PREFIX'].includes(key)) continue;
    out.push(key);
  }
  return out.sort();
}

/** Which variables exist, which are missing, and what to do about it. */
function envStatus(env = process.env) {
  const values = {};
  const present = {};
  for (const name of ALL_VARS) {
    values[name] = String(env[name] || '').trim();
    present[name] = values[name].length > 0;
  }

  const d1Configured = Boolean(d1Lib.configFromEnv(env));
  const r2Configured = Boolean(r2Lib.configFromEnv(env));

  const missing = {
    database: d1Configured
      ? []
      : DATABASE_VARS.filter((n) => !present[n] && !(n === 'CF_D1_API_TOKEN' && present.CF_API_TOKEN)),
    photos: r2Configured
      ? []
      : PHOTO_VARS.filter((n) => !present[n] && !(n === 'R2_ACCOUNT_ID' && present.CF_ACCOUNT_ID))
  };

  const shape = {};
  for (const name of ALL_VARS) shape[name] = shapeOf(name, values[name]);

  const anyDatabase = DATABASE_VARS.some((n) => present[n]);
  const anyPhotos = PHOTO_VARS.some((n) => present[n]);

  const warnings = [];
  if (anyDatabase && !d1Configured) {
    warnings.push(
      `Cloudflare D1 is PARTIALLY configured — missing: ${missing.database.join(
        ', '
      )}. Falling back to local SQLite, which does NOT survive a restart on Render Free. ` +
        'Check the exact spelling of every variable name (Render → your service → Environment).'
    );
  }
  if (anyPhotos && !r2Configured) {
    warnings.push(
      `Cloudflare R2 is PARTIALLY configured — missing: ${missing.photos.join(
        ', '
      )}. Photos are stored on the local disk only and will NOT survive a restart on Render Free.`
    );
  }
  const shapeProblems = ALL_VARS.filter((n) => present[n] && shape[n] !== 'ok' && shape[n] !== 'present');
  for (const name of shapeProblems) {
    warnings.push(`${name} looks wrong (found ${shape[name]}) — expected: ${SHAPES[name].hint}.`);
  }

  const unrecognized = unrecognizedStorageVars(env);
  if (unrecognized.length) {
    warnings.push(
      `These environment variables exist but the app does NOT read them (check the spelling): ${unrecognized.join(', ')}.`
    );
  }

  return {
    present,
    shape,
    configured: { database: d1Configured, photos: r2Configured },
    missing,
    unrecognized,
    warnings
  };
}

/* ------------------------------------------------------------ live checking */

let liveCache = { at: 0, value: null };
const LIVE_CACHE_MS = 60_000;

/** Ping D1 and R2 with the configured credentials; cached for one minute. */
async function liveCheck(env = process.env) {
  if (liveCache.value && Date.now() - liveCache.at < LIVE_CACHE_MS) return liveCache.value;

  const out = { when: Date.now(), database: null, photos: null };

  const d1Config = d1Lib.configFromEnv(env);
  if (d1Config) {
    try {
      await d1Lib.createClient(d1Config).ping();
      out.database = { ok: true };
    } catch (err) {
      out.database = { ok: false, error: String((err && err.message) || err) };
    }
  } else {
    out.database = { ok: false, skipped: 'D1 not configured' };
  }

  const r2Config = r2Lib.configFromEnv(env);
  if (r2Config) {
    try {
      await r2Lib.createClient(r2Config).ping();
      out.photos = { ok: true };
    } catch (err) {
      out.photos = { ok: false, error: String((err && err.message) || err) };
    }
  } else {
    out.photos = { ok: false, skipped: 'R2 not configured' };
  }

  liveCache = { at: Date.now(), value: out };
  return out;
}

module.exports = { envStatus, liveCheck, DATABASE_VARS, PHOTO_VARS };
