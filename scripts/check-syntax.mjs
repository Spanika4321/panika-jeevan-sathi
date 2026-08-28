#!/usr/bin/env node
/**
 * Syntax check for every JavaScript file we ship:
 *  - public/assets/js/*.js
 *  - every inline <script> block inside public/*.html
 *
 *   node scripts/check-syntax.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-syntax-'));

let checked = 0;
let broken = 0;

function check(label, code) {
  const file = path.join(tmp, `check-${checked}.mjs`);
  fs.writeFileSync(file, code);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    checked++;
  } catch (err) {
    broken++;
    console.log(`  ✗ ${label}`);
    console.log(String(err.stderr || err.message).split('\n').slice(0, 6).join('\n'));
  }
}

for (const file of fs.readdirSync(path.join(PUBLIC, 'assets', 'js'))) {
  if (!file.endsWith('.js')) continue;
  check(`assets/js/${file}`, fs.readFileSync(path.join(PUBLIC, 'assets', 'js', file), 'utf8'));
}

for (const file of fs.readdirSync(PUBLIC)) {
  if (!file.endsWith('.html')) continue;
  const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  blocks.forEach((m, i) => {
    if (m[1].trim()) check(`${file} <script #${i + 1}>`, m[1]);
  });
  checked++;
}

console.log(`  ${checked - broken} checked, ${broken} with syntax errors`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(broken ? 1 : 0);
