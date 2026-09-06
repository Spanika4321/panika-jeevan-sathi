'use strict';
/**
 * SEVA MARKET INDIA — session model.
 *
 * Server-side login sessions. A random token is issued to the client as an
 * HttpOnly cookie; only its SHA-256 hash is stored, so a database leak can
 * never be replayed as a live cookie. Storing sessions server-side means a
 * logout (or an administrator suspending a user) revokes access immediately.
 */

const crypto = require('node:crypto');

const USER_COLUMNS = 'id, email, full_name, role, status, email_verified_at';

/** Expiry timestamp, `ttlSeconds` from now, ISO-8601 UTC. */
function expiresAt(ttlSeconds) {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

/** SHA-256 of the token — what we store, never the token itself. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** A new random session token. */
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Create a session for a user. Requires an active account.
 * @returns {{id:number, token:string, expires_at:string}}
 */
function create(db, userId, { ttlSeconds = 30 * 24 * 60 * 60 } = {}) {
  const user = db.get('SELECT id, status FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('Unknown user.');
  if (user.status !== 'active') throw new Error('Account is not active.');

  const token = newToken();
  const expiry = expiresAt(ttlSeconds);
  const result = db.run(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [userId, hashToken(token), expiry],
  );
  return { id: Number(result.lastInsertRowid), token, expires_at: expiry };
}

/**
 * Resolve a token to its active user, or null. Expired sessions are deleted
 * opportunistically (cheap, and keeps the table from growing without a
 * background job).
 */
function userByToken(db, token) {
  if (!token || typeof token !== 'string') return null;
  const hash = hashToken(token);
  const row = db.get(
    `SELECT s.id AS session_id, s.expires_at, u.${USER_COLUMNS}
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [hash],
  );
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    destroy(db, token);
    return null;
  }
  if (row.status !== 'active') return null;
  db.run(
    `UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    [row.session_id],
  );
  const { session_id, expires_at, ...user } = row;
  return user;
}

/** Destroy a session (logout, or to force a re-login). */
function destroy(db, token) {
  if (!token) return false;
  const result = db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  return Number(result.changes) > 0;
}

/** Delete every session for a user (used when a user is suspended). */
function destroyForUser(db, userId) {
  db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

/** Purge all expired sessions; returns how many were removed. */
function cleanupExpired(db) {
  const now = new Date().toISOString();
  const result = db.run('DELETE FROM sessions WHERE expires_at <= ?', [now]);
  return Number(result.changes || 0);
}

function count(db) {
  return Number(db.scalar('SELECT COUNT(*) FROM sessions') ?? 0);
}

module.exports = {
  USER_COLUMNS,
  create,
  userByToken,
  destroy,
  destroyForUser,
  cleanupExpired,
  count,
};
