'use strict';
/**
 * SEVA MARKET INDIA — provider model.
 *
 * A provider is a business that owns services, sits at one primary location,
 * and optionally serves extra PIN codes via `service_areas`. Contact details
 * are the product: `phone` is always returned to customers, because the
 * marketplace's job is to connect people, not to gate them behind a login.
 */

const { slugify, cleanText, normalizePhone, isValidPin, likePattern } = require('../db/values');

const COLUMNS = `providers.id, providers.business_name, providers.slug, providers.contact_name,
  providers.phone, providers.alt_phone, providers.email, providers.category_id, providers.location_id,
  providers.pin_code, providers.address_line, providers.about, providers.experience_years, providers.photo_urls,
  providers.is_verified, providers.status, providers.rating_avg, providers.rating_count,
  providers.created_at`;

/** Denormalised columns for search results: category + place names. */
const CARD_COLUMNS = `${COLUMNS},
  categories.name AS category_name, categories.slug AS category_slug, categories.icon AS category_icon,
  locations.search_text AS location_label`;

function publicPhotoUrls(value) {
  const parsed = Array.isArray(value)
    ? value
    : (() => {
      try { return JSON.parse(String(value || '[]')); } catch (_) { return []; }
    })();
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((url) => {
    const text = String(url || '');
    if (/^\/uploads\/businesses\/[a-z0-9-]+\.(?:jpg|png|webp)$/i.test(text)) return true;
    try {
      const parsedUrl = new URL(text);
      return parsedUrl.protocol === 'https:' && !parsedUrl.username && !parsedUrl.password;
    } catch (_) {
      return false;
    }
  }).slice(0, 5);
}

function baseCard(row) {
  if (!row) return null;
  return { ...row, photo_urls: publicPhotoUrls(row.photo_urls), is_verified: Boolean(row.is_verified) };
}

/**
 * Create a provider. Requires an existing category and location.
 */
function createProvider(db, {
  businessName,
  categoryId,
  locationId,
  phone,
  userId = null,
  contactName = null,
  altPhone = null,
  email = null,
  pinCode = null,
  addressLine = null,
  about = null,
  experienceYears = 0,
  status = 'pending',
}) {
  const name = cleanText(businessName, 140);
  if (!name) throw new Error('Business name is required.');

  const digits = normalizePhone(phone);
  if (!digits) throw new Error('A valid 10-digit Indian mobile number is required.');

  const category = db.get('SELECT id FROM categories WHERE id = ? AND is_active = 1', [categoryId]);
  if (!category) throw new Error(`Unknown category: ${categoryId}`);

  const location = db.get('SELECT id, pin_code FROM locations WHERE id = ?', [locationId]);
  if (!location) throw new Error(`Unknown location: ${locationId}`);

  const pin = pinCode ? String(pinCode) : location.pin_code;
  if (pin !== null && !isValidPin(pin)) throw new Error(`Invalid PIN code: ${pin}`);
  if (!['pending', 'active', 'suspended'].includes(status)) throw new Error(`Unknown status: ${status}`);

  // Slugs must stay unique but also readable: append a counter on collision.
  const wanted = slugify(name);
  if (!wanted) throw new Error(`Cannot slugify business name: ${businessName}`);
  let slug = wanted;
  for (let suffix = 2; db.get('SELECT id FROM providers WHERE slug = ?', [slug]); suffix += 1) {
    slug = `${wanted}-${suffix}`;
  }

  const result = db.run(
    `INSERT INTO providers
       (user_id, business_name, slug, contact_name, phone, alt_phone, email, category_id, location_id,
        pin_code, address_line, about, experience_years, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId ?? null,
      name,
      slug,
      cleanText(contactName, 120),
      digits,
      altPhone ? normalizePhone(altPhone) : null,
      cleanText(email, 254)?.toLowerCase() ?? null,
      categoryId,
      locationId,
      pin,
      cleanText(addressLine, 200),
      cleanText(about, 2000),
      Math.max(0, Math.trunc(Number(experienceYears) || 0)),
      status,
    ],
  );
  return findById(db, Number(result.lastInsertRowid));
}

function findById(db, id) {
  return baseCard(db.get(`SELECT ${CARD_COLUMNS} FROM providers
    LEFT JOIN categories ON categories.id = providers.category_id
    LEFT JOIN locations  ON locations.id  = providers.location_id
    WHERE providers.id = ?`, [id]));
}

function findBySlug(db, slug) {
  return baseCard(db.get(`SELECT ${CARD_COLUMNS} FROM providers
    LEFT JOIN categories ON categories.id = providers.category_id
    LEFT JOIN locations  ON locations.id  = providers.location_id
    WHERE providers.slug = ?`, [slug]));
}

/** The business profile(s) owned by a user account (usually zero or one). */
function byUserId(db, userId) {
  return db.all(`SELECT ${CARD_COLUMNS} FROM providers
    LEFT JOIN categories ON categories.id = providers.category_id
    LEFT JOIN locations  ON locations.id  = providers.location_id
    WHERE providers.user_id = ?
    ORDER BY providers.id`, [userId]).map(baseCard);
}

/**
 * Update the editable fields of an owned business profile. Same validation
 * rules as createProvider — the dashboard form and the seed share one truth.
 */
function updateProvider(db, id, {
  businessName = null,
  contactName = null,
  phone = null,
  altPhone = null,
  email = null,
  categoryId = null,
  locationId = null,
  pinCode = null,
  addressLine = null,
  about = null,
  experienceYears = null,
} = {}) {
  const existing = findById(db, id);
  if (!existing) throw new Error(`Unknown provider: ${id}`);

  const patch = { updated_at: new Date().toISOString() };

  if (businessName !== null) {
    const name = cleanText(businessName, 140);
    if (!name) throw new Error('Business name is required.');
    patch.business_name = name;
  }
  if (contactName !== null) patch.contact_name = cleanText(contactName, 120);
  if (phone !== null) {
    const digits = normalizePhone(phone);
    if (!digits) throw new Error('A valid 10-digit Indian mobile number is required.');
    patch.phone = digits;
  }
  if (altPhone !== null) patch.alt_phone = altPhone ? normalizePhone(altPhone) : null;
  if (email !== null) patch.email = cleanText(email, 254)?.toLowerCase() ?? null;

  if (categoryId !== null) {
    const category = db.get('SELECT id FROM categories WHERE id = ? AND is_active = 1', [categoryId]);
    if (!category) throw new Error(`Unknown category: ${categoryId}`);
    patch.category_id = categoryId;
  }
  if (locationId !== null) {
    const location = db.get('SELECT id, pin_code FROM locations WHERE id = ? AND is_active = 1', [locationId]);
    if (!location) throw new Error(`Unknown location: ${locationId}`);
    patch.location_id = locationId;
    patch.pin_code = location.pin_code ?? existing.pin_code;
  }
  if (pinCode !== null) {
    const pin = String(pinCode);
    if (pin !== existing.pin_code && !isValidPin(pin)) throw new Error(`Invalid PIN code: ${pin}`);
    patch.pin_code = pin;
  }
  if (addressLine !== null) patch.address_line = cleanText(addressLine, 200);
  if (about !== null) patch.about = cleanText(about, 2000);
  if (experienceYears !== null) {
    patch.experience_years = Math.max(0, Math.trunc(Number(experienceYears) || 0));
  }

  const sets = Object.keys(patch).map((column) => `${column} = ?`);
  db.run(`UPDATE providers SET ${sets.join(', ')} WHERE id = ?`, [...Object.values(patch), id]);
  return findById(db, id);
}

/**
 * The core marketplace query: providers by category + place + PIN.
 * @param {object} db
 * @param {object} filters
 * @param {number[]} [filters.categoryIds]
 * @param {number}   [filters.locationId]
 * @param {string}   [filters.pin]
 * @param {string}   [filters.query]   free text over business name/about
 * @param {boolean}  [filters.verifiedOnly]
 */
function searchProviders(db, {
  categoryIds = null,
  locationId = null,
  locationIds = null,
  pin = null,
  query = null,
  verifiedOnly = false,
  limit = 20,
  offset = 0,
} = {}) {
  const where = ["providers.status = 'active'"];
  const params = [];

  if (categoryIds && categoryIds.length) {
    where.push(`providers.category_id IN (${categoryIds.map(() => '?').join(',')})`);
    params.push(...categoryIds);
  }
  if (locationIds && locationIds.length) {
    where.push(`providers.location_id IN (${locationIds.map(() => '?').join(',')})`);
    params.push(...locationIds);
  } else if (locationIds) {
    // The place filter named a location we do not know — match nothing
    // rather than silently showing every provider in India.
    where.push('0 = 1');
  } else if (locationId) {
    where.push('providers.location_id = ?');
    params.push(locationId);
  }
  if (pin) {
    where.push('(providers.pin_code = ? OR EXISTS (SELECT 1 FROM service_areas sa WHERE sa.provider_id = providers.id AND sa.pin_code = ?))');
    params.push(pin, pin);
  }
  if (verifiedOnly) where.push('providers.is_verified = 1');

  const text = cleanText(query, 80);
  if (text) {
    // Category word ("plumber") finds that trade's providers, matching the
    // service search semantics — /api/v1/providers?q= stays consistent with
    // /api/v1/services?q=.
    where.push(
      `(providers.business_name LIKE ? ESCAPE '\\' OR providers.about LIKE ? ESCAPE '\\' OR categories.name LIKE ? ESCAPE '\\')`,
    );
    const like = likePattern(text);
    params.push(like, like, like);
  }

  const clause = where.join(' AND ');
  const rows = db.all(
    `SELECT ${CARD_COLUMNS} FROM providers
     LEFT JOIN categories ON categories.id = providers.category_id
     LEFT JOIN locations  ON locations.id  = providers.location_id
     WHERE ${clause}
     ORDER BY providers.is_verified DESC, providers.rating_avg DESC, providers.business_name
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = Number(
    // Same joins as the row query: the text filter can reference
    // categories.name, so the count must see that table too.
    db.scalar(
      `SELECT COUNT(*) FROM providers
       LEFT JOIN categories ON categories.id = providers.category_id
       LEFT JOIN locations  ON locations.id  = providers.location_id
       WHERE ${clause}`,
      params,
    ) ?? 0,
  );
  return { items: rows.map(baseCard), total };
}

/** Add/replace the extra PIN codes a provider serves. */
function setServiceAreas(db, providerId, pins) {
  const unique = [...new Set((pins || []).map((pin) => String(pin)).filter(isValidPin))];
  db.transaction(() => {
    db.run('DELETE FROM service_areas WHERE provider_id = ?', [providerId]);
    for (const pin of unique) {
      const location = db.get('SELECT id FROM locations WHERE pin_code = ? LIMIT 1', [pin]);
      db.run('INSERT INTO service_areas (provider_id, pin_code, location_id) VALUES (?, ?, ?)', [
        providerId,
        pin,
        location ? location.id : null,
      ]);
    }
  });
  return unique;
}

function serviceAreas(db, providerId) {
  return db.all('SELECT pin_code FROM service_areas WHERE provider_id = ? ORDER BY pin_code', [providerId])
    .map((row) => row.pin_code);
}

/** Persist only server-produced HTTPS/local image URLs, never raw uploads. */
function setPhotoUrls(db, providerId, urls) {
  const provider = findById(db, providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const clean = publicPhotoUrls(urls);
  db.run(
    `UPDATE providers SET photo_urls = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [JSON.stringify(clean), providerId],
  );
  return clean;
}

function setStatus(db, id, status) {
  if (!['pending', 'active', 'suspended'].includes(status)) throw new Error(`Unknown status: ${status}`);
  return db.run(`UPDATE providers SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [status, id]);
}

function count(db, { status = 'active' } = {}) {
  return Number(db.scalar('SELECT COUNT(*) FROM providers WHERE status = ?', [status]) ?? 0);
}

module.exports = {
  COLUMNS,
  CARD_COLUMNS,
  publicPhotoUrls,
  createProvider,
  findById,
  findBySlug,
  byUserId,
  updateProvider,
  searchProviders,
  setServiceAreas,
  serviceAreas,
  setPhotoUrls,
  setStatus,
  count,
};
