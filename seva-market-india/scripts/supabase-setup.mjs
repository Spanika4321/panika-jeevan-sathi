/**
 * SEVA MARKET INDIA — Supabase mirror provisioning check + initial sync.
 *
 * The mirror TABLE itself is created by running scripts/supabase-init.sql
 * once in the Supabase SQL editor (DDL cannot go through PostgREST). This
 * script then verifies the table, pushes every pending change in the local
 * _sync_log to Supabase and reports what the mirror holds. Idempotent —
 * safe to re-run any time.
 *
 * Env (plain SUPABASE_* aliases also work — the ones Panika already uses):
 *   SEVA_SUPABASE_URL=... SEVA_SUPABASE_SERVICE_ROLE_KEY=... npm run supabase:setup
 */
'use strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Database } = require('../src/db/client');
const config = require('../src/config');
const { migrate } = require('../src/db/migrate');
const supabase = require('../src/db/supabase');
const remoteLib = require('../src/db/remote');

const remoteConfig = supabase.configFromEnv(process.env);
if (!remoteConfig) {
  console.error(
    'Supabase is not configured. Set SEVA_SUPABASE_URL and SEVA_SUPABASE_SERVICE_ROLE_KEY\n' +
      '(the plain SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aliases also work).'
  );
  process.exit(1);
}

const db = new Database(config.db.file);
migrate(db, config.db.migrationsDir);

const log = (m) => console.log(`[remote] ${m}`);
const client = supabase.createClient(remoteConfig, { log });

async function main() {
  log(`checking mirror table '${remoteConfig.table}' …`);
  try {
    await client.ensureSchema();
  } catch (err) {
    if (err && err.provisionRequired) {
      console.error(
        `\nMirror table '${remoteConfig.table}' does not exist yet.\n` +
          '  1. Open the Supabase dashboard → SQL Editor\n' +
          '  2. Paste the whole scripts/supabase-init.sql file\n' +
          '  3. Run it, then re-run this command.'
      );
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  log('table present.');

  log('pushing pending local changes …');
  let total = 0;
  for (let i = 0; i < 500; i++) {
    const pending = Number(db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL') || 0);
    if (pending === 0) break;
    total += await remoteLib.drainPending(db, client, { log: () => {}, chunk: 200 });
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
    console.error(`\nsupabase:setup failed: ${err && err.stack ? err.stack : err}`);
    process.exitCode = 1;
  })
  .finally(() => db.close());
