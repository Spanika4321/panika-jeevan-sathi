#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — member-data backup (Guardian agent).
 *
 * Matrimonial data is people's lives: a lost profile cannot be explained away.
 * This makes a verifiable, self-describing snapshot that needs no external
 * service, so the owner can always return to a known-good moment.
 *
 *   npm run backup                          → .backups/pjs-<timestamp>/
 *   npm run backup -- --dest /mnt/disk      → anywhere with free space
 *   npm run backup -- --keep 14             → prune, keeping the 14 newest
 *   npm run backup -- --list                → snapshots + member counts
 *   npm run backup -- --verify <dir>        → re-hash every file in a snapshot
 *   npm run backup -- --selftest            → backup + restore round trip in temp dirs
 *
 * What is captured (everything, not just the database):
 *   data/     the SQLite database or JSON store, uploaded photos, SEO reports
 *   storage/  the 12 agents' permanent memory + shared knowledge and ledger
 *
 * Exit 0 on success. A snapshot whose manifest does not verify is a FAILURE,
 * never a warning — an unreadable backup must be loud.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const has = (flag) => ARGS.includes(flag);
const valueOf = (flag, fallback) => {
  const i = ARGS.indexOf(flag);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : fallback;
};

/* Mutable so --selftest can point the whole tool at a throwaway fixture. */
let DATA_DIR = process.env.PJS_DATA_DIR || path.join(ROOT, 'data');
let AGENT_DIR = process.env.PJS_AGENT_DIR || path.join(ROOT, 'storage');
let DEST = path.resolve(valueOf('--dest', process.env.PJS_BACKUP_DIR || path.join(ROOT, '.backups')));

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, base = dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

function copyTree(src, destDir) {
  const files = walk(src);
  let bytes = 0;
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(src, rel));
    const to = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, buf);
    bytes += buf.length;
  }
  return { files: files.length, bytes };
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', 'T');
}

/**
 * Row counts are read from the snapshot itself, so they describe what was
 * actually written rather than what the live database looked like mid-copy.
 */
function countRows(dir) {
  const out = {};
  const dataDir = path.join(dir, 'data');
  const tables = ['users', 'profiles', 'messages', 'interests', 'shortlist', 'settings'];
  const dbFile = path.join(dataDir, 'panika-jeevan-sathi.db');
  if (fs.existsSync(dbFile)) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbFile, { readOnly: true });
      for (const t of tables) {
        try {
          out[t === 'users' ? 'members' : t] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
        } catch (_) {
          /* the table may legitimately not exist yet */
        }
      }
      db.close();
      return out;
    } catch (_) {
      /* fall through to the JSON store */
    }
  }
  const jsonStore = path.join(dataDir, 'store.json');
  if (fs.existsSync(jsonStore)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonStore, 'utf8'));
      for (const [t, rows] of Object.entries(parsed.tables || parsed)) {
        out[t === 'users' ? 'members' : t] = Array.isArray(rows) ? rows.length : 0;
      }
    } catch (_) {
      /* informational only */
    }
  }
  return out;
}

function createBackup({ quiet = false } = {}) {
  const dir = path.join(DEST, `pjs-${stamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    created_at: new Date().toISOString(),
    app: 'panika-jeevan-sathi',
    node: process.version,
    sections: {},
    files: {}
  };

  let totalBytes = 0;
  let totalFiles = 0;
  for (const [name, src] of [['data', DATA_DIR], ['storage', AGENT_DIR]]) {
    if (!fs.existsSync(src)) {
      if (!quiet) console.log(`  – ${name}: nothing there (${src})`);
      continue;
    }
    const target = path.join(dir, name);
    const result = copyTree(src, target);
    manifest.sections[name] = Object.assign({ source: src }, result);
    for (const rel of walk(target)) {
      const full = path.join(target, rel);
      manifest.files[`${name}/${rel}`] = sha256(full);
      totalBytes += fs.statSync(full).size;
      totalFiles += 1;
    }
    if (!quiet) console.log(`  ✓ ${name}: ${result.files} files, ${(result.bytes / 1024).toFixed(1)} KiB`);
  }

  manifest.counts = countRows(dir);
  if (!manifest.counts.members && !quiet) {
    console.log('  ⚠ 0 members in this snapshot — expected only on a brand-new install');
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(
    path.join(dir, 'RESTORE.txt'),
    [
      'To restore this snapshot:',
      '',
      '  npm run restore -- "<path to this folder>"',
      '',
      'The current data is copied to data-replaced-<timestamp>/ before anything is',
      'overwritten, so a restore can itself be undone. Then restart the site.',
      ''
    ].join('\n')
  );
  return { dir, manifest, totalFiles, totalBytes };
}

function verify(dir) {
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return { ok: false, error: 'manifest.json is missing', checked: 0, bad: [] };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (err) {
    return { ok: false, error: `manifest.json is not readable (${err.message})`, checked: 0, bad: [] };
  }
  const bad = [];
  let checked = 0;
  for (const [rel, hash] of Object.entries(manifest.files || {})) {
    const full = path.join(dir, rel);
    if (!fs.existsSync(full)) {
      bad.push(`${rel}: missing`);
      continue;
    }
    if (sha256(full) !== hash) bad.push(`${rel}: does not match the manifest`);
    checked += 1;
  }
  if (!checked) bad.push('the snapshot contains no files');
  return { ok: bad.length === 0, checked, bad };
}

function prune(keep) {
  if (!keep || !fs.existsSync(DEST)) return 0;
  const dirs = fs
    .readdirSync(DEST)
    .filter((n) => n.startsWith('pjs-'))
    .map((n) => path.join(DEST, n))
    .filter((p) => fs.existsSync(path.join(p, 'manifest.json')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  let removed = 0;
  for (const p of dirs.slice(Number(keep))) {
    fs.rmSync(p, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/* --------------------------------------------------------------- commands */

if (has('--selftest')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-backup-'));
  const fixtureData = path.join(tmp, 'data');
  const fixtureAgents = path.join(tmp, 'storage');
  fs.mkdirSync(path.join(fixtureData, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(fixtureAgents, 'agents/manager'), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureData, 'store.json'),
    JSON.stringify({ tables: { users: [{ id: 1 }, { id: 2 }], profiles: [{ id: 1 }] } })
  );
  fs.writeFileSync(path.join(fixtureData, 'uploads', 'photo-1.txt'), 'photo-bytes');
  fs.writeFileSync(path.join(fixtureAgents, 'agents/manager/state.json'), '{"runs":3}');

  DATA_DIR = fixtureData;
  AGENT_DIR = fixtureAgents;
  DEST = path.join(tmp, 'backups');
  const snapshot = createBackup({ quiet: true });
  const verdict = verify(snapshot.dir);

  const restore = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts/restore.mjs'), snapshot.dir, '--into', path.join(tmp, 'restored'), '--quiet'],
    { encoding: 'utf8' }
  );
  let restoredOk = false;
  try {
    restoredOk =
      restore.status === 0 &&
      fs.readFileSync(path.join(tmp, 'restored/data/uploads/photo-1.txt'), 'utf8') === 'photo-bytes' &&
      JSON.parse(fs.readFileSync(path.join(tmp, 'restored/storage/agents/manager/state.json'), 'utf8')).runs === 3;
  } catch (_) {
    restoredOk = false;
  }

  // A tampered snapshot must be caught, not silently accepted.
  fs.appendFileSync(path.join(snapshot.dir, 'data/uploads/photo-1.txt'), '-tampered');
  const tamper = verify(snapshot.dir);

  const ok =
    verdict.ok &&
    verdict.checked === 3 &&
    snapshot.totalFiles === 3 &&
    snapshot.manifest.counts.members === 2 &&
    restoredOk &&
    tamper.ok === false;
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('');
  console.log(`  snapshot files      : ${snapshot.totalFiles} (2 members detected in the store)`);
  console.log(`  manifest verify     : ${verdict.ok ? 'PASS' : `FAIL — ${(verdict.bad || [verdict.error]).join('; ')}`}`);
  console.log(`  restore round trip  : ${restoredOk ? 'PASS' : `FAIL — ${(restore.stderr || restore.stdout || 'no output').trim().slice(0, 160)}`}`);
  console.log(`  tamper detection    : ${tamper.ok === false ? 'PASS — a modified file is rejected' : 'FAIL — tampering went unnoticed'}`);
  console.log('');
  console.log(`  [backup-selftest] ${ok ? 'PASS — a snapshot is restorable byte for byte' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}

if (has('--verify')) {
  const dir = valueOf('--verify', '');
  if (!dir) {
    console.error('usage: node scripts/backup.mjs --verify <snapshot-dir>');
    process.exit(2);
  }
  const v = verify(path.resolve(dir));
  if (v.ok) {
    console.log(`  ✓ ${v.checked} files match the manifest — this snapshot is restorable`);
    process.exit(0);
  }
  console.error(`  ✗ snapshot is NOT trustworthy: ${(v.bad || [v.error]).join('; ')}`);
  process.exit(1);
}

if (has('--list')) {
  if (!fs.existsSync(DEST)) {
    console.log(`  no backups yet (${DEST})`);
    process.exit(0);
  }
  const rows = fs
    .readdirSync(DEST)
    .filter((n) => n.startsWith('pjs-'))
    .map((n) => {
      const m = path.join(DEST, n, 'manifest.json');
      let info = {};
      try {
        info = JSON.parse(fs.readFileSync(m, 'utf8'));
      } catch (_) {
        info = { corrupt: true };
      }
      return {
        name: n,
        created: info.created_at || 'unknown',
        members: info.counts && info.counts.members !== undefined ? info.counts.members : '?',
        files: Object.keys(info.files || {}).length,
        corrupt: Boolean(info.corrupt)
      };
    })
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  console.log('');
  console.log('  snapshot                       members  files  manifest');
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(30)} ${String(r.members).padStart(7)}  ${String(r.files).padStart(5)}  ${r.corrupt ? 'CORRUPT' : 'ok'}`);
  }
  console.log('');
  process.exit(rows.some((r) => r.corrupt) ? 1 : 0);
}

const { dir, totalFiles, totalBytes, manifest } = createBackup();
const removed = prune(valueOf('--keep', null));
const v = verify(dir);
console.log('');
console.log(`  Snapshot : ${path.relative(ROOT, dir) || dir}`);
console.log(`  Files    : ${totalFiles} (${(totalBytes / 1024 / 1024).toFixed(2)} MiB)`);
console.log(`  Members  : ${manifest.counts && manifest.counts.members !== undefined ? manifest.counts.members : 'unknown'}`);
console.log(`  Integrity: ${v.ok ? `verified — ${v.checked} sha256 hashes match` : `FAILED — ${(v.bad || [v.error]).join('; ')}`}`);
if (removed) console.log(`  Pruned   : ${removed} older snapshot(s), keeping ${valueOf('--keep', '?')}`);
console.log(`  Restore  : npm run restore -- ${path.relative(ROOT, dir)}`);
console.log('');
if (!v.ok) process.exit(1);
