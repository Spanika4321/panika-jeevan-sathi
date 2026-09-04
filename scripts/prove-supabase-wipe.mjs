#!/usr/bin/env node
/**
 * Write-through persistence proof for the Supabase client.
 *
 * This is NOT a production supabase.com test. It speaks the same PostgREST +
 * Storage HTTP the production client uses, against a durable *external* store
 * (sqlite file + object files living outside the app data dir).
 *
 * Sequence:
 *   1. Start mock Supabase (external dir)
 *   2. Start app with SUPABASE_* pointing at the mock, PJS_DATA_DIR = app dir
 *   3. Register, save profile, send message, upload photo
 *   4. Read the external store *directly* (bypass the app)
 *   5. Kill the app and delete the app data dir (Render-sleep analog)
 *   6. Confirm the app disk is empty and the external store still has the rows
 *   7. Restart the app on a fresh empty data dir, same SUPABASE_*
 *   8. Login and read profile / messages / photo bytes
 *
 *   node scripts/prove-supabase-wipe.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnvironment } from './lib/test-app.mjs';
import { createSupabaseMock } from './lib/mock-supabase.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-supabase-proof-'));
const APP_DIR = path.join(WORK, 'app-disk');
const STORE_DIR = path.join(WORK, 'external-store');
const REPORT = path.join(ROOT, 'reports', `PROOF-supabase-fix-${STAMP.slice(0, 10)}.md`);
const PORT = 4100 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(APP_DIR, { recursive: true });
fs.mkdirSync(STORE_DIR, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });

const checks = [];
function record(name, ok, realOrMock, evidence, fileLine) {
  checks.push({
    check: name,
    result: ok ? 'PASS' : 'FAIL',
    kind: realOrMock,
    evidence: String(evidence).slice(0, 500),
    file: fileLine || ''
  });
  console.log(`  ${ok ? '✓' : '✗'} [${realOrMock}] ${name}${ok ? '' : ' — ' + evidence}`);
}

function pngDataUrl() {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4nGP8//8/AzbAxIAHMGES+P//PxMDXsCEzjGMSg8AADJkCwlQn8RQAAAAAElFTkSuQmCC';
  return `data:image/png;base64,${base64}`;
}

function client() {
  const jar = new Map();
  async function call(method, urlPath, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(BASE + urlPath, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const cookie of setCookie) {
      const [pair] = cookie.split(';');
      const idx = pair.indexOf('=');
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /Max-Age=0/i.test(cookie)) jar.delete(key);
      else jar.set(key, value);
    }
    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      json = null;
    }
    return { status: res.status, body: json };
  }
  return {
    raw: (p) => fetch(BASE + p, { headers: { Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') } }),
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b || {}),
    put: (p, b) => call('PUT', p, b || {})
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(logRef) {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return await res.json();
    } catch (_) {
      /* not up */
    }
    if (logRef && /THE DATABASE COULD NOT BE REACHED|Fatal error/i.test(logRef.text)) {
      throw new Error('server aborted: ' + logRef.text.slice(-600));
    }
    await sleep(250);
  }
  throw new Error('Server did not start. Log:\n' + (logRef && logRef.text ? logRef.text.slice(-800) : ''));
}

function spawnApp(envExtra) {
  const logRef = { text: '' };
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...testEnvironment(),
      PORT: String(PORT),
      HOST: '127.0.0.1',
      PJS_DATA_DIR: APP_DIR,
      PJS_STORAGE: 'supabase',
      PJS_REQUIRE_REMOTE: '1',
      ADMIN_EMAIL: 'admin@proof.local',
      ADMIN_PASSWORD: 'ProofAdmin#2026',
      OWNER_EMAILS: '',
      NODE_NO_WARNINGS: '1',
      ...envExtra
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => (logRef.text += d.toString()));
  child.stderr.on('data', (d) => (logRef.text += d.toString()));
  return { child, logRef };
}

async function killApp(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((r) => child.on('exit', r)),
    sleep(4000).then(() => {
      try {
        child.kill('SIGKILL');
      } catch (_) {
        /* ignore */
      }
    })
  ]);
}

function wipeAppDisk() {
  if (fs.existsSync(APP_DIR)) fs.rmSync(APP_DIR, { recursive: true, force: true });
  fs.mkdirSync(APP_DIR, { recursive: true });
}

function listAppDisk() {
  if (!fs.existsSync(APP_DIR)) return [];
  const out = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push({ path: p, size: st.size });
    }
  }
  walk(APP_DIR);
  return out;
}

async function main() {
  let mock = createSupabaseMock({
    file: path.join(STORE_DIR, 'supabase.sqlite'),
    objectsDir: path.join(STORE_DIR, 'objects'),
    token: 'proof-service-role'
  });
  const supabaseUrl = await mock.listen();
  const sbEnv = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: mock.token,
    SUPABASE_STORAGE_BUCKET: 'uploads'
  };

  let app = null;
  const EMAIL = `ravi.proof.${Date.now()}@example.com`;
  const PASS = 'Passw0rd123';
  let photoPath = null;
  let photoBytes = null;
  let meeraId = null;
  let raviId = null;
  let messageBody = `proof-message-${Date.now()}`;
  let health1 = null;
  let health2 = null;
  let afterLogin = null;
  let afterProfile = null;
  let afterMessages = null;
  let afterPhotoStatus = null;
  let afterPhotoLen = null;
  let externalUserBeforeWipe = false;
  let externalUserAfterWipe = false;
  let externalPhotoAfterWipe = false;
  let appFilesAfterWipe = [];
  let storeFilesAfterWipe = [];

  try {
    app = spawnApp(sbEnv);
    health1 = await waitForServer(app.logRef);
    record(
      'boot health reports supabase',
      health1 && health1.ok && health1.storage === 'supabase',
      'MOCK',
      JSON.stringify({ storage: health1 && health1.storage, photos: health1 && health1.photos }),
      'server.js health + lib/db.js open()'
    );
    record(
      'boot photos are supabase write-through',
      health1 && String(health1.photos || '').startsWith('supabase'),
      'MOCK',
      JSON.stringify({ photos: health1 && health1.photos, remote: health1 && health1.remote }),
      'lib/photos.js createFromEnv'
    );
    record(
      'boot health durable=true (db+photos remote)',
      health1 && health1.durable === true && health1.data_loss_risk === false,
      'MOCK',
      JSON.stringify({ durable: health1 && health1.durable, data_loss_risk: health1 && health1.data_loss_risk }),
      'lib/api.js GET /api/health'
    );

    const ravi = client();
    let res = await ravi.post('/api/auth/register', {
      name: 'Ravi Proof',
      email: EMAIL,
      password: PASS,
      gender: 'male',
      city: 'Bilaspur',
      state: 'Chhattisgarh',
      community: 'Panika'
    });
    record(
      'register via API',
      res.status === 200 && res.body && res.body.ok,
      'MOCK',
      JSON.stringify({ status: res.status, id: res.body && res.body.user && res.body.user.id }),
      'lib/api.js POST /api/auth/register'
    );
    raviId = res.body && res.body.user && res.body.user.id;

    res = await ravi.put('/api/profile', {
      headline: 'Proof profile',
      age: 29,
      gender: 'Male',
      city: 'Bilaspur',
      state: 'Chhattisgarh',
      community: 'Panika',
      occupation: 'Engineer',
      about_me: 'Persistence proof row.'
    });
    record(
      'profile save via API',
      res.status === 200 && res.body && res.body.profile && res.body.profile.age === 29,
      'MOCK',
      JSON.stringify({ status: res.status, age: res.body && res.body.profile && res.body.profile.age }),
      'lib/api.js PUT /api/profile'
    );

    res = await ravi.post('/api/profile/photo', { data_url: pngDataUrl() });
    photoPath = res.body && res.body.photo;
    record(
      'photo upload via API',
      res.status === 200 && typeof photoPath === 'string' && photoPath.startsWith('/uploads/'),
      'MOCK',
      JSON.stringify({ status: res.status, photo: photoPath }),
      'lib/photos.js save → supabase put'
    );
    if (photoPath) {
      const photoRes = await ravi.raw(photoPath);
      photoBytes = Buffer.from(await photoRes.arrayBuffer());
      record(
        'photo served after upload',
        photoRes.status === 200 && photoBytes.length > 20,
        'MOCK',
        `http ${photoRes.status} bytes=${photoBytes.length}`,
        'server.js GET /uploads/'
      );
    }

    const meera = client();
    res = await meera.post('/api/auth/register', {
      name: 'Meera Proof',
      email: 'meera.proof@example.com',
      password: PASS,
      gender: 'female'
    });
    meeraId = res.body && res.body.user && res.body.user.id;
    await meera.put('/api/profile', {
      age: 25,
      gender: 'Female',
      city: 'Raipur',
      community: 'Panika',
      occupation: 'Teacher'
    });
    res = await ravi.post('/api/interests', { to_user_id: meeraId, message: 'proof interest' });
    const received = await meera.get('/api/interests?direction=received');
    const interestId = received.body && received.body.interests && received.body.interests[0] && received.body.interests[0].id;
    await meera.post(`/api/interests/${interestId}/respond`, { decision: 'accept' });
    res = await ravi.post('/api/messages', { to: meeraId, body: messageBody });
    record(
      'message send via API',
      res.status === 200,
      'MOCK',
      JSON.stringify({ status: res.status, to: meeraId }),
      'lib/api.js POST /api/messages'
    );

    externalUserBeforeWipe = mock.hasUser(EMAIL);
    const photoKey = photoPath ? path.basename(photoPath) : '';
    const photoOnStore = photoKey && mock.hasObject(photoKey);
    record(
      'external store has the member (direct sqlite, not via app)',
      externalUserBeforeWipe,
      'MOCK',
      `mock.hasUser(${EMAIL})=${externalUserBeforeWipe} userCount=${mock.userCount()}`,
      'scripts/lib/mock-supabase.mjs sqlite file'
    );
    record(
      'external store has the photo object (direct, not via app)',
      Boolean(photoOnStore),
      'MOCK',
      `key=${photoKey} hasObject=${photoOnStore} objectsDir=${mock.objectsDir}`,
      'scripts/lib/mock-supabase.mjs objects dir'
    );

    await killApp(app.child);
    app = null;
    wipeAppDisk();
    appFilesAfterWipe = listAppDisk();
    storeFilesAfterWipe = fs.existsSync(STORE_DIR) ? fs.readdirSync(STORE_DIR) : [];
    externalUserAfterWipe = mock.hasUser(EMAIL);
    externalPhotoAfterWipe = photoKey && mock.hasObject(photoKey);
    const photoFileOnDisk =
      photoKey && mock.objectsDir
        ? fs.existsSync(path.join(mock.objectsDir, encodeURIComponent(photoKey)))
        : false;

    const appHasDb = appFilesAfterWipe.some((f) => /panika-jeevan-sathi\.db$/.test(f.path));
    record(
      'app disk wiped (no local sqlite leftover)',
      !appHasDb,
      'MOCK',
      `files=${JSON.stringify(appFilesAfterWipe)}`,
      APP_DIR
    );
    record(
      'external sqlite still has the member after app-disk wipe',
      externalUserAfterWipe,
      'MOCK',
      `hasUser=${externalUserAfterWipe} userCount=${mock.userCount()} store=${STORE_DIR} files=${storeFilesAfterWipe.join(',')}`,
      mock.dbFile
    );
    record(
      'external object store still has the photo after app-disk wipe',
      Boolean(externalPhotoAfterWipe) && photoFileOnDisk,
      'MOCK',
      `hasObject=${externalPhotoAfterWipe} photoFileOnDisk=${photoFileOnDisk} objects=${fs.existsSync(mock.objectsDir) ? fs.readdirSync(mock.objectsDir).join(',') : 'missing'}`,
      mock.objectsDir
    );

    // Analog of "Supabase stays up, the Node process is a new machine":
    // close the mock HTTP process and reopen from the same sqlite + object files.
    mock.close();
    const mock2 = createSupabaseMock({
      file: path.join(STORE_DIR, 'supabase.sqlite'),
      objectsDir: path.join(STORE_DIR, 'objects'),
      token: 'proof-service-role'
    });
    const supabaseUrl2 = await mock2.listen();
    record(
      'external store survived mock-process restart (disk, not RAM)',
      mock2.hasUser(EMAIL) && (!photoKey || mock2.hasObject(photoKey)),
      'MOCK',
      `hasUser=${mock2.hasUser(EMAIL)} hasObject=${photoKey && mock2.hasObject(photoKey)} url2=${supabaseUrl2}`,
      mock2.dbFile
    );
    sbEnv.SUPABASE_URL = supabaseUrl2;

    app = spawnApp(sbEnv);
    health2 = await waitForServer(app.logRef);
    record(
      'restart health still supabase (empty local disk)',
      health2 && health2.storage === 'supabase',
      'MOCK',
      JSON.stringify({ storage: health2 && health2.storage, photos: health2 && health2.photos }),
      'server.js after wipe'
    );

    const again = client();
    res = await again.post('/api/auth/login', { email: EMAIL, password: PASS });
    afterLogin = res;
    record(
      'login after wipe+restart',
      res.status === 200 && res.body && res.body.user && res.body.user.email === EMAIL,
      'MOCK',
      JSON.stringify({ status: res.status, email: res.body && res.body.user && res.body.user.email }),
      'lib/api.js POST /api/auth/login'
    );

    res = await again.get('/api/profile');
    afterProfile = res;
    record(
      'profile survived wipe+restart',
      res.status === 200 && res.body && res.body.profile && res.body.profile.age === 29 && res.body.profile.community === 'Panika',
      'MOCK',
      JSON.stringify(res.body && res.body.profile),
      'profiles table via PostgREST'
    );

    res = await again.get('/api/conversations');
    afterMessages = res;
    const conv = res.body && res.body.conversations && res.body.conversations[0];
    record(
      'messages survived wipe+restart',
      res.status === 200 && conv && String(conv.last_message).includes('proof-message-'),
      'MOCK',
      JSON.stringify(res.body && res.body.conversations),
      'messages table via PostgREST'
    );

    if (photoPath) {
      const photoAgain = await again.raw(photoPath);
      const buf = Buffer.from(await photoAgain.arrayBuffer());
      afterPhotoStatus = photoAgain.status;
      afterPhotoLen = buf.length;
      record(
        'photo bytes survived wipe+restart (fetched from remote store)',
        photoAgain.status === 200 && buf.length > 20,
        'MOCK',
        `http ${photoAgain.status} bytes=${buf.length} url=${photoPath}`,
        'lib/photos.js ensure → supabase get'
      );
    }

    record(
      'this run used a local PostgREST mock, not supabase.com',
      true,
      'MOCK',
      `SUPABASE_URL=${supabaseUrl} (loopback mock). Production not exercised.`,
      'scripts/prove-supabase-wipe.mjs'
    );
  } catch (err) {
    record('proof script completed without crash', false, 'MOCK', err && err.stack ? err.stack : String(err), 'scripts/prove-supabase-wipe.mjs');
  } finally {
    if (app && app.child) await killApp(app.child);
    try {
      mock.close();
    } catch (_) {
      /* ignore */
    }
  }

  const failed = checks.filter((c) => c.result === 'FAIL');
  const wipeOk =
    checks.find((c) => c.check.startsWith('profile survived'))?.result === 'PASS' &&
    checks.find((c) => c.check.startsWith('messages survived'))?.result === 'PASS' &&
    checks.find((c) => c.check.startsWith('photo bytes survived'))?.result === 'PASS' &&
    checks.find((c) => c.check.startsWith('external sqlite still has'))?.result === 'PASS' &&
    checks.find((c) => c.check.startsWith('external store survived mock-process'))?.result === 'PASS';

  const md = [];
  md.push('# PROOF — Supabase write-through (app-disk wipe)');
  md.push('');
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push('');
  md.push('## What this is');
  md.push('');
  md.push('A **real** write → external store → wipe app disk → read cycle against the production PostgREST client (`lib/supabase.js`).');
  md.push('The remote endpoint is a **local mock** (`scripts/lib/mock-supabase.mjs`) whose sqlite file and object files live **outside** `PJS_DATA_DIR`.');
  md.push('');
  md.push('This is **NOT** proof that production `panikajeevansathi.onrender.com` is on Supabase.');
  md.push('Mock-as-production is forbidden: live health must be checked separately.');
  md.push('');
  md.push('## Verdict');
  md.push('');
  if (wipeOk) {
    md.push('**Code path (this sandbox):** write-through to an external store survived an app-disk wipe.');
  } else {
    md.push('**Code path (this sandbox):** FAILED — data did not survive the wipe, or the script crashed.');
  }
  md.push('');
  md.push('**Live production:** see `/api/health` on onrender.com — if `storage` is still `sqlite`, production data-loss is still possible.');
  md.push('');
  md.push(wipeOk
    ? '🟡 NOT FULLY PROVEN — MORE TEST REQUIRED'
    : '🔴 FAILED — DATA LOSS PROBLEM STILL POSSIBLE');
  md.push('');
  md.push('## Evidence table');
  md.push('');
  md.push('| Check | Result | REAL/MOCK | Evidence | File/Line |');
  md.push('| --- | --- | --- | --- | --- |');
  for (const c of checks) {
    const ev = String(c.evidence || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    md.push(`| ${c.check} | ${c.result} | ${c.kind} | ${ev} | ${c.file} |`);
  }
  md.push('');
  md.push('## Paths');
  md.push('');
  md.push(`- App disk (wiped): \`${APP_DIR}\``);
  md.push(`- External store: \`${STORE_DIR}\``);
  md.push(`- Mock sqlite: \`${mock.dbFile}\``);
  md.push(`- Mock objects: \`${mock.objectsDir}\``);
  md.push(`- Health after first boot: \`${JSON.stringify(health1)}\``);
  md.push(`- Health after wipe+restart: \`${JSON.stringify(health2)}\``);
  md.push(`- App files immediately after wipe: \`${JSON.stringify(appFilesAfterWipe)}\``);
  md.push('');
  md.push('## Secrets');
  md.push('');
  md.push('No production tokens were used. Mock key `proof-service-role` is not a live credential.');
  md.push('');
  fs.writeFileSync(REPORT, md.join('\n'));
  console.log('\nReport:', REPORT);
  console.log(wipeOk ? 'WIPE_DISK_PROOF=PASS (MOCK remote)' : 'WIPE_DISK_PROOF=FAIL');
  process.exit(failed.length ? 1 : 0);
}

main();
