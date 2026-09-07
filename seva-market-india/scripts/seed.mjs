#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — seed the configured database.
 *
 *   node scripts/seed.mjs
 *   SEVA_DB_FILE=/tmp/seva.db node scripts/seed.mjs
 *
 * Idempotent: re-running never duplicates a category, location or listing.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../src/config');
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const locationModel = require('../src/models/location');

const db = new Database(config.db.file);
const migrations = migrate(db, config.db.migrationsDir);
if (migrations.applied.length) console.log(`Migrations applied: ${migrations.applied.join(', ')}`);

const result = seed(db);

// If an Appwrite mirror is configured, push the seeded baseline now so the
// remote never lags behind the local database.
const appwrite = require('../src/db/appwrite');
const remoteLib = require('../src/db/remote');
const remoteConfig = appwrite.configFromEnv(process.env);
if (remoteConfig) {
  const client = appwrite.createClient(remoteConfig, { log: (m) => console.log(m) });
  await client.ensureSchema(remoteLib.TABLES);
  let total = 0;
  for (let i = 0; i < 100 && db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL') > 0; i++) {
    total += await remoteLib.drainPending(db, client, { log: () => {} });
  }
  console.log(`\nAppwrite mirror : ${total} change(s) pushed to ${remoteConfig.databaseId}`);
}
const totals = locationModel.stats(db);

console.log(`\nDatabase : ${config.db.file}`);
console.log(`Seed     : ${result.categories} categories, ${result.locations} locations, ${result.providers} providers, ${result.services} services`);
console.log('Hierarchy:');
for (const kind of ['country', 'state', 'district', 'city', 'locality', 'pincode']) {
  console.log(`  ${kind.padEnd(9)} ${String(totals[kind]).padStart(4)}`);
}

const sample = locationModel.findByPin(db, '781001');
if (sample) {
  console.log(`\nExample  : PIN 781001 -> ${sample.chain.map((node) => node.name).reverse().join(', ')}`);
}
db.close();
