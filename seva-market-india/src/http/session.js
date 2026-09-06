'use strict';
/**
 * SEVA MARKET INDIA — HTTP session + cookie helpers.
 *
 * Cookie parsing/serialisation is tiny and dependency-free. The session
 * *state* lives in the database (see src/models/session.js); here we only
 * read the token off the request and build the Set-Cookie header for the
 * response. SameSite=Lax + HttpOnly are always on; `Secure` only when the
 * site runs over HTTPS in production.
 */

const sessionModel = require('../models/session');

/** Parse a raw Cookie header into a plain object. */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/** Build a Set-Cookie header value. */
function serializeCookie(name, value, { maxAgeSeconds, path = '/', httpOnly = true, secure = false, sameSite = 'Lax' } = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) cookie += '; HttpOnly';
  if (secure) cookie += '; Secure';
  if (maxAgeSeconds !== undefined && maxAgeSeconds !== null) {
    cookie += `; Max-Age=${Math.trunc(maxAgeSeconds)}`;
  }
  return cookie;
}

/** Read the raw session token off a request's Cookie header. */
function readToken(req, cookieName = 'seva_sid') {
  const cookies = parseCookies(req?.headers?.cookie);
  return cookies[cookieName] || null;
}

/**
 * Resolve the current user from the request cookie, or null.
 * Wired into the request context so every page/route can read `ctx.user`.
 */
function userFromRequest(req, { db, cookieName = 'seva_sid' } = {}) {
  const token = readToken(req, cookieName);
  return token ? sessionModel.userByToken(db, token) : null;
}

/** The current raw session token, for building a logout/look-up. */
function tokenFromRequest(req, cookieName = 'seva_sid') {
  return readToken(req, cookieName);
}

module.exports = {
  parseCookies,
  serializeCookie,
  readToken,
  tokenFromRequest,
  userFromRequest,
};
