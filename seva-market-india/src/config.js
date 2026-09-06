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

/** An env var counts as true only when it is exactly `1` / `true` / `yes`. */
function boolFromEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
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
    // Session secret signs the stored token hashes and the CSRF tokens. When
    // it is absent the app generates an ephemeral one per process: sessions
    // then die on restart, which is the right failure mode for development
    // and a loud misconfiguration for production (checked at boot).
    sessionSecret: process.env.SESSION_SECRET || '',
    bcryptRounds: 12,
    pinPattern: /^[1-9][0-9]{5}$/,
    phonePattern: /^[6-9][0-9]{9}$/,
    emailPattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  },

  auth: {
    sessionCookie: 'seva_session',
    sessionDays: intFromEnv('SEVA_SESSION_DAYS', 30),
    // Login is throttled per email+IP before a session exists at all.
    minPasswordLength: 8,
    loginWindowMinutes: intFromEnv('SEVA_LOGIN_WINDOW_MINUTES', 15),
    loginMaxAttempts: intFromEnv('SEVA_LOGIN_MAX_ATTEMPTS', 10),
    verifyTokenMinutes: intFromEnv('SEVA_VERIFY_TOKEN_MINUTES', 24 * 60),
    resetTokenMinutes: intFromEnv('SEVA_RESET_TOKEN_MINUTES', 60),
    // When on, a new account cannot obtain a session until the emailed link
    // is followed. Off by default so a local install stays usable without an
    // SMTP server; email links still land in the outbox either way.
    requireEmailVerification: boolFromEnv('SEVA_REQUIRE_EMAIL_VERIFICATION'),
    // Secure cookies follow NODE_ENV unless explicitly overridden (a proxy
    // that terminates TLS is the usual reason to force this on or off).
    secureCookies: boolFromEnv('SEVA_SECURE_COOKIES', process.env.NODE_ENV === 'production'),
  },

  onboarding: {
    // Skip the manual admin review. Intended for local demos and preview
    // deploys; production should review every new listing by hand.
    autoApprove: boolFromEnv('SEVA_AUTO_APPROVE_PROVIDERS'),
    maxServiceAreas: intFromEnv('SEVA_MAX_SERVICE_AREAS', 25),
  },

  mail: {
    // No SMTP dependency in this build: every message is written to this
    // directory as a .txt file. A real transport plugs in behind the same
    // `send()` signature later without touching call sites.
    outboxDir: process.env.SEVA_OUTBOX_DIR || path.join(ROOT, 'data', 'outbox'),
    from: process.env.MAIL_FROM || 'SEVA MARKET INDIA <no-reply@seva-market.local>',
    enabled: boolFromEnv('SEVA_MAIL_ENABLED', true),
  },

  admin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
  },
};

module.exports = config;
