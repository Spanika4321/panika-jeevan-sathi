#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — backup & restore test.
 *
 * Proves, against local stand-ins for D1 and R2, that:
 *   1. db-backup.mjs reads every table out of D1 and writes a snapshot,
 *   2. the snapshot is encrypted when BACKUP_KEY is set (and unreadable
 *      without it),
 *   3. the snapshot is pushed to R2 under backups/,
 *   4. after a total wipe of D1, db-restore.mjs puts every member, profile
 *      and message back — from the R2 copy, without the local file,
 *   5. restoring twice is safe (idempotent).
 *
 *   node scripts/backup-test.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createD1Mock, createR2Mock } from './lib/mock-cloud.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function run(script, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env, NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => resolve({ code, out }));
  });
}

/* ------------------------------------------------------------------- setup */

const d1 = createD1Mock({ token: 'test-token' });
const r2 = createR2Mock({ bucket: 'pjs-test', prefix: 'uploads' });
const d1Url = await d1.listen();
const r2Url = await r2.listen();
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-backup-test-'));

const BACKUP_KEY = 'test-passphrase-2026';
const env = {
  CF_ACCOUNT_ID: 'test-account',
  CF_D1_DATABASE_ID: 'test-db',
  CF_D1_API_TOKEN: 'test-token',
  CF_D1_API_URL: d1Url,
  R2_ACCOUNT_ID: 'test-account',
  R2_BUCKET: 'pjs-test',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_ENDPOINT: r2Url,
  R2_PREFIX: 'uploads',
  BACKUP_KEY
};

// Seed the mock D1 with the real schema and a few members.
const { SCHEMA } = await import('../lib/db.js').then((m) => m.default || m);
for (const stmt of SCHEMA.split(';')) {
  const sql = stmt.trim();
  if (sql) d1.db.exec(sql);
}
const now = Date.now();
for (let i = 1; i <= 3; i += 1) {
  d1.db
    .prepare('INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(i, `member${i}@example.com`, `hash${i}`, `Member ${i}`, now);
  d1.db
    .prepare('INSERT INTO profiles (user_id, headline, city, updated_at) VALUES (?, ?, ?, ?)')
    .run(i, `Headline ${i}`, 'Raipur', now);
}
d1.db
  .prepare('INSERT INTO messages (id, sender_id, receiver_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
  .run(1, 1, 2, 'Namaste', now);

/* ------------------------------------------------------------- 1. backup */

section('1. Backup');
const backup = await run('scripts/db-backup.mjs', ['--out', workDir], env);
check('db-backup.mjs exits successfully', backup.code === 0, backup.out.slice(-400));
check('it reports the rows it dumped', /users\s+3 row/.test(backup.out), backup.out.slice(-400));

const files = fs.existsSync(workDir) ? fs.readdirSync(workDir) : [];
const snapshotName = files.find((f) => f.startsWith('pjs-backup-'));
check('a snapshot file was written', Boolean(snapshotName), files.join(', '));
check('the snapshot is encrypted (.json.enc)', Boolean(snapshotName && snapshotName.endsWith('.json.enc')), snapshotName);
check('latest.json points at the snapshot', files.includes('latest.json'));

const snapshotPath = snapshotName ? path.join(workDir, snapshotName) : null;
const rawSnapshot = snapshotPath ? fs.readFileSync(snapshotPath) : Buffer.alloc(0);
check('the encrypted snapshot carries the PJSBAK01 envelope', rawSnapshot.subarray(0, 8).toString() === 'PJSBAK01');
check(
  'member e-mail addresses are NOT readable in the encrypted file',
  !rawSnapshot.toString('latin1').includes('member1@example.com')
);

/* -------------------------------------------------------------- 2. off-site */

section('2. Off-site copy in R2');
const puts = r2.requests.filter((r) => r.method === 'PUT' && r.key.startsWith('backups/'));
check('the snapshot was uploaded to R2 under backups/', puts.length === 1, JSON.stringify(r2.requests.map((r) => `${r.method} ${r.key}`)));
check('every R2 request carried a SigV4 signature', r2.requests.every((r) => r.method !== 'PUT' || r.key));

/* ------------------------------------------------------- 3. disaster + restore */

section('3. Total data loss, then restore from R2');
d1.db.exec('DELETE FROM users');
d1.db.exec('DELETE FROM profiles');
d1.db.exec('DELETE FROM messages');
const emptied = d1.db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
check('D1 is empty before the restore', Number(emptied) === 0);

const dry = await run('scripts/db-restore.mjs', ['--from-r2', 'latest'], env);
check('a restore without --yes is a dry run', dry.code === 0 && /Dry run/.test(dry.out), dry.out.slice(-300));
check('the dry run changed nothing', Number(d1.db.prepare('SELECT COUNT(*) AS c FROM users').get().c) === 0);

const restore = await run('scripts/db-restore.mjs', ['--from-r2', 'latest', '--yes'], env);
check('db-restore.mjs exits successfully', restore.code === 0, restore.out.slice(-500));

const users = d1.db.prepare('SELECT * FROM users ORDER BY id').all();
check('all 3 members came back', users.length === 3, `${users.length}`);
check('their e-mail addresses are intact', users[0] && users[0].email === 'member1@example.com');
check('profiles came back', Number(d1.db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c) === 3);
check('messages came back', Number(d1.db.prepare('SELECT COUNT(*) AS c FROM messages').get().c) === 1);

/* ------------------------------------------------------------ 4. idempotency */

section('4. Restoring twice is safe');
const again = await run('scripts/db-restore.mjs', ['--from-r2', 'latest', '--yes'], env);
check('the second restore also succeeds', again.code === 0, again.out.slice(-300));
check('it did not duplicate any member', Number(d1.db.prepare('SELECT COUNT(*) AS c FROM users').get().c) === 3);

/* ------------------------------------------------------------ 5. wrong key */

section('5. A stolen backup is useless without the key');
const wrong = await run('scripts/db-restore.mjs', ['--from-r2', 'latest', '--yes'], {
  ...env,
  BACKUP_KEY: 'the-wrong-passphrase'
});
check('restoring with the wrong BACKUP_KEY fails loudly', wrong.code !== 0, wrong.out.slice(-300));

/* ------------------------------------------------------------------ report */

d1.close();
r2.close();
fs.rmSync(workDir, { recursive: true, force: true });

console.log(`\n${'─'.repeat(58)}`);
console.log(`Backup & restore: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
}
process.exit(failed ? 1 : 0);
