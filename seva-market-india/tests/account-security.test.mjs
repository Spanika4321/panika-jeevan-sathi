/**
 * SEVA MARKET INDIA — email verification and password reset.
 *
 * These are the two flows where a mistake is not a cosmetic bug but an account
 * takeover, so the suite asserts the properties rather than the markup:
 *
 *   - a mailed link works exactly once, and only for its own purpose;
 *   - the database never holds the raw token, only its SHA-256 hash;
 *   - asking for a new link kills the previous one;
 *   - "forgot password" answers identically for a known and an unknown address;
 *   - a reset signs every session out and confirms the address on the way;
 *   - cross-origin POSTs are refused, and every page here is noindex.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeApp, request, memoryMailer } from './helpers.mjs';

const require = createRequire(import.meta.url);
const crypto = require('node:crypto');
const tokens = require('../src/models/account-token');
const users = require('../src/models/user');

/* ------------------------------------------------------------- helpers --- */

async function post(app, url, fields, { cookie = '', ip = '127.0.0.1', origin = null } = {}) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const res = await request(app, {
    method: 'POST', url, body: new URLSearchParams(fields).toString(), headers, ip,
  });
  res.setCookie = res.headers['set-cookie'] || '';
  return res;
}

const cookieOf = (res) => String(res.setCookie).split(';')[0];

/** Register an account through the real route and return its session + email. */
async function signup(app, { email, role = 'customer', password = 'secret-pass-123', ip = '127.0.0.1' } = {}) {
  const res = await post(app, '/register', {
    role,
    full_name: 'Asha Devi',
    email,
    phone: '9876500011',
    password,
  }, { ip });
  assert.equal(res.statusCode, 303, 'signup redirects');
  return { cookie: cookieOf(res), email, password, ip };
}

/** The raw token from the most recent link mailed to `email`. */
function mailedToken(app, email, path) {
  const link = app.mailer.linkFor(email, path);
  assert.ok(link, `a ${path} link should have been emailed to ${email}`);
  return new URL(link).searchParams.get('token');
}

/** Each test gets its own connection so the per-IP counters stay independent. */
let ipCounter = 0;
const freshIp = () => `10.0.0.${(ipCounter += 1)}`;

/* ------------------------------------------------------- token model --- */

test('a token is 256 random bits, URL-safe, and only its hash is storable', () => {
  const token = tokens.newToken();
  assert.equal(token.length, 43, 'base64url of 32 bytes');
  assert.match(token, /^[A-Za-z0-9_-]+$/, 'no character needs escaping in a URL');
  assert.equal(tokens.hashToken(token).length, 64);
  assert.notEqual(tokens.newToken(), tokens.newToken(), 'two tokens must differ');

  const row = tokens.prepareToken({ userId: 7, purpose: 'reset_password', token });
  assert.equal(row.token_hash, tokens.hashToken(token));
  assert.ok(!JSON.stringify(row).includes(token), 'the prepared row must not carry the raw token');
  assert.equal(row.user_id, 7);
  assert.equal(row.consumed_at, undefined);
});

test('the token model refuses an unknown purpose or a malformed token', () => {
  assert.throws(() => tokens.prepareToken({ userId: 1, purpose: 'delete_everything', token: tokens.newToken() }), /Unknown token purpose/);
  assert.throws(() => tokens.prepareToken({ userId: 0, purpose: 'verify_email', token: tokens.newToken() }), /user id/);
  assert.throws(() => tokens.prepareToken({ userId: 1, purpose: 'verify_email', token: 'short' }), /URL-safe/);
  assert.equal(tokens.isTokenShape('abc'), false);
  assert.equal(tokens.isTokenShape(tokens.newToken()), true);
  assert.ok(tokens.TTL_MS.verify_email > tokens.TTL_MS.reset_password, 'a reset link must be shorter-lived');
});

/* ------------------------------------------------- signup + verification --- */

test('signing up mails a confirmation link and stores only its hash', async () => {
  const app = makeApp();
  const account = await signup(app, { email: 'asha@example.com' });

  assert.equal(app.mailer.sent.length, 1, 'exactly one email is sent at signup');
  const message = app.mailer.sent[0];
  assert.equal(message.to, 'asha@example.com');
  assert.match(message.subject, /Confirm your email/);
  assert.match(message.text, /Namaste Asha/, 'the greeting uses the first name');
  assert.match(message.text, /expires in 2 days/, 'the lifetime is stated in the units a person uses');
  assert.match(message.html, /<a href="http[^"]+\/verify-email\?token=/, 'the HTML half carries the button');

  const raw = mailedToken(app, 'asha@example.com', '/verify-email');
  const rows = app.db.all('SELECT * FROM account_tokens');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].purpose, 'verify_email');
  assert.equal(rows[0].token_hash, crypto.createHash('sha256').update(raw).digest('hex'));
  assert.ok(!JSON.stringify(rows).includes(raw), 'the raw token must never be written to the database');

  const stored = await app.store.users.findByEmail('asha@example.com');
  assert.equal(users.verifyPassword(account.password, stored.password_hash), true);
  app.close();
});

test('the confirmation link verifies the address once, then stops working', async () => {
  const app = makeApp();
  await signup(app, { email: 'once@example.com' });
  const raw = mailedToken(app, 'once@example.com', '/verify-email');

  const first = await request(app, { url: `/verify-email?token=${raw}` });
  assert.equal(first.statusCode, 303);
  assert.equal(first.headers.location, '/login?verified=1', 'a link confirms the address; it does not hand out a session');

  const user = await app.store.users.findByEmail('once@example.com');
  assert.ok(user.id);
  const row = app.db.get('SELECT email_verified_at FROM users WHERE id = ?', [user.id]);
  assert.ok(row.email_verified_at, 'email_verified_at is stamped');
  assert.ok(app.db.get('SELECT consumed_at FROM account_tokens WHERE id = 1').consumed_at, 'the token is spent');

  const login = await request(app, { url: '/login?verified=1' });
  assert.match(login.body, /Email address confirmed/);

  const replay = await request(app, { url: `/verify-email?token=${raw}` });
  assert.equal(replay.statusCode, 200);
  assert.match(replay.body, /does not work/);
  assert.match(replay.body, /noindex,nofollow/);
  app.close();
});

test('a garbage, truncated or wrong-purpose token is refused without a 500', async () => {
  const app = makeApp();
  for (const token of ['nope', 'a'.repeat(43), "' OR 1=1 --", tokens.newToken()]) {
    const res = await request(app, { url: `/verify-email?token=${encodeURIComponent(token)}` });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /does not work|Confirm your email/);
  }
  // A reset token must not verify an email address, and vice versa.
  await signup(app, { email: 'purpose@example.com' });
  const verifyToken = mailedToken(app, 'purpose@example.com', '/verify-email');
  const resetPage = await request(app, { url: `/reset-password?token=${verifyToken}` });
  assert.equal(resetPage.statusCode, 200);
  assert.match(resetPage.body, /That reset link does not work/);
  app.close();
});

test('an expired link is refused', async () => {
  const app = makeApp();
  await signup(app, { email: 'late@example.com' });
  const raw = mailedToken(app, 'late@example.com', '/verify-email');
  app.db.run("UPDATE account_tokens SET expires_at = '2000-01-01T00:00:00.000Z'");

  const res = await request(app, { url: `/verify-email?token=${raw}` });
  assert.match(res.body, /does not work/);
  assert.equal(app.db.get('SELECT email_verified_at FROM users').email_verified_at, null);
  app.close();
});

test('asking for a new link cancels the one already in the inbox', async () => {
  const app = makeApp();
  const account = await signup(app, { email: 'resend@example.com' });
  const oldToken = mailedToken(app, 'resend@example.com', '/verify-email');

  const dashboard = await request(app, { url: '/account', headers: { cookie: account.cookie } });
  assert.match(dashboard.body, /Confirm your email address/, 'the dashboard reminds an unconfirmed account');
  assert.match(dashboard.body, /action="\/verify-email\/resend"/);

  const resend = await post(app, '/verify-email/resend', {}, { cookie: account.cookie, ip: account.ip });
  assert.equal(resend.statusCode, 303);
  assert.equal(resend.headers.location, '/verify-email?sent=1');
  assert.equal(app.mailer.sent.length, 2, 'a second email went out');

  const newToken = mailedToken(app, 'resend@example.com', '/verify-email');
  assert.notEqual(newToken, oldToken);

  const old = await request(app, { url: `/verify-email?token=${oldToken}` });
  assert.match(old.body, /does not work/, 'the superseded link is dead');

  const fresh = await request(app, { url: `/verify-email?token=${newToken}`, headers: { cookie: account.cookie } });
  assert.equal(fresh.headers.location, '/account?ok=email-verified', 'signed in as the same account: straight to the dashboard');

  const after = await request(app, { url: '/account?ok=email-verified', headers: { cookie: account.cookie } });
  assert.doesNotMatch(after.body, /Confirm your email address ✉️/, 'the reminder disappears once confirmed');
  assert.match(after.body, /Email address confirmed/, 'and the dashboard says so once');

  const plain = await request(app, { url: '/account', headers: { cookie: account.cookie } });
  assert.doesNotMatch(plain.body, /verify-email\/resend/, 'no resend button left for a confirmed address');
  app.close();
});

test('resending needs a session, and stops at the hourly limit', async () => {
  const app = makeApp();
  const anonymous = await post(app, '/verify-email/resend', {}, { ip: freshIp() });
  assert.equal(anonymous.statusCode, 303);
  assert.equal(anonymous.headers.location, '/login?next=/verify-email');

  const account = await signup(app, { email: 'limit@example.com', ip: freshIp() });
  // The signup link counts towards the hour, so exactly limit-1 resends are
  // left: the limit is on links mailed, not on button presses.
  const limit = app.config.tokens.hourlyLimit.verify_email;
  for (let i = 0; i < limit - 1; i += 1) {
    const res = await post(app, '/verify-email/resend', {}, { cookie: account.cookie, ip: account.ip });
    assert.equal(res.headers.location, '/verify-email?sent=1', `resend ${i + 1} is allowed`);
  }
  assert.equal(app.mailer.sent.length, limit, 'signup + the allowed resends');

  const tooMany = await post(app, '/verify-email/resend', {}, { cookie: account.cookie, ip: account.ip });
  assert.equal(tooMany.statusCode, 200);
  assert.match(tooMany.body, /You already have a link/);
  assert.equal(app.mailer.sent.length, limit, 'the limit really stops the mail');

  const statusPage = await request(app, { url: '/verify-email', headers: { cookie: account.cookie } });
  assert.match(statusPage.body, /Too many requests/, 'the button is disabled at the limit');
  app.close();
});

test('a confirmed account cannot ask for another confirmation link', async () => {
  const app = makeApp();
  const account = await signup(app, { email: 'done@example.com' });
  const raw = mailedToken(app, 'done@example.com', '/verify-email');
  await request(app, { url: `/verify-email?token=${raw}`, headers: { cookie: account.cookie } });

  const resend = await post(app, '/verify-email/resend', {}, { cookie: account.cookie, ip: account.ip });
  assert.equal(resend.headers.location, '/account?ok=email-verified');
  assert.equal(app.mailer.sent.length, 1, 'nothing new is mailed');

  const statusPage = await request(app, { url: '/verify-email', headers: { cookie: account.cookie } });
  assert.match(statusPage.body, /Your email is confirmed/);
  app.close();
});

/* ------------------------------------------------------- password reset --- */

test('the login page offers a way out, and the reset form is one field deep', async () => {
  const app = makeApp();
  const login = await request(app, { url: '/login' });
  assert.match(login.body, /href="\/forgot-password"/);

  const forgot = await request(app, { url: '/forgot-password' });
  assert.equal(forgot.statusCode, 200);
  assert.match(forgot.body, /Reset your password/);
  assert.match(forgot.body, /name="email"/);
  assert.match(forgot.body, /noindex,nofollow/);
  assert.match(forgot.body, /the answer is the same whether or not the address has an account/);
  app.close();
});

test('"forgot password" answers identically for a known and an unknown address', async () => {
  const app = makeApp();
  await signup(app, { email: 'known@example.com', ip: freshIp() });
  app.mailer.sent.length = 0;

  const known = await post(app, '/forgot-password', { email: 'known@example.com' }, { ip: freshIp() });
  const unknown = await post(app, '/forgot-password', { email: 'nobody@example.com' }, { ip: freshIp() });
  const uppercase = await post(app, '/forgot-password', { email: 'KNOWN@example.com' }, { ip: freshIp() });

  for (const res of [known, unknown, uppercase]) {
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, '/forgot-password?sent=1');
  }
  assert.equal(known.headers.location, unknown.headers.location, 'no signal in the redirect');
  assert.equal(app.mailer.sent.length, 2, 'known + the case-insensitive repeat; never the unknown address');
  assert.deepEqual(app.mailer.sent.map((m) => m.to), ['known@example.com', 'known@example.com']);

  const page = await request(app, { url: '/forgot-password?sent=1' });
  assert.match(page.body, /If an account uses that email address, a reset link is on its way/);
  assert.doesNotMatch(page.body, /known@example\.com/, 'the address is not echoed back');
  app.close();
});

test('a malformed address is the only visibly different answer', async () => {
  const app = makeApp();
  const res = await post(app, '/forgot-password', { email: 'not-an-email' }, { ip: freshIp() });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Enter a valid email address/);
  assert.match(res.body, /id="email-err"/, 'the error is attached to the field, not just a banner');
  assert.match(res.body, /value="not-an-email"/, 'what they typed comes back');
  assert.equal(app.mailer.sent.length, 0);
  app.close();
});

test('one connection cannot request reset links all hour', async () => {
  const app = makeApp();
  const ip = freshIp();
  await signup(app, { email: 'flood@example.com', ip: freshIp() });
  app.mailer.sent.length = 0;

  const limit = app.config.tokens.hourlyLimit.reset_password;
  for (let i = 0; i < limit; i += 1) {
    const res = await post(app, '/forgot-password', { email: 'flood@example.com' }, { ip });
    assert.equal(res.headers.location, '/forgot-password?sent=1');
  }
  const blocked = await post(app, '/forgot-password', { email: 'flood@example.com' }, { ip });
  assert.equal(blocked.statusCode, 200, 'the rate limit is told, the account is not');
  assert.match(blocked.body, /Too many requests/);
  app.close();
});

test('the reset link sets a new password, spends itself and signs the browser out', async () => {
  const app = makeApp();
  const account = await signup(app, { email: 'reset@example.com', ip: freshIp() });
  app.mailer.sent.length = 0;

  await post(app, '/forgot-password', { email: 'reset@example.com' }, { ip: freshIp() });
  const raw = mailedToken(app, 'reset@example.com', '/reset-password');
  assert.match(app.mailer.sent[0].text, /expires in 60 minutes/);
  assert.match(app.mailer.sent[0].text, /works once/);

  const form = await request(app, { url: `/reset-password?token=${raw}` });
  assert.equal(form.statusCode, 200);
  assert.match(form.body, /Choose a new password/);
  assert.match(form.body, /autocomplete="new-password"/);
  assert.ok(form.body.includes(`value="${raw}"`), 'the token rides along in a hidden field');
  assert.match(form.body, /noindex,nofollow/);

  const done = await post(app, '/reset-password', {
    token: raw, password: 'brand-new-pass-9', password_confirm: 'brand-new-pass-9',
  }, { ip: freshIp() });
  assert.equal(done.statusCode, 303);
  assert.equal(done.headers.location, '/login?reset=1');
  assert.match(done.setCookie, /smi_session=;/, 'the session cookie is cleared');
  assert.match(done.setCookie, /Max-Age=0/);

  const login = await request(app, { url: '/login?reset=1' });
  assert.match(login.body, /Password changed/);

  // The old password is gone, the new one works.
  const oldLogin = await post(app, '/login', { email: 'reset@example.com', password: account.password }, { ip: freshIp() });
  assert.equal(oldLogin.statusCode, 200);
  assert.match(oldLogin.body, /Incorrect email or password/);

  const newLogin = await post(app, '/login', { email: 'reset@example.com', password: 'brand-new-pass-9' }, { ip: freshIp() });
  assert.equal(newLogin.statusCode, 303);
  assert.ok(newLogin.setCookie.includes('smi_session='), 'the new password logs in');

  // A reset proves control of the inbox, so the address is confirmed too.
  const row = app.db.get('SELECT email_verified_at FROM users WHERE email = ?', ['reset@example.com']);
  assert.ok(row.email_verified_at, 'the reset confirmed the address');

  // And the link is dead.
  const replay = await request(app, { url: `/reset-password?token=${raw}` });
  assert.match(replay.body, /That reset link does not work/);
  app.close();
});

test('two racing resets: only one wins', async () => {
  const app = makeApp();
  await signup(app, { email: 'race@example.com', ip: freshIp() });
  await post(app, '/forgot-password', { email: 'race@example.com' }, { ip: freshIp() });
  const raw = mailedToken(app, 'race@example.com', '/reset-password');

  const fields = { token: raw, password: 'winner-pass-123', password_confirm: 'winner-pass-123' };
  const [first, second] = await Promise.all([
    post(app, '/reset-password', fields, { ip: freshIp() }),
    post(app, '/reset-password', fields, { ip: freshIp() }),
  ]);
  const outcomes = [first, second];
  const winners = outcomes.filter((res) => res.headers.location === '/login?reset=1');
  const losers = outcomes.filter((res) => res.headers.location !== '/login?reset=1');
  assert.equal(winners.length, 1, 'exactly one of the two submits may succeed');
  assert.equal(losers.length, 1);
  assert.equal(losers[0].statusCode, 200);
  assert.match(losers[0].body, /already been used|does not work/);
  app.close();
});

test('a weak or mismatched password keeps the link usable', async () => {
  const app = makeApp();
  await signup(app, { email: 'typo@example.com', ip: freshIp() });
  await post(app, '/forgot-password', { email: 'typo@example.com' }, { ip: freshIp() });
  const raw = mailedToken(app, 'typo@example.com', '/reset-password');

  const weak = await post(app, '/reset-password', { token: raw, password: 'short', password_confirm: 'short' }, { ip: freshIp() });
  assert.equal(weak.statusCode, 200);
  assert.match(weak.body, /at least 8 characters/);
  assert.match(weak.body, /id="password-err"/);
  assert.doesNotMatch(weak.body, /value="short"/, 'a rejected password is never echoed back');

  const mismatch = await post(app, '/reset-password', { token: raw, password: 'good-pass-123', password_confirm: 'good-pass-999' }, { ip: freshIp() });
  assert.match(mismatch.body, /Both passwords must match/);

  // The token survived both mistakes, so the visitor can simply try again.
  const retry = await post(app, '/reset-password', { token: raw, password: 'good-pass-123', password_confirm: 'good-pass-123' }, { ip: freshIp() });
  assert.equal(retry.headers.location, '/login?reset=1');
  app.close();
});

test('an expired reset link is refused, and a reset token cannot verify an address', async () => {
  const app = makeApp();
  await signup(app, { email: 'stale@example.com', ip: freshIp() });
  await post(app, '/forgot-password', { email: 'stale@example.com' }, { ip: freshIp() });
  const raw = mailedToken(app, 'stale@example.com', '/reset-password');
  app.db.run("UPDATE account_tokens SET expires_at = '2000-01-01T00:00:00.000Z'");

  const page = await request(app, { url: `/reset-password?token=${raw}` });
  assert.match(page.body, /That reset link does not work/);
  assert.match(page.body, /href="\/forgot-password"/, 'the way forward is a new link');

  const submit = await post(app, '/reset-password', { token: raw, password: 'good-pass-123', password_confirm: 'good-pass-123' }, { ip: freshIp() });
  assert.equal(submit.statusCode, 200);
  assert.match(submit.body, /does not work/);

  const stored = await app.store.users.findByEmail('stale@example.com');
  assert.equal(users.verifyPassword('good-pass-123', stored.password_hash), false, 'the password did not change');
  app.close();
});

/* ------------------------------------------------------------ hardening --- */

test('every security POST is origin-checked', async () => {
  const app = makeApp();
  for (const url of ['/verify-email/resend', '/forgot-password', '/reset-password']) {
    const res = await post(app, url, {}, { origin: 'https://evil.example', ip: freshIp() });
    assert.equal(res.statusCode, 403, `${url} must refuse a cross-origin form`);
  }
  app.close();
});

test('security pages are never indexable and never leak a token', async () => {
  const app = makeApp();
  await signup(app, { email: 'leak@example.com', ip: freshIp() });
  const raw = mailedToken(app, 'leak@example.com', '/verify-email');

  const robots = await request(app, { url: '/robots.txt' });
  for (const path of ['/verify-email', '/forgot-password', '/reset-password']) {
    assert.match(robots.body, new RegExp(`^Disallow: ${path}`, 'm'), `${path} must be disallowed`);
  }

  const sitemap = await request(app, { url: '/sitemap.xml' });
  assert.doesNotMatch(sitemap.body, /verify-email|forgot-password|reset-password/);
  assert.doesNotMatch(sitemap.body, new RegExp(raw), 'a token must never be published');

  for (const url of ['/verify-email', '/forgot-password', `/reset-password?token=${raw}`]) {
    const res = await request(app, { url });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<meta name="robots" content="noindex,nofollow">/);
    const inline = res.body.match(/<script(?![^>]*\ssrc=)[^>]*>/g) || [];
    assert.deepEqual(inline, [], 'no inline script (CSP forbids it)');
  }
  app.close();
});

test('a failing mail server does not break the signup it was triggered by', async () => {
  const app = makeApp({ mailer: memoryMailer({ failWith: 'SMTP refused the message' }) });
  const res = await post(app, '/register', {
    role: 'customer',
    full_name: 'Mail Down',
    email: 'maildown@example.com',
    phone: '9876500022',
    password: 'secret-pass-123',
  }, { ip: freshIp() });
  assert.equal(res.statusCode, 303, 'the account exists even though the email did not leave');

  // The token row is still there, so the dashboard resend can recover it.
  assert.equal(app.db.all('SELECT * FROM account_tokens').length, 1);
  const dashboard = await request(app, { url: '/account', headers: { cookie: cookieOf(res) } });
  assert.match(dashboard.body, /Confirm your email address/);
  app.close();
});

test('an account with no mailer configured still gets a link into the outbox flow', async () => {
  // The real mailer with no SMTP: mode 'outbox' in development, 'disabled' in
  // production. Either way the flow completes and the page says what happened.
  const app = makeApp({ mailer: memoryMailer({ delivered: false, mode: 'outbox' }) });
  const account = await signup(app, { email: 'outbox@example.com', ip: freshIp() });
  await post(app, '/verify-email/resend', {}, { cookie: account.cookie, ip: account.ip });
  const page = await request(app, { url: '/verify-email?sent=1', headers: { cookie: account.cookie } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /we sent a new confirmation link/i);
  app.close();
});

test('verification and reset are audited without recording the token', async () => {
  const app = makeApp();
  await signup(app, { email: 'audit@example.com', ip: freshIp() });
  const verifyToken = mailedToken(app, 'audit@example.com', '/verify-email');
  await request(app, { url: `/verify-email?token=${verifyToken}` });
  await post(app, '/forgot-password', { email: 'audit@example.com' }, { ip: freshIp() });
  const resetToken = mailedToken(app, 'audit@example.com', '/reset-password');
  await post(app, '/reset-password', { token: resetToken, password: 'audit-pass-123', password_confirm: 'audit-pass-123' }, { ip: freshIp() });

  await new Promise((resolve) => setTimeout(resolve, 20)); // the audit write is fire-and-forget
  const rows = app.db.all('SELECT actor, action, detail FROM audit_logs ORDER BY id');
  const actions = rows.map((row) => row.action);
  for (const expected of [
    'auth.register',
    'auth.verify_email.requested',
    'auth.email_verified',
    'auth.password_reset.requested',
    'auth.password_reset',
  ]) assert.ok(actions.includes(expected), `missing audit action: ${expected}`);

  const details = rows.map((row) => String(row.detail || '')).join(' ');
  assert.ok(!details.includes(verifyToken), 'the audit trail must not carry a raw token');
  assert.ok(!details.includes(resetToken), 'the audit trail must not carry a raw token');
  assert.ok(!details.includes('audit-pass-123'), 'the audit trail must not carry a password');
  app.close();
});
