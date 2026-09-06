'use strict';
/**
 * SEVA MARKET INDIA — service model.
 *
 * A service is one thing a provider offers, priced and pinned to a place.
 * `searchServices()` is the query behind the homepage search box and is the
 * single hottest read path on the site.
 */

const { slugify, cleanText, isValidPin, likePattern } = require('../db/values');

const CARD_COLUMNS = `services.id, services.title, services.slug, services.description,
  services.price_min, services.price_max, services.price_unit, services.pin_code, services.status,
  services.category_id, services.location_id, services.created_at,
  providers.id AS provider_id, providers.business_name, providers.slug AS provider_slug,
  providers.phone, providers.is_verified, providers.rating_avg, providers.rating_count,
  categories.name AS category_name, categories.slug AS category_slug,
  locations.search_text AS location_label`;

const CARD_JOINS = `FROM services
  JOIN providers   ON providers.id  = services.provider_id
  JOIN categories  ON categories.id = services.category_id
  JOIN locations   ON locations.id  = services.location_id`;

function card(row) {
  if (!row) return null;
  return { ...row, is_verified: Boolean(row.is_verified) };
}

function createService(db, {
  providerId,
  categoryId,
  locationId,
  title,
  description = null,
  pinCode = null,
  priceMin = null,
  priceMax = null,
  priceUnit = 'visit',
  status = 'draft',
}) {
  const name = cleanText(title, 140);
  if (!name) throw new Error('Service title is required.');

  const provider = db.get('SELECT id, pin_code FROM providers WHERE id = ?', [providerId]);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const category = db.get('SELECT id FROM categories WHERE id = ? AND is_active = 1', [categoryId]);
  if (!category) throw new Error(`Unknown category: ${categoryId}`);

  const location = db.get('SELECT id, pin_code FROM locations WHERE id = ?', [locationId]);
  if (!location) throw new Error(`Unknown location: ${locationId}`);

  if (!['visit', 'hour', 'day', 'sqft', 'job', 'month'].includes(priceUnit)) {
    throw new Error(`Unknown price unit: ${priceUnit}`);
  }
  if (!['draft', 'active', 'paused', 'archived'].includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }

  const min = priceMin === null || priceMin === '' ? null : Math.trunc(Number(priceMin));
  const max = priceMax === null || priceMax === '' ? null : Math.trunc(Number(priceMax));
  if (min !== null && (!Number.isFinite(min) || min < 0)) throw new Error('price_min must be >= 0.');
  if (max !== null && (!Number.isFinite(max) || max < 0)) throw new Error('price_max must be >= 0.');
  if (min !== null && max !== null && max < min) throw new Error('price_max cannot be below price_min.');

  const pin = pinCode ? String(pinCode) : location.pin_code ?? provider.pin_code;
  if (pin !== null && pin !== undefined && !isValidPin(pin)) throw new Error(`Invalid PIN code: ${pin}`);

  const wanted = slugify(`${name}-${providerId}`);
  if (!wanted) throw new Error(`Cannot slugify service title: ${title}`);
  let slug = wanted;
  for (let suffix = 2; db.get('SELECT id FROM services WHERE slug = ?', [slug]); suffix += 1) {
    slug = `${wanted}-${suffix}`;
  }

  const result = db.run(
    `INSERT INTO services
       (provider_id, category_id, location_id, title, slug, description, pin_code,
        price_min, price_max, price_unit, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      providerId,
      categoryId,
      locationId,
      name,
      slug,
      cleanText(description, 2000),
      pin ?? null,
      min,
      max,
      priceUnit,
      status,
    ],
  );
  return findById(db, Number(result.lastInsertRowid));
}

function findById(db, id) {
  return card(db.get(`SELECT ${CARD_COLUMNS} ${CARD_JOINS} WHERE services.id = ?`, [id]));
}

function findBySlug(db, slug) {
  return card(db.get(`SELECT ${CARD_COLUMNS} ${CARD_JOINS} WHERE services.slug = ?`, [slug]));
}

function byProvider(db, providerId, { status = 'active' } = {}) {
  return db
    .all(
      `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
       WHERE services.provider_id = ? AND services.status = ?
       ORDER BY services.title`,
      [providerId, status],
    )
    .map(card);
}

/**
 * Marketplace search: service + category + place + PIN, in any combination.
 * Only ACTIVE services from ACTIVE providers are ever returned — the WHERE
 * clause is built first and reused for the count so both agree.
 */
function searchServices(db, {
  query = null,
  categoryIds = null,
  locationId = null,
  locationIds = null,
  pin = null,
  limit = 20,
  offset = 0,
} = {}) {
  const where = ["services.status = 'active'", "providers.status = 'active'"];
  const params = [];

  const text = cleanText(query, 80);
  if (text) {
    where.push(
      `(services.title LIKE ? ESCAPE '\\'
        OR services.description LIKE ? ESCAPE '\\'
        OR providers.business_name LIKE ? ESCAPE '\\')`,
    );
    const like = likePattern(text);
    params.push(like, like, like);
  }
  if (categoryIds && categoryIds.length) {
    where.push(`services.category_id IN (${categoryIds.map(() => '?').join(',')})`);
    params.push(...categoryIds);
  }
  // Match by location *subtree*: "in Assam" / "in Guwahati" should find any
  // service pinned beneath that node, not just ones attached to it exactly.
  let areaIds = locationIds || (locationId ? [locationId] : null);
  if (areaIds && areaIds.length) {
    where.push(`services.location_id IN (${areaIds.map(() => '?').join(',')})`);
    params.push(...areaIds);
  }
  if (pin) {
    // A service matches a PIN directly, or via the provider's coverage list.
    where.push(
      `(services.pin_code = ? OR EXISTS (
         SELECT 1 FROM service_areas sa
         WHERE sa.provider_id = providers.id AND sa.pin_code = ?))`,
    );
    params.push(pin, pin);
  }

  const clause = where.join(' AND ');
  const items = db
    .all(
      `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
       WHERE ${clause}
       ORDER BY providers.is_verified DESC, providers.rating_avg DESC, services.title
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    .map(card);

  const total = Number(
    db.scalar(
      `SELECT COUNT(*) ${CARD_JOINS} WHERE ${clause}`,
      params,
    ) ?? 0,
  );

  return { items, total };
}

/** Every service a provider owns, any status — for the dashboard. */
function byProviderAll(db, providerId) {
  return db
    .all(
      `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
       WHERE services.provider_id = ?
       ORDER BY (services.status = 'active') DESC, services.created_at DESC`,
      [providerId],
    )
    .map(card);
}

/**
 * Change a service's status, but only for the owning provider (dashboard
 * action). Statuses: draft, active, paused, archived.
 */
function updateStatus(db, id, { providerId, status }) {
  if (!['draft', 'active', 'paused', 'archived'].includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }
  const owned = db.get('SELECT id FROM services WHERE id = ? AND provider_id = ?', [id, providerId]);
  if (!owned) throw new Error('Service not found or not owned by this provider.');
  db.run(
    `UPDATE services SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [status, id],
  );
  return findById(db, id);
}

/** Top categories by live service count — homepage "popular" strip. */
function popularCategories(db, limit = 8) {
  return db.all(
    `SELECT categories.id, categories.name, categories.slug, categories.icon,
            COUNT(services.id) AS service_count
     FROM categories
     LEFT JOIN services ON services.category_id = categories.id AND services.status = 'active'
     WHERE categories.is_active = 1
     GROUP BY categories.id
     HAVING service_count > 0
     ORDER BY service_count DESC, categories.sort_order
     LIMIT ?`,
    [limit],
  );
}

function count(db, { status = 'active' } = {}) {
  return Number(db.scalar('SELECT COUNT(*) FROM services WHERE status = ?', [status]) ?? 0);
}

module.exports = {
  CARD_COLUMNS,
  CARD_JOINS,
  createService,
  findById,
  findBySlug,
  byProvider,
  byProviderAll,
  updateStatus,
  searchServices,
  popularCategories,
  count,
};
