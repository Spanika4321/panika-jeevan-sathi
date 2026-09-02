#!/usr/bin/env node
/**
 * FORENSIC persistence audit (NOT a production proof).
 *
 * Labels every result REAL/MOCK/LOCAL/SIMULATION.
 * Does not talk to Cloudflare. Does not claim the production problem is solved.
 *
 *  A. LOCAL sqlite: register → same-disk restart → record still there
 *  B. SIMULATION of Render Free sleep: wipe data dir → restart → record GONE
 *  C. MOCK D1: register against local D1 stand-in → wipe instance disk → record survives
 *
 *   node scripts/forensic-persistence-audit.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { createD1Mock, createR2Mock } from './lib/mock-cloud.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const findings = [];
function record(check, result, kind, evidence) {
  findings.push({ check, result, kind, evidence });
  const mark = result === 'PASS' ? '✓' : result === 'FAIL' ? '✗' : '·';
  console.log(`  ${mark} [${kind}] ${check}: ${result}${evidence ? ` — ${evidence}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(env) {
  const port = 4100 + Math.floor(Math.random() * 800);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, ...env, PORT: String(port), NODE_NO_WARNINGS: '1', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) {
        const body = await res.json();
        return { child, base, log, port, health: body };
      }
    } catch (_) {
      /* not up */
    }
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${log.slice(-800)}`);
    await sleep(100);
  }
  throw new Error(`server did not start:\n${log.slice(-800)}`);
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
    return { status: res.status, body: json, text };
  }
  return { call };
}

function png() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
}

const stamp = Date.now();
const marker = `PJS_PERSISTENCE_PROOF_${stamp}`;
const testName = `DATA_LOSS_AUDIT_${stamp}`;

console.log(`\nFORENSIC LOCAL AUDIT  marker=${marker}\n`);

/* ------------------------------------------------------------------ A+B sqlite */
{
  console.log('A/B. LOCAL sqlite (same driver production currently reports)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-forensic-sqlite-'));
  const email = `audit.sqlite.${stamp}@example.com`;
  const password = 'AuditPass123';

  let srv = await startServer({
    PJS_DATA_DIR: dir,
    PJS_STORAGE: 'auto',
    ADMIN_EMAIL: 'admin-audit@example.com',
    ADMIN_PASSWORD: 'AdminAudit1'
  });
  record(
    'boot without CF_* uses sqlite',
    srv.health.storage === 'sqlite' ? 'PASS' : 'FAIL',
    'LOCAL',
    `storage=${srv.health.storage} photos=${srv.health.photos}`
  );
  record(
    'photos are local (not R2) without R2_*',
    srv.health.photos === 'local' ? 'PASS' : 'FAIL',
    'LOCAL',
    `photos=${srv.health.photos}`
  );

  const api = client(srv.base);
  let res = await api.call('POST', '/api/auth/register', {
    name: testName,
    email,
    password,
    gender: 'male',
    community: 'Panika',
    city: marker
  });
  record(
    'A) register write accepted',
    res.status === 200 && res.body && res.body.ok === true ? 'PASS' : 'FAIL',
    'LOCAL',
    `HTTP ${res.status} id=${res.body && res.body.user && res.body.user.id}`
  );
  const userId = res.body && res.body.user && res.body.user.id;

  res = await api.call('PUT', '/api/profile', {
    about_me: marker,
    city: 'Bilaspur',
    occupation: 'Teacher',
    age: 29,
    gender: 'Male'
  });
  record(
    'profile write accepted',
    res.status === 200 && res.body && res.body.ok === true ? 'PASS' : 'FAIL',
    'LOCAL',
    `HTTP ${res.status}`
  );

  const upload = await api.call('POST', '/api/profile/photo', { data_url: png() });
  const photoUrl = upload.body && upload.body.photo;
  record(
    'photo upload accepted',
    upload.status === 200 && Boolean(photoUrl) ? 'PASS' : 'FAIL',
    'LOCAL',
    `photo=${photoUrl}`
  );

  const dbFile = path.join(dir, 'panika-jeevan-sathi.db');
  record(
    'B) sqlite file exists on disk after write',
    fs.existsSync(dbFile) ? 'PASS' : 'FAIL',
    'LOCAL',
    dbFile
  );

  let sqliteCount = 0;
  let sqliteMarker = false;
  if (fs.existsSync(dbFile)) {
    const db = new DatabaseSync(dbFile);
    sqliteCount = Number(db.prepare('SELECT COUNT(*) AS c FROM users').get().c);
    const row = db.prepare('SELECT email, name FROM users WHERE email = ?').get(email);
    sqliteMarker = Boolean(row && row.name === testName);
    db.close();
  }
  record(
    'sqlite file contains the test user (authoritative local file)',
    sqliteMarker ? 'PASS' : 'FAIL',
    'LOCAL',
    `users=${sqliteCount} nameMatch=${sqliteMarker}`
  );

  await stopServer(srv);

  // Same-disk restart (NOT a Render proof — disk kept)
  srv = await startServer({
    PJS_DATA_DIR: dir,
    PJS_STORAGE: 'auto',
    ADMIN_EMAIL: 'admin-audit@example.com',
    ADMIN_PASSWORD: 'AdminAudit1'
  });
  const after = client(srv.base);
  res = await after.call('POST', '/api/auth/login', { email, password });
  record(
    'same-disk restart: user can log in',
    res.status === 200 && res.body && res.body.ok === true ? 'PASS' : 'FAIL',
    'LOCAL',
    `HTTP ${res.status}`
  );
  res = await after.call('GET', '/api/profile');
  record(
    'same-disk restart: profile readable',
    res.body && res.body.profile && res.body.profile.about_me === marker ? 'PASS' : 'FAIL',
    'LOCAL',
    `about_me=${res.body && res.body.profile && res.body.profile.about_me}`
  );
  if (photoUrl) {
    const photoRes = await fetch(srv.base + photoUrl);
    record(
      'same-disk restart: photo served from local uploads/',
      photoRes.status === 200 ? 'PASS' : 'FAIL',
      'LOCAL',
      `HTTP ${photoRes.status}`
    );
  }
  await stopServer(srv);

  // Render-style wipe
  console.log('\nB2. SIMULATION — wipe instance filesystem (Render Free sleep/redeploy)');
  const wiped = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-forensic-wiped-'));
  srv = await startServer({
    PJS_DATA_DIR: wiped,
    PJS_STORAGE: 'auto',
    ADMIN_EMAIL: 'admin-audit@example.com',
    ADMIN_PASSWORD: 'AdminAudit1'
  });
  const wipedApi = client(srv.base);
  res = await wipedApi.call('POST', '/api/auth/login', { email, password });
  record(
    'after disk wipe: test user login',
    res.status === 200 ? 'FAIL' : 'PASS',
    'SIMULATION',
    `HTTP ${res.status} (401/fail expected if data was only on ephemeral disk)`
  );
  // Invert: PASS means data was lost (which is the production failure mode)
  // The record above used PASS when login failed. Clarify:
  record(
    'Render-style wipe DESTROYS user data when storage=sqlite',
    res.status !== 200 ? 'CONFIRMED_DATA_LOSS' : 'UNEXPECTED_SURVIVAL',
    'SIMULATION',
    `login HTTP ${res.status}`
  );

  const healthWiped = await wipedApi.call('GET', '/api/health');
  record(
    'wiped instance still reports sqlite',
    healthWiped.body && healthWiped.body.storage === 'sqlite' ? 'PASS' : 'FAIL',
    'SIMULATION',
    `storage=${healthWiped.body && healthWiped.body.storage}`
  );
  await stopServer(srv);

  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(wiped, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ C mock D1 */
{
  console.log('\nC. MOCK D1 + MOCK R2 (NOT production Cloudflare)');
  const d1 = createD1Mock({ token: 'test-token' });
  const r2 = createR2Mock({ bucket: 'pjs-test', prefix: 'uploads' });
  const d1Url = await d1.listen();
  const r2Url = await r2.listen();
  const cloudEnv = {
    PJS_STORAGE: 'd1',
    CF_ACCOUNT_ID: 'test-account',
    CF_D1_DATABASE_ID: 'test-database',
    CF_D1_API_TOKEN: 'test-token',
    CF_D1_API_URL: d1Url,
    R2_ACCOUNT_ID: 'test-account',
    R2_BUCKET: 'pjs-test',
    R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
    R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    R2_ENDPOINT: r2Url,
    R2_PREFIX: 'uploads'
  };
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-forensic-d1a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-forensic-d1b-'));
  const email = `audit.d1.${stamp}@example.com`;
  const password = 'AuditPass123';

  let srv = await startServer({ ...cloudEnv, PJS_DATA_DIR: dirA, ADMIN_EMAIL: 'admin-d1@example.com', ADMIN_PASSWORD: 'AdminAudit1' });
  record(
    'boot with CF_* (mocked) reports storage=d1',
    srv.health.storage === 'd1' ? 'PASS' : 'FAIL',
    'MOCK',
    `storage=${srv.health.storage} photos=${srv.health.photos}`
  );

  const api = client(srv.base);
  let res = await api.call('POST', '/api/auth/register', {
    name: testName,
    email,
    password,
    city: marker
  });
  record(
    'register against mock D1',
    res.status === 200 && res.body && res.body.ok === true ? 'PASS' : 'FAIL',
    'MOCK',
    `HTTP ${res.status}`
  );
  await api.call('PUT', '/api/profile', { about_me: marker, city: 'Guwahati', age: 31, gender: 'Male' });
  const upload = await api.call('POST', '/api/profile/photo', { data_url: png() });
  const photoUrl = upload.body && upload.body.photo;
  const photoName = photoUrl ? path.basename(photoUrl) : '';

  await stopServer(srv);

  let d1HasUser = false;
  try {
    const row = d1.db.prepare('SELECT name, email FROM users WHERE email = ?').get(email);
    d1HasUser = Boolean(row && row.name === testName);
  } catch (err) {
    d1HasUser = false;
  }
  record(
    'mock D1 sqlite file contains the user after flush',
    d1HasUser ? 'PASS' : 'FAIL',
    'MOCK',
    `d1HasUser=${d1HasUser}`
  );
  record(
    'mock R2 has the photo object',
    photoName && r2.has(photoName) ? 'PASS' : 'FAIL',
    'MOCK',
    `keys=${r2.keys().join(',')}`
  );

  srv = await startServer({ ...cloudEnv, PJS_DATA_DIR: dirB, ADMIN_EMAIL: 'admin-d1@example.com', ADMIN_PASSWORD: 'AdminAudit1' });
  const api2 = client(srv.base);
  res = await api2.call('POST', '/api/auth/login', { email, password });
  record(
    'mock D1: login after wiping instance disk',
    res.status === 200 && res.body && res.body.ok === true ? 'PASS' : 'FAIL',
    'MOCK',
    `HTTP ${res.status}`
  );
  res = await api2.call('GET', '/api/profile');
  record(
    'mock D1: profile survived instance replacement',
    res.body && res.body.profile && res.body.profile.about_me === marker ? 'PASS' : 'FAIL',
    'MOCK',
    `about_me=${res.body && res.body.profile && res.body.profile.about_me}`
  );
  if (photoUrl) {
    const photoRes = await fetch(srv.base + photoUrl);
    record(
      'mock R2: photo re-fetched after disk wipe',
      photoRes.status === 200 ? 'PASS' : 'FAIL',
      'MOCK',
      `HTTP ${photoRes.status}`
    );
  }
  await stopServer(srv);
  d1.close();
  r2.close();
  try {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
}

console.log('\n──────────────────────────────────────────────');
console.log('This script is LOCAL/MOCK/SIMULATION only.');
console.log('It is NOT proof that production D1/R2 is connected.');
console.log(JSON.stringify({ marker, testName, findings }, null, 2));
