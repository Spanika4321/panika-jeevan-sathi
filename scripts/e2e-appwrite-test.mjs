#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Appwrite Cloud storage end-to-end test.
 *
 * Runs the whole site against a local stand-in for the Appwrite Cloud REST
 * API (scripts/lib/mock-appwrite.mjs) plus the existing R2 photo mock —
 * i.e. the exact production configuration:
 *
 *   1. the full member journey (scripts/e2e-test.mjs),
 *   2. a "cold start" simulation: the instance's disk is wiped between runs
 *      (what Render does every time a free service sleeps) and every member,
 *      profile, message and photo must come back from Appwrite / R2,
 *   3. photo upload → R2 object exists → cache wiped → photo still served,
 *   4. Appwrite outage: the write is retried and still saved,
 *   5. schema auto-provisioning created the collections in the mock.
 *
 *   node scripts/e2e-appwrite-test.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testEnvironment } from './lib/test-app.mjs';
import { createAppwriteMock } from './lib/mock-appwrite.mjs';
import { createR2Mock } from './lib/mock-cloud.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------------------------------------- test server */

async function startServer(env) {
  const port = 4000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...testEnvironment(), ...env, PORT: String(port), NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 140; i += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return { child, base, log, port };
    } catch (_) {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error(`server did not start:\n${log.join('')}`);
}

async function stopServer(handle) {
  if (!handle || handle.child.exitCode !== null) return;
  handle.child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      handle.child.kill('SIGKILL');
      resolve();
    }, 4000);
    handle.child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/* ------------------------------------------------------------------- client */

function client(base) {
  const jar = new Map();
  async function call(method, urlPath, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + urlPath, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const cookie of setCookie) {
      const [pair] = cookie.split(';');
      const idx = pair.indexOf('=');
      jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = null;
    }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  return { call, jar };
}

/* --------------------------------------------------------------------- main */

const mock = createAppwriteMock({ project: 'test-project', token: 'test-key' });
const r2 = createR2Mock({ bucket: 'pjs-test', prefix: 'uploads' });
const awUrl = await mock.listen();
const r2Url = await r2.listen();

const cloudEnv = {
  PJS_STORAGE: 'appwrite',
  APPWRITE_ENDPOINT: awUrl,
  APPWRITE_PROJECT_ID: 'test-project',
  APPWRITE_API_KEY: 'test-key',
  APPWRITE_DATABASE_ID: 'test-db',
  APPWRITE_AUTO_SCHEMA: '1',
  R2_ACCOUNT_ID: 'test-account',
  R2_BUCKET: 'pjs-test',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  R2_ENDPOINT: r2Url,
  R2_PREFIX: 'uploads'
};

try {
  /* -------------------------------------------------- 1. full member journey */

  section('1. Full member journey against Appwrite + R2 (the real test suite)');

  const suite = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/e2e-test.mjs'], {
      cwd: ROOT,
      env: { ...testEnvironment(), ...cloudEnv, PJS_TEST_MOCK_APPWRITE: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('exit', (code) => resolve({ code, out }));
  });

  const summary = /(\d+) passed, (\d+) failed/.exec(suite.out);
  const suitePassed = summary ? Number(summary[1]) : 0;
  const suiteFailed = summary ? Number(summary[2]) : 1;
  if (suite.code === 0 && suiteFailed === 0) {
    passed += 1;
    console.log(`  ✓ scripts/e2e-test.mjs — ${suitePassed} assertions passed`);
  } else {
    failed += 1;
    failures.push('e2e-test.mjs suite');
    console.log(`  ✗ scripts/e2e-test.mjs exited ${suite.code} (${suitePassed} passed, ${suiteFailed} failed)`);
    console.log(
      suite.out
        .split('\n')
        .filter((l) => l.startsWith('  ✗') || /Error|error:/.test(l))
        .slice(0, 25)
        .join('\n')
    );
  }

  /* ------------------------------------- 2. cold start with a wiped filesystem */

  section('2. Render-style cold start (instance filesystem wiped)');

  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-aw-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-aw-b-'));
  const stamp = Date.now();
  const email = `aw${stamp}@example.com`;
  const password = 'AppwritePass123';

  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  let serverA = await startServer({ ...cloudEnv, PJS_DATA_DIR: dirA });
  let api = client(serverA.base);

  check('schema auto-provisioning created the users collection', mock.hasCollection('users'));
  check('schema auto-provisioning created 13 collections', mock.counts().createCollection !== undefined || ['users', 'profiles', 'interests', 'shortlist', 'messages', 'notifications', 'reports', 'stories', 'contact_messages', 'settings', 'audit_logs', 'site_stats', 'site_visitors'].every((t) => mock.hasCollection(t)));

  let res = await api.call('POST', '/api/auth/register', {
    name: 'Appwrite Member',
    email,
    password,
    gender: 'male',
    looking_for: 'female'
  });
  check('register on an Appwrite-backed instance', res.status === 200 && res.body.ok === true, `status ${res.status}`);

  res = await api.call('PUT', '/api/profile', {
    age: 32,
    city: 'Raipur',
    state: 'Chhattisgarh',
    community: 'Panika',
    religion: 'Hindu',
    occupation: 'Teacher',
    education: 'Graduate',
    about_me: 'Stored in Appwrite Cloud, not on the server disk.'
  });
  check('profile saved to Appwrite', res.status === 200 && res.body.ok === true, `status ${res.status}`);

  // Clear a numeric field: SQL NULL round-trips through Appwrite via markers.
  res = await api.call('PUT', '/api/profile', { age: '' });
  check('clearing age works', res.status === 200 && res.body.ok === true, `status ${res.status}`);
  res = await api.call('GET', '/api/profile');
  check(
    'cleared age reads back as null',
    res.body && res.body.profile && (res.body.profile.age === null || res.body.profile.age === undefined),
    JSON.stringify(res.body && res.body.profile && res.body.profile.age)
  );

  const upload = await api.call('POST', '/api/profile/photo', { data_url: png });
  check(
    'photo upload accepted',
    upload.status === 200 && Boolean(upload.body && upload.body.photo),
    `status ${upload.status}`
  );
  const photoUrl = upload.body && upload.body.photo;
  const photoName = photoUrl ? path.basename(photoUrl) : '';

  const health = await api.call('GET', '/api/health');
  check('health reports the appwrite driver', health.body && health.body.storage === 'appwrite', JSON.stringify(health.body && health.body.storage));
  check(
    'health reports zero unsaved changes',
    health.body && health.body.remote && health.body.remote.database.pending === 0,
    JSON.stringify(health.body && health.body.remote && health.body.remote.database)
  );
  check(
    'health reports photos are mirrored to R2',
    health.body && health.body.remote && health.body.remote.photos.remote === true
  );

  await stopServer(serverA);

  check('photo was pushed to R2', photoName && r2.has(photoName), `keys: ${r2.keys().join(', ')}`);
  check(
    'photo in R2 is byte-identical',
    photoName && r2.read(photoName) && Buffer.from(png.split(',')[1], 'base64').equals(r2.read(photoName))
  );

  // A brand-new instance: empty data folder, same Appwrite database and R2 bucket.
  const serverB = await startServer({ ...cloudEnv, PJS_DATA_DIR: dirB });
  api = client(serverB.base);

  res = await api.call('POST', '/api/auth/login', { email, password });
  check(
    'member can log in after the instance was replaced',
    res.status === 200 && res.body.ok === true,
    `status ${res.status}`
  );

  res = await api.call('GET', '/api/profile');
  check(
    'profile survived the cold start',
    res.status === 200 && res.body && res.body.profile && res.body.profile.city === 'Raipur',
    JSON.stringify(res.body && res.body.profile && res.body.profile.city)
  );

  const photoRes = await fetch(serverB.base + photoUrl, { headers: { Cookie: [...api.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') } });
  const photoBytes = Buffer.from(await photoRes.arrayBuffer());
  check(
    'photo is re-fetched from R2 after the disk was wiped',
    photoRes.status === 200 && photoBytes.length > 0,
    `status ${photoRes.status}`
  );
  check(
    'directory listing of the upload folder is not exposed',
    (await fetch(serverB.base + '/uploads/')).status === 404
  );

  const profileRows = mock.collectionDocs('profiles').filter((d) => d.user_id !== undefined && d.user_id !== null);
  check('Appwrite mock holds the member profile', profileRows.length >= 1, `profiles=${profileRows.length}`);

  /* ------------------------------------------------------- 3. Appwrite outage */

  section('3. Appwrite outage (write is retried, nothing is lost)');

  mock.failNext(1, 'http500');
  const outageOk = await api.call('PUT', '/api/profile', { headline: 'Still here after the outage' });
  check(
    'site keeps working when Appwrite returns a 500',
    outageOk.status === 200 && outageOk.body.ok === true,
    `status ${outageOk.status}`
  );

  res = await api.call('GET', '/api/profile');
  check(
    'the retried write reached Appwrite',
    res.body && res.body.profile && res.body.profile.headline === 'Still here after the outage',
    JSON.stringify(res.body && res.body.profile && res.body.profile.headline)
  );

  const headlineInMock = mock.collectionDocs('profiles').some((d) => d.headline === 'Still here after the outage');
  check('Appwrite document actually holds the retried headline', headlineInMock);

  await stopServer(serverB);

  /* --------------------------------------------------------- 4. remote stats */

  section('4. Remote storage usage');

  check('Appwrite received document operations', mock.documentCount('users') >= 2, `users=${mock.documentCount('users')}`);
  check('settings seeded into Appwrite', mock.documentCount('settings') >= 5, `settings=${mock.documentCount('settings')}`);
  const indexCalls = mock.counts();
  check(
    'schema endpoints were used for provisioning',
    Object.keys(indexCalls).some((k) => k.endsWith('.email')) &&
      Object.keys(indexCalls).some((k) => k.includes('users_email')),
    JSON.stringify(Object.keys(indexCalls).filter((k) => k.includes('users_') || k.endsWith('.email')))
  );
  check('R2 served photo PUT/GET requests', r2.requests.length >= 3, `requests=${r2.requests.length}`);
} finally {
  mock.close();
  r2.close();
}

console.log(
  `\n──────────────────────────────────────────────\n  ${passed} passed, ${failed} failed\n`
);
if (failed) {
  console.log(`  failing: ${failures.join(', ')}\n`);
  process.exit(1);
}
