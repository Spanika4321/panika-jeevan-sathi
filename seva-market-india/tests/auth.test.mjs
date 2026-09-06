/**
 * SEVA MARKET INDIA — authentication unit tests.
 *
 * These cover the primitives at model level, where the interesting failures
 * live: what a session really is, when a token stops working, and what the
 * throttle counts. The HTTP behaviour on top of them is `auth-http.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeDb } from './helpers.mjs';

const require = createRequire(import.meta.url);
const users = require('../src/models/user');
const auth = require('../src/models/auth');
const actions = require('../src/actions/auth');
const config = require('../src/config');

const SECRET = 'unit-test-secret';

function testConfig(overrides = {}) {
  return {
    ...config,
    security: { ...config.security, sessionSecret: SECRET },
    auth: { ...config.auth, requireEmailVerification: false, minPasswordLength: 8 },
    onboarding: { ...config.onboarding, autoApprove: true },
    mail: { ...config.mail, enabled: false },
    ...overrides,
  };
}

/* --------------------------------------------------------- passwords */

test('the password policy requires length, a letter and a number', () => {
  assert.equal(users.passwordProblem('short1'), 'Password must be at least 8 characters.');
  assert.equal(users.passwordProblem('alllettersonly'), 'Password must contain at least one number.');
  assert.equal(users.passwordProblem('12345678'), 'Password must contain at least one letter.');
  assert.equal(users.passwordProblem('seva-market1'), null);
  assert.equal(users.passwordProblem('x'.repeat(2000)).includes('1024'), true);
});

test('a hash is salted, self-describing and never the password', () => {
  const { db } = makeDb({ withSeed: false });
  const first = users.hashPassword('seva-market1');
  const second = users.hashPassword('seva-market1');
  assert.notEqual(first, second, 'a random salt must make identical passwords differ');
  assert.match(first, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(!first.includes('seva-market1'));
  assert.equal(users.verifyPassword('seva-market1', first), true);
  assert.equal(users.verifyPassword('seva-market2', first), false);
  db.close();
});

test('verifyPassword survives garbage input instead of throwing', () => {
  assert.equal(users.verifyPassword('whatever', null), false);
  assert.equal(users.verifyPassword('whatever', 'scrypt$nope'), false);
  assert.equal(users.verifyPassword(undefined, 'scrypt$2$1$1$ff$ff'), false);
});

/* --------------------------------------------------------- accounts */

test('creating an account stores a hash and lower-cases the email', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig();
  const result = actions.registerAccount(db, cfg, {
    email: 'Ravi@Example.COM',
    password: 'seva-market1',
    fullName: 'Ravi Das',
    phone: '+91 90000 11111',
  });
  assert.equal(result.ok, true);
  assert.equal(result.user.email, 'ravi@example.com');
  assert.equal(result.user.status, 'active', 'verification is not mandatory here');
  const row = db.get('SELECT password_hash FROM users WHERE id = ?', [result.user.id]);
  assert.match(row.password_hash, /^scrypt\$/);
  db.close();
});

test('a duplicate email is refused with a field error, not a stack trace', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig();
  actions.registerAccount(db, cfg, { email: 'dup@example.com', password: 'seva-market1', fullName: 'One' });
  const second = actions.registerAccount(db, cfg, { email: 'DUP@example.com', password: 'seva-market1', fullName: 'Two' });
  assert.equal(second.ok, false);
  assert.match(second.errors.email, /already exists/);
  db.close();
});

test('role escalation is impossible through the register action', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig();
  const result = actions.registerAccount(db, cfg, {
    email: 'sneak@example.com', password: 'seva-market1', fullName: 'Sneak', role: 'admin',
  });
  assert.equal(result.ok, true);
  assert.equal(result.user.role, 'customer', 'an admin is created by config, never by a form');
  db.close();
});

test('mandatory verification leaves the account pending and returns no session', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig({ auth: { ...config.auth, requireEmailVerification: true, minPasswordLength: 8 } });
  const result = actions.registerAccount(db, cfg, { email: 'wait@example.com', password: 'seva-market1', fullName: 'Wait' });
  assert.equal(result.requiresVerification, true);
  assert.equal(result.user.status, 'pending');
  const login = actions.login(db, cfg, { email: 'wait@example.com', password: 'seva-market1' });
  assert.equal(login.ok, false);
  assert.equal(login.status, 403);
  assert.equal(login.unverified, true);
  db.close();
});

/* -------------------------------------------------------- sessions */

test('a session resolves to its user and stores only a hash of the token', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 's@ex.co', fullName: 'S', password: 'seva-market1', role: 'customer', status: 'active' });
  const session = auth.createSession(db, user.id, { secret: SECRET, ip: '1.2.3.4' });

  const stored = db.get('SELECT token_hash, ip_hash FROM sessions WHERE id = ?', [session.id]);
  assert.ok(stored.token_hash.length === 64, 'token_hash must be an HMAC digest, not the token');
  assert.ok(!stored.token_hash.includes(session.token.slice(0, 8)));
  assert.notEqual(stored.ip_hash, '1.2.3.4', 'the client IP is never stored raw');

  const found = auth.readSession(db, session.token, SECRET);
  assert.equal(found.user.id, user.id);
  assert.equal(found.user.email, 's@ex.co');
  db.close();
});

test('an unknown, forged or wrong-secret token resolves to nothing', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 's2@ex.co', fullName: 'S', password: 'seva-market1', status: 'active' });
  const session = auth.createSession(db, user.id, { secret: SECRET });
  assert.equal(auth.readSession(db, '', SECRET), null);
  assert.equal(auth.readSession(db, 'x'.repeat(64), SECRET), null);
  assert.equal(auth.readSession(db, session.token, 'other-secret'), null, 'another server must not accept our cookie');
  db.close();
});

test('logout revokes the session immediately', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 's3@ex.co', fullName: 'S', password: 'seva-market1', status: 'active' });
  const session = auth.createSession(db, user.id, { secret: SECRET });
  assert.ok(auth.readSession(db, session.token, SECRET));
  auth.revokeSessionByToken(db, session.token, SECRET);
  assert.equal(auth.readSession(db, session.token, SECRET), null);
  db.close();
});

test('an expired session row is deleted on read, not kept forever', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 's4@ex.co', fullName: 'S', password: 'seva-market1', status: 'active' });
  const session = auth.createSession(db, user.id, { secret: SECRET });
  db.run('UPDATE sessions SET expires_at = ? WHERE id = ?', ['2000-01-01T00:00:00.000Z', session.id]);
  assert.equal(auth.readSession(db, session.token, SECRET), null);
  assert.equal(db.scalar('SELECT COUNT(*) FROM sessions'), 0);
  db.close();
});

test('a suspended account loses every live session on the next request', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 's5@ex.co', fullName: 'S', password: 'seva-market1', status: 'active' });
  const session = auth.createSession(db, user.id, { secret: SECRET });
  assert.ok(auth.readSession(db, session.token, SECRET));
  users.setStatus(db, user.id, 'suspended');
  assert.equal(auth.readSession(db, session.token, SECRET), null);
  assert.ok(db.get('SELECT revoked_at FROM sessions WHERE id = ?', [session.id]).revoked_at);
  db.close();
});

test('revoking all sessions covers password changes and resets', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 's6@ex.co', fullName: 'S', password: 'seva-market1', status: 'active' });
  const tokens = [1, 2, 3].map(() => auth.createSession(db, user.id, { secret: SECRET }).token);
  assert.equal(auth.activeSessionCount(db, user.id), 3);
  assert.equal(auth.revokeAllSessions(db, user.id), 3);
  for (const token of tokens) assert.equal(auth.readSession(db, token, SECRET), null);
  db.close();
});

/* ------------------------------------------------ CSRF token binding */

test('the CSRF proof is derived from the session and not guessable', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 'c1@ex.co', fullName: 'C', password: 'seva-market1', status: 'active' });
  const session = auth.createSession(db, user.id, { secret: SECRET });
  const token = auth.csrfTokenFor(session.token, SECRET);

  assert.ok(token.length >= 32);
  assert.notEqual(token, session.token, 'the proof must not be the secret itself');
  assert.equal(auth.csrfTokenMatches(session.token, token, SECRET), true);
  assert.equal(auth.csrfTokenMatches(session.token, 'wrong', SECRET), false);
  assert.equal(auth.csrfTokenMatches(session.token, '', SECRET), false);
  assert.equal(auth.csrfTokenMatches(session.token, undefined, SECRET), false);
  assert.equal(auth.csrfTokenMatches(null, token, SECRET), false);
  assert.equal(auth.csrfTokenMatches(session.token, token, 'other-secret'), false);
  db.close();
});

/* ------------------------------------------------------- auth tokens */

test('an email verification token works once and only for its purpose', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 'v1@ex.co', fullName: 'V', password: 'seva-market1' });
  const token = auth.issueToken(db, user.id, 'email_verification', { secret: SECRET, minutes: 60 });

  assert.equal(auth.consumeToken(db, token, 'password_reset', { secret: SECRET }).valid, false, 'a verify token must not reset a password');
  const first = auth.consumeToken(db, token, 'email_verification', { secret: SECRET });
  assert.equal(first.valid, true);
  assert.equal(first.userId, user.id);
  const replay = auth.consumeToken(db, token, 'email_verification', { secret: SECRET });
  assert.equal(replay.valid, false);
  assert.equal(replay.reason, 'used');
  db.close();
});

test('issuing a new token voids the previous one', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 'v2@ex.co', fullName: 'V', password: 'seva-market1' });
  const oldToken = auth.issueToken(db, user.id, 'password_reset', { secret: SECRET, minutes: 60 });
  auth.issueToken(db, user.id, 'password_reset', { secret: SECRET, minutes: 60 });
  assert.equal(auth.consumeToken(db, oldToken, 'password_reset', { secret: SECRET }).reason, 'used');
  db.close();
});

test('an expired token reports "expired" and cannot be consumed', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 'v3@ex.co', fullName: 'V', password: 'seva-market1' });
  const token = auth.issueToken(db, user.id, 'password_reset', { secret: SECRET, minutes: 60 });
  db.run(`UPDATE auth_tokens SET expires_at = '2000-01-01T00:00:00.000Z'`);
  const result = auth.consumeToken(db, token, 'password_reset', { secret: SECRET });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired');
  db.close();
});

test('token purposes are a closed set', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 'v4@ex.co', fullName: 'V', password: 'seva-market1' });
  assert.throws(() => auth.issueToken(db, user.id, 'magic_link', { secret: SECRET }), /Unknown token purpose/);
  db.close();
});

/* ---------------------------------------------------------- verify */

test('following a verification link activates the account exactly once', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig({ auth: { ...config.auth, requireEmailVerification: true, minPasswordLength: 8 } });
  const created = actions.registerAccount(db, cfg, { email: 'v5@ex.co', password: 'seva-market1', fullName: 'V' });
  const user = users.findById(db, created.user.id);
  assert.equal(user.status, 'pending');

  const verified = actions.verifyEmail(db, cfg, created.debugToken);
  assert.equal(verified.ok, true);
  assert.equal(users.findById(db, user.id).status, 'active');
  assert.ok(users.findById(db, user.id).email_verified_at);

  const again = actions.verifyEmail(db, cfg, created.debugToken);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'used');
  db.close();
});

test('a nonsense token is rejected without distinguishing anything', () => {
  const { db } = makeDb({ withSeed: false });
  const result = actions.verifyEmail(db, testConfig(), 'deadbeef');
  assert.equal(result.ok, false);
  assert.match(result.error, /not valid/);
  db.close();
});

/* ------------------------------------------------------ password flow */

test('a reset changes the password, kills other sessions and voids the link', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig();
  actions.registerAccount(db, cfg, { email: 'p1@ex.co', password: 'seva-market1', fullName: 'P' });
  const account = users.findByEmail(db, 'p1@ex.co');
  const session = auth.createSession(db, account.id, { secret: SECRET });
  const other = auth.createSession(db, account.id, { secret: SECRET });

  const request = actions.requestPasswordReset(db, cfg, { email: 'p1@ex.co' });
  assert.equal(request.ok, true);
  const confirm = actions.confirmPasswordReset(db, cfg, { token: request.debugToken, password: 'brand-new-pass1' });
  assert.equal(confirm.ok, true);
  assert.equal(confirm.sessionsRevoked, 2);
  assert.equal(auth.readSession(db, session.token, SECRET), null);
  assert.equal(auth.readSession(db, other.token, SECRET), null);

  assert.equal(actions.login(db, cfg, { email: 'p1@ex.co', password: 'seva-market1' }).ok, false, 'the old password must stop working');
  assert.equal(actions.login(db, cfg, { email: 'p1@ex.co', password: 'brand-new-pass1' }).ok, true);
  assert.equal(auth.consumeToken(db, request.debugToken, 'password_reset', { secret: SECRET }).valid, false);
  db.close();
});

test('the forgot-password answer is identical for a missing account', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig();
  actions.registerAccount(db, cfg, { email: 'known@ex.co', password: 'seva-market1', fullName: 'K' });
  const known = actions.requestPasswordReset(db, cfg, { email: 'known@ex.co' });
  const unknown = actions.requestPasswordReset(db, cfg, { email: 'nobody@ex.co' });
  assert.equal(known.ok, unknown.ok);
  assert.equal(known.sent, true);
  assert.equal(unknown.sent, false);
  // The server-side object differs (there is nothing to send to), but the
  // keys and the HTTP-visible answer do not — `auth-http.test.mjs` asserts
  // the response body is byte-identical for both addresses.
  assert.equal(Object.keys(unknown).sort().join(','), Object.keys(known).sort().join(','), 'same keys, same shape');
  assert.equal(unknown.debugToken, null);
  assert.ok(known.debugToken);
  db.close();
});

test('a weak or reused password is refused on change, and the current one is checked', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig();
  const created = actions.registerAccount(db, cfg, { email: 'p2@ex.co', password: 'seva-market1', fullName: 'P' });
  const id = created.user.id;

  assert.equal(actions.changePassword(db, cfg, { userId: id, currentPassword: 'wrong-one1', newPassword: 'another-pass1' }).ok, false);
  const weak = actions.changePassword(db, cfg, { userId: id, currentPassword: 'seva-market1', newPassword: 'abc' });
  assert.equal(weak.ok, false);
  assert.match(weak.errors.new_password, /at least 8/);
  const same = actions.changePassword(db, cfg, { userId: id, currentPassword: 'seva-market1', newPassword: 'seva-market1' });
  assert.equal(same.ok, false);
  assert.match(same.errors.new_password, /not used here before/);

  const good = actions.changePassword(db, cfg, { userId: id, currentPassword: 'seva-market1', newPassword: 'another-pass1' });
  assert.equal(good.ok, true);
  assert.equal(users.verifyPassword('another-pass1', db.get('SELECT password_hash FROM users WHERE id = ?', [id]).password_hash), true);
  db.close();
});

/* ------------------------------------------------------------ login */

test('a wrong password and an unknown email are indistinguishable', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig();
  actions.registerAccount(db, cfg, { email: 'l1@ex.co', password: 'seva-market1', fullName: 'L' });
  const wrongPassword = actions.login(db, cfg, { email: 'l1@ex.co', password: 'not-it-at-all1' });
  const noAccount = actions.login(db, cfg, { email: 'ghost@ex.co', password: 'not-it-at-all1' });
  assert.equal(wrongPassword.ok, false);
  assert.equal(noAccount.ok, false);
  assert.equal(wrongPassword.errors.password, noAccount.errors.password, 'the message must not reveal whether the account exists');
  assert.equal(wrongPassword.status, 401);
  assert.equal(noAccount.status, 401);
  db.close();
});

test('the throttle blocks after the configured attempts and then clears', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig({ auth: { ...config.auth, loginMaxAttempts: 3, loginWindowMinutes: 15, minPasswordLength: 8 } });
  actions.registerAccount(db, cfg, { email: 'l2@ex.co', password: 'seva-market1', fullName: 'L' });

  for (let i = 0; i < 3; i += 1) {
    const attempt = actions.login(db, cfg, { email: 'l2@ex.co', password: 'bad-password1', ip: '9.9.9.9' });
    assert.equal(attempt.status, 401);
  }
  const blocked = actions.login(db, cfg, { email: 'l2@ex.co', password: 'seva-market1', ip: '9.9.9.9' });
  assert.equal(blocked.ok, false, 'the correct password is refused while blocked');
  assert.equal(blocked.status, 429);
  assert.ok(blocked.retryAfterSeconds > 0);

  // A different connection is unaffected: the key is email + IP.
  assert.equal(actions.login(db, cfg, { email: 'l2@ex.co', password: 'seva-market1', ip: '8.8.8.8' }).ok, true);
  db.close();
});

test('a successful sign-in clears the failure counter', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig();
  actions.registerAccount(db, cfg, { email: 'l3@ex.co', password: 'seva-market1', fullName: 'L' });
  actions.login(db, cfg, { email: 'l3@ex.co', password: 'bad1', ip: '7.7.7.7' });
  assert.equal(actions.login(db, cfg, { email: 'l3@ex.co', password: 'seva-market1', ip: '7.7.7.7' }).ok, true);
  const key = auth.throttleKey('l3@ex.co', '7.7.7.7', SECRET);
  assert.equal(auth.checkThrottle(db, key, { windowMinutes: 15, maxAttempts: 10 }).attempts, 0);
  db.close();
});

test('the throttle key never stores the email or the IP', () => {
  const key = auth.throttleKey('someone@example.com', '1.2.3.4', SECRET);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.ok(!key.includes('someone'));
  assert.ok(!key.includes('1.2.3.4'));
});

test('a suspended account cannot sign in', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig();
  const created = actions.registerAccount(db, cfg, { email: 'l4@ex.co', password: 'seva-market1', fullName: 'L' });
  users.setStatus(db, created.user.id, 'suspended');
  const attempt = actions.login(db, cfg, { email: 'l4@ex.co', password: 'seva-market1' });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.status, 403);
  assert.match(attempt.errors.email, /suspended/);
  db.close();
});

/* -------------------------------------------------------- the admin */

test('the administrator is created once and only from configuration', () => {
  const { db } = makeDb({ withSeed: false });
  assert.equal(users.ensureAdmin(db, { email: '', password: '' }), null, 'nothing happens without config');
  const created = users.ensureAdmin(db, { email: 'admin@ex.co', password: 'first-admin-pass1' });
  assert.equal(created.created, true);
  const row = db.get('SELECT role, status, email_verified_at FROM users WHERE id = ?', [created.id]);
  assert.equal(row.role, 'admin');
  assert.equal(row.status, 'active');
  assert.ok(row.email_verified_at, 'the seed admin is verified: there is no inbox to click');

  const again = users.ensureAdmin(db, { email: 'ADMIN@ex.co', password: 'a-different-pass1' });
  assert.equal(again.created, false);
  assert.equal(db.scalar('SELECT COUNT(*) FROM users'), 1, 'a reboot must not create a second admin');
  db.close();
});

test('an existing account is promoted rather than re-created', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 'promote@ex.co', fullName: 'P', password: 'seva-market1', status: 'active' });
  const result = users.ensureAdmin(db, { email: 'promote@ex.co', password: 'ignored-because-existing1' });
  assert.equal(result.id, user.id);
  assert.equal(db.get('SELECT role FROM users WHERE id = ?', [user.id]).role, 'admin');
  assert.equal(users.verifyPassword('seva-market1', db.get('SELECT password_hash FROM users WHERE id = ?', [user.id]).password_hash), true, 'an existing password must not be overwritten');
  db.close();
});

/* -------------------------------------------------------- housekeeping */

test('purging drops dead sessions, revoked sessions and stale tokens', () => {
  const { db } = makeDb({ withSeed: false });
  const { user } = users.createUser(db, { email: 'h1@ex.co', fullName: 'H', password: 'seva-market1', status: 'active' });
  const live = auth.createSession(db, user.id, { secret: SECRET });
  const dead = auth.createSession(db, user.id, { secret: SECRET });
  db.run('UPDATE sessions SET expires_at = ? WHERE id = ?', ['2001-01-01T00:00:00.000Z', dead.id]);
  const token = auth.issueToken(db, user.id, 'password_reset', { secret: SECRET, minutes: 1 });
  db.run(`UPDATE auth_tokens SET expires_at = '2001-01-01T00:00:00.000Z'`);

  const purged = auth.purgeExpired(db);
  assert.equal(purged.sessions, 1, 'only the dead session goes');
  assert.equal(purged.tokens, 1, 'an expired, never-used token has no future use');
  assert.ok(auth.readSession(db, live.token, SECRET), 'a live session survives housekeeping');
  assert.equal(db.scalar('SELECT COUNT(*) FROM sessions'), 1);
  assert.equal(db.scalar('SELECT COUNT(*) FROM auth_tokens'), 0);
  db.close();
});

test('audit rows are written for the actions that matter', () => {
  const { db } = makeDb({ withSeed: false });
  const cfg = testConfig();
  const created = actions.registerAccount(db, cfg, { email: 'a1@ex.co', password: 'seva-market1', fullName: 'A' });
  actions.login(db, cfg, { email: 'a1@ex.co', password: 'seva-market1', ip: '5.5.5.5' });
  const rows = db.all('SELECT action, actor FROM audit_logs ORDER BY id');
  assert.deepEqual(rows.map((row) => row.action), ['account.register', 'auth.login']);
  assert.match(rows[0].actor, /^user:/);
  db.close();
});
