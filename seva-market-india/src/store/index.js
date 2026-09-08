'use strict';
/**
 * SEVA MARKET INDIA — storage factory.
 *
 * One entry point, two backends, one interface:
 *
 *   store.users.create(...)         store.leads.create(...)
 *   store.users.findByEmail(...)    store.leads.recentCountFromIp(...)
 *   store.audit.log(...)            store.health()
 *
 * Everything is async regardless of backend, so a route never has to know
 * whether the row went to a local file or over HTTPS to Postgres.
 */

const { createRemoteClient, readEnvConfig } = require('../db/remote');
const { assertStorageSafe, StorageConfigError } = require('./guard');
const { createSqliteStore } = require('./sqlite-store');
const { createSupabaseStore } = require('./supabase-store');
const { createMediaStore } = require('./media');

/**
 * Build the store described by `config.storage`, refusing to boot on a
 * configuration that would silently lose data.
 *
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.db          local SQLite (catalog + sqlite backend)
 * @param {Function} [options.fetchImpl]  injected in tests
 * @param {Function} [options.log]
 */
function createStore({ config, db, fetchImpl, log = console.warn } = {}) {
  if (!config) throw new StorageConfigError('createStore requires config.');

  const { driver, durable, warnings } = assertStorageSafe(config.storage, {
    isProduction: config.isProduction,
  });
  for (const warning of warnings) log(`[storage] WARNING: ${warning}`);

  if (driver === 'sqlite') {
    return {
      ...createSqliteStore({ db, config }),
      media: createMediaStore({ config, driver, fetchImpl }),
      warnings,
      driver,
      durable,
    };
  }

  const remote = createRemoteClient({
    url: config.storage.supabase.url,
    key: config.storage.supabase.key,
    fetchImpl,
  });
  return {
    ...createSupabaseStore({ db, remote, config }),
    media: createMediaStore({ config, driver, fetchImpl }),
    warnings,
    driver,
    durable,
    remote,
  };
}

module.exports = { createStore, readEnvConfig, StorageConfigError };
