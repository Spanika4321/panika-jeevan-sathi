#!/usr/bin/env node
/**
 * Test runner — syntax gate first, then the node:test suite.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Pass the files explicitly: a bare directory argument is not portable across
// Node versions and quietly turns into "cannot find module".
const testFiles = fs
  .readdirSync(path.join(ROOT, 'tests'))
  .filter((name) => /\.test\.js$/.test(name))
  .sort()
  .map((name) => path.join('tests', name));

function run(label, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n  ${label} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

run('syntax', ['scripts/check-syntax.js']);
run('unit + integration', ['--test', '--test-reporter=spec', ...testFiles]);

console.log('\n  All SEVA MARKET INDIA checks passed.\n');
