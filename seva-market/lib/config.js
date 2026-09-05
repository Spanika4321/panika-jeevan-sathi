/**
 * Application configuration.
 *
 * Config is built from the environment exactly once at start-up and validated
 * before the server accepts traffic: a misconfigured deployment must fail
 * loudly at boot rather than behave surprisingly at 2 a.m.
 *
 * `loadConfig` is pure (env in → config out) so tests can assert the rules
 * without touching process.env.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ConfigError } from './errors.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const MIGRATIONS_DIR = path.join(ROOT, 'lib', 'db', 'migrations');
export const DATA_DIR_DEFAULT = path.join(ROOT, 'data');

export const SITE = {
  name: 'SEVA MARKET INDIA',
  shortName: 'Seva Market',
  tagline: 'Find trusted local service providers near you',
  description:
    'SEVA MARKET INDIA is an India-wide local services marketplace. Search by service, city, locality or PIN code and contact verified providers near you.',
  locale: 'en_IN',
  country: 'IN',
  currency: 'INR',
  defaultRadiusKm: 10,
  supportPhone: '+91 80998 34725'
};

export const ENVIRONMENTS = ['development', 'test', 'production'];
export const DB_DRIVERS = ['sqlite', 'memory', 'postgres'];

function text(env, key, fallback = '') {
  const value = env[key];
  return value === undefined || value === null ? fallback : String(value);
}

function int(env, key, fallback) {
  // An unset variable must fall back, not become 0: Number('') === 0, which
  // silently produced a port of 0 and an instantly-expired session.
  const raw = text(env, key, '').trim();
  if (raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function bool(env, key, fallback = false) {
  const value = text(env, key, '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

export function loadConfig(env = process.env, overrides = {}) {
  const nodeEnv = (text(env, 'NODE_ENV', 'development') || 'development').toLowerCase();
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  const config = {
    env: nodeEnv,
    isProduction,
    isTest,

    host: text(env, 'SEVA_HOST', text(env, 'HOST', '0.0.0.0')),
    port: int(env, 'SEVA_PORT', int(env, 'PORT', 3100)),

    // Storage
    driver: (text(env, 'SEVA_DB_DRIVER', 'sqlite') || 'sqlite').toLowerCase(),
    databaseUrl: text(env, 'DATABASE_URL', ''), // reserved for the Postgres driver
    dataDir: text(env, 'SEVA_DATA_DIR', DATA_DIR_DEFAULT),
    autoMigrate: bool(env, 'SEVA_AUTO_MIGRATE', true),
    autoSeed: bool(env, 'SEVA_AUTO_SEED', !isProduction),

    // HTTP / security
    siteUrl: text(env, 'SEVA_SITE_URL', text(env, 'SITE_URL', '')).replace(/\/+$/, ''),
    trustProxyHops: int(env, 'SEVA_TRUST_PROXY_HOPS', 0),
    sessionSecret: text(env, 'SEVA_SESSION_SECRET', text(env, 'SESSION_SECRET', '')),
    sessionTtlHours: int(env, 'SEVA_SESSION_TTL_HOURS', 24 * 30),
    rateLimitWindowMs: int(env, 'SEVA_RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMax: int(env, 'SEVA_RATE_LIMIT_MAX', 120),

    // Observability
    logLevel: (text(env, 'SEVA_LOG_LEVEL', isProduction ? 'info' : 'debug') || 'info').toLowerCase(),
    logJson: bool(env, 'SEVA_LOG_JSON', isProduction),

    site: { ...SITE }
  };

  // Local development needs a signing key without asking the developer to
  // invent one; it is generated once and reused from the data directory.
  if (!config.sessionSecret && !isProduction) {
    config.sessionSecret = crypto.randomBytes(32).toString('hex');
    config.sessionSecretIsEphemeral = true;
  }

  return { ...config, ...overrides };
}

/** @returns {string[]} human-readable configuration problems (empty = valid). */
export function validateConfig(config) {
  const errors = [];
  const push = (message) => errors.push(message);

  if (!ENVIRONMENTS.includes(config.env)) {
    push(`NODE_ENV must be one of ${ENVIRONMENTS.join(', ')} (got "${config.env}")`);
  }

  // 0 is valid outside production: the OS picks a free port, which is what
  // integration tests use to boot a real server without port collisions.
  const portFloor = config.isProduction ? 1 : 0;
  if (!Number.isInteger(config.port) || config.port < portFloor || config.port > 65535) {
    push(`port must be an integer between ${portFloor} and 65535 (got "${config.port}")`);
  }

  if (!DB_DRIVERS.includes(config.driver)) {
    push(`SEVA_DB_DRIVER must be one of ${DB_DRIVERS.join(', ')} (got "${config.driver}")`);
  }

  if (config.driver === 'postgres' && !config.databaseUrl) {
    push('DATABASE_URL is required when SEVA_DB_DRIVER=postgres');
  }

  if (config.trustProxyHops < 0) push('SEVA_TRUST_PROXY_HOPS cannot be negative');

  if (config.siteUrl && !/^https?:\/\/[^\s]+$/i.test(config.siteUrl)) {
    push('SEVA_SITE_URL must be an absolute http(s) URL');
  }

  if (config.isProduction) {
    if (!/^https:\/\//i.test(config.siteUrl)) {
      push('production requires SEVA_SITE_URL to be an HTTPS origin');
    }
    if (String(config.sessionSecret || '').length < 32) {
      push('production requires SEVA_SESSION_SECRET of at least 32 characters');
    }
    if (config.driver === 'memory') {
      push('the in-memory driver is not allowed in production');
    }
    if (config.autoSeed) {
      push('SEVA_AUTO_SEED=1 is not allowed in production (seed via `npm run seed`)');
    }
  }

  return errors;
}

export function assertValidConfig(config) {
  const errors = validateConfig(config);
  if (errors.length) throw new ConfigError(errors);
  return config;
}
