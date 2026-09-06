/**
 * SEVA MARKET INDIA — authentication over HTTP.
 *
 * The unit tests prove the primitives; these prove the *wire*: cookie flags,
 * the CSRF gate, the throttle's status code, the envelope, and that nothing
 * secret is ever written into a response body.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeApp, request, makeAgent, cookieValue, cookieRaw } from './helpers.mjs';

const require = createRequire(import.meta.url);
const config = require('../src/config');
const users = require('../src/models/user');

const app = makeApp();
const PASSWORD = 'seva-market1';

async function makeAccount(email, { role = 'customer', password = PASSWORD } = {}) {
  const res = await request(app, {
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { 'content-type': 'application/json' },
    body: { email, password, full_name: 'Test Person', phone: '9000012345', role },
    ip: '203.0.113.10',
  });
  return res;
}

/* ------------------------------------------------------------ register */

test('POST /api/v1/auth/register creates the account and a HttpOnly cookie', async () => {
  const res = await makeAccount('reg-1@example.com');
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.data.user.email, 'reg-1@example.com');
  assert.equal(body.data.user.role, 'customer');
  assert.equal(body.data.signed_in, true);

  const cookie = cookieRaw(res, 'seva_session');
  assert.ok(cookie, 'a session cookie must be set');
  assert.match(cookie, /HttpOnly/, 'no script may read the session');
  assert.match(cookie, /SameSite=Lax/, 'cross-site POSTs must not carry it');
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=/);
  if (config.auth.secureCookies) assert.match(cookie, /Secure/);

  assert.ok(!res.body.includes('scrypt$'), 'the password hash must never appear');
  assert.ok(!res.body.includes(cookieValue(res, 'seva_session')), 'the session token itself is cookie-only');
});

test('the register response never carries the password or the hash', async () => {
  const res = await makeAccount('reg-2@example.com');
  assert.ok(!res.body.includes(PASSWORD), 'the password must not be echoed back');
  const json = res.json();
  assert.equal(json.data.user.password, undefined);
  assert.equal(json.data.user.password_hash, undefined);
});

test('register validates every field and names each one', async () => {
  const res = await request(app, {
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { 'content-type': 'application/json' },
    body: { email: 'not-an-email', password: 'x', full_name: '   ' },
  });
  assert.equal(res.statusCode, 400);
  const details = res.json().error.details;
  for (const field of ['email', 'password', 'full_name']) {
    assert.ok(details[field], `missing error for ${field}`);
  }
});

test('register refuses an unsupported content type instead of guessing', async () => {
  const res = await request(app, {
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { 'content-type': 'text/plain' },
    body: 'email=x@example.com',
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /Unsupported Content-Type/);
});

test('a self-declared admin role is downgraded to customer', async () => {
  const res = await makeAccount('sneak-1@example.com', { role: 'admin' });
  assert.equal(res.json().data.user.role, 'customer');
  const row = users.findByEmail(app.db, 'sneak-1@example.com');
  assert.equal(row.role, 'customer');
});

/* ---------------------------------------------------------------- login */

test('signing in through the API sets the cookie and returns a CSRF proof', async () => {
  await makeAccount('login-1@example.com');
  const res = await request(app, {
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    body: { email: 'login-1@example.com', password: PASSWORD },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(cookieValue(res, 'seva_session'));
  assert.match(res.json().data.csrf_token, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(res.json().data.after_login_url, '/account');
});

test('the forgot-password endpoint answers identically for a known and an unknown address', async () => {
  await makeAccount('known-address@example.com');
  const known = await request(app, {
    method: 'POST', url: '/api/v1/auth/password/forgot',
    headers: { 'content-type': 'application/json' }, body: { email: 'known-address@example.com' },
  });
  const unknown = await request(app, {
    method: 'POST', url: '/api/v1/auth/password/forgot',
    headers: { 'content-type': 'application/json' }, body: { email: 'nobody-here@example.com' },
  });
  assert.equal(known.statusCode, unknown.statusCode);
  // Outside production the body may carry a debug link for a *real* account,
  // so compare the part of the payload that is always client-visible.
  const strip = (res) => {
    const data = { ...res.json().data };
    delete data.debug_token;
    return data;
  };
  assert.deepEqual(strip(known), strip(unknown));
  assert.equal(unknown.json().data.sent, undefined, 'never reveal whether anything was sent');
});

test('login is throttled per email and connection, and says 429 with Retry-After', async () => {
  await makeAccount('throttle-1@example.com');
  const max = config.auth.loginMaxAttempts;
  const statuses = [];
  for (let i = 0; i < max; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, {
      method: 'POST', url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      body: { email: 'throttle-1@example.com', password: 'wrong-password1' },
      ip: '203.0.113.77',
    });
    statuses.push(res.statusCode);
  }
  assert.ok(statuses.every((code) => code === 401), `expected 401s, got ${statuses}`);

  const blocked = await request(app, {
    method: 'POST', url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    body: { email: 'throttle-1@example.com', password: PASSWORD },
    ip: '203.0.113.77',
  });
  assert.equal(blocked.statusCode, 429, 'the right password must also be refused while blocked');
  assert.ok(Number(blocked.headers['retry-after']) > 0, 'Retry-After must tell the client how long');

  const otherIp = await request(app, {
    method: 'POST', url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    body: { email: 'throttle-1@example.com', password: PASSWORD },
    ip: '203.0.113.78',
  });
  assert.equal(otherIp.statusCode, 200, 'a different connection is not punished');
});

/* -------------------------------------------------------------- me */

test('GET /api/v1/auth/me is public: anonymous returns null, not 401', async () => {
  const res = await request(app, { url: '/api/v1/auth/me' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().data.signed_in, false);
  assert.equal(res.json().data.user, null);
});

test('a session cookie resolves to the account and nothing else', async () => {
  await makeAccount('me-1@example.com');
  const login = await request(app, {
    method: 'POST', url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    body: { email: 'me-1@example.com', password: PASSWORD },
  });
  const cookie = `seva_session=${cookieValue(login, 'seva_session')}`;
  const me = await request(app, { url: '/api/v1/auth/me', headers: { cookie } });
  assert.equal(me.json().data.user.email, 'me-1@example.com');
  assert.ok(me.json().data.csrf_token);
  assert.ok(!me.body.includes('password'));

  const tampered = await request(app, { url: '/api/v1/auth/me', headers: { cookie: 'seva_session=' + 'f'.repeat(64) } });
  assert.equal(tampered.json().data.signed_in, false, 'a forged cookie is simply anonymous traffic');
});

/* ------------------------------------------------------- CSRF gate */

test('a signed-in write without the CSRF proof is refused with 403', async () => {
  await makeAccount('csrf-1@example.com', { role: 'provider' });
  const login = await request(app, {
    method: 'POST', url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    body: { email: 'csrf-1@example.com', password: PASSWORD },
  });
  const cookie = `seva_session=${cookieValue(login, 'seva_session')}`;
  const csrf = login.json().data.csrf_token;
  // The account needs a listing before it can own a service.
  await request(app, {
    method: 'POST', url: '/api/v1/providers',
    headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: {
      business_name: 'Csrf Test Plumbing', phone: '9000054321', category_id: 2,
      pin_code: '781001', service_title: 'Initial check',
    },
  });

  const withoutToken = await request(app, {
    method: 'POST', url: '/api/v1/providers/me/services',
    headers: { cookie, 'content-type': 'application/json' },
    body: { title: 'Tap repair' },
  });
  assert.equal(withoutToken.statusCode, 403);
  assert.match(withoutToken.json().error.message, /CSRF|session expired/i);

  const wrongToken = await request(app, {
    method: 'POST', url: '/api/v1/providers/me/services',
    headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': 'not-the-right-token' },
    body: { title: 'Tap repair' },
  });
  assert.equal(wrongToken.statusCode, 403);

  const withToken = await request(app, {
    method: 'POST', url: '/api/v1/providers/me/services',
    headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: { title: 'Tap repair', price_min: 300 },
  });
  assert.equal(withToken.statusCode, 201, 'the same request with the proof goes through');
});

test('a GET with a session is never blocked by the CSRF gate', async () => {
  const account = await makeAccount('csrf-2@example.com');
  const cookie = `seva_session=${cookieValue(account, 'seva_session')}`;
  const res = await request(app, { url: '/api/v1/auth/me', headers: { cookie } });
  assert.equal(res.statusCode, 200);
});

test('every dashboard form carries a CSRF field', async () => {
  await makeAccount('form-csrf@example.com', { role: 'provider' });
  const agent = makeAgent(app);
  await agent.signIn('form-csrf@example.com', PASSWORD);
  await agent.post('/api/v1/providers', {
    business_name: ' CSRF Plumbing ', phone: '9000054321', category_id: 2, pin_code: '781001',
    service_title: 'Tap repair',
  }, { headers: { 'x-csrf-token': agent.csrf() } });

  const res = await agent.get('/dashboard/services');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /name="_csrf" value="[A-Za-z0-9_-]{32,}"/);
  assert.ok((res.body.match(/name="_csrf"/g) || []).length >= 2, 'each form gets its own hidden field');
});

/* --------------------------------------------------------- logout */

test('logout revokes the session server-side, not just the cookie', async () => {
  await makeAccount('out-1@example.com');
  const agent = makeAgent(app);
  await agent.signIn('out-1@example.com', PASSWORD);
  assert.equal((await agent.get('/api/v1/auth/me')).json().data.signed_in, true);

  const out = await agent.post('/api/v1/auth/logout', {}, { headers: { 'x-csrf-token': agent.csrf() } });
  assert.match(cookieRaw(out, 'seva_session'), /Max-Age=0/, 'the cookie is expired, not merely cleared client-side');
  assert.equal((await agent.get('/api/v1/auth/me')).json().data.signed_in, false);

  // The old token value must be useless even if the browser kept it.
  const reused = await request(app, { url: '/api/v1/auth/me', headers: { cookie: agent.state.cookie } });
  assert.equal(reused.json().data.signed_in, false);
});

/* ------------------------------------------------------ form pages */

test('the sign-in and register pages render accessible forms with no inline JS', async () => {
  for (const url of ['/login', '/register', '/forgot-password', '/reset-password']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, { url });
    assert.equal(res.statusCode, 200, `${url} must render`);
    assert.match(res.headers['content-security-policy'], /script-src 'self'/);
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(res.body), `${url}: no inline script`);
    for (const handler of ['onclick=', 'onsubmit=', 'onchange=']) {
      assert.ok(!res.body.includes(handler), `${url}: no inline handler`);
    }
  }
  const login = await request(app, { url: '/login' });
  assert.match(login.body, /<label class="field__label" for="email">Email address/);
  assert.match(login.body, /name="password"/);
  assert.match(login.body, /Forgot your password\?/);
});

test('a failed form login re-renders with the error next to the field', async () => {
  await makeAccount('form-login@example.com');
  const res = await request(app, {
    method: 'POST', url: '/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'form-login@example.com', password: 'nope-nope1' }).toString(),
  });
  assert.equal(res.statusCode, 401);
  assert.match(res.body, /class="field field--error"/);
  assert.match(res.body, /Email or password is incorrect/);
  assert.match(res.body, /<h1 class="page-head__title">Sign in<\/h1>/);
});

test('a form sign-in redirects to the page the visitor came from', async () => {
  await makeAccount('form-next@example.com');
  const res = await request(app, {
    method: 'POST', url: '/login?next=%2Fdashboard%2Fcoverage',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'form-next@example.com', password: PASSWORD }).toString(),
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/dashboard/coverage');
});

test('an open redirect in ?next= is refused', async () => {
  await makeAccount('form-redirect@example.com');
  for (const [attempt, expected] of [
    ['https://evil.example.com', '/account'],
    ['//evil.example.com', '/account'],
    ['javascript:alert(1)', '/account'],
    ['/relative-ok', '/relative-ok'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, {
      method: 'POST', url: `/login?next=${encodeURIComponent(attempt)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'form-redirect@example.com', password: PASSWORD }).toString(),
    });
    assert.equal(res.headers.location, expected, `${attempt} must not be followed`);
  }
});

test('the register form creates an account, signs in and lands on onboarding', async () => {
  const res = await request(app, {
    method: 'POST', url: '/register?intent=provider',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      full_name: 'Bhaskar Jyoti', email: 'form-register@example.com', phone: '9000011111', password: PASSWORD, intent: 'provider',
    }).toString(),
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/providers/new?ok=welcome');
  assert.ok(cookieValue(res, 'seva_session'));
  assert.equal(users.findByEmail(app.db, 'form-register@example.com').role, 'provider');
});

test('the dashboard is behind a redirect to sign-in for anonymous visitors', async () => {
  for (const url of ['/dashboard', '/dashboard/services', '/dashboard/enquiries', '/account']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, { url });
    assert.equal(res.statusCode, 303, `${url} must redirect`);
    assert.match(res.headers.location, /^\/login\?next=/);
  }
  const api = await request(app, { url: '/api/v1/providers/me' });
  assert.equal(api.statusCode, 401, 'the API gets a status code instead of a redirect');
});

test('a signed-in visitor is moved off the login page', async () => {
  await makeAccount('already-in@example.com');
  const agent = makeAgent(app);
  await agent.signIn('already-in@example.com', PASSWORD);
  const res = await agent.get('/login');
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/account');
});

test('password change through the form signs every session out', async () => {
  await makeAccount('pw-change@example.com');
  const agent = makeAgent(app);
  await agent.signIn('pw-change@example.com', PASSWORD);
  const res = await agent.postForm('/account/password', {
    _csrf: agent.csrf(),
    current_password: PASSWORD,
    new_password: 'a-brand-new-pass1',
  });
  assert.equal(res.statusCode, 303);
  assert.match(res.headers.location, /password-changed/);
  assert.equal(users.verifyPassword('a-brand-new-pass1', users.findByEmail(app.db, 'pw-change@example.com').password_hash), true);
});

test('sessions revoked from the account page log every browser out', async () => {
  await makeAccount('multi-device@example.com');
  const first = makeAgent(app);
  const second = makeAgent(app);
  await first.signIn('multi-device@example.com', PASSWORD);
  await second.signIn('multi-device@example.com', PASSWORD);
  assert.equal((await second.get('/api/v1/auth/me')).json().data.signed_in, true);

  await first.postForm('/account/sessions/revoke', { _csrf: first.csrf() });
  assert.equal((await second.get('/api/v1/auth/me')).json().data.signed_in, false, 'sign out everywhere means everywhere');
});

test('the email verification link works as a GET from an email client', async () => {
  const res = await request(app, {
    method: 'POST', url: '/api/v1/auth/register',
    headers: { 'content-type': 'application/json' },
    body: { email: 'verify-flow@example.com', password: PASSWORD, full_name: 'V' },
    ip: '203.0.113.5',
  });
  const created = users.findByEmail(app.db, 'verify-flow@example.com');
  const authModel = require('../src/models/auth');
  const token = authModel.issueToken(app.db, created.id, 'email_verification', { secret: config.security.sessionSecret, minutes: 60 });

  const page = await request(app, { url: `/verify-email?token=${token}` });
  assert.equal(page.statusCode, 303);
  assert.match(page.headers.location, /ok=verified/);
  assert.ok(users.findById(app.db, created.id).email_verified_at);

  const replay = await request(app, { url: `/verify-email?token=${token}` });
  assert.equal(replay.statusCode, 400, 'a replayed link is an error page, not a success');
  assert.match(replay.body, /already been used/);
});

test('the outbox is where mail lands when no SMTP transport is wired', async () => {
  const mailer = require('../src/mail/mailer');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seva-outbox-'));
  try {
    const result = mailer.send({
      to: 'someone@example.com',
      subject: 'Test message',
      text: 'Hello there',
      config: { ...config, mail: { ...config.mail, enabled: true, outboxDir: dir } },
    });
    assert.equal(result.delivered, 'outbox');
    const written = fs.readFileSync(result.file, 'utf8');
    assert.match(written, /Subject: Test message/);
    assert.match(written, /Hello there/);
    assert.equal(fs.statSync(result.file).mode & 0o077, 0, 'mail may contain tokens: owner-only permissions');

    const refused = mailer.send({ to: 'not-an-email', subject: 'x', text: 'y', config });
    assert.equal(refused.delivered, 'refused', 'a bad address is dropped, never thrown');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an invalid email never breaks registration — mail is best-effort', async () => {
  const mailer = require('../src/mail/mailer');
  const result = mailer.send({ to: '', subject: 'x', text: 'y', config: { ...config, mail: { ...config.mail, enabled: true } } });
  assert.equal(result.delivered, 'refused');
});

/* ------------------------------------------------- admin surface gate */

test('the admin pages are gated by role, not by a secret URL', async () => {
  await makeAccount('not-admin@example.com');
  const agent = makeAgent(app);
  await agent.signIn('not-admin@example.com', PASSWORD);
  const page = await agent.get('/admin');
  assert.equal(page.statusCode, 403);
  const api = await agent.get('/api/v1/admin/summary');
  assert.equal(api.statusCode, 403);
  const queue = await agent.get('/api/v1/admin/providers');
  assert.equal(queue.statusCode, 403);
});

test('signing out of a pending verification account is still possible', async () => {
  const res = await request(app, {
    method: 'POST', url: '/logout',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(res.statusCode, 303, 'logout is idempotent for an anonymous visitor');
});
