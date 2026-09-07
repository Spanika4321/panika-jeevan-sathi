'use strict';
/**
 * SEVA MARKET INDIA — remote mirror provider selection.
 *
 * The app mirrors every SQLite write to a durable remote store. Two
 * providers are supported, both zero-dep REST clients with the SAME
 * client contract (ensureSchema/createDoc/updateDoc/deleteDoc/listAll/
 * hasAnyData), so src/db/remote.js and the app wiring are provider-agnostic:
 *
 *   1. supabase — a single `seva_mirror` table (JSONB docs) inside a
 *      Supabase project. Prefer this when a Supabase project (e.g. the one
 *      Panika Jeevan Sathi already uses) is available: env vars are
 *      SEVA_SUPABASE_URL / SEVA_SUPABASE_SERVICE_ROLE_KEY, and the plain
 *      SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aliases work unchanged.
 *
 *   2. appwrite — Appwrite Cloud DocumentsDB collections. Env vars
 *      SEVA_APPWRITE_ENDPOINT / PROJECT_ID / API_KEY / DATABASE_ID (the
 *      APPWRITE_* aliases also work).
 *
 * When both are configured, Supabase wins (it is the one Panika-style hosts
 * already export). When neither is configured the mirror is off and the
 * app behaves exactly as before (SQLite only).
 */

const appwrite = require('./appwrite');
const supabase = require('./supabase');

const PROVIDERS = { appwrite, supabase };

/**
 * Resolve the remote mirror from env.
 * @param {object} env process.env-like
 * @returns {null | {provider: string, config: object}}
 */
function resolveRemoteConfig(env) {
  if (supabase.configFromEnv(env)) {
    return { provider: 'supabase', config: supabase.configFromEnv(env) };
  }
  if (appwrite.configFromEnv(env)) {
    return { provider: 'appwrite', config: appwrite.configFromEnv(env) };
  }
  return null;
}

/** Create a client for a resolved {provider, config} pair. */
function createRemoteClient(resolved, options) {
  const lib = PROVIDERS[resolved.provider];
  if (!lib) throw new Error(`Unknown remote provider: ${resolved.provider}`);
  return { lib, client: lib.createClient(resolved.config, options) };
}

module.exports = { PROVIDERS, resolveRemoteConfig, createRemoteClient };
