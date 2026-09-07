#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Appwrite Cloud provisioning.
 *
 * Creates/verifies every collection, attribute and index the site needs in
 * your Appwrite Cloud project. Idempotent: existing items are left alone,
 * missing ones are created. Run it once before switching PJS_STORAGE=appwrite.
 *
 *   node scripts/appwrite-setup.mjs            create missing schema
 *   node scripts/appwrite-setup.mjs --check    report only, exit 1 if missing
 *
 * Env:
 *   APPWRITE_ENDPOINT      default https://cloud.appwrite.io/v1
 *   APPWRITE_PROJECT_ID    6a9e5230000b2f752e11
 *   APPWRITE_API_KEY       API key with Databases → read/write scopes
 *   APPWRITE_DATABASE_ID   your Database id (created in the Appwrite console)
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const appwriteLib = require('../lib/appwrite.js');
const schemaMap = require('../lib/schema-map.js');

const checkOnly = process.argv.includes('--check');
const log = (m) => console.log(m);

async function main() {
  const config = appwriteLib.configFromEnv();
  if (!config) {
    console.error(
      [
        'Appwrite is not configured. Set:',
        '  APPWRITE_PROJECT_ID   (your project id)',
        '  APPWRITE_API_KEY      (server API key with databases.* scopes)',
        '  APPWRITE_DATABASE_ID  (the Database that will hold the collections)',
        '  APPWRITE_ENDPOINT     (optional, defaults to https://cloud.appwrite.io/v1)'
      ].join('\n')
    );
    process.exit(1);
  }

  console.log(`Appwrite : ${config.endpoint}`);
  console.log(`Project  : ${config.projectId}`);
  console.log(`Database : ${config.databaseId}`);
  console.log('');

  const client = appwriteLib.createClient(config, { log });
  const missing = [];

  if (checkOnly) {
    for (const table of schemaMap.TABLE_ORDER) {
      try {
        const info = await client.getCollection(table);
        const expected = schemaMap.TABLES[table].columns
          .filter((c) => !(c.name === 'id' && schemaMap.pkOf(table) === 'id'))
          .map((c) => c.name);
        const have = new Set((info.attributes || []).map((a) => a.key));
        const absent = expected.filter((k) => !have.has(k));
        console.log(`  ${absent.length ? '✗' : '✓'} ${table}${absent.length ? ` — missing: ${absent.join(', ')}` : ''}`);
        if (absent.length) missing.push(table);
      } catch (err) {
        console.log(`  ✗ ${table} — ${err.message}`);
        missing.push(table);
      }
    }
    if (missing.length) {
      console.error(`\nMissing schema. Run: node scripts/appwrite-setup.mjs`);
      process.exit(1);
    }
    console.log('\nAll collections and attributes are present. Ready for PJS_STORAGE=appwrite.');
    return;
  }

  await client.ensureSchema();

  console.log('');
  console.log('Collections ready:');
  let totalRows = 0;
  for (const table of schemaMap.TABLE_ORDER) {
    try {
      const { total } = await client.listDocuments(table, ['limit(1)']);
      totalRows += Number(total || 0);
      console.log(`  • ${table.padEnd(16)} ${total} document(s)`);
    } catch (err) {
      console.log(`  • ${table} — cannot read (${err.message})`);
    }
  }
  console.log(`\nTotal documents: ${totalRows}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. If you already run the site on SQLite, copy the data with:');
  console.log('       npm run appwrite:migrate');
  console.log('  2. Set PJS_STORAGE=appwrite in your host environment (plus the');
  console.log('     APPWRITE_* variables) and deploy.');
  console.log('  3. Smoke-test: npm run test:appwrite  (local, no account needed)');
}

main().catch((err) => {
  console.error(`\nAppwrite setup failed: ${err.message}`);
  if (err.body) console.error(err.body.slice(0, 500));
  process.exit(1);
});
