#!/usr/bin/env node
/**
 * End-to-end test for the Google Apps Script connector.
 *
 * A local HTTP server stands in for the Apps Script Web App and re-implements
 * the exact verification logic from apps-script/Code.gs (envelope parsing +
 * HMAC-SHA256 over the payload string). That proves the Node signer and the
 * Apps Script verifier agree, without needing a Google account.
 *
 *   node scripts/test-gsheet.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.log(`  \u2717 ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

/* ---- stand-in for the Apps Script Web App (mirrors Code.gs doPost) ------- */

function hmacHex(message, secret) {
  return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

function startFakeAppsScript(secret, state) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const reply = (obj) => {
        const s = JSON.stringify(obj);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(s);
      };
      state.requests++;
      if (state.failNext > 0) {
        state.failNext--;
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Google backend error');
        return;
      }
      try {
        const envelope = JSON.parse(body);
        if (typeof envelope.payload !== 'string' || !envelope.sig)
          return reply({ ok: false, error: 'malformed envelope' });
        if (hmacHex(envelope.payload, secret) !== envelope.sig)
          return reply({ ok: false, error: 'bad signature' });
        const payload = JSON.parse(envelope.payload);
        const rows = (payload.rows || []).filter((r) => r.event !== 'ping');
        state.rows.push(...rows);
        reply({ ok: true, appended: rows.length });
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* --------------------------------------------------------------- fixtures */

const USER = {
  id: 42,
  email: 'test@example.com',
  name: 'Test Member',
  role: 'user',
  status: 'active',
  email_verified: 1,
  password_hash: 'SECRET-HASH-MUST-NOT-LEAK',
  verification_token: 'SECRET-TOKEN-MUST-NOT-LEAK',
  reset_token: 'SECRET-RESET-MUST-NOT-LEAK',
  created_at: 1756000000000
};

const PROFILE = {
  user_id: 42,
  gender: 'Male',
  pref_gender: 'Female',
  city: 'Guwahati',
  state: 'Assam',
  community: 'Panika',
  religion: 'Kabirpanthi',
  phone: '9999999999'
};

/* ------------------------------------------------------------------- main */

async function main() {
  console.log('\nGoogle Apps Script connector test\n');
  const SECRET = 'test-secret-'.repeat(3);
  const state = { rows: [], requests: 0, failNext: 0 };
  const server = await startFakeAppsScript(SECRET, state);
  const port = server.address().port;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-gsheet-'));

  // The connector requires a script.google.com URL, so relax that one check by
  // pointing at the local stand-in through the documented override.
  process.env.GAS_SHARED_SECRET = SECRET;
  process.env.GAS_WEBAPP_URL = `http://127.0.0.1:${port}/exec`;
  process.env.GAS_ALLOW_INSECURE_URL = '1';
  delete process.env.GAS_DISABLED;

  const gsheet = require('../lib/gsheet.js');

  console.log('1. Configuration');
  check('configured when URL + secret are present', gsheet.configured() === true);
  process.env.GAS_DISABLED = '1';
  check('GAS_DISABLED=1 hard-disables the connector', gsheet.configured() === false);
  delete process.env.GAS_DISABLED;
  const savedUrl = process.env.GAS_WEBAPP_URL;
  delete process.env.GAS_WEBAPP_URL;
  check('not configured without a URL', gsheet.configured() === false);
  process.env.GAS_WEBAPP_URL = savedUrl;

  console.log('\n2. Row building (no secrets may leave the server)');
  const row = gsheet.buildRow(USER, PROFILE);
  const serialized = JSON.stringify(row);
  check('name included', row.name === 'Test Member');
  check('city included', row.city === 'Guwahati');
  check('community included', row.community === 'Panika');
  check('registered_at is ISO', /^\d{4}-\d{2}-\d{2}T/.test(row.registered_at));
  check('password hash NOT sent', !serialized.includes('SECRET-HASH'));
  check('verification token NOT sent', !serialized.includes('SECRET-TOKEN'));
  check('reset token NOT sent', !serialized.includes('SECRET-RESET'));

  console.log('\n3. Signature verified by the Apps Script logic');
  const r1 = await gsheet.pushRegistration({ user: USER, profile: PROFILE, dataDir });
  check('push accepted', r1.ok === true, r1.error);
  check('one row appended', state.rows.length === 1);
  check('appended row carries the email', state.rows[0] && state.rows[0].email === 'test@example.com');

  console.log('\n4. Wrong secret is rejected');
  process.env.GAS_SHARED_SECRET = 'wrong-secret-entirely';
  const r2 = await gsheet.pushRegistration({ user: USER, profile: PROFILE, dataDir });
  check('bad signature rejected', r2.ok === false);
  check('rejected row was queued, not lost', gsheet.queueSize(dataDir) === 1);
  check('nothing written to the sheet', state.rows.length === 1);
  process.env.GAS_SHARED_SECRET = SECRET;

  console.log('\n5. Outage: rows queue then drain');
  state.failNext = 1;
  const r3 = await gsheet.pushRegistration({ user: USER, profile: PROFILE, dataDir });
  check('push failed during outage', r3.ok === false);
  check('backlog now holds 2 rows', gsheet.queueSize(dataDir) === 2);
  const r4 = await gsheet.flushQueue(dataDir);
  check('flush delivered the backlog', r4.ok === true, r4.error);
  check('backlog is empty', gsheet.queueSize(dataDir) === 0);
  check('sheet received all 3 rows', state.rows.length === 3, `got ${state.rows.length}`);

  console.log('\n6. Ping probe');
  const r5 = await gsheet.ping();
  check('ping accepted', r5.ok === true, r5.error);
  check('ping did NOT add a data row', state.rows.length === 3);

  console.log('\n7. Unreachable endpoint never throws');
  process.env.GAS_WEBAPP_URL = 'http://127.0.0.1:1/exec';
  const r6 = await gsheet.pushRegistration({ user: USER, profile: PROFILE, dataDir });
  check('resolves with ok:false instead of throwing', r6.ok === false);
  check('row preserved in the queue', gsheet.queueSize(dataDir) === 1);
  process.env.GAS_WEBAPP_URL = savedUrl;
  await gsheet.flushQueue(dataDir);

  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });

  console.log('\n' + '\u2500'.repeat(58));
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('\u2500'.repeat(58) + '\n');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
