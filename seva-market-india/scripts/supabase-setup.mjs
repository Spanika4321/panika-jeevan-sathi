#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — create/verify public.seva_mirror, then push local rows.
 *
 *   node scripts/supabase-setup.mjs --sql     # print paste-ready SQL only
 *   node scripts/supabase-setup.mjs           # ping + upsert (needs env)
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional: SEVA_DB_FILE (defaults to ./data/seva-market.db)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const config = require('../src/config');
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const {
  initStatements,
  collectDocuments,
  summarise,
  configFromEnv,
  createMirrorClient,
  isMissingTableError,
} = require('../src/db/supabase-mirror');

const args = new Set(process.argv.slice(2));
const wantSql = args.has('--sql') || args.has('--print-sql');

function printSql() {
  const sql = initStatements();
  process.stdout.write(`${sql}\n`);
}

function missingTableHelp() {
  return [
    '',
    'public.seva_mirror is not in this Supabase project yet.',
    '',
    'Do this exactly:',
    '  1. Supabase dashboard -> SQL Editor -> New query',
    '  2. Ctrl+A, Delete  (editor must be empty)',
    '  3. Paste ONLY the SQL printed below — no file name, no path',
    '  4. Run. Success looks like: "Success. No rows returned"',
    '  5. Re-run: node scripts/supabase-setup.mjs',
    '',
    '----- copy from the next line -----',
    initStatements(),
    '----- stop copying before this line -----',
    '',
  ].join('\n');
}

if (wantSql) {
  printSql();
  process.exit(0);
}

const remote = configFromEnv(process.env);
if (!remote) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Printing the SQL the SQL Editor needs. Paste this and nothing else:\n');
  printSql();
  process.exit(2);
}

const dbFile = config.db.file;
if (dbFile !== ':memory:') {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
}

const db = new Database(dbFile);
migrate(db, config.db.migrationsDir);

const documents = collectDocuments(db);
const stats = summarise(documents);
db.close();

const client = createMirrorClient(remote);

try {
  const ready = await client.ping();
  if (!ready) {
    console.error(missingTableHelp());
    process.exit(2);
  }
} catch (err) {
  if (isMissingTableError(err)) {
    console.error(missingTableHelp());
    process.exit(2);
  }
  console.error(`Supabase ping failed: ${err.message}`);
  process.exit(1);
}

if (!documents.length) {
  console.log('seva_mirror is ready. Local database has no rows to sync.');
  console.log(`Database : ${dbFile}`);
  process.exit(0);
}

try {
  const result = await client.upsert(documents);
  console.log('seva_mirror sync complete.');
  console.log(`Database : ${dbFile}`);
  console.log(`Upserted : ${result.upserted} document(s) in ${result.chunks} request(s)`);
  const names = Object.keys(stats.byTable).sort();
  for (const name of names) {
    console.log(`  ${name.padEnd(20)} ${String(stats.byTable[name]).padStart(5)}`);
  }
} catch (err) {
  if (isMissingTableError(err)) {
    console.error(missingTableHelp());
    process.exit(2);
  }
  console.error(`Sync failed: ${err.message}`);
  process.exit(1);
}
