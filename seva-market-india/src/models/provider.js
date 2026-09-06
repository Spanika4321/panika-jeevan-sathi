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

// Public columns only. `review_note`, `reviewed_at` and `gst_number` are
// deliberately absent: they must never ride along on a public profile.
const COLUMNS = `providers.id, providers.user_id, providers.business_name, providers.slug,
  providers.contact_name, providers.phone, providers.alt_phone, providers.email,
  providers.category_id, providers.location_id, providers.pin_code, providers.address_line,
  providers.about, providers.experience_years, providers.website, providers.is_verified,
  providers.verified_at, providers.status, providers.rating_avg, providers.rating_count,
  providers.created_at`;

/** Everything an owner (or an admin) is allowed to see about their listing. */
const OWNER_COLUMNS = `${COLUMNS}, providers.gst_number, providers.review_note, providers.reviewed_at,
  providers.updated_at`;

/** Denormalised columns for search results: category + place names. */
const CARD_COLUMNS = `${COLUMNS},
  categories.name AS category_name, categories.slug AS category_slug,
  locations.search_text AS location_label`;

function baseCard(row) {
  if (!row) return null;
  return { ...row, is_verified: Boolean(row.is_verified) };
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
  expandTree = false,
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
  if (locationId) {
    if (expandTree) {
      where.push(require('./location').subtreeInClause('providers.location_id'));
    } else {
      where.push('providers.location_id = ?');
    }
    params.push(locationId);
  }
  if (pin) {
    where.push('(providers.pin_code = ? OR EXISTS (SELECT 1 FROM service_areas sa WHERE sa.provider_id = providers.id AND sa.pin_code = ?))');
    params.push(pin, pin);
  }
  if (verifiedOnly) where.push('providers.is_verified = 1');

  const text = cleanText(query, 80);
  if (text) {
    where.push(
      `(providers.business_name LIKE ? ESCAPE '\\' OR providers.about LIKE ? ESCAPE '\\')`,
    );
    const like = likePattern(text);
    params.push(like, like);
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
    // The count shares the WHERE clause and the parameters, so pagination
    // totals can never disagree with the page they describe.
    db.scalar(`SELECT COUNT(*) FROM providers WHERE ${clause}`, params) ?? 0,
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

/**
 * Patch the fields a provider owns. `status` and `is_verified` are excluded
 * on purpose: those belong to the review queue, not to the business.
 * The slug never changes, so published URLs survive a rebrand.
 */
const EDITABLE = ['contact_name', 'phone', 'alt_phone', 'email', 'address_line', 'about',
  'experience_years', 'website', 'gst_number', 'category_id', 'location_id', 'pin_code', 'business_name'];

function updateProvider(db, id, patch = {}) {
  const provider = db.get('SELECT id, slug FROM providers WHERE id = ?', [id]);
  if (!provider) throw new Error(`Unknown provider: ${id}`);

  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!EDITABLE.includes(key) || value === undefined) continue;
    if (key === 'phone' || key === 'alt_phone') {
      const digits = normalizePhone(value);
      if (key === 'phone' && !digits) throw new Error('A valid 10-digit Indian mobile number is required.');
      sets.push(`${key} = ?`);
      params.push(digits);
      continue;
    }
    if (key === 'email') {
      sets.push('email = ?');
      params.push(cleanText(value, 254)?.toLowerCase() ?? null);
      continue;
    }
    if (key === 'website') {
      sets.push('website = ?');
      params.push(cleanWebsite(value));
      continue;
    }
    if (key === 'gst_number') {
      sets.push('gst_number = ?');
      params.push(cleanGst(value));
      continue;
    }
    if (key === 'experience_years') {
      sets.push('experience_years = ?');
      params.push(Math.max(0, Math.trunc(Number(value) || 0)));
      continue;
    }
    if (key === 'category_id' || key === 'location_id') {
      const table = key === 'category_id' ? 'categories' : 'locations';
      const found = db.get(`SELECT id FROM ${table} WHERE id = ?`, [Number(value)]);
      if (!found) throw new Error(`Unknown ${table.slice(0, -1)}: ${value}`);
      sets.push(`${key} = ?`);
      params.push(Number(value));
      continue;
    }
    if (key === 'pin_code') {
      const pin = value ? String(value) : null;
      if (pin !== null && !isValidPin(pin)) throw new Error(`Invalid PIN code: ${pin}`);
      sets.push('pin_code = ?');
      params.push(pin);
      continue;
    }
    if (key === 'business_name') {
      const name = cleanText(value, 140);
      if (!name) throw new Error('Business name is required.');
      sets.push('business_name = ?');
      params.push(name);
      continue;
    }
    sets.push(`${key} = ?`);
    params.push(cleanText(value, key === 'about' ? 2000 : 200));
  }

  if (!sets.length) return findById(db, id);
  params.push(id);
  db.run(
    `UPDATE providers SET ${sets.join(', ')},
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    params,
  );
  return findById(db, id);
}

/** Only http(s) links, no javascript: URLs, capped at 200 characters. */
function cleanWebsite(value) {
  const text = cleanText(value, 200);
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href.slice(0, 200);
  } catch (_) {
    return null;
  }
}

/**
 * Indian GSTIN: 22AAAAA0000A1Z5 — two digits, five letters, four digits,
 * an entity check character, a Z and a checksum. Length is checked after
 * whitespace removal so a spaced-out paste still works, and separators do
 * not: "22-AAAAA" is not a GSTIN anyone should be able to save.
 */
function cleanGst(value) {
  const text = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  if (text.length !== 15) return null;
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(text) ? text : null;
}

/** The provider a signed-in account manages (newest first). */
function findForUser(db, userId) {
  const row = db.get(
    `SELECT ${OWNER_COLUMNS} FROM providers WHERE user_id = ? ORDER BY status = 'active' DESC, id DESC LIMIT 1`,
    [userId],
  );
  if (!row) return null;
  return {
    ...row,
    is_verified: Boolean(row.is_verified),
    service_areas: serviceAreas(db, row.id),
    documents: require('./verification').documents(db, row.id),
  };
}

function listForUser(db, userId) {
  return db.all(
    `SELECT ${COLUMNS}, (SELECT COUNT(*) FROM services s WHERE s.provider_id = providers.id) AS service_count
     FROM providers WHERE user_id = ? ORDER BY id DESC`,
    [userId],
  ).map(baseCard);
}

/** Attach an existing (e.g. seed-created) listing to an account. */
function claimForUser(db, providerId, userId) {
  const provider = db.get('SELECT id, user_id FROM providers WHERE id = ?', [providerId]);
  if (!provider) throw new Error('Provider not found.');
  if (provider.user_id && provider.user_id !== userId) throw new Error('That listing already belongs to another account.');
  db.run('UPDATE providers SET user_id = ? WHERE id = ?', [userId, providerId]);
  return findById(db, providerId);
}

/** Dashboard summary numbers. */
function statsFor(db, providerId) {
  const row = db.get(
    `SELECT
       (SELECT COUNT(*) FROM services s WHERE s.provider_id = p.id AND s.status = 'active')  AS active_services,
       (SELECT COUNT(*) FROM services s WHERE s.provider_id = p.id AND s.status = 'draft')   AS draft_services,
       (SELECT COUNT(*) FROM services s WHERE s.provider_id = p.id)                          AS total_services,
       (SELECT COUNT(*) FROM leads l WHERE l.provider_id = p.id AND l.status = 'new')        AS new_leads,
       (SELECT COUNT(*) FROM leads l WHERE l.provider_id = p.id)                             AS total_leads,
       (SELECT COUNT(*) FROM service_areas sa WHERE sa.provider_id = p.id)                   AS area_count
     FROM providers p WHERE p.id = ?`,
    [providerId],
  ) || {};
  return {
    active_services: Number(row.active_services ?? 0),
    draft_services: Number(row.draft_services ?? 0),
    total_services: Number(row.total_services ?? 0),
    new_leads: Number(row.new_leads ?? 0),
    total_leads: Number(row.total_leads ?? 0),
    area_count: Number(row.area_count ?? 0),
  };
}

/**
 * How complete a listing is, 0-100. Drives the dashboard progress bar and
 * nudges providers towards the fields customers actually filter on.
 */
function completeness(provider) {
  if (!provider) return 0;
  const checks = [
    Boolean(provider.business_name),
    Boolean(provider.contact_name),
    Boolean(provider.phone),
    Boolean(provider.address_line),
    (provider.about || '').length >= 60,
    Number(provider.experience_years) > 0,
    Number(provider.rating_count) > 0 || provider.is_verified === 1 || provider.is_verified === true,
    Number(provider.service_area_count ?? 0) > 0 || (provider.service_areas || []).length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
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
  OWNER_COLUMNS,
  CARD_COLUMNS,
  EDITABLE,
  createProvider,
  updateProvider,
  findById,
  findBySlug,
  findForUser,
  listForUser,
  claimForUser,
  searchProviders,
  setServiceAreas,
  serviceAreas,
  statsFor,
  completeness,
  cleanWebsite,
  cleanGst,
  setStatus,
  count,
};
