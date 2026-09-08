'use strict';
/**
 * SEVA MARKET INDIA — user model.
 *
 * Passwords are hashed with scrypt (built-in, memory-hard, no dependency)
 * and stored as `scrypt$N$r$p$salt$hash`. The hash format is self-describing
 * so the cost parameters can be raised later without a data migration.
 * Authentication itself lands in a later step; the primitives are here now.
 */

const crypto = require('node:crypto');
const { cleanText, normalizePhone } = require('../db/values');

const COLUMNS = 'id, email, phone, full_name, role, status, email_verified_at, created_at, updated_at';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Hash a plaintext password. Never logs or returns the plaintext. */
function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

/** Constant-time comparison against a stored hash. */
function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  let derived;
  try {
    derived = crypto.scryptSync(String(password ?? ''), Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
  } catch (_) {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validate + normalise signup input into a storable row (snake_case columns,
 * identical in SQLite and Postgres).
 *
 * Extracted from `createUser` so the Supabase-backed store applies exactly
 * the same rules — including the scrypt hashing — without a second copy of
 * the logic drifting out of sync.
 */
function prepareUser({ email, fullName, password, phone = null, role = 'customer' }) {
  const cleanEmail = cleanText(email, 254)?.toLowerCase() ?? null;
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) throw new Error('A valid email is required.');

  const name = cleanText(fullName, 120);
  if (!name) throw new Error('Full name is required.');
  if (!['customer', 'provider', 'admin'].includes(role)) throw new Error(`Unknown role: ${role}`);

  return {
    email: cleanEmail,
    phone: phone ? normalizePhone(phone) : null,
    full_name: name,
    password_hash: hashPassword(password),
    role,
  };
}

/**
 * Create a user account.
 * @returns {{user: object, passwordHash: string}}
 */
function createUser(db, input) {
  const row = prepareUser(input);

  const duplicate = db.get('SELECT id FROM users WHERE lower(email) = ?', [row.email]);
  if (duplicate) throw new Error('An account with that email already exists.');

  const result = db.run(
    `INSERT INTO users (email, phone, full_name, password_hash, role)
     VALUES (?, ?, ?, ?, ?)`,
    [row.email, row.phone, row.full_name, row.password_hash, row.role],
  );
  return { user: findById(db, Number(result.lastInsertRowid)), passwordHash: row.password_hash };
}

function findById(db, id) {
  return db.get(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [id]);
}

function findByEmail(db, email) {
  const cleanEmail = cleanText(email, 254)?.toLowerCase();
  if (!cleanEmail) return null;
  return db.get(`SELECT id, email, full_name, role, status, password_hash FROM users WHERE lower(email) = ?`, [cleanEmail]);
}

/**
 * Stamp the address as confirmed. Called by the verify-email route and by a
 * successful password reset (spending a reset link proves inbox control just
 * as convincingly as clicking the verification link did).
 */
function setEmailVerified(db, id, at = new Date().toISOString()) {
  return db.run(
    `UPDATE users SET email_verified_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [at, id],
  );
}

/**
 * Replace the password hash. The caller must already have proven the right to
 * do it (a valid reset token, or an authenticated session); this function only
 * hashes and writes, so both stores share one scrypt configuration.
 */
function setPassword(db, id, password) {
  const hash = hashPassword(password);
  db.run(
    `UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [hash, id],
  );
  return findById(db, id);
}

function setStatus(db, id, status) {
  if (!['pending', 'active', 'suspended'].includes(status)) throw new Error(`Unknown status: ${status}`);
  return db.run(`UPDATE users SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [status, id]);
}

/** Switch an account between customer / provider / admin. */
function setRole(db, id, role) {
  if (!['customer', 'provider', 'admin'].includes(role)) throw new Error(`Unknown role: ${role}`);
  return db.run(`UPDATE users SET role = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [role, id]);
}

/** Update contact details shown on the account. */
function updateProfile(db, id, { fullName = null, phone = null } = {}) {
  const name = cleanText(fullName, 120);
  if (fullName && !name) throw new Error('Full name is required.');
  const digits = phone ? normalizePhone(phone) : null;
  if (phone && !digits) throw new Error('A valid 10-digit Indian mobile number is required.');
  if (!name && !digits) return findById(db, id);
  const sets = [];
  const params = [];
  if (name) { sets.push('full_name = ?'); params.push(name); }
  if (digits) { sets.push('phone = ?'); params.push(digits); }
  params.push(id);
  db.run(
    `UPDATE users SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    params,
  );
  return findById(db, id);
}

function countByRole(db, role) {
  return Number(
    db.scalar("SELECT COUNT(*) FROM users WHERE role = ? AND status != 'suspended'", [role]) ?? 0,
  );
}

/** Total non-suspended accounts. */
function count(db) {
  return Number(db.scalar("SELECT COUNT(*) FROM users WHERE status != 'suspended'") ?? 0);
}

module.exports = {
  COLUMNS,
  hashPassword,
  verifyPassword,
  prepareUser,
  createUser,
  findById,
  findByEmail,
  setEmailVerified,
  setPassword,
  setStatus,
  setRole,
  updateProfile,
  countByRole,
  count,
};
