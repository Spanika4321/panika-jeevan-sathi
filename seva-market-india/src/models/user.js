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
 * Create a user account.
 * @returns {{user: object, passwordHash: string}}
 */
function createUser(db, { email, fullName, password, phone = null, role = 'customer' }) {
  const cleanEmail = cleanText(email, 254)?.toLowerCase() ?? null;
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) throw new Error('A valid email is required.');

  const name = cleanText(fullName, 120);
  if (!name) throw new Error('Full name is required.');
  if (!['customer', 'provider', 'admin'].includes(role)) throw new Error(`Unknown role: ${role}`);

  const passwordHash = hashPassword(password);
  const normalizedPhone = phone ? normalizePhone(phone) : null;

  const duplicate = db.get('SELECT id FROM users WHERE lower(email) = ?', [cleanEmail]);
  if (duplicate) throw new Error('An account with that email already exists.');

  const result = db.run(
    `INSERT INTO users (email, phone, full_name, password_hash, role)
     VALUES (?, ?, ?, ?, ?)`,
    [cleanEmail, normalizedPhone, name, passwordHash, role],
  );
  return { user: findById(db, Number(result.lastInsertRowid)), passwordHash };
}

function findById(db, id) {
  return db.get(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [id]);
}

function findByEmail(db, email) {
  const cleanEmail = cleanText(email, 254)?.toLowerCase();
  if (!cleanEmail) return null;
  return db.get(`SELECT id, email, full_name, role, status, password_hash FROM users WHERE lower(email) = ?`, [cleanEmail]);
}

function setStatus(db, id, status) {
  if (!['pending', 'active', 'suspended'].includes(status)) throw new Error(`Unknown status: ${status}`);
  return db.run(`UPDATE users SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [status, id]);
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
  createUser,
  findById,
  findByEmail,
  setStatus,
  countByRole,
  count,
};
