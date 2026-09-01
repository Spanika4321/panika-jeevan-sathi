#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — database + photo backup.
 *
 * Reads every table (including D1-backed profile photos), encrypts one JSON
 * snapshot, and leaves it ready for a GitHub Actions artifact. R2 is optional:
 *
 *   1. Cloudflare D1        — live members + temporary compressed photo store
 *   2. GitHub Actions       — encrypted rolling snapshots (90 days)
 *   3. Cloudflare R2        — optional extra copy whenever a bucket is added
 *
 * Usage:
 *   node scripts/db-backup.mjs                     # dump → backups/ + R2
 *   node scripts/db-backup.mjs --out backups       # choose the output folder
 *   node scripts/db-backup.mjs --no-remote         # local dump only
 *
 * Environment:
 *   CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_API_TOKEN   (required)
 *   R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID,
 *   R2_SECRET_ACCESS_KEY                                (optional, for copy 2)
 *   BACKUP_KEY   passphrase → AES-256-GCM encryption (required unless the
 *                explicit --allow-plaintext escape hatch is passed)
 *   BACKUP_KEEP  how many snapshots to keep in R2 (default 30)
 *
 * Exits non-zero if the dump could not be produced, so the workflow turns red
 * and GitHub emails the owner.
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
const outDir = path.resolve(process.cwd(), arg('out', 'backups'));
const useRemote = !args.includes('--no-remote');
const keep = Number(process.env.BACKUP_KEEP || 30);

function log(msg) {
  console.log(msg);
}
function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ 1. dump */

const d1Config = d1Lib.configFromEnv();
if (!d1Config) {
  fail(
    'D1 is not configured (CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_D1_API_TOKEN).\n' +
      '  Nothing to back up — the site is still running on an ephemeral local file.'
  );
}

const d1 = d1Lib.createClient(d1Config, { log: (m) => log(`    ${m}`) });

log('1. Reading Cloudflare D1');
const tables = Object.keys(TABLES);
const snapshot = {
  format: 'pjs-backup-1',
  createdAt: new Date().toISOString(),
  account: d1Config.accountId,
  database: d1Config.databaseId,
  tables: {}
};

async function readTable(table) {
  if (table !== 'photo_blobs') return d1.selectAll(table);

  // A photo table near the bridge safety line is too large for one D1 HTTP
  // response. Keyset pagination also avoids OFFSET repeatedly scanning blobs.
  const rows = [];
  const pageSize = Math.max(1, Math.min(20, Number(process.env.BACKUP_PHOTO_PAGE || 5)));
  let after = '';
  for (;;) {
    const page = await d1.query(
      'SELECT * FROM "photo_blobs" WHERE "name" > ? ORDER BY "name" LIMIT ?',
      [after, pageSize]
    );
    const found = page.results || [];
    rows.push(...found);
    if (found.length < pageSize) break;
    after = String(found[found.length - 1].name);
  }
  return rows;
}

let totalRows = 0;
for (const table of tables) {
  try {
    const rows = await readTable(table);
    snapshot.tables[table] = rows;
    totalRows += rows.length;
    log(`   ✓ ${table.padEnd(18)} ${rows.length} row(s)`);
  } catch (err) {
    fail(`could not read table "${table}" from D1: ${err.message}`);
  }
}
log(`   → ${totalRows} row(s) across ${tables.length} tables`);

/* ---------------------------------------------------- 2. serialise & encrypt */

const stamp = snapshot.createdAt.replace(/[:.]/g, '-');
let payload = Buffer.from(JSON.stringify(snapshot, null, 0), 'utf8');
let ext = 'json';
const key = String(process.env.BACKUP_KEY || '').trim();
if (!key && !args.includes('--allow-plaintext')) {
  fail(
    'BACKUP_KEY is required so member data never lands in a readable GitHub artifact.\n' +
      '  Set BACKUP_KEY, or use --allow-plaintext only for a deliberate local export.'
  );
}

if (key) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derived = crypto.scryptSync(key, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  const body = Buffer.concat([cipher.update(payload), cipher.final()]);
  // header: magic(8) | salt(16) | iv(12) | tag(16) | ciphertext
  payload = Buffer.concat([Buffer.from('PJSBAK01'), salt, iv, cipher.getAuthTag(), body]);
  ext = 'json.enc';
  log('\n2. Encrypting snapshot (AES-256-GCM, scrypt key)');
} else {
  log('\n2. Snapshot is NOT encrypted (set BACKUP_KEY to encrypt it)');
}

fs.mkdirSync(outDir, { recursive: true });
const fileName = `pjs-backup-${stamp}.${ext}`;
const localFile = path.join(outDir, fileName);
fs.writeFileSync(localFile, payload);
fs.writeFileSync(
  path.join(outDir, 'latest.json'),
  JSON.stringify(
    { file: fileName, createdAt: snapshot.createdAt, rows: totalRows, encrypted: Boolean(key) },
    null,
    2
  )
);
log(`   ✓ ${localFile} (${(payload.length / 1024).toFixed(1)} KB)`);

/* ------------------------------------------------------------- 3. push to R2 */

const r2Config = r2Lib.configFromEnv();
if (useRemote && r2Config) {
  log('\n3. Uploading to Cloudflare R2');
  const r2 = r2Lib.createClient(r2Config, { log: (m) => log(`    ${m}`) });
  const remoteKey = `backups/${fileName}`;
  try {
    await r2.put(remoteKey, payload, key ? 'application/octet-stream' : 'application/json');
    log(`   ✓ r2://${r2Config.bucket}/${r2Config.prefix}/${remoteKey}`);
  } catch (err) {
    fail(`R2 upload failed: ${err.message}`);
  }

  // Keep the bucket tidy: retain the newest `keep` snapshots.
  try {
    const keys = (await r2.list('backups')).filter((k) => k.includes('pjs-backup-'));
    const sorted = keys.sort();
    const drop = sorted.slice(0, Math.max(0, sorted.length - keep));
    for (const k of drop) {
      await r2.remove(k.startsWith('backups/') ? k : `backups/${k}`);
    }
    log(`   ✓ ${sorted.length - drop.length} snapshot(s) retained, ${drop.length} pruned`);
  } catch (err) {
    log(`   – retention pass skipped: ${err.message}`);
  }
} else if (useRemote) {
  log('\n3. R2 is not configured — skipping the off-site copy.');
} else {
  log('\n3. --no-remote: skipping the off-site copy.');
}

log(`\n✓ Backup complete — ${totalRows} row(s), ${fileName}`);
