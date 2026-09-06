'use strict';
/**
 * SEVA MARKET INDIA — review (rating) model.
 *
 * A review is a customer's rating + comment on a provider. Only `approved`
 * reviews roll up into the provider's public `rating_avg` / `rating_count`,
 * which is recomputed here (a SQL trigger cannot round), so the write path
 * stays in one place and stays testable.
 *
 * A fresh provider with no customer reviews keeps its editorial seed rating;
 * as soon as real approved reviews exist the number shown is the customer
 * average, never a mix of the two.
 */

const crypto = require('node:crypto');
const { cleanText, normalizePhone } = require('../db/values');

const COLUMNS = 'id, provider_id, service_id, customer_name, rating, comment, status, created_at';

const STATUSES = ['pending', 'approved', 'rejected'];

/** One-way IP hash, salted by the site secret (mirrors leads). */
function hashIp(ip, secret = '') {
  if (!ip) return null;
  return crypto.createHmac('sha256', secret || 'seva-market').update(String(ip)).digest('hex');
}

/** Recomputed rating row for a provider from its approved reviews. */
function approvedAggregate(db, providerId) {
  return db.get(
    `SELECT COUNT(*) AS rating_count, AVG(rating) AS rating_avg
       FROM reviews WHERE provider_id = ? AND status = 'approved'`,
    [providerId],
  );
}

/** Recompute `rating_avg` / `rating_count` from approved reviews. */
function recomputeRating(db, providerId) {
  const agg = approvedAggregate(db, providerId);
  const count = Number(agg?.rating_count ?? 0);
  if (count > 0) {
    const avg = Math.round((Number(agg.rating_avg) + Number.EPSILON) * 10) / 10;
    db.run(
      `UPDATE providers SET rating_avg = ?, rating_count = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [avg, count, providerId],
    );
  }
  return { rating_avg: count > 0 ? Number(agg.rating_avg) : null, rating_count: count };
}

/**
 * Create a review. `approve` defaults to whether the site is moderated.
 * When the review is approved, the provider's public rating is recomputed.
 */
function create(db, {
  providerId,
  serviceId = null,
  customerName,
  rating,
  comment = null,
  customerPhone = null,
  ip = null,
  secret = '',
  approve = true,
}) {
  const provider = db.get('SELECT id FROM providers WHERE id = ?', [providerId]);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const name = cleanText(customerName, 120);
  if (!name) throw new Error('Your name is required.');

  const stars = Math.trunc(Number(rating));
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new Error('Rating must be a whole number between 1 and 5.');
  }

  if (serviceId) {
    const service = db.get('SELECT id FROM services WHERE id = ? AND provider_id = ?', [serviceId, providerId]);
    if (!service) throw new Error('Service does not belong to that provider.');
  }

  const result = db.run(
    `INSERT INTO reviews (provider_id, service_id, customer_name, customer_phone, rating, comment, status, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      providerId,
      serviceId ?? null,
      name,
      customerPhone ? normalizePhone(customerPhone) : null,
      stars,
      cleanText(comment, 2000),
      approve ? 'approved' : 'pending',
      hashIp(ip, secret),
    ],
  );

  const review = findById(db, Number(result.lastInsertRowid));
  if (approve) recomputeRating(db, providerId);
  return review;
}

function findById(db, id) {
  return db.get(`SELECT ${COLUMNS} FROM reviews WHERE id = ?`, [id]);
}

/** Approved reviews for a provider's public profile, newest first. */
function approvedByProvider(db, providerId, { limit = 50 } = {}) {
  return db
    .all(
      `SELECT ${COLUMNS} FROM reviews
        WHERE provider_id = ? AND status = 'approved'
        ORDER BY created_at DESC LIMIT ?`,
      [providerId, limit],
    )
    .map((row) => ({ ...row, customer_phone: undefined }));
}

/** Reviews in a given status (dashboard / moderation view). */
function byStatus(db, providerId, status = 'pending') {
  if (!STATUSES.includes(status)) throw new Error(`Unknown review status: ${status}`);
  return db.all(
    `SELECT ${COLUMNS} FROM reviews WHERE provider_id = ? AND status = ?
      ORDER BY created_at DESC`,
    [providerId, status],
  );
}

/** Set a review's moderation status and recompute the provider rating. */
function setStatus(db, id, status) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown review status: ${status}`);
  db.transaction(() => {
    db.run(
      `UPDATE reviews SET status = ? WHERE id = ?`,
      [status, id],
    );
    const review = db.get('SELECT provider_id FROM reviews WHERE id = ?', [id]);
    if (review) recomputeRating(db, review.provider_id);
  });
}

/** Recent reviews from one IP in the last `minutes` (abuse throttle). */
function recentCountFromIp(db, ip, { minutes = 60, secret = '' } = {}) {
  const ipHash = hashIp(ip, secret);
  if (!ipHash) return 0;
  return Number(
    db.scalar(
      `SELECT COUNT(*) FROM reviews
        WHERE ip_hash = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
      [ipHash, `-${Math.trunc(minutes)} minutes`],
    ) ?? 0,
  );
}

function count(db, { status = 'approved' } = {}) {
  return Number(db.scalar('SELECT COUNT(*) FROM reviews WHERE status = ?', [status]) ?? 0);
}

module.exports = {
  COLUMNS,
  STATUSES,
  create,
  findById,
  approvedByProvider,
  byStatus,
  setStatus,
  recomputeRating,
  recentCountFromIp,
  count,
};
