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
  categories.name AS category_name, categories.slug AS category_slug, categories.icon AS category_icon,
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
 * Every service a provider owns except archived ones — the rows the
 * dashboard "My services" list shows (draft / active / paused).
 */
function byProviderAll(db, providerId) {
  return db
    .all(
      `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
       WHERE services.provider_id = ? AND services.status != 'archived'
       ORDER BY services.created_at DESC, services.id DESC`,
      [providerId],
    )
    .map(card);
}

/**
 * Update the editable fields of one service. `locationId`/`pinCode` stay
 * with the provider's business profile by default: a marketplace listing is
 * tied to where the provider works, not to a free-text box.
 */
function updateService(db, id, {
  title = null,
  description = null,
  categoryId = null,
  priceMin = null,
  priceMax = null,
  priceUnit = null,
  status = null,
} = {}) {
  const existing = findById(db, id);
  if (!existing) throw new Error(`Unknown service: ${id}`);

  const patch = { updated_at: new Date().toISOString() };

  if (title !== null) {
    const name = cleanText(title, 140);
    if (!name) throw new Error('Service title is required.');
    patch.title = name;
  }
  if (description !== null) patch.description = cleanText(description, 2000);
  if (categoryId !== null) {
    const category = db.get('SELECT id FROM categories WHERE id = ? AND is_active = 1', [categoryId]);
    if (!category) throw new Error(`Unknown category: ${categoryId}`);
    patch.category_id = categoryId;
  }
  if (priceUnit !== null) {
    if (!['visit', 'hour', 'day', 'sqft', 'job', 'month'].includes(priceUnit)) {
      throw new Error(`Unknown price unit: ${priceUnit}`);
    }
    patch.price_unit = priceUnit;
  }
  if (status !== null) {
    if (!['draft', 'active', 'paused', 'archived'].includes(status)) {
      throw new Error(`Unknown service status: ${status}`);
    }
    patch.status = status;
  }

  const min = priceMin === null || priceMin === undefined || priceMin === ''
    ? null : Math.trunc(Number(priceMin));
  const max = priceMax === null || priceMax === undefined || priceMax === ''
    ? null : Math.trunc(Number(priceMax));
  if (min !== null && (!Number.isFinite(min) || min < 0)) throw new Error('price_min must be >= 0.');
  if (max !== null && (!Number.isFinite(max) || max < 0)) throw new Error('price_max must be >= 0.');
  if (min !== null && max !== null && max < min) throw new Error('price_max cannot be below price_min.');
  patch.price_min = min;
  patch.price_max = max;

  const sets = Object.keys(patch).map((column) => `${column} = ?`);
  db.run(`UPDATE services SET ${sets.join(', ')} WHERE id = ?`, [...Object.values(patch), id]);
  return findById(db, id);
}

/**
 * Move a service between draft / active / paused / archived. No hard delete:
 * old leads keep pointing at a row that still exists (archive is the "remove
 * from site" action).
 */
function setStatus(db, id, status) {
  if (!['draft', 'active', 'paused', 'archived'].includes(status)) {
    throw new Error(`Unknown service status: ${status}`);
  }
  db.run(`UPDATE services SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [status, id]);
  return findById(db, id);
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
    // The homepage search box invites category words ("Plumber, electrician,
    // tutor..."), so the category name has to match too — otherwise the most
    // natural first search a customer makes returns nothing.
    where.push(
      `(services.title LIKE ? ESCAPE '\\'
        OR services.description LIKE ? ESCAPE '\\'
        OR providers.business_name LIKE ? ESCAPE '\\'
        OR categories.name LIKE ? ESCAPE '\\')`,
    );
    const like = likePattern(text);
    params.push(like, like, like, like);
  }
  if (categoryIds && categoryIds.length) {
    where.push(`services.category_id IN (${categoryIds.map(() => '?').join(',')})`);
    params.push(...categoryIds);
  }
  if (locationIds && locationIds.length) {
    where.push(`services.location_id IN (${locationIds.map(() => '?').join(',')})`);
    params.push(...locationIds);
  } else if (locationIds) {
    // The place filter named a location we do not know — match nothing
    // rather than silently showing every listing in India.
    where.push('0 = 1');
  } else if (locationId) {
    where.push('services.location_id = ?');
    params.push(locationId);
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

/** Top-level category groups with their live-service subtotals (homepage tiles). */
function parentTiles(db) {
  return db.all(
    `SELECT c.id, c.name, c.slug, c.icon, COUNT(s.id) AS service_count
     FROM categories c
     LEFT JOIN categories child ON child.parent_id = c.id
     LEFT JOIN services s ON s.category_id = child.id AND s.status = 'active'
     WHERE c.parent_id IS NULL AND c.is_active = 1
     GROUP BY c.id
     ORDER BY c.sort_order, c.name`,
  );
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
  updateService,
  setStatus,
  searchServices,
  popularCategories,
  parentTiles,
  count,
};
