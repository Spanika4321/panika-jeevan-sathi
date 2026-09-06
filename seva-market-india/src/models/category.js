'use strict';
/**
 * SEVA MARKET INDIA — category model.
 *
 * Categories are the top level of the catalog. In the foundation build they
 * were a two-level self-referencing tree (parent_id). After 0002 the
 * canonical second level lives in `subcategories`, but the self-reference is
 * retained for backward compatibility — existing child-category rows continue
 * to work and are returned by `tree()` alongside the new `subcategories`.
 *
 * Every category carries the same editorial fields required by the spec:
 * name, slug, description, icon, image, sort_order, is_active.
 * Slugs are globally unique because they appear in public URLs and for SEO.
 */

const { slugify, cleanText } = require('../db/values');

const COLUMNS = 'id, parent_id, name, slug, description, icon, image, sort_order, is_active, created_at, updated_at';

function ensureCategory(db, { name, parentId = null, description = null, icon = null, image = null, sortOrder = 0, isActive = 1 }) {
  const cleanName = cleanText(name, 80);
  if (!cleanName) throw new Error('Category name is required.');

  const slug = slugify(cleanName);
  if (!slug) throw new Error(`Cannot slugify category name: ${name}`);

  if (parentId !== null && parentId !== undefined) {
    const parent = db.get(`SELECT ${COLUMNS} FROM categories WHERE id = ?`, [parentId]);
    if (!parent) throw new Error(`Parent category ${parentId} not found.`);
    if (parent.parent_id !== null) throw new Error('Categories nest at most two levels deep.');
  }

  const existing = db.get(`SELECT ${COLUMNS} FROM categories WHERE slug = ?`, [slug]);
  if (existing) return existing;

  const result = db.run(
    `INSERT INTO categories (parent_id, name, slug, description, icon, image, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [parentId ?? null, cleanName, slug, cleanText(description, 500), cleanText(icon, 40), cleanText(image, 500), sortOrder, isActive ? 1 : 0],
  );
  return db.get(`SELECT ${COLUMNS} FROM categories WHERE id = ?`, [Number(result.lastInsertRowid)]);
}

function createCategory(db, { name, description = null, icon = null, image = null, sortOrder = 0, isActive = true }) {
  const cleanName = cleanText(name, 80);
  if (!cleanName) throw new Error('Category name is required.');
  const slug = slugify(cleanName);
  if (!slug) throw new Error(`Cannot slugify category name: ${name}`);
  if (db.get('SELECT id FROM categories WHERE slug = ?', [slug])) {
    throw new Error(`Category slug "${slug}" already exists.`);
  }
  const result = db.run(
    `INSERT INTO categories (parent_id, name, slug, description, icon, image, sort_order, is_active)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [cleanName, slug, cleanText(description, 500), cleanText(icon, 40), cleanText(image, 500), sortOrder, isActive ? 1 : 0],
  );
  return db.get(`SELECT ${COLUMNS} FROM categories WHERE id = ?`, [Number(result.lastInsertRowid)]);
}

function updateCategory(db, id, { name = null, description = null, icon = null, image = null, sortOrder = null, isActive = null }) {
  const existing = findById(db, id);
  if (!existing) throw new Error(`Category ${id} not found.`);
  const updates = [];
  const params = [];
  if (name !== null && name !== undefined) {
    const cleanName = cleanText(name, 80);
    if (!cleanName) throw new Error('Category name is required.');
    const slug = slugify(cleanName);
    if (!slug) throw new Error(`Cannot slugify category name: ${name}`);
    const clash = db.get('SELECT id FROM categories WHERE slug = ? AND id != ?', [slug, id]);
    if (clash) throw new Error(`Category slug "${slug}" already exists.`);
    updates.push('name = ?', 'slug = ?');
    params.push(cleanName, slug);
  }
  if (description !== null && description !== undefined) {
    updates.push('description = ?');
    params.push(cleanText(description, 500));
  }
  if (icon !== null && icon !== undefined) {
    updates.push('icon = ?');
    params.push(cleanText(icon, 40));
  }
  if (image !== null && image !== undefined) {
    updates.push('image = ?');
    params.push(cleanText(image, 500));
  }
  if (sortOrder !== null && sortOrder !== undefined) {
    updates.push('sort_order = ?');
    params.push(Math.trunc(Number(sortOrder)) || 0);
  }
  if (isActive !== null && isActive !== undefined) {
    updates.push('is_active = ?');
    params.push(isActive ? 1 : 0);
  }
  if (!updates.length) return existing;
  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  db.run(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
  return findById(db, id);
}

function setActive(db, id, isActive) {
  return updateCategory(db, id, { isActive });
}

function removeCategory(db, id) {
  // Hard delete only if no subcategories or services rely on it; otherwise
  // deactivate. This keeps admin usage safe without code awareness.
  const subCount = db.scalar('SELECT COUNT(*) FROM subcategories WHERE category_id = ?', [id]) || 0;
  const svcCount = db.scalar('SELECT COUNT(*) FROM catalog_services WHERE category_id = ?', [id]) || 0;
  const providerCount = db.scalar('SELECT COUNT(*) FROM providers WHERE category_id = ?', [id]) || 0;
  const serviceCount = db.scalar('SELECT COUNT(*) FROM services WHERE category_id = ?', [id]) || 0;
  if (subCount > 0 || svcCount > 0 || providerCount > 0 || serviceCount > 0) {
    throw new Error('Category is in use and cannot be deleted. Deactivate it instead.');
  }
  const childCount = db.scalar('SELECT COUNT(*) FROM categories WHERE parent_id = ?', [id]) || 0;
  if (childCount > 0) throw new Error('Category has child categories and cannot be deleted.');
  db.run('DELETE FROM categories WHERE id = ?', [id]);
  return true;
}

function reorder(db, orderedIds) {
  db.transaction(() => {
    orderedIds.forEach((id, index) => {
      db.run("UPDATE categories SET sort_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [index, id]);
    });
  });
}

/** Top-level categories with their children attached (legacy + new). */
function tree(db, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  const rows = db.all(
    `SELECT ${COLUMNS} FROM categories ${where} ORDER BY sort_order, name`,
  );
  const parents = rows.filter((row) => row.parent_id === null);
  return parents.map((parent) => ({
    ...parent,
    is_active: Boolean(parent.is_active),
    children: rows.filter((row) => row.parent_id === parent.id).map((c) => ({ ...c, is_active: Boolean(c.is_active) })),
  }));
}

function findAll(db, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  return db.all(`SELECT ${COLUMNS} FROM categories ${where} ORDER BY sort_order, name`).map((r) => ({ ...r, is_active: Boolean(r.is_active) }));
}

function findById(db, id) {
  const row = db.get(`SELECT ${COLUMNS} FROM categories WHERE id = ?`, [id]);
  if (!row) return null;
  return { ...row, is_active: Boolean(row.is_active) };
}

function findBySlug(db, slug) {
  const row = db.get(`SELECT ${COLUMNS} FROM categories WHERE slug = ?`, [slug]);
  if (!row) return null;
  return { ...row, is_active: Boolean(row.is_active) };
}

/** A category plus its parent (for headings). */
function withParent(db, id) {
  const category = findById(db, id);
  if (!category) return null;
  return { ...category, parent: category.parent_id ? findById(db, category.parent_id) : null };
}

/**
 * Every category id that should match a query on `id`: the category itself
 * plus its legacy children, so searching top-level also returns child services.
 */
function selfAndDescendantIds(db, id) {
  const ids = [id];
  const children = db.all('SELECT id FROM categories WHERE parent_id = ?', [id]);
  for (const child of children) ids.push(child.id);
  return ids;
}

function count(db, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  return Number(db.scalar(`SELECT COUNT(*) FROM categories ${where}`) ?? 0);
}

function search(db, query, { includeInactive = false, limit = 50 } = {}) {
  const text = cleanText(query, 80);
  if (!text) return [];
  const like = `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const activeClause = includeInactive ? '' : 'AND is_active = 1';
  return db.all(
    `SELECT ${COLUMNS} FROM categories WHERE (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ${activeClause} ORDER BY sort_order, name LIMIT ?`,
    [like, like, limit],
  ).map((r) => ({ ...r, is_active: Boolean(r.is_active) }));
}

module.exports = {
  COLUMNS,
  ensureCategory,
  createCategory,
  updateCategory,
  setActive,
  removeCategory,
  reorder,
  tree,
  findAll,
  findById,
  findBySlug,
  withParent,
  selfAndDescendantIds,
  count,
  search,
};
