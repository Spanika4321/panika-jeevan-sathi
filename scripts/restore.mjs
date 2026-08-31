#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — restore a verified backup (Guardian agent).
 *
 *   npm run restore -- .backups/pjs-20260831T070000
 *   npm run restore -- <snapshot> --dry-run      → what would change, writes nothing
 *   npm run restore -- <snapshot> --force        → actually replace the data
 *   npm run restore -- <snapshot> --into DIR     → restore somewhere else (selftest/inspection)
 *
 * Rules, in this order:
 *   1. The snapshot manifest must verify (sha256) or the script stops.
 *   2. The data being replaced is first copied to data-replaced-<timestamp>/,
 *      so a restore can always be undone.
 *   3. Nothing is written without --force (or --into, which is a fresh folder).
 *   4. A restore never prints passwords or session material.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const valueOf = (f, fb) => {
  const i = ARGS.indexOf(f);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : fb;
};

const SNAP = ARGS.find((a) => !a.startsWith('--') && !isValue(a));
function isValue(arg) {
  const i = ARGS.indexOf(arg);
  return i > 0 && ['--dest', '--into', '--from'].includes(ARGS[i - 1]);
}

if (!SNAP) {
  console.error('usage: node scripts/restore.mjs <snapshot-dir> [--dry-run|--force] [--into DIR]');
  process.exit(2);
}

const DATA_DIR = process.env.PJS_DATA_DIR || path.join(ROOT, 'data');
const AGENT_DIR = path.join(ROOT, 'storage');
const snapshot = path.resolve(SNAP);
const manifestPath = path.join(snapshot, 'manifest.json');

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

if (!fs.existsSync(manifestPath)) {
  console.error(`  ✗ ${snapshot} is not a backup: manifest.json is missing`);
  console.error('    make one with: npm run backup');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entries = Object.entries(manifest.files || {});
if (!entries.length) {
  console.error('  ✗ this snapshot declares no files — refusing to restore');
  process.exit(1);
}

/* ------------------------------------------------------------- verification */

const bad = [];
for (const [rel, hash] of entries) {
  const full = path.join(snapshot, rel);
  if (!fs.existsSync(full)) bad.push(`${rel}: missing from the folder`);
  else if (sha256(full) !== hash) bad.push(`${rel}: does not match the manifest`);
}
if (bad.length) {
  console.error('');
  console.error(`  ✗ REFUSING TO RESTORE — the snapshot is not intact (${bad.length} problem(s))`);
  for (const b of bad.slice(0, 8)) console.error(`      ${b}`);
  console.error('');
  console.error('    A partial snapshot would replace live member data with silence.');
  console.error('    Pick another snapshot: npm run backup -- --list');
  console.error('');
  process.exit(1);
}

/* ------------------------------------------------------------- plan/apply */

const into = valueOf('--into', null);
const dryRun = has('--dry-run') || (!has('--force') && !into);
const targets = [];
for (const [rel] of entries) {
  const slash = rel.indexOf('/');
  const section = rel.slice(0, slash);
  const rest = rel.slice(slash + 1);
  if (section === 'data') targets.push([path.join(snapshot, rel), into ? path.join(into, 'data', rest) : path.join(DATA_DIR, rest)]);
  else if (section === 'storage') targets.push([path.join(snapshot, rel), into ? path.join(into, 'storage', rest) : path.join(AGENT_DIR, rest)]);
}

let wouldAdd = 0;
let wouldChange = 0;
let same = 0;
for (const [from, to] of targets) {
  if (!fs.existsSync(to)) wouldAdd += 1;
  else if (sha256(from) !== sha256(to)) wouldChange += 1;
  else same += 1;
}

console.log('');
console.log(`  Snapshot  : ${snapshot}`);
console.log(`  Created   : ${manifest.created_at}`);
console.log(`  Files     : ${entries.length} — manifest verified (sha256)`);
console.log(`  Members   : ${manifest.counts && manifest.counts.members !== undefined ? manifest.counts.members : 'not recorded'}`);
console.log(`  Target    : ${into || path.join(ROOT, 'data')} + ${into || 'storage/'}`);
console.log(`  Changes   : ${wouldAdd} new, ${wouldChange} different, ${same} already identical`);

if (dryRun) {
  console.log('');
  console.log(`  ${into ? 'DRY RUN' : 'DRY RUN'} — nothing was written. Add --force to apply this restore.`);
  console.log('');
  process.exit(0);
}

if (!into) {
  const stampNow = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const safety = path.join(ROOT, `data-replaced-${stampNow}`);
  if (fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(safety, { recursive: true });
    for (const rel of walk(DATA_DIR)) {
      const buf = fs.readFileSync(path.join(DATA_DIR, rel));
      const to = path.join(safety, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, buf);
    }
    console.log(`  Safety    : live data copied to ${path.relative(ROOT, safety)}`);
  }
}

let written = 0;
for (const [from, to] of targets) {
  const buf = fs.readFileSync(from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, buf);
  written += 1;
}
console.log(`  Restored  : ${written} files written`);
console.log('');
console.log('  Restart the site now (npm start / redeploy) so it re-reads the restored database.');
console.log('  Confirm with: npm run health && npm run backup -- --verify ' + snapshot);
console.log('');
