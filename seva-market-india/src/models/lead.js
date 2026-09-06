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

function createLead(db, { serviceId = null, providerId, name, phone, email = null, pinCode = null, message = null, ip = null, secret = '' }) {
  const provider = db.get('SELECT id FROM providers WHERE id = ? AND status = ?', [providerId, 'active']);
  if (!provider) throw new Error('Unknown or inactive provider.');

  const cleanName = cleanText(name, 120);
  if (!cleanName) throw new Error('Your name is required.');

  const digits = normalizePhone(phone);
  if (!digits) throw new Error('A valid 10-digit Indian mobile number is required.');

  const pin = pinCode ? String(pinCode) : null;
  if (pin !== null && !isValidPin(pin)) throw new Error('PIN code must be 6 digits.');

  if (serviceId !== null && serviceId !== undefined) {
    const service = db.get('SELECT id FROM services WHERE id = ? AND provider_id = ?', [serviceId, providerId]);
    if (!service) throw new Error('Service does not belong to that provider.');
  }

  const result = db.run(
    `INSERT INTO leads (service_id, provider_id, name, phone, email, pin_code, message, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      serviceId ?? null,
      providerId,
      cleanName,
      digits,
      cleanText(email, 254)?.toLowerCase() ?? null,
      pin,
      cleanText(message, 1000),
      hashIp(ip, secret),
    ],
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

const LEAD_STATUSES = ['new', 'contacted', 'closed', 'spam'];

/**
 * Update an enquiry's status, scoped to the owning provider so one provider
 * can never mutate another's lead. Statuses: new, contacted, closed, spam.
 */
function setStatus(db, id, { providerId, status }) {
  if (!LEAD_STATUSES.includes(status)) throw new Error(`Unknown lead status: ${status}`);
  const owned = db.get('SELECT id FROM leads WHERE id = ? AND provider_id = ?', [id, providerId]);
  if (!owned) throw new Error('Enquiry not found or not owned by this provider.');
  db.run('UPDATE leads SET status = ? WHERE id = ?', [status, id]);
  return findById(db, id);
}

/** Count leads per status for a provider's dashboard summary. */
function statusCounts(db, providerId) {
  const rows = db.all(
    `SELECT status, COUNT(*) AS total FROM leads WHERE provider_id = ? GROUP BY status`,
    [providerId],
  );
  const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  for (const row of rows) counts[row.status] = Number(row.total);
  return counts;
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
  LEAD_STATUSES,
  hashIp,
  createLead,
  findById,
  byProvider,
  setStatus,
  statusCounts,
  recentCountFromIp,
  count,
};
