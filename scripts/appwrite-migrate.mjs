#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — migrate the local SQLite/JSON store into Appwrite.
 *
 * Copies every row, preserving numeric ids (they become the Appwrite
 * document ids), created_at timestamps, messages, settings and analytics.
 * Idempotent: rows already present are updated, never duplicated.
 *
 *   node scripts/appwrite-migrate.mjs                 migrate everything
 *   node scripts/appwrite-migrate.mjs --table users   migrate one table
 *   node scripts/appwrite-migrate.mjs --source DIR    read the local store from DIR
 *   node scripts/appwrite-migrate.mjs --dry-run       counts only, no writes
 *
 * Env: APPWRITE_* as in scripts/appwrite-setup.mjs.
 * Run scripts/appwrite-setup.mjs first so the collections exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dbLib = require('../lib/db.js');
const appwriteLib = require('../lib/appwrite.js');
const schemaMap = require('../lib/schema-map.js');

function arg(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1];
}

async function main() {
  const tableOnly = arg('--table');
  const sourceDir = arg('--source') || process.env.PJS_DATA_DIR || path.resolve(process.cwd(), 'data');
  const dryRun = process.argv.includes('--dry-run');

  const config = appwriteLib.configFromEnv();
  if (!config) {
    console.error('Appwrite is not configured (APPWRITE_PROJECT_ID / APPWRITE_API_KEY / APPWRITE_DATABASE_ID).');
    process.exit(1);
  }

  // Open the LOCAL store as the source, never Appwrite.
  const sqliteFile = path.join(sourceDir, 'panika-jeevan-sathi.db');
  const jsonFile = path.join(sourceDir, 'panika-jeevan-sathi.json');
  const prev = process.env.PJS_STORAGE;
  process.env.PJS_STORAGE = fs.existsSync(sqliteFile) ? 'sqlite' : 'json';
  const opened = dbLib.open(sourceDir, { log: () => {} });
  process.env.PJS_STORAGE = prev;
  if (opened.ready) await opened.ready();
  const source = opened.driver;

  const client = appwriteLib.createClient(config, { log: (m) => console.log(m) });
  console.log(`Provisioning collections in ${config.databaseId} ...`);
  await client.ensureSchema();

  const tables = tableOnly ? [tableOnly] : schemaMap.TABLE_ORDER;
  let totalCopied = 0;
  let totalSkipped = 0;

  for (const table of tables) {
    const rows = await source.all(table, {});
    console.log(`\n${table}: ${rows.length} row(s)`);
    if (!rows.length) continue;
    if (dryRun) {
      const sample = rows[0];
      console.log(`  dry-run: first row id/docId ${schemaMap.docIdFor(table, sample)} (${Object.keys(sample).length} keys)`);
      totalSkipped += rows.length;
      continue;
    }

    let copied = 0;
    for (const row of rows) {
      const docId = schemaMap.docIdFor(table, row);
      const data = appwriteLib.dataFromRow(table, row);
      try {
        await client.createDocument(table, docId, data);
        copied += 1;
      } catch (err) {
        if (err.status === 409) {
          await client.updateDocument(table, docId, data);
          copied += 1;
        } else {
          throw err;
        }
      }
    }
    totalCopied += copied;

    // Verify: the remote table must now hold every migrated row.
    const remote = [];
    const pages = await appwriteLib.fetchAllPages(client, table);
    for (const doc of pages) remote.push(doc.$id);
    const ids = new Set(rows.map((r) => schemaMap.docIdFor(table, r)));
    const missingIds = [...ids].filter((id) => !remote.includes(id));
    if (missingIds.length) {
      throw new Error(`Migration verification failed for ${table}: ${missingIds.length} document(s) missing on Appwrite.`);
    }
    console.log(`  ✓ ${copied} document(s) verified on Appwrite`);
  }

  console.log(`\nDone. Copied ${totalCopied} row(s), skipped ${totalSkipped}.`);
  console.log('Now set PJS_STORAGE=appwrite on the host and deploy. Keep the old');
  console.log('SQLite file backed up until the new storage has run in production for a few days.');
  await opened.driver.close();
}

main().catch((err) => {
  console.error(`\nMigration failed: ${err.message}`);
  if (err.body) console.error(err.body.slice(0, 500));
  process.exit(1);
});
