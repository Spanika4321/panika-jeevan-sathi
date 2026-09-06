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
const crypto = require('node:crypto');

const ROOT = __dirname === undefined ? process.cwd() : path.resolve(__dirname, '..');

/** Coerce an env var to a positive integer, falling back to `fallback`. */
function intFromEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

/** A fresh 32-byte secret, hex encoded. Used for dev sessions/CSRF. */
function randomSecret() {
  return crypto.randomBytes(32).toString('hex');
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
  },

  security: {
    // Session signing/cookie secret. Pin SESSION_SECRET in production; in
    // development a random one is generated once per process so auth still
    // works out of the box without a secret on disk.
    sessionSecret: process.env.SESSION_SECRET || randomSecret(),
    // Cookie + session lifetime (30 days).
    sessionTtlSeconds: 30 * 24 * 60 * 60,
    cookie: {
      name: 'seva_sid',
      secure: process.env.NODE_ENV === 'production',
    },
    bcryptRounds: 12,
    pinPattern: /^[1-9][0-9]{5}$/,
    phonePattern: /^[6-9][0-9]{9}$/,
    emailPattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  },

  reviews: {
    // Auto-approve customer reviews when no moderation is configured. A real
    // deployment can set REVIEWS_MODERATED=1 to hold reviews in 'pending'
    // until an administrator approves them.
    moderated: process.env.REVIEWS_MODERATED === '1',
    // Max reviews a single client IP may leave per hour (abuse throttle).
    perHourPerIp: 3,
  },

  admin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
  },
};

module.exports = config;
