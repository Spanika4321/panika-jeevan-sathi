import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readEnvironment, mergeEnvironment, validateEnvironment } from './lib/deploy-config.mjs';
import { productionUrl, healthProblems, checkProduction } from './lib/production-check.mjs';
import { testEnvironment } from './lib/test-app.mjs';
import httpSecurity from '../lib/http-security.js';
import db from '../lib/db.js';
import api from '../lib/api.js';
import photos from '../lib/photos.js';

const environment = {
  SUPABASE_URL: 'https://test.example', SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key',
  SUPABASE_STORAGE_BUCKET: 'uploads', PJS_STORAGE: 'supabase', PJS_REQUIRE_REMOTE: '1',
  SITE_URL: 'https://matrimony.example', SESSION_SECRET: 'test-only-secret-'.repeat(3),
  SMTP_HOST: 'smtp.test.example', SMTP_USER: 'test@test.example', SMTP_PASS: 'fake-mail-password',
  R2_BUCKET: 'existing-photos', CF_D1_API_TOKEN: 'fake-d1-token', OWNER_EMAILS: 'owner@test.example',
  CUSTOM_PROVIDER_SETTING: 'must-survive', INTENTIONALLY_EMPTY: ''
};
const rows = Object.entries(environment).map(([key, value]) => ({ key, value }));

function healthy() {
  return {
    ok: true, service: 'panika-jeevan-sathi', security_revision: '2026-09-05',
    storage: 'supabase', photos: 'supabase+cache', durable: true, data_loss_risk: false,
    mail: { configured: true },
    remote: { database: { loaded: true, pending: 0, lastError: null }, photos: { remote: true, pending: 0, lastError: null } }
  };
}

test('deploy: every existing environment value survives; omission never erases credentials', () => {
  const result = mergeEnvironment(rows, { SMTP_PASS: '', HOST: '0.0.0.0' }, { SITE_URL: 'https://wrong-default.example' });
  const values = Object.fromEntries(result.map((row) => [row.key, row.value]));
  for (const [key, value] of Object.entries(environment)) assert.equal(values[key], value, key);
  assert.equal(values.HOST, '0.0.0.0');
  assert.doesNotThrow(() => validateEnvironment(result));
});

test('deploy: complete environment is paginated before replacement', async () => {
  const requests = [];
  const result = await readEnvironment(async (url) => {
    requests.push(url);
    return requests.length === 1
      ? Array.from({ length: 100 }, (_, index) => ({ envVar: { key: `VALUE_${index}`, value: String(index) }, cursor: `cursor-${index}` }))
      : [{ envVar: { key: 'SMTP_PASS', value: 'test-only' } }];
  }, 'service-test');
  assert.equal(result.length, 101);
  assert.match(requests[1], /cursor=cursor-99/);
});

test('deploy: failed, masked, duplicated or incomplete reads cannot be treated as empty settings', async () => {
  await assert.rejects(readEnvironment(async () => { throw new Error('403'); }, 'test'), /403/);
  for (const response of [null, {}, [{ envVar: { key: 'SMTP_PASS' } }], [{ key: 'A', value: 'a' }, { key: 'A', value: 'b' }], Array.from({ length: 100 }, (_, index) => ({ key: `K${index}`, value: '' }))]) {
    await assert.rejects(readEnvironment(async () => response, 'test'));
  }
});

test('deploy: implicit database/bucket migrations and ephemeral storage are refused', () => {
  for (const key of ['SUPABASE_URL', 'SUPABASE_STORAGE_BUCKET', 'PJS_STORAGE', 'R2_BUCKET']) {
    assert.throws(() => mergeEnvironment(rows, { [key]: 'different-storage' }), /migration/);
  }
  for (const patch of [{ PJS_STORAGE: 'sqlite' }, { PJS_ALLOW_LOCAL: '1' }, { SESSION_SECRET: 'weak' }, { SITE_URL: 'http://public.example' }, { SUPABASE_SERVICE_ROLE_KEY: '' }]) {
    const altered = Object.entries({ ...environment, ...patch }).map(([key, value]) => ({ key, value }));
    assert.throws(() => validateEnvironment(altered));
  }
});

test('monitor: Supabase alone is not sufficient evidence of safety or durability', () => {
  assert.deepEqual(healthProblems(healthy()), []);
  for (const mutate of [
    (body) => { body.durable = false; }, (body) => { body.data_loss_risk = true; },
    (body) => { body.photos = 'local'; }, (body) => { body.ok = 'true'; },
    (body) => { body.remote.database.loaded = false; }, (body) => { body.remote.database.pending = 2; },
    (body) => { body.remote.photos.remote = false; }, (body) => { body.remote.photos.lastError = 'private error'; }
  ]) { const body = healthy(); mutate(body); assert.ok(healthProblems(body).length); }
});

test('monitor: production check is GET-only, checks privacy, and reports no member data', async () => {
  const requests = [];
  const report = await checkProduction('https://site.test', { attempts: 1, delayMs: 0, fetchImpl: async (url, options) => {
    requests.push(options);
    const pathname = new URL(url).pathname;
    const body = pathname === '/api/health' ? healthy() : pathname === '/api/site' ? { ok: true, site: { maintenance: '0' } } : { ok: false };
    const status = pathname === '/' || ['/api/health', '/api/site'].includes(pathname) ? 200 : pathname.startsWith('/api/') ? 401 : 404;
    return new Response(JSON.stringify(body), { status, headers: {
      'Content-Type': 'application/json', 'Content-Security-Policy': "script-src 'self' 'sha256-test'; object-src 'none'; frame-ancestors 'self'",
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Strict-Transport-Security': 'max-age=31536000'
    } });
  } });
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.ok(requests.length >= 9);
  assert.ok(requests.every((request) => request.method === 'GET' && !request.body && !request.headers.Cookie && !request.headers.Authorization));
  assert.ok(!JSON.stringify(report).includes('service_role'));
});

test('monitor: invalid URLs, non-JSON responses and network failures never pass', async () => {
  for (const url of ['http://public.example', 'https://user:password@site.example', 'https://site.example/?token=secret', 'file:///etc/passwd']) assert.throws(() => productionUrl(url));
  assert.equal(productionUrl('http://127.0.0.1:1234'), 'http://127.0.0.1:1234');
  for (const fetchImpl of [async () => { throw new Error('network failed'); }, async () => new Response('not JSON', { status: 200 })]) {
    assert.equal((await checkProduction('https://test.example', { attempts: 1, delayMs: 0, fetchImpl })).ok, false);
  }
});

test('security: only the configured rightmost proxy hop determines the client IP', () => {
  const req = { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '192.0.2.10, 198.51.100.20', 'x-forwarded-proto': 'http, https' } };
  assert.equal(httpSecurity.clientIp(req, {}), '10.0.0.1');
  assert.equal(httpSecurity.clientIp(req, { TRUST_PROXY_HOPS: '1' }), '198.51.100.20');
  assert.equal(httpSecurity.isSecure(req, { TRUST_PROXY_HOPS: '1' }), true);
  assert.equal(httpSecurity.isSecure(req, {}), false);
  assert.throws(() => httpSecurity.proxyHops({ TRUST_PROXY_HOPS: 'all' }));
});

test('storage: D1 writes cannot be acknowledged before their remote flush succeeds', async () => {
  const driver = db.asAsyncDriver({ kind: 'd1', insert: () => ({ id: 1 }), flush: async () => { throw new Error('remote unavailable'); } });
  await assert.rejects(driver.insert('users', {}), /remote unavailable/);
});

test('storage: JSON data is on disk before an acknowledged write, even without shutdown', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-json-ack-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, ['-e', `(async () => { const { driver } = require('./lib/db').open(process.argv[1]); await driver.insert('users', { email: 'saved@test.example' }); process.exit(0); })();`, dir], {
    cwd: new URL('../', import.meta.url), env: { ...testEnvironment(), PJS_STORAGE: 'json' }, encoding: 'utf8'
  });
  assert.equal(run.status, 0, run.stderr);
  const file = path.join(dir, 'panika-jeevan-sathi.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).tables.users[0].email, 'saved@test.example');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('storage: photo errors affect health, without exposing provider error details', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-health-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = photos.createStore({ dataDir: dir, remoteKind: 'supabase', client: { put: async () => { throw new Error('private-provider-value'); } } });
  await assert.rejects(store.save('test.png', Buffer.from('test'), 'image/png'));
  assert.ok(store.stats().lastError);
  const instance = api.createApi({ db: { kind: 'supabase', one: async () => null, all: async () => [] }, dataDir: dir, secret: 'test-only', photos: store,
    remoteStatus: () => ({ database: { loaded: true, pending: 0, lastError: null }, photos: store.stats() }) });
  let status, body;
  const res = { writeHead: (value) => { status = value; }, end: (value) => { body = JSON.parse(value); } };
  await instance.handle({ method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res, new URL('http://localhost/api/health'));
  assert.equal(status, 503);
  assert.equal(body.durable, false);
  assert.ok(!JSON.stringify(body).includes('private-provider-value'));
});

for (const accepted of [true, false]) {
  test(`mail: encrypted SMTP is required and ${accepted ? 'acceptance is checked' : 'rejection falls back privately'}`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-smtp-stub-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const run = spawnSync(process.execPath, ['-e', `
      const Module = require('node:module'); const load = Module._load; let config;
      Module._load = function (name, ...args) {
        if (name === 'nodemailer') return { createTransport(options) { config = options; return { sendMail: async () => ({ accepted: ${accepted ? "['recipient@test.example']" : '[]'} }) }; } };
        return load.call(this, name, ...args);
      };
      require('./lib/mailer').send({ to: 'recipient@test.example', subject: 'Test only', text: 'No actual SMTP server is contacted' }, process.argv[1])
        .then(result => { delete config.auth; console.log(JSON.stringify({ result, config })); });
    `, dir], { cwd: new URL('../', import.meta.url), env: { ...testEnvironment(), SMTP_HOST: '127.0.0.1', SMTP_USER: 'sender@test.example', SMTP_PASS: 'test-only' }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const { result, config } = JSON.parse(run.stdout);
    assert.equal(result.delivered, accepted);
    assert.equal(config.requireTLS, true);
    assert.equal(config.tls.rejectUnauthorized, true);
    assert.equal(config.tls.minVersion, 'TLSv1.2');
    assert.ok(config.socketTimeout <= 20000);
    if (!accepted) assert.equal(fs.statSync(path.join(dir, fs.readdirSync(dir)[0])).mode & 0o777, 0o600);
  });
}

test('automation: live write tests need explicit opt-in and deployment forms contain no secrets', () => {
  const run = spawnSync(process.execPath, ['scripts/verify-supabase-live.mjs'], { cwd: new URL('../', import.meta.url), env: testEnvironment(), encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Refusing production writes/);
  const workflow = fs.readFileSync(new URL('../.github/workflows/deploy-render.yml', import.meta.url), 'utf8');
  assert.ok(!workflow.includes('inputs.render_api_key'));
  assert.ok(!workflow.includes('inputs.admin_password'));
  assert.ok(workflow.includes('needs: verify'));
  const proof = fs.readFileSync(new URL('../.github/workflows/live-proof.yml', import.meta.url), 'utf8');
  assert.ok(!proof.includes('  schedule:'));
  assert.ok(proof.includes('if: inputs.allow_test_members'));
});
