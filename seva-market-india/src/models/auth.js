'use strict';
/**
 * SEVA MARKET INDIA — authentication data layer.
 *
 * Owns three things the app must get exactly right:
 *   1. sessions  — random token in the browser, HMAC of it in the database;
 *   2. tokens    — single-use, expiring, hashed the same way, for email
 *                  verification and password reset;
 *   3. throttle  — a per email+IP failure counter that exists precisely
 *                  because there is no session yet to rate-limit.
 *
 * Nothing here touches `req`/`res`; that lives in `src/http/auth.js`.
 */

const crypto = require('node:crypto');

const TOKEN_BYTES = 32;

/* --------------------------------------------------------------- keys */

/** Domain separation: the same secret must not serve two purposes. */
function mac(value, secret, purpose) {
  return crypto
    .createHmac('sha256', secret || 'seva-market-dev-secret')
    .update(`${purpose}\u0000${value}`)
    .digest('hex');
}

/** Hash a bearer token for storage. Never store the token itself. */
function hashToken(token, secret = '') {
  return mac(String(token), secret, 'session');
}

/** Hash an email-verification / password-reset token. */
function hashPurposeToken(token, secret = '') {
  return mac(String(token), secret, 'auth-token');
}

/** A CSRF proof bound to the session token the attacker cannot read. */
function csrfTokenFor(sessionToken, secret = '') {
  return crypto
    .createHmac('sha256', secret || 'seva-market-dev-secret')
    .update(`csrf\u0000${String(sessionToken)}`)
    .digest('base64url');
}

/** Constant-time comparison of two CSRF proofs. */
function csrfTokenMatches(sessionToken, submitted, secret = '') {
  if (!sessionToken || typeof submitted !== 'string' || !submitted) return false;
  const expected = Buffer.from(csrfTokenFor(sessionToken, secret));
  const actual = Buffer.from(submitted);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Deterministic key for the login throttle: no raw email or IP is stored. */
function throttleKey(email, ip, secret = '') {
  return crypto
    .createHash('sha256')
    .update(`${String(email || '').toLowerCase()}|${String(ip || '')}|${secret}`)
    .digest('hex');
}

function randomToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function isoIn(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/* ------------------------------------------------------------ sessions */

/**
 * Create a session row and return the raw token for the cookie.
 * @param {import('../db/client').Database} db
 */
function createSession(db, userId, { ip = null, userAgent = null, secret = '', days = 30 } = {}) {
  const token = randomToken();
  const inserted = db.run(
    `INSERT INTO sessions (token_hash, user_id, ip_hash, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      hashToken(token, secret),
      userId,
      ip ? mac(String(ip), secret, 'ip') : null,
      typeof userAgent === 'string' ? userAgent.slice(0, 256) : null,
      isoIn(days * 24 * 60),
    ],
  );
  return { token, id: Number(inserted.lastInsertRowid) };
}

/**
 * Resolve a bearer token to `{ session, user }`, or null when it is unknown,
 * revoked or expired. Expired rows are deleted lazily on read, so the table
 * cannot grow forever on a machine that never restarts.
 */
function readSession(db, token, secret = '') {
  if (!token) return null;
  const hash = hashToken(token, secret);
  const row = db.get(
    `SELECT sessions.id, sessions.user_id, sessions.expires_at, sessions.revoked_at,
            users.email, users.full_name, users.role, users.status, users.email_verified_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?`,
    [hash],
  );
  if (!row) return null;
  if (row.revoked_at || row.expires_at <= new Date().toISOString()) {
    db.run('DELETE FROM sessions WHERE id = ?', [row.id]);
    return null;
  }
  if (row.status !== 'active') {
    // Suspension must take effect immediately, not at the next login.
    revokeSession(db, row.id, 'account_not_active');
    return null;
  }
  // Touch the session at most once every five minutes: an unconditional write
  // per request turns every page view into a database write.
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  db.run(
    `UPDATE sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?`,
    [new Date().toISOString(), row.id, staleBefore],
  );
  return {
    session: { id: row.id, user_id: row.user_id, expires_at: row.expires_at },
    user: {
      id: row.user_id,
      email: row.email,
      full_name: row.full_name,
      role: row.role,
      status: row.status,
      email_verified_at: row.email_verified_at,
    },
  };
}

function revokeSession(db, sessionId, _reason = null) {
  return db.run(
    `UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [sessionId],
  );
}

function revokeSessionByToken(db, token, secret = '') {
  return db.run(
    `UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE token_hash = ? AND revoked_at IS NULL`,
    [hashToken(token, secret)],
  );
}

/** Used on password change / reset / suspension: sign everything out. */
function revokeAllSessions(db, userId) {
  const result = db.run(
    `UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE user_id = ? AND revoked_at IS NULL`,
    [userId],
  );
  return Number(result.changes ?? 0);
}

function activeSessionCount(db, userId) {
  return Number(
    db.scalar(
      `SELECT COUNT(*) FROM sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
      [userId, new Date().toISOString()],
    ) ?? 0,
  );
}

/** Housekeeping hook for a cron or the admin panel. */
function purgeExpired(db) {
  const now = new Date().toISOString();
  const sessions = db.run('DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL', [now]);
  const tokens = db.run('DELETE FROM auth_tokens WHERE expires_at <= ? AND used_at IS NULL', [now]);
  return {
    sessions: Number(sessions.changes ?? 0),
    tokens: Number(tokens.changes ?? 0),
  };
}

/* ---------------------------------------------------- single-use tokens */

const PURPOSES = ['email_verification', 'password_reset'];

/**
 * Issue a token for a user. Any earlier unconsumed token for the same
 * purpose is voided first, so "forgot password" twice cannot leave two
 * live links in an inbox.
 */
function issueToken(db, userId, purpose, { secret = '', minutes = 60 } = {}) {
  if (!PURPOSES.includes(purpose)) throw new Error(`Unknown token purpose: ${purpose}`);
  db.run(
    `UPDATE auth_tokens SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE user_id = ? AND purpose = ? AND used_at IS NULL`,
    [userId, purpose],
  );
  const token = randomToken();
  db.run(
    'INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [userId, purpose, hashPurposeToken(token, secret), isoIn(minutes)],
  );
  return token;
}

/**
 * Consume a token. Returns `{ valid:false, reason }` for every failure mode
 * with the same shape, so no caller can leak which part was wrong.
 */
function consumeToken(db, token, purpose, { secret = '' } = {}) {
  if (!token || typeof token !== 'string') return { valid: false, reason: 'invalid' };
  const row = db.get(
    `SELECT id, user_id, expires_at, used_at FROM auth_tokens
     WHERE token_hash = ? AND purpose = ?`,
    [hashPurposeToken(token, secret), purpose],
  );
  if (!row) return { valid: false, reason: 'invalid' };
  if (row.used_at) return { valid: false, reason: 'used' };
  if (row.expires_at <= new Date().toISOString()) {
    db.run(`UPDATE auth_tokens SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [row.id]);
    return { valid: false, reason: 'expired' };
  }
  db.run(
    `UPDATE auth_tokens SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [row.id],
  );
  return { valid: true, userId: Number(row.user_id) };
}

/* ----------------------------------------------------------- throttle */

/**
 * Is this email+IP pair currently blocked from attempting a login?
 * @returns {{blocked: boolean, attempts: number, retryAfterSeconds: number}}
 */
function checkThrottle(db, key, { windowMinutes = 15, maxAttempts = 10 } = {}) {
  const row = db.get('SELECT attempts, last_at, blocked_until FROM login_throttle WHERE key = ?', [key]);
  if (!row) return { blocked: false, attempts: 0, retryAfterSeconds: 0 };

  const now = Date.now();
  if (row.blocked_until) {
    const until = Date.parse(row.blocked_until);
    if (Number.isFinite(until) && until > now) {
      return { blocked: true, attempts: Number(row.attempts), retryAfterSeconds: Math.ceil((until - now) / 1000) };
    }
    // The penalty has been served: start from clean.
    db.run('DELETE FROM login_throttle WHERE key = ?', [key]);
    return { blocked: false, attempts: 0, retryAfterSeconds: 0 };
  }

  const last = Date.parse(row.last_at);
  if (!Number.isFinite(last) || now - last > windowMinutes * 60_000) {
    return { blocked: false, attempts: 0, retryAfterSeconds: 0 };
  }
  return { blocked: Number(row.attempts) >= maxAttempts, attempts: Number(row.attempts), retryAfterSeconds: 0 };
}

/**
 * Count one failed attempt. Repeated failures keep extending the lockout by
 * exactly one window, so a blocked attacker cannot reset it by waiting out
 * the window and trying once.
 */
function recordFailure(db, key, { windowMinutes = 15, maxAttempts = 10 } = {}) {
  const now = new Date().toISOString();
  const windowStart = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const existing = db.get('SELECT attempts, last_at FROM login_throttle WHERE key = ?', [key]);
  const inWindow = existing && existing.last_at >= windowStart;
  const attempts = inWindow ? Number(existing.attempts) + 1 : 1;
  const blockedUntil = attempts >= maxAttempts
    ? new Date(Date.now() + windowMinutes * 60_000).toISOString()
    : null;

  db.run(
    `INSERT INTO login_throttle (key, attempts, last_at, blocked_until) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET
       attempts = excluded.attempts,
       last_at = excluded.last_at,
       blocked_until = excluded.blocked_until`,
    [key, attempts, now, blockedUntil],
  );
  return { attempts, blockedUntil, blocked: Boolean(blockedUntil) };
}

function clearThrottle(db, key) {
  return db.run('DELETE FROM login_throttle WHERE key = ?', [key]);
}

/* --------------------------------------------------------- audit trail */

/** Record who did what. Failures here must never break the user's action. */
function audit(db, { actor = 'system', action, entity = null, entityId = null, detail = null }) {
  try {
    db.run(
      'INSERT INTO audit_logs (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [String(actor), String(action), entity, entityId ?? null, detail === null ? null : String(detail).slice(0, 500)],
    );
  } catch (err) {
    console.error('audit write failed:', err.message);
  }
}

function recentAudit(db, { limit = 50, entity = null } = {}) {
  return entity
    ? db.all('SELECT * FROM audit_logs WHERE entity = ? ORDER BY id DESC LIMIT ?', [entity, limit])
    : db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [limit]);
}

module.exports = {
  PURPOSES,
  hashToken,
  hashPurposeToken,
  csrfTokenFor,
  csrfTokenMatches,
  throttleKey,
  randomToken,
  createSession,
  readSession,
  revokeSession,
  revokeSessionByToken,
  revokeAllSessions,
  activeSessionCount,
  purgeExpired,
  issueToken,
  consumeToken,
  checkThrottle,
  recordFailure,
  clearThrottle,
  audit,
  recentAudit,
};
