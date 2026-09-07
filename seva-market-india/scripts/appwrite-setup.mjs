/**
 * SEVA MARKET INDIA — one-time Appwrite provisioning + initial sync.
 *
 * Manual, but idempotent: safe to re-run any time. Creates the mirror
 * collections/attributes if missing, then pushes every pending change in
 * the local _sync_log to Appwrite and reports what the remote holds.
 *
 * Requires SEVA_APPWRITE_ENDPOINT, SEVA_APPWRITE_PROJECT_ID,
 * SEVA_APPWRITE_API_KEY and SEVA_APPWRITE_DATABASE_ID (or the APPWRITE_*
 * aliases) in the environment.
 *
 *   SEVA_APPWRITE_PROJECT_ID=... SEVA_APPWRITE_API_KEY=... \
 *   SEVA_APPWRITE_DATABASE_ID=... npm run appwrite:setup
 */
'use strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Database } = require('../src/db/client');
const config = require('../src/config');
const { migrate } = require('../src/db/migrate');
const appwrite = require('../src/db/appwrite');
const remoteLib = require('../src/db/remote');

const remoteConfig = appwrite.configFromEnv(process.env);
if (!remoteConfig) {
  console.error(
    'Appwrite is not configured. Set SEVA_APPWRITE_ENDPOINT, SEVA_APPWRITE_PROJECT_ID,\n' +
      'SEVA_APPWRITE_API_KEY and SEVA_APPWRITE_DATABASE_ID (APPWRITE_* aliases also work).'
  );
  process.exit(1);
}

const db = new Database(config.db.file);
migrate(db, config.db.migrationsDir);

const log = (m) => console.log(`[remote] ${m}`);
const client = appwrite.createClient(remoteConfig, { log });

async function main() {
  log('ensuring schema …');
  const { collections } = await client.ensureSchema(remoteLib.TABLES);
  log(`schema ready for ${collections} collection(s) — idempotent, nothing already present is touched`);

  log('pushing pending local changes …');
  let total = 0;
  for (let i = 0; i < 500; i++) {
    const pending = Number(db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL') || 0);
    if (pending === 0) break;
    total += await remoteLib.drainPending(db, client, { log: () => {}, chunk: 100 });
  }
  const unsynced = Number(db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL') || 0);
  if (unsynced > 0) {
    console.error(`[remote] ${unsynced} change(s) could not be pushed — fix the connection and re-run.`);
    process.exitCode = 1;
    return;
  }
  log(`${total} change(s) pushed; remote mirror is in sync.`);

  console.log('\nRemote mirror contents:');
  for (const table of Object.keys(remoteLib.TABLES)) {
    const docs = await client.listAll(table);
    console.log(`  ${table.padEnd(14)} ${docs.length} document(s)`);
  }
  console.log(
    '\nDone. On an ephemeral host, this same sync now happens automatically at boot and after every write.'
  );
}

main()
  .catch((err) => {
    console.error(`\nappwrite:setup failed: ${err && err.stack ? err.stack : err}`);
    process.exitCode = 1;
  })
  .finally(() => db.close());
