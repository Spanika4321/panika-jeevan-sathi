'use strict';
/**
 * SEVA MARKET INDIA — central configuration.
 *
 * Every environment-specific value is read here exactly once. The rest of
 * the codebase receives `config` by injection, which keeps the app testable
 * (tests build their own config with a temp database) and keeps secrets out
 * of business logic.
 */

const path = require('node:path');

const ROOT = __dirname === undefined ? process.cwd() : path.resolve(__dirname, '..');

/** Coerce an env var to a positive integer, falling back to `fallback`. */
function intFromEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

const config = {
  root: ROOT,
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  site: {
    name: 'SEVA MARKET INDIA',
    tagline: 'Local services, verified providers — anywhere in India.',
    url: process.env.SITE_URL || '',
    locale: 'en-IN',
    currency: 'INR',
  },

  http: {
    host: process.env.HOST || '0.0.0.0',
    port: intFromEnv('PORT', 3000),
    maxBodyBytes: 32 * 1024,          // JSON/form bodies: leads + provider forms only
    defaultPageSize: 20,
    maxPageSize: 100,
    trustProxyHops: intFromEnv('TRUST_PROXY_HOPS', 0),
  },

  db: {
    // ':memory:' keeps the whole suite hermetic; a file path gives persistence.
    file: process.env.SEVA_DB_FILE || path.join(ROOT, 'data', 'seva-market.db'),
    migrationsDir: path.join(ROOT, 'src', 'db', 'migrations'),
    // Directory that outlives this instance (mounted volume, external NAS,
    // object storage sync target). When set, the app snapshots its database
    // there on every boot and restores from the newest backup instead of
    // ever starting empty. On ephemeral hosts (Render/Railway/Fly) this is
    // the difference between a recovered site and silent total data loss.
    backupDir: process.env.SEVA_BACKUP_DIR || '',
  },

  security: {
    // Sessions are not implemented yet (foundation only); the secret is
    // already wired so auth can land without touching config call sites.
    sessionSecret: process.env.SESSION_SECRET || '',
    bcryptRounds: 12,
    pinPattern: /^[1-9][0-9]{5}$/,
    phonePattern: /^[6-9][0-9]{9}$/,
    emailPattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  },

  admin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
  },
};

module.exports = config;
