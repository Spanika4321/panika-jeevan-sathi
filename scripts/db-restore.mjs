#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — restore a backup into Cloudflare D1.
 *
 * A backup nobody has ever restored is not a backup, so this script is the
 * other half of scripts/db-backup.mjs and is exercised by the test suite.
 *
 *   node scripts/db-restore.mjs --file backups/pjs-backup-....json[.enc]
 *   node scripts/db-restore.mjs --from-r2 latest        # newest snapshot in R2
 *   node scripts/db-restore.mjs --file ... --dry-run    # only show the plan
 *
 * Safety:
 *   • --dry-run (default OFF) prints what would happen and changes nothing.
 *   • Restoring requires --yes, because it overwrites live rows.
 *   • Rows are written with INSERT OR REPLACE, so a restore is idempotent and
 *     never destroys rows that were created after the snapshot unless you
 *     also pass --wipe.
 *
 * Environment: the same CF_* / R2_* / BACKUP_KEY variables as db-backup.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const d1Lib = require('../lib/d1.js');
const r2Lib = require('../lib/r2.js');
const { TABLES } = require('../lib/db.js');

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}
const dryRun = args.includes('--dry-run') || !args.includes('--yes');
const wipe = args.includes('--wipe');

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

/** Undo the AES-256-GCM envelope written by db-backup.mjs. */
export function decrypt(buffer, key) {
  if (buffer.subarray(0, 8).toString('utf8') !== 'PJSBAK01') return buffer;
  if (!key) fail('this snapshot is encrypted — set BACKUP_KEY to restore it.');
  const salt = buffer.subarray(8, 24);
  const iv = buffer.subarray(24, 36);
  const tag = buffer.subarray(36, 52);
  const body = buffer.subarray(52);
  const derived = crypto.scryptSync(key, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', derived, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/* ------------------------------------------------------------ 1. load file */

let raw = null;
const fileArg = arg('file');

if (fileArg) {
  const file = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(file)) fail(`no such file: ${file}`);
  raw = fs.readFileSync(file);
  console.log(`1. Loaded ${file} (${(raw.length / 1024).toFixed(1)} KB)`);
} else if (args.includes('--from-r2')) {
  const r2Config = r2Lib.configFromEnv();
  if (!r2Config) fail('R2 is not configured (R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).');
  const r2 = r2Lib.createClient(r2Config);
  const keys = (await r2.list('backups')).filter((k) => k.includes('pjs-backup-')).sort();
  if (!keys.length) fail('no snapshots found in R2 under backups/.');
  const wanted = arg('from-r2', 'latest');
  const chosen = wanted === 'latest' ? keys[keys.length - 1] : keys.find((k) => k.includes(wanted));
  if (!chosen) fail(`no snapshot in R2 matching "${wanted}".`);
  raw = await r2.get(chosen.startsWith('backups/') ? chosen : `backups/${chosen}`);
  if (!raw) fail(`snapshot ${chosen} disappeared from R2.`);
  console.log(`1. Downloaded r2://${r2Config.bucket}/${chosen} (${(raw.length / 1024).toFixed(1)} KB)`);
} else {
  fail('pass --file <path> or --from-r2 latest');
}

const plain = decrypt(raw, String(process.env.BACKUP_KEY || '').trim());
let snapshot;
try {
  snapshot = JSON.parse(plain.toString('utf8'));
} catch (err) {
  fail(`snapshot is not readable JSON (wrong BACKUP_KEY?): ${err.message}`);
}
if (snapshot.format !== 'pjs-backup-1') fail(`unknown backup format: ${snapshot.format}`);

console.log(`   taken ${snapshot.createdAt}, database ${snapshot.database}`);

/* --------------------------------------------------------------- 2. plan */

const plan = [];
let totalRows = 0;
for (const table of Object.keys(TABLES)) {
  const rows = snapshot.tables[table] || [];
  totalRows += rows.length;
  if (rows.length) plan.push({ table, rows });
  console.log(`   ${table.padEnd(18)} ${rows.length} row(s)`);
}
console.log(`\n2. Plan: restore ${totalRows} row(s)${wipe ? ' after DELETING existing rows' : ' (INSERT OR REPLACE)'}`);

if (dryRun) {
  console.log('\n– Dry run. Nothing was changed. Re-run with --yes to apply.');
  process.exit(0);
}

/* ------------------------------------------------------------- 3. restore */

const d1Config = d1Lib.configFromEnv();
if (!d1Config) fail('D1 is not configured (CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_D1_API_TOKEN).');
const d1 = d1Lib.createClient(d1Config, { log: (m) => console.log(`    ${m}`) });

const statements = [];
if (wipe) {
  for (const { table } of plan) statements.push({ sql: `DELETE FROM "${table}"`, params: [] });
}
for (const { table, rows } of plan) {
  for (const row of rows) {
    const cols = Object.keys(row).filter((c) => row[c] !== undefined);
    if (!cols.length) continue;
    statements.push({
      sql: `INSERT OR REPLACE INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols
        .map(() => '?')
        .join(', ')})`,
      params: cols.map((c) => row[c])
    });
  }
}

console.log(`\n3. Sending ${statements.length} statement(s) to D1`);
try {
  await d1.execScript(require('../lib/db.js').SCHEMA);
  await d1.run(statements);
} catch (err) {
  fail(`restore failed: ${err.message}`);
}

console.log(`\n✓ Restore complete — ${totalRows} row(s) are back in D1.`);
