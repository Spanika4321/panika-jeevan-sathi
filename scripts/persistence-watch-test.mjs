#!/usr/bin/env node
/** Proves the live alarm accepts the no-R2 D1 bridge and rejects real risks. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-watch-test-'));
let mode = 'healthy';
let members = 12;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/site') {
    res.end(JSON.stringify({ ok: true, counts: { members } }));
    return;
  }
  if (req.url === '/api/health') {
    const local = mode === 'local';
    const bytes = mode === 'full' ? 121 * 1024 * 1024 : 6 * 1024 * 1024;
    res.end(
      JSON.stringify({
        ok: true,
        storage: local ? 'sqlite' : 'd1',
        photos: local ? 'local' : 'd1+cache',
        remote: {
          database: local ? { kind: 'sqlite' } : { kind: 'd1', pending: 0, lastError: null },
          photos: local
            ? { kind: 'local', backend: 'local', remote: false }
            : { kind: 'd1+cache', backend: 'd1', remote: true, usage: { objects: 40, bytes } }
        }
      })
    );
    return;
  }
  res.writeHead(404);
  res.end('{}');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;

function run(stateName) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['scripts/persistence-watch.mjs', '--url', url, '--state', path.join(dir, stateName)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('exit', (code) => resolve({ code, out }));
  });
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

try {
  console.log('\nPersistence-watch modes');

  mode = 'healthy';
  let result = await run('healthy.json');
  check('D1 photos pass without an R2 bucket', result.code === 0, result.out.slice(-500));
  check('D1 bridge usage is measured', /6\.0 MB, 40 photo/.test(result.out), result.out.slice(-500));

  mode = 'local';
  result = await run('local.json');
  check('ephemeral local member/photo storage fails', result.code !== 0, result.out.slice(-500));

  mode = 'full';
  result = await run('full.json');
  check('121 MB of D1 photos triggers the safety alarm', result.code !== 0, result.out.slice(-500));

  mode = 'healthy';
  fs.writeFileSync(
    path.join(dir, 'drop.json'),
    JSON.stringify({ members: 13, checkedAt: new Date().toISOString() })
  );
  members = 12;
  result = await run('drop.json');
  check('falling member count still detects a wipe', result.code !== 0 && /DATA LOSS DETECTED/.test(result.out), result.out.slice(-500));
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\nPersistence watch: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
