'use strict';
/**
 * SEVA MARKET INDIA — location model.
 *
 * The geography tree is the backbone of the marketplace: every provider and
 * service hangs off a `locations` row, and customer search is expressed as
 * service + location + PIN. This module owns creation (with breadcrumb
 * maintenance), traversal and lookup.
 */

const { LOCATION_KINDS, LOCATION_ORDER, slugify, isValidPin, breadcrumb, cleanText, likePattern } = require('../db/values');

const COLUMNS = 'id, kind, parent_id, name, slug, code, pin_code, latitude, longitude, search_text, is_active';

/** Walk from a node up to the root, returning the chain root-first. */
function chainFor(db, locationId) {
  const chain = [];
  let currentId = locationId;
  const seen = new Set();

  while (currentId !== null && currentId !== undefined && !seen.has(currentId)) {
    seen.add(currentId);
    const row = db.get(`SELECT ${COLUMNS} FROM locations WHERE id = ?`, [currentId]);
    if (!row) break;
    chain.unshift(row);
    currentId = row.parent_id;
  }
  return chain;
}

/** Human-readable breadcrumb, e.g. "Uzan Bazar, Guwahati, Assam, India". */
function breadcrumbFor(db, locationId) {
  const chain = chainFor(db, locationId);
  chain.reverse(); // deepest first reads better in a provider card
  return breadcrumb(chain);
}

/**
 * Insert (or fetch the existing) location, maintaining `search_text`.
 * Idempotent by (kind, parent_id, slug) so the seed script can be re-run.
 */
function ensureLocation(db, { kind, parentId = null, name, code = null, pinCode = null, latitude = null, longitude = null }) {
  if (!LOCATION_KINDS.includes(kind)) {
    throw new Error(`Unknown location kind: ${kind}`);
  }
  const cleanName = cleanText(name, 120);
  if (!cleanName) throw new Error('Location name is required.');

  const pin = pinCode === null || pinCode === undefined ? null : String(pinCode);
  if (kind === 'pincode' && !isValidPin(pin)) {
    throw new Error(`Invalid PIN code: ${pinCode}`);
  }

  const slug = kind === 'pincode' ? `pin-${pin}` : slugify(cleanName) || slugify(String(kind));
  if (!slug) throw new Error(`Cannot slugify location name: ${name}`);

  const existing = db.get(
    `SELECT ${COLUMNS} FROM locations WHERE kind = ? AND slug = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))`,
    [kind, slug, parentId, parentId],
  );
  if (existing) return existing;

  let parent = null;
  if (parentId !== null && parentId !== undefined) {
    parent = db.get(`SELECT ${COLUMNS} FROM locations WHERE id = ?`, [parentId]);
    if (!parent) throw new Error(`Parent location ${parentId} not found.`);
    const childRank = LOCATION_ORDER[kind];
    const parentRank = LOCATION_ORDER[parent.kind];
    // The hierarchy is strict: each level has exactly one valid parent level.
    // Allowing a PIN to hang straight off a state is how address data rots.
    if (childRank !== parentRank + 1) {
      throw new Error(`A ${kind} cannot sit under a ${parent.kind} — expected it under a ${LOCATION_KINDS[childRank - 1]}.`);
    }
  }

  const parentChain = parent ? chainFor(db, parent.id) : [];
  const chainNames = [...parentChain.map((node) => node.name), cleanName];
  // Breadcrumbs read deepest-first on the site: "Guwahati, Assam, India".
  const searchText = [...chainNames].reverse().join(', ');

  const result = db.run(
    `INSERT INTO locations (kind, parent_id, name, slug, code, pin_code, latitude, longitude, search_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [kind, parent ? parent.id : null, cleanName, slug, code, pin, latitude, longitude, searchText],
  );

  return db.get(`SELECT ${COLUMNS} FROM locations WHERE id = ?`, [Number(result.lastInsertRowid)]);
}

/** Direct children of a node, optionally filtered by kind. */
function findChildren(db, parentId, kind = null) {
  if (parentId === null || parentId === undefined) {
    return db.all(
      `SELECT ${COLUMNS} FROM locations WHERE parent_id IS NULL AND is_active = 1
       ${kind ? 'AND kind = ?' : ''} ORDER BY name`,
      kind ? [kind] : [],
    );
  }
  return db.all(
    `SELECT ${COLUMNS} FROM locations WHERE parent_id = ? AND is_active = 1
     ${kind ? 'AND kind = ?' : ''} ORDER BY name`,
    kind ? [parentId, kind] : [parentId],
  );
}

/** Look a location up by slug + kind (used by /state/:slug style URLs). */
function findBySlug(db, kind, slug) {
  return db.get(`SELECT ${COLUMNS} FROM locations WHERE kind = ? AND slug = ?`, [kind, slug]);
}

/**
 * Resolve a PIN code to its full chain, root-first.
 * A PIN may repeat across localities; the first active match wins.
 */
function findByPin(db, pin) {
  if (!isValidPin(String(pin))) return null;
  const node = db.get(
    `SELECT ${COLUMNS} FROM locations WHERE pin_code = ? AND is_active = 1 ORDER BY id LIMIT 1`,
    [String(pin)],
  );
  return node ? { node, chain: chainFor(db, node.id) } : null;
}

/** Free-text search over the breadcrumb column. */
function search(db, query, { kind = null, limit = 20 } = {}) {
  const text = cleanText(query, 80);
  if (!text) return [];
  const like = likePattern(text);
  const params = [like];
  let kindClause = '';
  if (kind) {
    kindClause = 'AND kind = ?';
    params.push(kind);
  }
  params.push(limit);
  return db.all(
    `SELECT ${COLUMNS} FROM locations
     WHERE is_active = 1 AND search_text LIKE ? ESCAPE '\\' ${kindClause}
     ORDER BY kind, name LIMIT ?`,
    params,
  );
}

/**
 * Every descendant id of a node (itself included). A service hangs off a
 * locality row, so searching "state=assam" or a city needs the full
 * subtree, not one id. The tree is ~100 rows in this build — recursion in
 * JS over four levels is fine and avoids N SQL round-trips.
 */
function descendantIds(db, locationId) {
  const ids = [locationId];
  const queue = [locationId];
  while (queue.length) {
    const parentId = queue.shift();
    const children = db.all(
      'SELECT id FROM locations WHERE parent_id = ? AND is_active = 1',
      [parentId],
    );
    for (const child of children) {
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

/** The India root row, creating it on first use. */
function ensureIndia(db) {
  return ensureLocation(db, { kind: 'country', name: 'India', code: 'IN' });
}

/** Counts per level — used by the homepage stats strip. */
function stats(db) {
  const rows = db.all('SELECT kind, COUNT(*) AS total FROM locations WHERE is_active = 1 GROUP BY kind');
  const totals = Object.fromEntries(LOCATION_KINDS.map((kind) => [kind, 0]));
  for (const row of rows) totals[row.kind] = row.total;
  return totals;
}

module.exports = {
  COLUMNS,
  chainFor,
  breadcrumbFor,
  ensureLocation,
  ensureIndia,
  findChildren,
  findBySlug,
  findByPin,
  descendantIds,
  search,
  stats,
};
