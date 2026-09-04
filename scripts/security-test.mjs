import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startTestApp, register, adminClient, ADMIN_EMAIL, ADMIN_PASSWORD, testEnvironment } from './lib/test-app.mjs';
import supabase from '../lib/supabase.js';

async function appFor(t, env) {
  const app = await startTestApp(env);
  t.after(() => app.stop());
  return app;
}

test('security: foreign origins cannot perform authenticated changes or log a victim in', async (t) => {
  const app = await appFor(t);
  const member = app.client();
  await register(member);
  for (const origin of ['https://attacker.example', 'null']) {
    const res = await member.raw('/api/me/name', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ name: 'Changed by another website' })
    });
    assert.equal(res.status, 403);
  }
  assert.equal((await member.get('/api/me')).body.user.name, 'Test Member');
  const login = await app.client().raw('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  assert.equal(login.status, 403);
  assert.equal(login.headers.get('set-cookie'), null);
  assert.equal((await member.raw('/api/me/name', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.base },
    body: JSON.stringify({ name: 'Allowed same-origin update' })
  })).status, 200);
});

test('security: form-compatible content types cannot bypass JSON-only writes', async (t) => {
  const app = await appFor(t);
  const member = app.client();
  await register(member);
  for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
    const res = await member.raw('/api/me/name', {
      method: 'POST', headers: { 'Content-Type': type }, body: JSON.stringify({ name: 'Cross-site change' })
    });
    assert.equal(res.status, 415);
  }
});

test('security: forged forwarded IPs cannot bypass the login rate limit', async (t) => {
  const app = await appFor(t);
  for (let attempt = 1; attempt <= 11; attempt++) {
    const res = await fetch(app.base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${attempt}` },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: 'DefinitelyWrong123' })
    });
    assert.equal(res.status, attempt <= 10 ? 401 : 429);
  }
});

test('security: browser script injection is blocked without allowing unsafe inline scripts', async (t) => {
  const app = await appFor(t, { TRUST_PROXY_HOPS: '1' });
  const res = await fetch(app.base + '/', { headers: { 'X-Forwarded-Proto': 'https' } });
  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src[^;]*'sha256-/);
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp));
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(res.headers.get('strict-transport-security') || '', /max-age=/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const member = app.client();
  const login = await member.raw('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  assert.match(login.headers.get('set-cookie') || '', /; Secure/);
});

test('security: hidden profiles cannot be enumerated through chats, interests or shortlist', async (t) => {
  const app = await appFor(t);
  const target = app.client();
  const targetUser = await register(target, 'hidden@test.example');
  const viewer = app.client();
  await register(viewer, 'viewer@test.example');
  await viewer.post('/api/shortlist', { user_id: targetUser.id });
  await target.put('/api/profile', { visibility: 'hidden', city: 'Private city' });
  assert.equal((await viewer.get(`/api/conversations/${targetUser.id}`)).status, 404);
  assert.equal((await viewer.post('/api/interests', { to_user_id: targetUser.id })).status, 404);
  assert.equal((await viewer.get('/api/shortlist')).body.results.length, 0);
  // Removal of an old entry remains possible; adding a new hidden entry does not.
  await viewer.post('/api/shortlist', { user_id: targetUser.id });
  assert.equal((await viewer.post('/api/shortlist', { user_id: targetUser.id })).status, 404);
});

test('security: suspension revokes sessions permanently, including after reactivation', async (t) => {
  const app = await appFor(t);
  const member = app.client();
  const user = await register(member);
  const admin = await adminClient(app);
  await admin.patch(`/api/admin/users/${user.id}`, { status: 'suspended' });
  await admin.patch(`/api/admin/users/${user.id}`, { status: 'active' });
  assert.equal((await member.get('/api/me')).status, 401);
  assert.equal((await member.post('/api/auth/login', { email: 'member@test.example', password: 'MemberPass123' })).status, 200);
});

test('security: moderation cannot delete or suspend the last administrator', async (t) => {
  const app = await appFor(t);
  const member = app.client();
  await register(member);
  const admin = await adminClient(app);
  const id = (await admin.get('/api/me')).body.user.id;
  assert.equal((await member.post('/api/reports', { user_id: id, reason: 'Test report' })).status, 200);
  const report = (await admin.get('/api/admin/reports')).body.reports[0];
  for (const action of ['delete', 'suspend']) {
    assert.equal((await admin.patch(`/api/admin/reports/${report.id}`, { status: 'resolved', action })).status, 400);
    assert.equal((await admin.get('/api/admin/stats')).status, 200);
  }
});

test('security: recovery tokens are single-use under simultaneous requests', async (t) => {
  const app = await appFor(t);
  const member = app.client();
  await register(member);
  await member.post('/api/auth/forgot', { email: 'member@test.example' });
  const token = app.mailLink('member@test.example', 'reset-password.html').searchParams.get('token');
  const results = await Promise.all([0, 1].map((index) => app.client().post('/api/auth/reset', { token, password: `ResetPassword${index}123` })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
});

test('security: Supabase must refuse a public photo bucket', async () => {
  const client = supabase.createClient({ url: 'https://test.invalid', key: 'test-only', bucket: 'uploads' }, {
    fetchImpl: async () => new Response(JSON.stringify({ id: 'uploads', public: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  await assert.rejects(client.ensureBucket(), /private|public/i);
});

test('security: a missing photo bucket or core table must not produce healthy startup', async () => {
  const client = {
    ping: async () => true,
    ensureBucket: async () => { throw new Error('Storage permission denied'); },
    count: async () => 0,
    stats: () => ({})
  };
  const driver = supabase.createDriver(client);
  await assert.rejects(driver.load(), /storage|bucket|permission/i);
  assert.equal(driver.stats().loaded, false);
  client.ensureBucket = async () => {};
  client.count = async (table) => { if (table === 'messages') throw new Error('messages table missing'); return 0; };
  await assert.rejects(driver.load(), /messages/);
  assert.equal(driver.stats().loaded, false);
});

for (const kind of ['json', 'sqlite']) {
  test(`security: corrupted ${kind} storage is not replaced by an empty site`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-corruption-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, `panika-jeevan-sathi.${kind === 'json' ? 'json' : 'db'}`);
    const contents = 'corrupted database; preserve for recovery';
    fs.writeFileSync(file, contents);
    const run = spawnSync(process.execPath, ['-e', `require('./lib/db').open(process.argv[1])`, dir], {
      cwd: new URL('../', import.meta.url), env: { ...testEnvironment(), PJS_STORAGE: kind }, encoding: 'utf8'
    });
    assert.notEqual(run.status, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), contents);
    if (kind === 'sqlite') assert.equal(fs.existsSync(path.join(dir, 'panika-jeevan-sathi.json')), false);
  });
}

test('security: simultaneous admin changes cannot remove every administrator', async (t) => {
  const app = await appFor(t);
  const member = app.client();
  const user = await register(member);
  const admin = await adminClient(app);
  const ownerId = (await admin.get('/api/me')).body.user.id;
  await admin.patch(`/api/admin/users/${user.id}`, { role: 'admin' });
  await member.post('/api/auth/login', { email: 'member@test.example', password: 'MemberPass123' });
  const results = await Promise.all([
    admin.patch(`/api/admin/users/${user.id}`, { role: 'user' }),
    member.patch(`/api/admin/users/${ownerId}`, { role: 'user' })
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.ok(results.some((result) => [400, 401, 403].includes(result.status)));
});
