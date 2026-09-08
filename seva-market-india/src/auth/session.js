'use strict';
/**
 * SEVA MARKET INDIA — stateless signed session cookies.
 *
 * The cookie carries a tiny signed payload ({ uid, nm, rl, exp }) — user id,
 * display name and role for the header, plus an expiry. Every value inside
 * is HMAC-SHA256 signed with the session secret, so it cannot be forged or
 * edited by a visitor. Fresh account state (status, role changes) is always
 * re-read from the store on pages that need it; the cookie is only a
 * display claim, never an authority.
 *
 * No server-side session table: logout is a client-side cookie expiry, and
 * a stolen cookie expires server-side only when the secret is rotated.
 * That is the right trade for this build, and the config comment says so.
 */

const crypto = require('node:crypto');

const COOKIE_NAME = 'smi_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Resolve the secret to sign sessions with.
 * - SESSION_SECRET from the host wins (stable across restarts).
 * - Development: a fixed dev-only secret is fine.
 * - Production without SESSION_SECRET: derive one at boot and WARN — every
 *   restart signs everyone out, which is safe but annoying; the warning
 *   tells the operator to set the variable.
 */
function sessionSecret(env = process.env, log = console.warn) {
  const explicit = String(env.SESSION_SECRET || '').trim();
  if (explicit.length >= 16) return explicit;
  if (explicit.length > 0) {
    log('[session] WARNING: SESSION_SECRET is set but shorter than 16 characters; ignoring it.');
  }
  if (env.NODE_ENV !== 'production') {
    log('[session] dev mode: using the built-in development session secret. Set SESSION_SECRET for a shared one.');
    return 'seva-market-dev-session-secret-do-not-use-in-prod';
  }
  log('[session] WARNING: SESSION_SECRET is not set. Sessions will not survive a restart — set SESSION_SECRET (32+ random characters) in the host environment.');
  return crypto.randomBytes(32).toString('hex');
}

/** Parse the raw Cookie header into a map. */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/**
 * Sign a payload into `base64url(payload).sig`.
 * @param {object} payload JSON-serialisable claims
 * @param {string} secret
 */
function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify a token; returns the payload or null. */
function verify(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  let given;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch (_) {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.uid !== 'number' || typeof payload.exp !== 'number') return null;
    if (Date.now() >= payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

/**
 * Read a request's cookie header and return the verified claims, or null.
 * @param {string|undefined} cookieHeader req.headers.cookie
 * @param {string} secret
 */
function readSession(cookieHeader, secret) {
  if (!cookieHeader || !secret) return null;
  const token = parseCookies(cookieHeader)[COOKIE_NAME];
  return verify(token, secret) || null;
}

/** The Set-Cookie value for a fresh login. */
function sessionCookie(payload, secret, { secure = false, maxAgeMs = TTL_MS } = {}) {
  const claims = {
    uid: payload.uid,
    nm: String(payload.nm || '').slice(0, 120),
    rl: String(payload.rl || 'customer').slice(0, 12),
    exp: Date.now() + maxAgeMs,
  };
  const parts = [
    `${COOKIE_NAME}=${sign(claims, secret)}`,
    'Path=/',
    'Max-Age=' + Math.floor(maxAgeMs / 1000),
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** The Set-Cookie value that deletes the session. */
function clearCookie(secure = false) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Build a session from a stored user row (columns from the users model). */
function claimsFor(user) {
  return { uid: Number(user.id), nm: user.full_name || '', rl: user.role || 'customer' };
}

module.exports = {
  COOKIE_NAME,
  TTL_MS,
  sessionSecret,
  parseCookies,
  sign,
  verify,
  readSession,
  sessionCookie,
  clearCookie,
  claimsFor,
};
