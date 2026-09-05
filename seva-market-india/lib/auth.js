'use strict';
/**
 * SEVA MARKET INDIA — passwords and sessions.
 *
 * scrypt password hashing (Node core), server-side session records in the
 * database so logout / suspension really ends a session. No JWT, no third
 * party dependency, nothing secret is sent to the browser.
 */

const crypto = require('node:crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_COOKIE = 'smi_session';
const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(String(expected), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Creates a session row and returns { token, expires_at }. */
function createSession(db, userId) {
  const token = newToken();
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * 86400000;
  db.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [token, userId, now, expiresAt]);
  return { token, expiresAt };
}

function userForRequest(db, cookieValue) {
  const token = String(cookieValue || '').trim();
  if (!token) return null;
  const row = db.get(
    `SELECT u.*, p.id AS provider_id, p.status AS provider_status, p.business_name
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN providers p ON p.user_id = u.id
      WHERE s.token = ? AND s.expires_at > ?`,
    [token, Date.now()]
  );
  if (!row) return null;
  if (row.status !== 'active') return null;
  return row;
}

function destroySession(db, token) {
  if (token) db.run('DELETE FROM sessions WHERE token = ?', [String(token).trim()]);
}

function destroyUserSessions(db, userId) {
  db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

function purgeExpiredSessions(db) {
  db.run('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()]);
}

function cookieHeader(token, expiresAt) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + SESSION_DAYS * 86400,
    'Expires=' + new Date(expiresAt).toUTCString()
  ];
  return parts.join('; ');
}

function clearCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function readCookie(headerValue, name = SESSION_COOKIE) {
  const raw = String(headerValue || '');
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return '';
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  userForRequest,
  destroySession,
  destroyUserSessions,
  purgeExpiredSessions,
  cookieHeader,
  clearCookieHeader,
  readCookie
};
