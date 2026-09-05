#!/usr/bin/env node
/**
 * Syntax check for every JavaScript source file in the project.
 * Uses `node --check`, which parses without executing anything.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SKIP = new Set(['node_modules', 'data', '.git']);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) yield full;
  }
}

let checked = 0;
const errors = [];

for (const file of walk(ROOT)) {
  checked += 1;
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    errors.push(`${path.relative(ROOT, file)}: ${String(error.stderr || error.message).split('\n').slice(0, 3).join(' ')}`);
  }
}

console.log(`  ${checked} JavaScript files checked, ${errors.length} with syntax errors`);
if (errors.length) {
  errors.forEach((line) => console.error(`  ✗ ${line}`));
  process.exit(1);
}
console.log('  ✓ syntax OK');
