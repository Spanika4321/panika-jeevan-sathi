#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — syntax check over every source file.
 *
 * Runs `node --check` on all .js/.mjs under src/, scripts/, tests/ and the
 * server entry point. Cheap, and it catches the class of typo that would
 * otherwise surface as a 500 at runtime.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'data', 'coverage']);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) yield full;
  }
}

const files = [...walk(ROOT)].sort();
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failures.push({ file, message: (err.stderr || err.stdout || err.message).toString().trim() });
  }
}

console.log(`Checked ${files.length} file(s).`);
if (failures.length) {
  console.error(`\n${failures.length} file(s) failed the syntax check:`);
  for (const failure of failures) {
    console.error(`\n--- ${path.relative(ROOT, failure.file)}\n${failure.message}`);
  }
  process.exit(1);
}
console.log('Syntax check passed.');
