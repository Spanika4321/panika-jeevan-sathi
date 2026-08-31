#!/usr/bin/env node
/**
 * Syntax check for every JavaScript file we ship.
 *
 *   node scripts/check-syntax.mjs
 *
 * Do layers:
 *   1. Browser code  — public/assets/js/*.js + every inline <script> block in
 *      public/*.html (inlined into a temp .mjs so `node --check` can parse it)
 *   2. Server code   — every .js / .cjs / .mjs in the repository
 *      (server.js, lib/, scripts/, agents/), skipping node_modules, data,
 *      storage and reports.
 *
 * Layer 2 matters: CI calls this "Syntax check" as step 1, so a typo in
 * lib/api.js or agents/worker.mjs has to fail here and not at boot time on
 * the live server.
 *
 * Exit 0 when everything parses, 1 when any file is broken.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-syntax-'));

const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'storage', 'reports', '.cache']);

let checked = 0;
let broken = 0;
const failures = [];

function check(label, code) {
  const file = path.join(tmp, `check-${checked}.mjs`);
  fs.writeFileSync(file, code);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    checked++;
  } catch (err) {
    broken++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
    console.log(String(err.stderr || err.message).split('\n').slice(0, 6).join('\n'));
  }
}

/** Parse a file in place — keeps CommonJS `require` semantics honest. */
function checkFile(file) {
  const label = path.relative(ROOT, file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    checked++;
  } catch (err) {
    broken++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
    console.log(String(err.stderr || err.message).split('\n').slice(0, 6).join('\n'));
  }
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(js|cjs|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/* ------------------------------------------------------ 1. browser code */

let browserFiles = 0;
let browserBlocks = 0;
let htmlPages = 0;

// Missing directory ko crash (ENOENT) nahi, saaf FAIL banana chahiye — warna
// ek adhoori copy (jaise recovery clone) mein pata hi nahi chalta kya kho hai.
const jsDir = path.join(PUBLIC, 'assets', 'js');
if (!fs.existsSync(PUBLIC) || !fs.existsSync(jsDir)) {
  broken++;
  failures.push('public/ (or public/assets/js) is missing');
  console.log(`  ✗ public/ tree is missing at ${path.relative(ROOT, PUBLIC) || 'public'} — cannot check browser code`);
}

for (const file of fs.existsSync(jsDir) ? fs.readdirSync(jsDir) : []) {
  if (!file.endsWith('.js')) continue;
  const before = checked;
  check(`assets/js/${file}`, fs.readFileSync(path.join(PUBLIC, 'assets', 'js', file), 'utf8'));
  if (checked > before) browserFiles++;
}

for (const file of fs.existsSync(PUBLIC) ? fs.readdirSync(PUBLIC) : []) {
  if (!file.endsWith('.html')) continue;
  htmlPages++;
  const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  blocks.forEach((m, i) => {
    if (!m[1].trim()) return;
    const before = checked;
    check(`${file} <script #${i + 1}>`, m[1]);
    if (checked > before) browserBlocks++;
  });
  checked++;
}

/* ------------------------------------------------------- 2. server code */

const serverFiles = walk(ROOT).sort();
for (const file of serverFiles) checkFile(file);

/* --------------------------------------------------------------- report */

console.log('');
console.log(`  browser code : ${browserFiles} js file(s) + ${browserBlocks} inline <script> block(s) in ${htmlPages} page(s)`);
console.log(`  server code  : ${serverFiles.length} file(s) (server.js, lib/, scripts/, agents/)`);
console.log(`  ${checked - broken} checked, ${broken} with syntax errors`);
if (failures.length) console.log(`  broken: ${failures.join(', ')}`);

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(broken ? 1 : 0);
