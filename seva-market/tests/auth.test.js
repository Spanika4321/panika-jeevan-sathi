import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  SESSION_COOKIE
} from '../lib/services/auth.js';

const SECRET = 'a-very-long-test-signing-secret-0123456789';

describe('session tokens', () => {
  test('a signed token round-trips', () => {
    const token = createSessionToken({ userId: 'user-1', tokenVersion: 3, secret: SECRET, ttlHours: 24 });
    const session = verifySessionToken(token, SECRET);
    assert.equal(session.uid, 'user-1');
    assert.equal(session.tv, 3);
    assert.ok(session.exp > Date.now());
  });

  test('a token signed with another secret is rejected', () => {
    const token = createSessionToken({ userId: 'user-1', secret: 'some-other-secret-value' });
    assert.equal(verifySessionToken(token, SECRET), null);
  });

  test('tampering with the payload invalidates the signature', () => {
    const token = createSessionToken({ userId: 'user-1', secret: SECRET });
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'admin-1', tv: 1, exp: Date.now() + 99999 })).toString('base64url');
    assert.equal(verifySessionToken(`${forged}.${signature}`, SECRET), null);
    assert.ok(verifySessionToken(`${payload}.${signature}`, SECRET));
  });

  test('expired tokens are refused', () => {
    const token = createSessionToken({ userId: 'user-1', secret: SECRET, ttlHours: -1 });
    assert.equal(verifySessionToken(token, SECRET), null);
  });

  test('malformed input never throws', () => {
    for (const value of ['', '.', 'a.b', 'not-a-token', null, undefined, 42]) {
      assert.equal(verifySessionToken(value, SECRET), null);
    }
  });
});

describe('cookies', () => {
  test('parseCookies handles a realistic header', () => {
    const cookies = parseCookies(`a=1; ${SESSION_COOKIE}=abc.def; b=hello%20world; broken`);
    assert.equal(cookies.a, '1');
    assert.equal(cookies[SESSION_COOKIE], 'abc.def');
    assert.equal(cookies.b, 'hello world');
  });

  test('the session cookie is HttpOnly and SameSite=Lax', () => {
    const cookie = sessionCookie('abc.def', { isProduction: false, ttlHours: 24 });
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=86400/);
    assert.doesNotMatch(cookie, /Secure/, 'Secure is only set in production');
  });

  test('production adds the Secure attribute', () => {
    assert.match(sessionCookie('abc.def', { isProduction: true }), /Secure/);
  });

  test('clearing sets an empty, immediately expiring cookie', () => {
    const cookie = clearSessionCookie({ isProduction: true });
    assert.match(cookie, new RegExp(`${SESSION_COOKIE}=;`));
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /Secure/);
  });
});

describe('password hashing', () => {
  test('the hash records its parameters so they can be upgraded later', () => {
    const hash = hashPassword('strongpass1');
    const parts = hash.split('$');
    assert.equal(parts[0], 'scrypt');
    assert.equal(parts.length, 6);
    assert.equal(Number(parts[1]), 16384, 'N');
  });

  test('verification is constant-time and fails closed on junk', () => {
    const hash = hashPassword('strongpass1');
    const started = Date.now();
    for (let i = 0; i < 20; i += 1) verifyPassword('strongpass1', hash);
    assert.ok(Date.now() - started < 5000, 'scrypt stays within a sane cost budget');
    assert.equal(verifyPassword('', hash), false);
    assert.equal(verifyPassword('strongpass1', ''), false);
    assert.equal(verifyPassword('strongpass1', 'scrypt$broken'), false);
  });
});
