'use strict';
/**
 * SEVA MARKET INDIA — one-time account token model.
 *
 * Shared by the SQLite and Supabase stores so both backends enforce exactly
 * the same rules: the token shape, the per-purpose lifetime, the hash that is
 * stored, and the "single use, newest wins" policy.
 *
 * Threat model, in one paragraph: a token is a bearer secret that proves
 * control of a mailbox. So it is (1) 256 bits of `crypto.randomBytes`, which
 * cannot be guessed; (2) stored only as a SHA-256 hash, so a leaked database
 * or Supabase key cannot be replayed; (3) short-lived (48 h to verify an
 * address, 1 h to reset a password); (4) single use — spending it stamps
 * `consumed_at`; and (5) superseded — issuing a new token revokes the
 * outstanding ones for the same account and purpose, so an email that arrives
 * late cannot resurrect an old link.
 */

const crypto = require('node:crypto');

/** The only two reasons a token may exist. */
const PURPOSES = Object.freeze(['verify_email', 'reset_password']);

/** How long a link stays usable, per purpose. */
const TTL_MS = Object.freeze({
  verify_email: 48 * 60 * 60 * 1000,   // 48 hours — mailboxes can be checked later
  reset_password: 60 * 60 * 1000,      // 1 hour — a reset is urgent by definition
});

/**
 * How many links one account may request per hour before the flow says
 * "already sent" instead of mailing again. Small numbers: each request costs
 * an email, and an unthrottled one is a mail-bombing gadget.
 */
const HOURLY_LIMIT = Object.freeze({ verify_email: 5, reset_password: 5 });

/** base64url of 32 random bytes: 43 characters, URL-safe, no padding. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

/** A plausible token as it arrives from a query string. */
function isTokenShape(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/** Mint a new raw token. Returned to the caller once, then never stored. */
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** The storable form of a token: SHA-256, lowercase hex. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Current UTC time in the ISO shape both databases store. */
function nowIso(at = Date.now()) {
  return new Date(at).toISOString();
}

/**
 * Validate + normalise a token row (snake_case columns, identical in SQLite
 * and Postgres) — the same trick `models/user.prepareUser` uses, so the two
 * backends cannot drift.
 */
function prepareToken({ userId, purpose, token, ipHash = null, at = Date.now() }) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('A token needs a user id.');
  if (!PURPOSES.includes(purpose)) throw new Error(`Unknown token purpose: ${purpose}`);
  if (!isTokenShape(token)) throw new Error('A token must be 32-64 URL-safe characters.');
  const ttl = TTL_MS[purpose];
  return {
    user_id: id,
    purpose,
    token_hash: hashToken(token),
    ip_hash: ipHash ? String(ipHash).slice(0, 128) : null,
    expires_at: nowIso(at + ttl),
    created_at: nowIso(at),
  };
}

/* ------------------------------------------------------- SQLite side --- */

function create(db, input) {
  const row = prepareToken(input);
  const result = db.run(
    `INSERT INTO account_tokens (user_id, purpose, token_hash, ip_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.user_id, row.purpose, row.token_hash, row.ip_hash, row.expires_at, row.created_at],
  );
  return findById(db, Number(result.lastInsertRowid));
}

function findById(db, id) {
  return db.get(
    'SELECT id, user_id, purpose, token_hash, expires_at, consumed_at, created_at FROM account_tokens WHERE id = ?',
    [id],
  );
}

/**
 * The row a presented token maps to, or null.
 * Expiry and single-use are enforced by the query, not by the caller.
 */
function findValid(db, { purpose, token }, at = Date.now()) {
  if (!PURPOSES.includes(purpose) || !isTokenShape(token)) return null;
  return db.get(
    `SELECT id, user_id, purpose, token_hash, expires_at, consumed_at, created_at
     FROM account_tokens
     WHERE purpose = ? AND token_hash = ? AND consumed_at IS NULL AND expires_at >= ?`,
    [purpose, hashToken(token), nowIso(at)],
  );
}

/** Spend a token. Returns the number of rows stamped (0 = already spent). */
function consume(db, id, at = Date.now()) {
  const result = db.run(
    "UPDATE account_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
    [nowIso(at), id],
  );
  return Number(result.changes ?? 0);
}

/** Invalidate every outstanding token for one account + purpose. */
function revokeForUser(db, userId, purpose, at = Date.now()) {
  if (!PURPOSES.includes(purpose)) throw new Error(`Unknown token purpose: ${purpose}`);
  const result = db.run(
    `UPDATE account_tokens SET consumed_at = ?
     WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`,
    [nowIso(at), Number(userId), purpose],
  );
  return Number(result.changes ?? 0);
}

/** How many tokens an account (or one IP) requested inside the window. */
function recentCount(db, { purpose, userId = null, ipHash = null, minutes = 60 }, at = Date.now()) {
  if (!PURPOSES.includes(purpose)) throw new Error(`Unknown token purpose: ${purpose}`);
  const since = nowIso(at - Math.trunc(minutes) * 60_000);
  if (userId) {
    return Number(
      db.scalar(
        'SELECT COUNT(*) FROM account_tokens WHERE purpose = ? AND user_id = ? AND created_at >= ?',
        [purpose, Number(userId), since],
      ) ?? 0,
    );
  }
  if (ipHash) {
    return Number(
      db.scalar(
        'SELECT COUNT(*) FROM account_tokens WHERE purpose = ? AND ip_hash = ? AND created_at >= ?',
        [purpose, String(ipHash), since],
      ) ?? 0,
    );
  }
  return 0;
}

/** Housekeeping: drop rows that can never be used again. */
function purgeExpired(db, at = Date.now()) {
  const result = db.run(
    'DELETE FROM account_tokens WHERE expires_at < ?',
    [nowIso(at)],
  );
  return Number(result.changes ?? 0);
}

module.exports = {
  PURPOSES,
  TTL_MS,
  HOURLY_LIMIT,
  TOKEN_RE,
  isTokenShape,
  newToken,
  hashToken,
  nowIso,
  prepareToken,
  create,
  findById,
  findValid,
  consume,
  revokeForUser,
  recentCount,
  purgeExpired,
};
