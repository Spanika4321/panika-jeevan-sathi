#!/usr/bin/env node
/**
 * ARENA ↔ TERMUX batch helper: verify the device's app-code working tree.
 *
 * Read-only. Runs `git status --porcelain --untracked-files=no` over the app
 * code paths (server.js, lib/, public/, agents/) and asserts that the ONLY
 * tracked modification is the owner-approved UI file(s). Untracked backup
 * files (e.g. *.bak) are deliberately ignored by --untracked-files=no so they
 * are never mistaken for app-code drift.
 *
 * Usage:
 *   node scripts/app-diff-verify.mjs                    # allow public/assets/js/app.js
 *   node scripts/app-diff-verify.mjs --allow public/assets/js/app.js
 *
 * Exit 0 only when the allowed change is present AND nothing else changed.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PATHS = ['server.js', 'lib', 'public', 'agents'];

const allow = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--allow') {
    allow.push(argv[i + 1]);
    i += 1;
  }
}
if (allow.length === 0) allow.push('public/assets/js/app.js');
const allowedSet = new Set(allow.map((p) => p.replace(/^\.\//, '').replace(/^\//, '')));

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString();
  } catch (e) {
    try {
      return String(e.stdout ?? '');
    } catch (err) {
      return '';
    }
  }
}

const status = git(['status', '--porcelain', '--untracked-files=no', '--', ...APP_PATHS]);
const lines = String(status || '')
  .split('\n')
  .map((l) => l.replace(/\s+$/, ''))
  .filter(Boolean);

const paths = [];
for (const line of lines) {
  // porcelain v2 uses "1 <...>" header and path elsewhere, but git defaults to
  // porcelain v1 here; parse the common v1 "XY <path>" shape safely.
  if (/^1\s/.test(line)) {
    const parts = line.split(' ');
    const last = parts[parts.length - 1];
    if (last) paths.push(last.replace(/^"|"$/g, '').replace(/"\\"/g, '"'));
    continue;
  }
  const p = line.slice(3).trim().replace(/^"|"$/g, '').replace(/"\\"/g, '"');
  if (p) paths.push(p);
}

const unexpected = paths.filter((p) => !allowedSet.has(p));
const presentAllowed = paths.filter((p) => allowedSet.has(p));

if (presentAllowed.length === 0) {
  console.error('APP CODE DIFF FAIL');
  console.error(`expected allowed app-code change(s) to be present, but none was found: ${[...allowedSet].join(', ')}`);
  process.exit(1);
}

if (unexpected.length) {
  console.error('APP CODE DIFF FAIL');
  console.error(`unexpected app-code change(s): ${unexpected.join(', ')}`);
  console.error(`allowed app-code change(s): ${[...allowedSet].join(', ')}`);
  process.exit(1);
}

console.log('APP CODE DIFF OK');
console.log(`allowed app-code change(s) present: ${presentAllowed.join(', ')}`);
