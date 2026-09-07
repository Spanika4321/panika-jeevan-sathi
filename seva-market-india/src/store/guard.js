'use strict';
/**
 * SEVA MARKET INDIA — storage guard (fail-closed boot checks).
 *
 * The failure mode this file exists to prevent:
 *
 *   1. Deploy to a free host with an ephemeral disk.
 *   2. SUPABASE_* is missing or misspelt, so the app quietly falls back to
 *      a local SQLite file.
 *   3. Signups and enquiries land on that disk for three weeks.
 *   4. A redeploy (or a wake-from-sleep) wipes the disk. The site still
 *      returns HTTP 200 — with an empty database and no error anywhere.
 *
 * Step 4 is silent, which is what makes it dangerous. So the guard refuses
 * to boot at step 2 instead: on a host that has declared itself ephemeral
 * (SEVA_REQUIRE_REMOTE=1), a missing or unusable Supabase configuration is
 * a startup crash, and a crash is visible in the deploy log.
 */

const { describeKey, isPublicKey, readEnvConfig } = require('../db/remote');

const DRIVERS = ['sqlite', 'supabase'];

class StorageConfigError extends Error {
  constructor(message, { hint } = {}) {
    super(hint ? `${message}\n\n${hint}` : message);
    this.name = 'StorageConfigError';
    this.hint = hint || null;
  }
}

/** Read `SEVA_REQUIRE_REMOTE` / `SEVA_ALLOW_EPHEMERAL` style flags. */
function flag(env, name) {
  const raw = String(env[name] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Decide which driver to use.
 *
 * Explicit SEVA_STORAGE always wins. Otherwise: Supabase in production when
 * credentials exist, SQLite everywhere else (so `npm test` and a laptop
 * checkout never need a network).
 *
 * @returns {'sqlite'|'supabase'}
 */
function resolveDriver(env = process.env, { isProduction = false } = {}) {
  const explicit = String(env.SEVA_STORAGE || '').trim().toLowerCase();
  if (explicit) {
    if (!DRIVERS.includes(explicit)) {
      throw new StorageConfigError(`Unknown SEVA_STORAGE value: "${explicit}".`, {
        hint: `Valid values: ${DRIVERS.join(', ')}.`,
      });
    }
    return explicit;
  }
  if (flag(env, 'SEVA_REQUIRE_REMOTE')) return 'supabase';
  const { url, key } = readEnvConfig(env);
  return isProduction && url && key ? 'supabase' : 'sqlite';
}

/**
 * Validate a storage configuration before a single request is served.
 *
 * @param {object} storage config.storage
 * @param {object} [options]
 * @returns {{driver: string, durable: boolean, warnings: string[]}}
 * @throws {StorageConfigError} when the configuration would lose data
 */
function assertStorageSafe(storage, { isProduction = false } = {}) {
  const warnings = [];
  const { driver, requireRemote, allowEphemeral, supabase } = storage;

  if (!DRIVERS.includes(driver)) {
    throw new StorageConfigError(`Unknown storage driver: "${driver}".`);
  }

  if (driver === 'supabase') {
    if (!supabase.url || !supabase.key) {
      const missing = [!supabase.url && 'SUPABASE_URL', !supabase.key && 'SUPABASE_SERVICE_ROLE_KEY']
        .filter(Boolean).join(' and ');
      throw new StorageConfigError(`Storage driver "supabase" needs ${missing}.`, {
        hint: [
          'Set them in the host dashboard (Render: Settings -> Environment), or run',
          'SEVA_STORAGE=sqlite locally. Refusing to boot: falling back to a local file',
          'here would lose every account and enquiry on the next deploy.',
        ].join('\n'),
      });
    }
    if (!/^https:\/\//i.test(supabase.url) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(supabase.url)) {
      throw new StorageConfigError(`SUPABASE_URL must be an https:// URL (got "${supabase.url}").`);
    }
    if (isPublicKey(supabase.key)) {
      throw new StorageConfigError('SUPABASE_SERVICE_ROLE_KEY looks like the anon/publishable key.', {
        hint: [
          'The anon key is browser-safe and cannot write to tables that have RLS on',
          'with grants revoked — every signup and enquiry would fail. Copy the',
          'service-role key: Supabase -> Project Settings -> API -> service_role.',
        ].join('\n'),
      });
    }
    const { role } = describeKey(supabase.key);
    if (role && role !== 'service_role') {
      warnings.push(`Supabase key carries role "${role}", expected "service_role".`);
    }
  }

  if (requireRemote && driver !== 'supabase') {
    throw new StorageConfigError(
      `SEVA_REQUIRE_REMOTE=1 forbids the "${driver}" driver on this host.`,
      {
        hint: [
          'This host has an ephemeral filesystem: a SQLite file here is deleted on',
          'every deploy and every wake-from-sleep. Configure SUPABASE_URL and',
          'SUPABASE_SERVICE_ROLE_KEY, or drop SEVA_REQUIRE_REMOTE if this host',
          'really does have a persistent disk.',
        ].join('\n'),
      },
    );
  }

  if (driver === 'sqlite' && isProduction && !allowEphemeral) {
    warnings.push(
      'Running in production on local SQLite: accounts and enquiries live in a file '
      + 'on this machine. If the filesystem is ephemeral (Render/Railway free plans, '
      + 'most containers) that data is lost on the next deploy. '
      + 'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or SEVA_ALLOW_EPHEMERAL=1 to '
      + 'silence this if the disk is genuinely persistent.',
    );
  }

  return { driver, durable: driver === 'supabase', warnings };
}

module.exports = { DRIVERS, StorageConfigError, flag, resolveDriver, assertStorageSafe };
