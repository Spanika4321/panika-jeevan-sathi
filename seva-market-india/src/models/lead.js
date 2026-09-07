'use strict';
/**
 * SEVA MARKET INDIA — lead (enquiry) model.
 *
 * The conversion event of the marketplace. Stored with a hashed IP so
 * abuse can be rate-limited without keeping raw addresses around.
 */

const crypto = require('node:crypto');
const { cleanText, normalizePhone, isValidPin } = require('../db/values');

const COLUMNS = 'id, service_id, provider_id, name, phone, email, pin_code, message, status, created_at';

/** One-way hash of a client IP; salted by the site secret. */
function hashIp(ip, secret = '') {
  if (!ip) return null;
  return crypto.createHmac('sha256', secret || 'seva-market').update(String(ip)).digest('hex');
}

/**
 * Check that the enquiry targets a real, active provider (and, when given, a
 * service that provider actually offers).
 *
 * Split out of `createLead` so the Supabase-backed store can reuse exactly
 * the same rules: the catalog it validates against is local seed data, while
 * the lead itself is written to Postgres. One implementation, two backends.
 */
function assertTarget(db, providerId, serviceId = null) {
  const provider = db.get('SELECT id FROM providers WHERE id = ? AND status = ?', [providerId, 'active']);
  if (!provider) throw new Error('Unknown or inactive provider.');

  if (serviceId !== null && serviceId !== undefined) {
    const service = db.get('SELECT id FROM services WHERE id = ? AND provider_id = ?', [serviceId, providerId]);
    if (!service) throw new Error('Service does not belong to that provider.');
  }
  return true;
}

/**
 * Validate + normalise enquiry input into a storable row (snake_case, the
 * column names both SQLite and Postgres use).
 *
 * @returns {{service_id: number|null, provider_id: number, name: string, phone: string,
 *            email: string|null, pin_code: string|null, message: string|null, ip_hash: string|null}}
 */
function prepareLead({ serviceId = null, providerId, name, phone, email = null, pinCode = null, message = null, ip = null, secret = '' }) {
  const cleanName = cleanText(name, 120);
  if (!cleanName) throw new Error('Your name is required.');

  const digits = normalizePhone(phone);
  if (!digits) throw new Error('A valid 10-digit Indian mobile number is required.');

  const pin = pinCode ? String(pinCode) : null;
  if (pin !== null && !isValidPin(pin)) throw new Error('PIN code must be 6 digits.');

  return {
    service_id: serviceId ?? null,
    provider_id: providerId,
    name: cleanName,
    phone: digits,
    email: cleanText(email, 254)?.toLowerCase() ?? null,
    pin_code: pin,
    message: cleanText(message, 1000),
    ip_hash: hashIp(ip, secret),
  };
}

function createLead(db, input) {
  const { providerId, serviceId = null } = input;
  assertTarget(db, providerId, serviceId);
  const row = prepareLead(input);

  const result = db.run(
    `INSERT INTO leads (service_id, provider_id, name, phone, email, pin_code, message, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.service_id, row.provider_id, row.name, row.phone, row.email, row.pin_code, row.message, row.ip_hash],
  );
  return findById(db, Number(result.lastInsertRowid));
}

function findById(db, id) {
  return db.get(`SELECT ${COLUMNS} FROM leads WHERE id = ?`, [id]);
}

function byProvider(db, providerId, { limit = 50 } = {}) {
  return db.all(
    `SELECT ${COLUMNS} FROM leads WHERE provider_id = ? ORDER BY created_at DESC LIMIT ?`,
    [providerId, limit],
  );
}

/** Move an enquiry through new -> contacted -> closed (or flag it spam). */
function setStatus(db, id, status) {
  if (!['new', 'contacted', 'closed', 'spam'].includes(status)) {
    throw new Error(`Unknown lead status: ${status}`);
  }
  db.run('UPDATE leads SET status = ? WHERE id = ?', [status, id]);
  return findById(db, id);
}

/** Leads in the last `minutes` from one IP — naive abuse throttle. */
function recentCountFromIp(db, ip, { minutes = 60, secret = '' } = {}) {
  const ipHash = hashIp(ip, secret);
  if (!ipHash) return 0;
  return Number(
    db.scalar(
      `SELECT COUNT(*) FROM leads
       WHERE ip_hash = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
      [ipHash, `-${Math.trunc(minutes)} minutes`],
    ) ?? 0,
  );
}

function count(db) {
  return Number(db.scalar('SELECT COUNT(*) FROM leads') ?? 0);
}

module.exports = {
  COLUMNS,
  hashIp,
  assertTarget,
  prepareLead,
  createLead,
  findById,
  byProvider,
  setStatus,
  recentCountFromIp,
  count,
};
