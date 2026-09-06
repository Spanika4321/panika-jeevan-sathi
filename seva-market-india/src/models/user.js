'use strict';
/**
 * SEVA MARKET INDIA — user model.
 *
 * Passwords are hashed with scrypt (built-in, memory-hard, no dependency)
 * and stored as `scrypt$N$r$p$salt$hash`. The hash format is self-describing
 * so the cost parameters can be raised later without a data migration.
 *
 * `authenticate()` never distinguishes "no such account" from "wrong
 * password", and it hashes even for an unknown address, so neither the
 * message nor the timing leaks which emails are registered.
 */

const crypto = require('node:crypto');
const { cleanText, normalizePhone } = require('../db/values');

const COLUMNS = 'id, email, phone, full_name, role, status, email_verified_at, last_login_at,\n  password_changed_at, created_at, updated_at';

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
 * Password policy, expressed as a problem string so the API and the HTML
 * forms report it identically. `hashPassword` still enforces the floor: a
 * caller that skips this check cannot smuggle in a 3-character password.
 */
function passwordProblem(password, { minLength = 8 } = {}) {
  const value = String(password ?? '');
  if (value.length > 1024) return `Password must be ${1024} characters or fewer.`;
  if (value.length < minLength) return `Password must be at least ${minLength} characters.`;
  if (!/[A-Za-z]/.test(value)) return 'Password must contain at least one letter.';
  if (!/[0-9]/.test(value)) return 'Password must contain at least one number.';
  return null;
}

/**
 * Create a user account.
 * @returns {{user: object, passwordHash: string}}
 */
function createUser(db, { email, fullName, password, phone = null, role = 'customer', status = 'pending' }) {
  const cleanEmail = cleanText(email, 254)?.toLowerCase() ?? null;
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) throw new Error('A valid email is required.');

  const name = cleanText(fullName, 120);
  if (!name) throw new Error('Full name is required.');
  if (!['customer', 'provider', 'admin'].includes(role)) throw new Error(`Unknown role: ${role}`);

  const passwordHash = hashPassword(password);
  const normalizedPhone = phone ? normalizePhone(phone) : null;

  const duplicate = db.get('SELECT id FROM users WHERE lower(email) = ?', [cleanEmail]);
  if (duplicate) throw new Error('An account with that email already exists.');

  if (!['pending', 'active', 'suspended'].includes(status)) throw new Error(`Unknown status: ${status}`);

  const result = db.run(
    `INSERT INTO users (email, phone, full_name, password_hash, role, status, password_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    [cleanEmail, normalizedPhone, name, passwordHash, role, status],
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

/**
 * Check credentials. Returns `{ ok, user?, error? }` rather than throwing,
 * because every failure branch must be indistinguishable to the client:
 * an unknown email and a wrong password take the same time and say the
 * same thing.
 */
function authenticate(db, email, password) {
  const generic = { ok: false, error: 'Email or password is incorrect.' };
  const cleanEmail = cleanText(email, 254)?.toLowerCase();
  if (!cleanEmail) return generic;

  const row = db.get(
    `SELECT id, email, full_name, role, status, password_hash, email_verified_at
     FROM users WHERE lower(email) = ?`,
    [cleanEmail],
  );
  // Deliberate: hash even for an unknown address so the response time does
  // not reveal whether the account exists.
  if (!row) {
    hashPassword(String(password ?? 'x'.repeat(12)));
    return generic;
  }
  if (!verifyPassword(password, row.password_hash)) return generic;
  if (row.status === 'suspended') {
    return { ok: false, suspended: true, error: 'This account has been suspended. Contact support.' };
  }
  if (row.status !== 'active' && !row.email_verified_at) {
    return { ok: false, unverified: true, error: 'Confirm your email address before signing in.' };
  }

  touchLogin(db, row.id);
  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      role: row.role,
      status: row.status,
      email_verified_at: row.email_verified_at,
    },
  };
}

function touchLogin(db, id) {
  db.run(
    `UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                      failed_logins = 0,
                      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    [id],
  );
}

function markEmailVerified(db, id) {
  db.run(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                      status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
                      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    [id],
  );
  return findById(db, id);
}

/** Install a new password. Callers revoke sessions afterwards. */
function setPassword(db, id, password) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  db.run(
    `UPDATE users SET password_hash = ?,
                      password_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    [hashPassword(password), id],
  );
  return findById(db, id);
}

/**
 * Create or promote the site administrator from ADMIN_EMAIL/ADMIN_PASSWORD.
 * Idempotent and silent when either value is missing, which is what makes it
 * safe to call on every boot.
 */
function ensureAdmin(db, { email, password } = {}) {
  const cleanEmail = cleanText(email, 254)?.toLowerCase();
  if (!cleanEmail || !password) return null;

  const existing = db.get('SELECT id, role, status FROM users WHERE lower(email) = ?', [cleanEmail]);
  if (existing) {
    if (existing.role !== 'admin') {
      db.run("UPDATE users SET role = 'admin', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [existing.id]);
    }
    return { id: existing.id, created: false };
  }

  const { user } = createUser(db, {
    email: cleanEmail,
    fullName: 'Site administrator',
    password,
    role: 'admin',
  });
  db.run(
    `UPDATE users SET status = 'active',
                      email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    [user.id],
  );
  return { id: user.id, created: true };
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
  passwordProblem,
  createUser,
  findById,
  findByEmail,
  authenticate,
  touchLogin,
  markEmailVerified,
  setPassword,
  setStatus,
  ensureAdmin,
  countByRole,
  count,
};
