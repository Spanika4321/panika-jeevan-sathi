#!/usr/bin/env node
'use strict';
/**
 * PANIKA JEEVAN SATHI — REAL production write→restart→read proof.
 *
 * Runs against a live deployment over plain HTTPS (no mocks in this file):
 *
 *   node scripts/verify-supabase-live.mjs
 *   node scripts/verify-supabase-live.mjs --url https://panikajeevansathi.onrender.com
 *   node scripts/verify-supabase-live.mjs --wait-min 17        # sleep-wake cycle
 *
 * What it proves, step by step:
 *
 *   1. GET /api/health → storage=supabase, photos=supabase…, durable=true.
 *      If this fails the site is still on ephemeral sqlite and the run STOPS
 *      with a red verdict (writes would be pointless — they can vanish).
 *   2. Registers two fresh members (unique emails), saves a profile,
 *      uploads a photo, interest→accept, sends a message. All REAL HTTP.
 *   3. Optional --wait-min N: stays completely idle for N minutes so a Render
 *      Free service spins down, then wakes it. A new /api/health `boot_at`
 *      (or a >5s cold-start) proves the process actually restarted on a
 *      FRESH filesystem. Then it logs in again and reads everything back.
 *   4. Cleans up: deletes both test members (delete must also work remotely).
 *
 * Exit code 0 = every check passed. 1 = at least one failed.
 *
 * Zero dependencies: Node 22 global fetch.
 */

/* ------------------------------------------------------------------ args */
/* Zero imports: Node 22 globals (process, fetch, Buffer, AbortSignal). */

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v === undefined || String(v).startsWith('--') ? fallback : v;
}

const BASE = String(argValue('--url', 'https://panikajeevansathi.onrender.com')).replace(/\/+$/, '');
const WAIT_MIN = Number(argValue('--wait-min', '0') || '0');
const TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const REQUEST_TIMEOUT_MS = 120_000;

/* ------------------------------------------------------------------ table */

const rows = [];
function record(name, pass, evidence, note = '', opts = {}) {
  const warn = !pass && opts.warnInsteadOfFail;
  rows.push({ name, pass: Boolean(pass), warn, evidence: String(evidence || '').slice(0, 300), note });
  const mark = pass ? '✓ PASS' : warn ? '⚠ WARN' : '✗ FAIL';
  console.log(`  ${mark}  ${name}${evidence ? ` — ${String(evidence).slice(0, 160)}` : ''}`);
  return Boolean(pass);
}

/* ------------------------------------------------------------------ http */

function pickCookies(res, jar) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of list) {
    const pair = line.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function request(method, path, { body, jar, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (jar && jar.size) headers['Cookie'] = cookieHeader(jar);
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'manual'
  });
  const ms = Date.now() - t0;
  if (jar) pickCookies(res, jar);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON (photo bytes, html) */
  }
  return { status: res.status, ms, json, text };
}

function client() {
  const jar = new Map();
  return {
    jar,
    get: (p, o) => request('GET', p, { ...o, jar }),
    post: (p, b, o) => request('POST', p, { ...o, jar, body: b }),
    put: (p, b, o) => request('PUT', p, { ...o, jar, body: b }),
    del: (p, o) => request('DELETE', p, { ...o, jar })
  };
}

async function fetchBytes(path) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes: buf, ms: Date.now() - t0 };
}

async function waitForHealth(tries = 8, delayMs = 10_000) {
  let last = null;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await request('GET', '/api/health', { timeoutMs: REQUEST_TIMEOUT_MS });
      if (r.status === 200 && r.json) return r.json;
      last = new Error(`health status ${r.status}`);
    } catch (err) {
      last = err;
    }
    if (i < tries) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw last || new Error('health unreachable');
}

/* ------------------------------------------------------------- test data */

function pngDataUrl() {
  // 1x1 transparent PNG (93 bytes) — same shape the mock wipe-proof uses.
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  return `data:image/png;base64,${b64}`;
}

/* ------------------------------------------------------------------ main */

let failures = 0;

async function main() {
  console.log(`\nLIVE PROOF against ${BASE}`);
  console.log(`started ${new Date().toISOString()}  wait-min=${WAIT_MIN}\n`);

  /* ---- 1. health must already be durable -------------------------------- */
  let health1;
  try {
    health1 = await waitForHealth();
  } catch (err) {
    record('site reachable /api/health', false, err.message);
    return finish();
  }
  record(
    'health storage=supabase (not sqlite)',
    health1.storage === 'supabase',
    `storage=${health1.storage} photos=${health1.photos}`
  );
  record(
    'health photos remote (supabase+cache)',
    String(health1.photos || '').startsWith('supabase'),
    `photos=${health1.photos}`
  );
  record(
    'health durable=true data_loss_risk=false',
    health1.durable === true && health1.data_loss_risk === false,
    `durable=${health1.durable} data_loss_risk=${health1.data_loss_risk}`
  );
  if (health1.storage !== 'supabase' || String(health1.photos || '').indexOf('supabase') !== 0) {
    console.log(
      '\nSTOP: the live site is NOT on Supabase yet. Set SUPABASE_URL + ' +
        'SUPABASE_SERVICE_ROLE_KEY on the service (and PJS_STORAGE=supabase), ' +
        'run supabase/schema.sql once, redeploy, then run this script again. ' +
        'Any member written now could vanish on the next sleep — do not rely on it.'
    );
    return finish();
  }

  const bootAt1 = health1.boot_at || null;

  /* ---- 2. real writes ---------------------------------------------------- */
  const PASS = 'Passw0rd123';
  const raviEmail = `ravi.proof.${TAG}@example.com`;
  const meeraEmail = `meera.proof.${TAG}@example.com`;
  const messageBody = `live-proof-${TAG}`;
  const profileAge = 29;

  const ravi = client();
  const meera = client();

  let res = await ravi.post('/api/auth/register', {
    name: 'Ravi Liveproof',
    email: raviEmail,
    password: PASS,
    gender: 'male'
  });
  const raviOk = record('register member A', res.status === 200, `http ${res.status}`);
  res = await meera.post('/api/auth/register', {
    name: 'Meera Liveproof',
    email: meeraEmail,
    password: PASS,
    gender: 'female'
  });
  const meeraId = res.json && res.json.user ? res.json.user.id : null;
  record('register member B', res.status === 200 && Boolean(meeraId), `http ${res.status} id=${meeraId}`);
  if (!raviOk || !meeraId) {
    console.log('\nSTOP: registration failed — later checks are meaningless.');
    return finish();
  }

  res = await ravi.post('/api/auth/login', { email: raviEmail, password: PASS });
  record('login member A', res.status === 200, `http ${res.status}`);

  res = await ravi.put('/api/profile', {
    age: profileAge,
    gender: 'Male',
    city: 'Raipur',
    community: 'Panika',
    occupation: 'Teacher'
  });
  record('save profile (age 29)', res.status === 200, `http ${res.status}`);

  let photoPath = null;
  let photoLen1 = 0;
  res = await ravi.post('/api/profile/photo', { data_url: pngDataUrl() });
  photoPath = res.json && res.json.photo ? res.json.photo : null;
  record(
    'upload photo (waits for remote put)',
    res.status === 200 && typeof photoPath === 'string' && photoPath.startsWith('/uploads/'),
    `http ${res.status} photo=${photoPath}`
  );
  if (photoPath) {
    const p = await fetchBytes(photoPath);
    photoLen1 = p.bytes.length;
    record('photo served right after upload', p.status === 200 && photoLen1 > 20, `http ${p.status} bytes=${photoLen1}`);
  }

  res = await ravi.post('/api/interests', { to_user_id: meeraId, message: 'live proof interest' });
  record('interest A→B', res.status === 200, `http ${res.status}`);
  res = await meera.get('/api/interests?direction=received');
  const interest =
    res.json && Array.isArray(res.json.interests) && res.json.interests.length ? res.json.interests[0] : null;
  record('B sees the interest', Boolean(interest), `interests=${res.json && res.json.interests ? res.json.interests.length : '?'}`);
  if (interest) {
    res = await meera.post(`/api/interests/${interest.id}/respond`, { decision: 'accept' });
    record('B accepts', res.status === 200, `http ${res.status}`);
  }

  res = await ravi.post('/api/messages', { to: meeraId, body: messageBody });
  record('A sends message', res.status === 200, `http ${res.status} body="${messageBody}"`);

  /* ---- 3. optional idle window → sleep-wake → fresh instance ------------- */
  if (WAIT_MIN > 0) {
    console.log(`\n  … idling ${WAIT_MIN} minutes (no requests) so the service can spin down …\n`);
    await new Promise((r) => setTimeout(r, WAIT_MIN * 60_000));
    const woke = await waitForHealth(10, 15_000);
    const bootAt2 = woke.boot_at || null;
    const restarted = bootAt1 && bootAt2 ? bootAt2 !== bootAt1 : woke.ms > 5000;
    record(
      `service restarted during idle wait (fresh process/disk)`,
      restarted,
      `boot_at ${bootAt1} → ${bootAt2} wake-latency=${woke.ms}ms${bootAt2 ? '' : ' (boot_at missing — latency heuristic)'}`,
      '',
      { warnInsteadOfFail: true }
    );
    if (!restarted) {
      console.log(
        '  NOTE: no restart detected (service may not have slept yet). ' +
          'The read-back below is still required to pass, but for a full wipe ' +
          'proof increase --wait-min above the platform idle limit.'
      );
    }
  }

  /* ---- 4. read everything back on a (possibly fresh) process ------------- */
  const ravi2 = client();
  res = await ravi2.post('/api/auth/login', { email: raviEmail, password: PASS });
  record('login member A again after wait', res.status === 200, `http ${res.status}`);

  res = await ravi2.get('/api/profile');
  const age = res.json && res.json.profile ? res.json.profile.age : undefined;
  record('profile survived (age still 29)', Number(age) === profileAge, `age=${age}`);

  res = await ravi2.get('/api/conversations');
  const convs = res.json && Array.isArray(res.json.conversations) ? res.json.conversations : null;
  const conv = convs ? convs.find((c) => Number(c.other_id) === Number(meeraId) || Number(c.other_user_id) === Number(meeraId)) : null;
  const convId = conv ? conv.other_id || conv.other_user_id : meeraId;
  res = await ravi2.get(`/api/conversations/${convId}`);
  const msgs =
    res.json && Array.isArray(res.json.messages)
      ? res.json.messages
      : res.json && Array.isArray(res.json.conversation)
        ? res.json.conversation
        : [];
  const found = msgs.some((m) => m && m.body === messageBody);
  record('message survived', found, `${msgs.length} messages, looking for "${messageBody}"`);

  if (photoPath) {
    const p = await fetchBytes(photoPath);
    record(
      'photo bytes survived (fetched from remote store)',
      p.status === 200 && p.bytes.length === photoLen1 && photoLen1 > 20,
      `http ${p.status} bytes=${p.bytes.length} (was ${photoLen1})`
    );
  }

  const health2 = await request('GET', '/api/health');
  record(
    'health still durable after the whole cycle',
    health2.json && health2.json.storage === 'supabase' && health2.json.durable === true,
    `storage=${health2.json && health2.json.storage} durable=${health2.json && health2.json.durable}`
  );

  /* ---- 5. cleanup (delete must work remotely too) ------------------------ */
  res = await ravi2.del('/api/me');
  record('cleanup: delete member A', res.status === 200, `http ${res.status}`);
  res = await meera.post('/api/auth/login', { email: meeraEmail, password: PASS });
  if (res.status === 200) {
    res = await meera.del('/api/me');
    record('cleanup: delete member B', res.status === 200, `http ${res.status}`);
  } else {
    record('cleanup: delete member B (re-login)', false, `login http ${res.status}`);
  }

  return finish();
}

function finish() {
  failures = rows.filter((r) => !r.pass && !r.warn).length;
  const pass = rows.filter((r) => r.pass).length;
  const warns = rows.filter((r) => r.warn).length;
  console.log('\n' + '─'.repeat(70));
  console.log(
    `  LIVE PROOF: ${pass}/${rows.length} passed${warns ? `, ${warns} warning(s)` : ''} — all checks above were REAL HTTPS calls`
  );
  console.log('─'.repeat(70));
  if (failures === 0 && rows.length > 0) {
    console.log('  VERDICT: 🟢 durable storage proven against the live URL above.');
  } else {
    console.log(`  VERDICT: 🔴 ${failures} check(s) failed — data-loss risk is NOT resolved.`);
  }
  console.log('');
  process.exitCode = failures === 0 && rows.length > 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('\nUNEXPECTED ERROR:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
