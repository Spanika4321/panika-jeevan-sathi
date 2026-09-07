#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — Supabase mirror setup + sync.
 *
 *   node scripts/supabase-setup.mjs --sql
 *       Print ONLY the SQL from scripts/supabase-init.sql (nothing else on
 *       stdout), so it can be piped or copied straight into the Supabase
 *       SQL editor without any path/comment noise.
 *
 *   node scripts/supabase-setup.mjs [--dry-run] [--tables a,b,c]
 *       Mirror every row of the local SQLite database into the
 *       `public.seva_mirror` table (one JSONB document per row, keyed by
 *       table name + primary key). Requires:
 *         SUPABASE_URL               https://<ref>.supabase.co
 *         SUPABASE_SERVICE_ROLE_KEY  server-side key (never the anon key)
 *       Optional:
 *         SEVA_DB_FILE               local SQLite file (default: data/seva-market.db)
 *
 * Zero npm dependencies: node:sqlite + global fetch (Node 22.5+).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_FILE = path.join(ROOT, 'scripts', 'supabase-init.sql');
const MIRROR_TABLE = 'seva_mirror';
const BATCH_SIZE = 200;

/** Tables mirrored, in dependency order, with their primary key columns. */
const MIRRORED_TABLES = {
  users: ['id'],
  locations: ['id'],
  categories: ['id'],
  providers: ['id'],
  services: ['id'],
  service_areas: ['provider_id', 'pin_code'],
  leads: ['id'],
  audit_logs: ['id'],
};

/* ----------------------------------------------------------------- args */
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--') && !a.includes('=')));
const options = Object.fromEntries(
  argv.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2))
);

function readSql() {
  return fs.readFileSync(SQL_FILE, 'utf8');
}

/** Config from env; returns null when Supabase is not configured. */
export function configFromEnv(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || '').trim();
  if (!url || !key) return null;
  return { url, key };
}

/** Serialise a SQLite row into a JSON-safe document. */
export function toDocument(row) {
  const doc = {};
  for (const [col, value] of Object.entries(row)) {
    if (typeof value === 'bigint') doc[col] = Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    else if (value instanceof Uint8Array) doc[col] = Buffer.from(value).toString('base64');
    else doc[col] = value;
  }
  return doc;
}

/** Composite primary keys become "a:b" so the mirror key stays a plain string. */
export function rowId(row, pkColumns) {
  return pkColumns.map((col) => String(row[col])).join(':');
}

/** Build the mirror rows for one table. */
export function mirrorRows(tbl, rows, pkColumns) {
  return rows.map((row) => ({ tbl, id: rowId(row, pkColumns), doc: toDocument(row) }));
}

/** Upsert one batch through PostgREST (merge on the (tbl,id) primary key). */
export async function upsertBatch(config, rows, { fetchImpl = fetch } = {}) {
  if (!rows.length) return 0;
  const res = await fetchImpl(`${config.url}/rest/v1/${MIRROR_TABLE}?on_conflict=tbl,id`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase upsert failed (${res.status}) for ${rows[0].tbl}: ${body.slice(0, 400)}`);
  }
  return rows.length;
}

/** Verify the mirror table exists (a friendly message instead of a raw 404). */
export async function ensureMirrorTable(config, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${config.url}/rest/v1/${MIRROR_TABLE}?select=tbl&limit=1`, {
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
  });
  if (res.ok) return true;
  const body = await res.text().catch(() => '');
  if (res.status === 404 || /relation .* does not exist|Could not find the table/i.test(body)) {
    throw new Error(
      `Table public.${MIRROR_TABLE} not found in Supabase. ` +
        'Run scripts/supabase-init.sql once in the SQL editor (print it with: node scripts/supabase-setup.mjs --sql).'
    );
  }
  throw new Error(`Supabase check failed (${res.status}): ${body.slice(0, 400)}`);
}

/** Sync every mirrored table; returns per-table counts. */
export async function syncAll({ db, config, tables = Object.keys(MIRRORED_TABLES), dryRun = false, log = console.log, fetchImpl = fetch }) {
  const counts = {};
  if (!dryRun) await ensureMirrorTable(config, { fetchImpl });
  for (const tbl of tables) {
    const pk = MIRRORED_TABLES[tbl];
    if (!pk) throw new Error(`Unknown table "${tbl}". Known: ${Object.keys(MIRRORED_TABLES).join(', ')}`);
    const rows = db.all(`SELECT * FROM ${tbl}`);
    const docs = mirrorRows(tbl, rows, pk);
    let sent = 0;
    if (!dryRun) {
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        sent += await upsertBatch(config, docs.slice(i, i + BATCH_SIZE), { fetchImpl });
      }
    }
    counts[tbl] = docs.length;
    log(`${dryRun ? 'would sync' : 'synced'}  ${String(docs.length).padStart(6)}  ${tbl}${dryRun ? '' : `  (${sent} sent)`}`);
  }
  return counts;
}

/* ----------------------------------------------------------------- main */
async function main() {
  if (flags.has('--sql')) {
    process.stdout.write(readSql());
    return;
  }

  const dryRun = flags.has('--dry-run');
  const config = configFromEnv();
  if (!config && !dryRun) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or use --dry-run).');
    process.exit(2);
  }

  const appConfig = require('../src/config');
  const { Database } = require('../src/db/client');
  const { migrate } = require('../src/db/migrate');

  const dbFile = process.env.SEVA_DB_FILE || appConfig.db.file;
  if (dbFile !== ':memory:' && !fs.existsSync(dbFile)) {
    console.error(`Local database not found: ${dbFile}\nRun "npm run migrate && npm run seed" first.`);
    process.exit(2);
  }

  const db = new Database(dbFile);
  migrate(db, appConfig.db.migrationsDir);
  const tables = options.tables ? options.tables.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

  console.log(`Database : ${dbFile}`);
  console.log(`Target   : ${config ? `${config.url}/rest/v1/${MIRROR_TABLE}` : '(dry run — nothing sent)'}`);
  try {
    const counts = await syncAll({ db, config, tables, dryRun });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`${dryRun ? 'Would sync' : 'Synced'} ${total} row(s) across ${Object.keys(counts).length} table(s).`);
  } finally {
    db.close();
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
