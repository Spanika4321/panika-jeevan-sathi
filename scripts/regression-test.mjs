import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startTestApp, register, adminClient, PNG, ADMIN_EMAIL } from './lib/test-app.mjs';

async function appFor(t, env) {
  const app = await startTestApp(env);
  t.after(() => app.stop());
  return app;
}

for (const url of ['/%E0%A4%A', '/%00', '/api/profiles/%E0%A4%A']) {
  test(`malformed path ${url} returns 400 without taking the server down`, async (t) => {
    const app = await appFor(t);
    const res = await fetch(app.base + url);
    assert.equal(res.status, 400);
    assert.equal((await fetch(app.base + '/api/health')).status, 200);
  });
}

test('malformed/unrelated cookies cannot crash public or private routes', async (t) => {
  const app = await appFor(t);
  const res = await fetch(app.base + '/api/health', { headers: { Cookie: 'other=%ZZ; pjs_session=%E0%A4%A' } });
  assert.equal(res.status, 200);
  assert.equal((await app.client().get('/api/me')).status, 401);
});

test('JSON bodies must be objects and oversized requests receive a real 413', async (t) => {
  const app = await appFor(t);
  for (const value of [null, [], 123, true, 'hello']) {
    const res = await app.client().post('/api/auth/login', value);
    assert.equal(res.status, 400, JSON.stringify(value));
  }
  const res = await fetch(app.base + '/api/contact', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'x'.repeat(8 * 1024 * 1024) })
  });
  assert.equal(res.status, 413);
  assert.equal((await fetch(app.base + '/api/health')).status, 200);
});

test('API/error responses have security headers and health works during maintenance', async (t) => {
  const app = await appFor(t);
  for (const url of ['/api/health', '/api/me', '/api/not-a-route', '/missing.html']) {
    const res = await fetch(app.base + url);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
    assert.ok(res.headers.get('referrer-policy'), url);
    if (url.startsWith('/api/')) assert.match(res.headers.get('x-robots-tag') || '', /noindex/);
  }
  const admin = await adminClient(app);
  await admin.put('/api/admin/settings', { maintenance: '1' });
  assert.equal((await app.client().get('/api/health')).status, 200);
  assert.equal((await app.client().get('/api/profiles')).status, 503);
});

test('old registration, password and chat links redirect without losing query parameters', async (t) => {
  const app = await appFor(t);
  const aliases = {
    '/register': '/login.html?tab=register',
    '/register.html': '/login.html?tab=register',
    '/signup': '/login.html?tab=register',
    '/signup.html': '/login.html?tab=register',
    '/forgot-password': '/login.html?tab=forgot',
    '/forgot-password.html': '/login.html?tab=forgot',
    '/reset-password?token=abc': '/reset-password.html?token=abc',
    '/chat.html?with=7': '/messages.html?with=7',
    '/login': '/login.html',
    '/register?next=%2Fsearch.html&tab=forgot': '/login.html?next=%2Fsearch.html&tab=register'
  };
  for (const [from, to] of Object.entries(aliases)) {
    const res = await fetch(app.base + from, { redirect: 'manual' });
    assert.equal(res.status, 301, from);
    assert.equal(res.headers.get('location'), to, from);
    assert.equal((await fetch(app.base + from)).status, 200, from);
  }
});

test('reset tokens stay in mail, use the pinned origin, and cannot be reused', async (t) => {
  const app = await appFor(t, { SITE_URL: 'https://matrimony.example/' });
  const member = app.client();
  await register(member);
  const stranger = app.client();
  const unknown = await stranger.post('/api/auth/forgot', { email: 'unknown@test.example' });
  const res = await stranger.raw('/api/auth/forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Host': 'attacker.example' },
    body: JSON.stringify({ email: 'member@test.example' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, unknown.body, 'do not leak tokens, delivery state or account existence');
  const link = app.mailLink('member@test.example', 'reset-password.html');
  assert.equal(link.origin, 'https://matrimony.example');
  const reset = { token: link.searchParams.get('token'), password: 'NewPassword123' };
  assert.equal((await stranger.post('/api/auth/reset', reset)).status, 200);
  assert.equal((await stranger.post('/api/auth/reset', reset)).status, 400);
  assert.equal((await member.get('/api/me')).status, 401, 'old session revoked');
  assert.equal((await stranger.post('/api/auth/login', { email: 'member@test.example', password: reset.password })).status, 200);
  const adminReset = await member.post('/api/auth/forgot', { email: ADMIN_EMAIL });
  assert.deepEqual(adminReset.body, unknown.body, 'administrator reset token is private too');
});

test('passwords preserve whitespace and changing one revokes outstanding reset links', async (t) => {
  const app = await appFor(t);
  const member = app.client();
  await register(member, 'space@test.example', '  SpacePassword123  ');
  const stranger = app.client();
  assert.equal((await stranger.post('/api/auth/login', { email: 'space@test.example', password: 'SpacePassword123' })).status, 401);
  assert.equal((await stranger.post('/api/auth/login', { email: 'space@test.example', password: '  SpacePassword123  ' })).status, 200);
  await stranger.post('/api/auth/forgot', { email: 'space@test.example' });
  const token = app.mailLink('space@test.example', 'reset-password.html').searchParams.get('token');
  assert.equal((await member.post('/api/me/password', { current_password: '  SpacePassword123  ', new_password: 'ChangedPassword123' })).status, 200);
  assert.equal((await stranger.post('/api/auth/reset', { token, password: 'StolenPassword123' })).status, 400);
});

test('unverified registration cannot acquire a session or expose its verification token', async (t) => {
  const app = await appFor(t);
  const admin = await adminClient(app);
  await admin.put('/api/admin/settings', { require_email_verification: '1' });
  const member = app.client();
  const user = await register(member);
  assert.equal(user.email_verified, false);
  assert.equal((await member.get('/api/me')).status, 401);
  assert.equal((await member.get('/api/matches')).status, 401);
  const login = await member.post('/api/auth/login', { email: 'member@test.example', password: 'MemberPass123' });
  assert.equal(login.status, 403);
  assert.ok(!login.body.verification_link);
  const resend = await member.post('/api/auth/resend-verification', { email: 'member@test.example' });
  assert.ok(!resend.body.verification_link);
  const link = app.mailLink('member@test.example', 'verify-email.html');
  assert.equal((await member.get('/api/auth/verify' + link.search)).status, 200);
  assert.equal((await member.post('/api/auth/login', { email: 'member@test.example', password: 'MemberPass123' })).status, 200);
  const notifications = await member.get('/api/notifications');
  assert.ok(!JSON.stringify(notifications.body).includes('?token='));
});

test('claiming an owner email is not enough to become an administrator', async (t) => {
  const app = await appFor(t, { OWNER_EMAILS: 'owner@test.example' });
  const member = app.client();
  const result = await member.post('/api/auth/register', { name: 'Claimed Owner', email: 'owner@test.example', password: 'OwnerPass123', role: 'admin' });
  assert.equal(result.status, 200);
  assert.equal(result.body.user.role, 'user');
  assert.equal(result.body.verification_required, true);
  assert.ok(!result.body.verification_link);
  assert.equal((await member.get('/api/admin/stats')).status, 401);
  const link = app.mailLink('owner@test.example', 'verify-email.html');
  await member.get('/api/auth/verify' + link.search);
  const login = await member.post('/api/auth/login', { email: 'owner@test.example', password: 'OwnerPass123' });
  assert.equal(login.body.user.role, 'admin', 'verified configured owner can administer the site');
});

test('suspended administrators lose existing-session access', async (t) => {
  const app = await appFor(t);
  const member = app.client();
  const user = await register(member);
  const admin = await adminClient(app);
  await admin.patch(`/api/admin/users/${user.id}`, { role: 'admin' });
  assert.equal((await member.get('/api/admin/stats')).status, 401);
  await member.post('/api/auth/login', { email: 'member@test.example', password: 'MemberPass123' });
  assert.equal((await member.get('/api/admin/stats')).status, 200);
  await admin.patch(`/api/admin/users/${user.id}`, { status: 'suspended' });
  assert.equal((await member.get('/api/admin/stats')).status, 401);
});

test('photo privacy also protects the actual uploaded bytes, not just the JSON URL', async (t) => {
  const app = await appFor(t);
  const owner = app.client();
  await register(owner, 'photo@test.example');
  const viewer = app.client();
  await register(viewer, 'viewer@test.example');
  const uploaded = await owner.post('/api/profile/photo', { data_url: PNG });
  assert.equal(uploaded.status, 200);
  const url = uploaded.body.photo;
  assert.equal((await fetch(app.base + url)).status, 404, 'members-only photo is not public');
  assert.equal((await viewer.raw(url)).status, 200);
  await owner.put('/api/profile', { hide_photo: 1 });
  assert.equal((await viewer.raw(url)).status, 404, 'previously known URL respects new privacy');
  const own = await owner.raw(url);
  assert.equal(own.status, 200);
  assert.match(own.headers.get('cache-control'), /no-store/);
  await owner.put('/api/profile', { hide_photo: 0, visibility: 'everyone' });
  assert.equal((await fetch(app.base + url)).status, 200);
  await owner.put('/api/profile', { visibility: 'hidden' });
  assert.equal((await viewer.raw(url)).status, 404);
});

test('invalid pagination does not produce null pages or silently empty results', async (t) => {
  const app = await appFor(t);
  const member = app.client();
  await register(member);
  await register(app.client(), 'another@test.example');
  const result = await member.get('/api/profiles?page=abc&per_page=Infinity');
  assert.equal(result.status, 200);
  assert.equal(result.body.page, 1);
  assert.equal(result.body.per_page, 12);
  assert.equal(result.body.results.length, 1);
  const matches = await member.get('/api/matches?limit=NaN');
  assert.equal(matches.body.results.length, 1);
});

test('partial profile updates validate the complete preferred age range', async (t) => {
  const app = await appFor(t);
  const member = app.client();
  const user = await register(member);
  await member.put('/api/profile', { pref_age_min: 21, pref_age_max: 30 });
  assert.equal((await member.put('/api/profile', { pref_age_min: 40 })).status, 400);
  const admin = await adminClient(app);
  assert.equal((await admin.patch(`/api/admin/users/${user.id}/profile`, { pref_age_max: 19 })).status, 400);
});


test('reset and verification requests are rate limited', async (t) => {
  const app = await appFor(t);
  const client = app.client();
  for (let attempt = 1; attempt <= 6; attempt++) {
    const reset = await client.post('/api/auth/forgot', { email: 'missing@test.example' });
    assert.equal(reset.status, attempt <= 5 ? 200 : 429);
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    const resend = await client.post('/api/auth/resend-verification', { email: 'missing@test.example' });
    assert.equal(resend.status, attempt <= 3 ? 200 : 429);
  }
});

test('name search works and photo-only search respects hidden photos', async (t) => {
  const app = await appFor(t);
  const viewer = app.client();
  await register(viewer);
  const candidate = app.client();
  await register(candidate, 'candidate@test.example');
  await candidate.post('/api/me/name', { name: 'Unique Surname' });
  assert.equal((await viewer.get('/api/profiles?keyword=Surname')).body.total, 1);
  await candidate.post('/api/profile/photo', { data_url: PNG });
  await candidate.put('/api/profile', { hide_photo: 1 });
  assert.equal((await viewer.get('/api/profiles?with_photo=1')).body.total, 0);
  await candidate.put('/api/profile', { hide_photo: 0 });
  assert.equal((await viewer.get('/api/profiles?with_photo=1')).body.total, 1);
});

test('outbox filenames support long emails and token files are private', async (t) => {
  // Exercise the local outbox in an isolated process without SMTP credentials.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-mail-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = await appFor(t);
  const member = app.client();
  await register(member);
  await member.post('/api/auth/forgot', { email: 'member@test.example' });
  const file = fs.readdirSync(path.join(app.dataDir, 'outbox'))[0];
  assert.equal(fs.statSync(path.join(app.dataDir, 'outbox', file)).mode & 0o777, 0o600);
  const run = spawnSync(process.execPath, ['-e', `
    const mailer = require('./lib/mailer');
    mailer.send({to: 'a'.repeat(230) + '@test.example', subject: 'A test reset', text: 'local test'}, process.argv[1])
      .then(result => { if (result.mode !== 'outbox') process.exitCode = 1; });
  `, dir], { cwd: new URL('../', import.meta.url), env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('syntax checker covers server, backend, agents and automation, not just HTML', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-checker-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['scripts', 'lib', 'agents', 'public/assets/js']) fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.copyFileSync(new URL('./check-syntax.mjs', import.meta.url), path.join(dir, 'scripts/check-syntax.mjs'));
  for (const file of ['server.js', 'lib/broken.js', 'agents/broken.mjs', 'scripts/broken.cjs']) {
    fs.writeFileSync(path.join(dir, file), 'const broken = ;');
  }
  fs.writeFileSync(path.join(dir, 'public/index.html'), '<script>const valid = true;</script>');
  const result = spawnSync(process.execPath, [path.join(dir, 'scripts/check-syntax.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  for (const file of ['server.js', 'lib/broken.js', 'agents/broken.mjs', 'scripts/broken.cjs']) {
    assert.ok(result.stdout.includes(file), file);
  }
  assert.match(result.stdout, /6 checked, 4 with syntax errors/);
});
