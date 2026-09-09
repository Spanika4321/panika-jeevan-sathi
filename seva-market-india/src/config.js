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

const { resolveDriver, flag } = require('./store/guard');
const { readEnvConfig } = require('./db/remote');
const { resolveSiteUrl } = require('./site-url');

/**
 * Google Search Console ownership token (HTML-tag verification method).
 * The token is public by design — Google reads it straight from the served
 * HTML of every page — so a committed value is safe. Paste the content value
 * Google shows (see seva-market-india/GOOGLE-INDEXING.md §3) into
 * DEFAULT_GOOGLE_SITE_VERIFICATION below, or set the GOOGLE_SITE_VERIFICATION
 * environment variable in the host to override it without a code change.
 */
const DEFAULT_GOOGLE_SITE_VERIFICATION = 'KUEY7AjRRY6ZhMJhPx1otFcfCkDxVrARnY1syD3rR-o';
const { readMailConfig } = require('./mail/mailer');
const accountTokens = require('./models/account-token');

const ROOT = __dirname === undefined ? process.cwd() : path.resolve(__dirname, '..');

/** Coerce an env var to a positive integer, falling back to `fallback`. */
function intFromEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

const isProduction = process.env.NODE_ENV === 'production';
const supabase = readEnvConfig(process.env);
const site = resolveSiteUrl(process.env);
const mail = readMailConfig(process.env, { isProduction, root: ROOT });

const config = {
  root: ROOT,
  env: process.env.NODE_ENV || 'development',
  isProduction,

  // Boot-time notes about the configured origin (see src/site-url.js). app.js
  // logs these next to the storage warnings; empty in tests/dev, where no host
  // URL is present.
  siteWarnings: site.warnings,

  site: {
    name: 'SEVA MARKET INDIA',
    tagline: 'Local services, verified providers — anywhere in India.',
    url: site.url,
    locale: 'en-IN',
    currency: 'INR',
  },

  // Google Search Console ownership token (the content value of the
  // <meta name="google-site-verification"> tag). GOOGLE_SITE_VERIFICATION
  // (host env) wins over the committed default; when both are empty the tag
  // is not rendered at all — a placeholder token would fail verification.
  googleSiteVerification: (process.env.GOOGLE_SITE_VERIFICATION || DEFAULT_GOOGLE_SITE_VERIFICATION).trim(),

  http: {
    host: process.env.HOST || '0.0.0.0',
    port: intFromEnv('PORT', 3000),
    maxBodyBytes: 32 * 1024,          // JSON/form bodies: leads + provider forms only
    maxUploadBytes: 11 * 1024 * 1024, // five 2 MB business photos + multipart overhead
    defaultPageSize: 20,
    maxPageSize: 100,
    trustProxyHops: intFromEnv('TRUST_PROXY_HOPS', 0),
  },

  db: {
    // ':memory:' keeps the whole suite hermetic; a file path gives persistence.
    file: process.env.SEVA_DB_FILE || path.join(ROOT, 'data', 'seva-market.db'),
    migrationsDir: path.join(ROOT, 'src', 'db', 'migrations'),
    // The catalog is deterministic seed data. On an ephemeral host the file
    // is empty after every deploy, so rebuild it at boot (idempotent, ~190
    // rows, well under a second). SEVA_SEED_ON_BOOT=0 turns it off.
    seedOnBoot: String(process.env.SEVA_SEED_ON_BOOT ?? '1') !== '0',
  },

  /**
   * Where user-generated rows live.
   *
   *   driver 'sqlite'    accounts + enquiries in the local file (dev, tests,
   *                      or a host with a real persistent disk)
   *   driver 'supabase'  accounts + enquiries written through to Postgres
   *
   * See src/store/guard.js for the boot checks that stop a misconfigured
   * production host from quietly storing customer data on a disk that gets
   * wiped on the next deploy.
   */
  storage: {
    driver: resolveDriver(process.env, { isProduction }),
    requireRemote: flag(process.env, 'SEVA_REQUIRE_REMOTE'),
    allowEphemeral: flag(process.env, 'SEVA_ALLOW_EPHEMERAL'),
    supabase: {
      url: supabase.url,
      key: supabase.key,
    },
    // Prefixed: one Supabase project may also host Panika Jeevan Sathi,
    // which already owns public.users and public.audit_logs.
    tables: {
      users: process.env.SEVA_TABLE_USERS || 'seva_users',
      leads: process.env.SEVA_TABLE_LEADS || 'seva_leads',
      audit: process.env.SEVA_TABLE_AUDIT || 'seva_audit_logs',
      // Email-verification and password-reset links. Durable for the same
      // reason accounts are: a reset link written to a disk that is wiped
      // before the visitor clicks it is a locked-out customer.
      tokens: process.env.SEVA_TABLE_TOKENS || 'seva_account_tokens',
    },
  },

  /**
   * Account email (verification + password reset). See src/mail/mailer.js:
   * real SMTP when SMTP_HOST/SMTP_USER/SMTP_PASS are set, otherwise a private
   * outbox file in development and nothing at all in production.
   */
  mail,

  /**
   * One-time account tokens. Lifetimes and the hourly per-account limit live
   * in the model so both storage backends enforce the same numbers.
   */
  tokens: {
    ttl: accountTokens.TTL_MS,
    hourlyLimit: accountTokens.HOURLY_LIMIT,
    // The link must be absolute to survive an email client, so it is built
    // from the canonical origin; local development has none, hence this.
    linkOrigin: (() => {
      try {
        return new URL(site.url).origin;
      } catch (_) {
        return `http://localhost:${intFromEnv('PORT', 3000)}`;
      }
    })(),
  },

  media: {
    // Photos are assigned a server-side random filename and sent to this
    // dedicated Supabase Storage bucket in production. The bucket is created
    // on the first upload by the server's existing service-role credential.
    bucket: process.env.SEVA_MEDIA_BUCKET || 'seva-business-photos',
    maxPhotos: 5,
    maxFileBytes: 2 * 1024 * 1024,
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
