/**
 * Identifier + token helpers.
 *
 * Records use UUIDv4 text primary keys (not auto-increment integers) so that
 * ids are portable across SQLite and Postgres, safe to expose in URLs, and do
 * not leak record counts or allow enumeration.
 */
import crypto from 'node:crypto';

export function newId() {
  return crypto.randomUUID();
}

export function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Short, human-friendly public reference (e.g. SM-7K2QF9). */
export function newReference(prefix = 'SM') {
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${prefix}-${out}`;
}
