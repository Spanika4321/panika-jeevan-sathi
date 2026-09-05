/**
 * Authentication primitives.
 *
 * Passwords are hashed with scrypt (memory-hard, in the Node standard library).
 * Sessions are stateless HMAC-signed cookies: the payload carries the user id
 * and a `token_version`, so changing the version on a user invalidates every
 * session they have without needing a session table.
 */
import crypto from 'node:crypto';
import { ValidationError } from '../errors.js';

export const SESSION_COOKIE = 'sm_session';
export const MIN_PASSWORD_LENGTH = 8;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function passwordProblem(password) {
  const value = typeof password === 'string' ? password : '';
  if (value.length < MIN_PASSWORD_LENGTH) return `at least ${MIN_PASSWORD_LENGTH} characters`;
  if (value.length > 200) return 'at most 200 characters';
  if (/\s/.test(value)) return 'no spaces';
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) return 'at least one letter and one number';
  return null;
}

export function assertStrongPassword(password) {
  const problem = passwordProblem(password);
  if (problem) throw new ValidationError({ password: `Password must have ${problem}.` });
  return true;
}

export function hashPassword(password, options = SCRYPT) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, options.keylen, {
    N: options.N,
    r: options.r,
    p: options.p,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$${options.N}$${options.r}$${options.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [, n, r, p, salt, hash] = parts;
  try {
    const expected = Buffer.from(hash, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', String(secret)).update(payload).digest('base64url');
}

export function createSessionToken({ userId, tokenVersion = 1, secret, ttlHours = 720 }) {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, tv: Number(tokenVersion) || 1, exp: Date.now() + ttlHours * 3600_000 })
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded?.uid || !Number.isFinite(decoded.exp) || decoded.exp < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { isProduction = false, ttlHours = 720 } = {}) {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(1, Math.trunc(ttlHours * 3600))}`
  ];
  if (isProduction) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearSessionCookie({ isProduction = false } = {}) {
  return [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(isProduction ? ['Secure'] : [])].join(
    '; '
  );
}
