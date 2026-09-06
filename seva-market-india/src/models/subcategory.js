'use strict';
/**
 * SEVA MARKET INDIA — subcategory model.
 *
 * Subcategories are the second level of the catalog:
 *   Category (e.g. Beauty & Personal Care) → Subcategory (e.g. Makeup Services)
 *   → Service (e.g. Bridal Makeup)
 *
 * Each subcategory belongs to exactly one category. Slugs are globally unique
 * for stable URLs and SEO.
 */

const { slugify, cleanText, likePattern } = require('../db/values');

const COLUMNS = 'id, category_id, name, slug, description, icon, image, sort_order, is_active, created_at, updated_at';

function ensureSubcategory(db, { categoryId, name, description = null, icon = null, image = null, sortOrder = 0, isActive = true }) {
  const cleanName = cleanText(name, 80);
  if (!cleanName) throw new Error('Subcategory name is required.');
  if (!categoryId) throw new Error('categoryId is required.');
  const category = db.get('SELECT id FROM categories WHERE id = ?', [categoryId]);
  if (!category) throw new Error(`Unknown category: ${categoryId}`);

  const slug = slugify(cleanName);
  if (!slug) throw new Error(`Cannot slugify subcategory name: ${name}`);

  const existing = db.get(`SELECT ${COLUMNS} FROM subcategories WHERE slug = ?`, [slug]);
  if (existing) return { ...existing, is_active: Boolean(existing.is_active) };

  const result = db.run(
    `INSERT INTO subcategories (category_id, name, slug, description, icon, image, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [categoryId, cleanName, slug, cleanText(description, 500), cleanText(icon, 40), cleanText(image, 500), sortOrder, isActive ? 1 : 0],
  );
  return findById(db, Number(result.lastInsertRowid));
}

function createSubcategory(db, { categoryId, name, description = null, icon = null, image = null, sortOrder = 0, isActive = true }) {
  const cleanName = cleanText(name, 80);
  if (!cleanName) throw new Error('Subcategory name is required.');
  if (!categoryId) throw new Error('categoryId is required.');
  const category = db.get('SELECT id FROM categories WHERE id = ?', [categoryId]);
  if (!category) throw new Error(`Unknown category: ${categoryId}`);
  const slug = slugify(cleanName);
  if (!slug) throw new Error(`Cannot slugify subcategory name: ${name}`);
  if (db.get('SELECT id FROM subcategories WHERE slug = ?', [slug])) {
    throw new Error(`Subcategory slug "${slug}" already exists.`);
  }
  const result = db.run(
    `INSERT INTO subcategories (category_id, name, slug, description, icon, image, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [categoryId, cleanName, slug, cleanText(description, 500), cleanText(icon, 40), cleanText(image, 500), sortOrder, isActive ? 1 : 0],
  );
  return findById(db, Number(result.lastInsertRowid));
}

function updateSubcategory(db, id, { categoryId = null, name = null, description = null, icon = null, image = null, sortOrder = null, isActive = null }) {
  const existing = findById(db, id);
  if (!existing) throw new Error(`Subcategory ${id} not found.`);
  const updates = [];
  const params = [];
  if (categoryId !== null && categoryId !== undefined) {
    const cat = db.get('SELECT id FROM categories WHERE id = ?', [categoryId]);
    if (!cat) throw new Error(`Unknown category: ${categoryId}`);
    updates.push('category_id = ?');
    params.push(categoryId);
  }
  if (name !== null && name !== undefined) {
    const cleanName = cleanText(name, 80);
    if (!cleanName) throw new Error('Subcategory name is required.');
    const slug = slugify(cleanName);
    if (!slug) throw new Error(`Cannot slugify subcategory name: ${name}`);
    const clash = db.get('SELECT id FROM subcategories WHERE slug = ? AND id != ?', [slug, id]);
    if (clash) throw new Error(`Subcategory slug "${slug}" already exists.`);
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
  db.run(`UPDATE subcategories SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
  return findById(db, id);
}

function setActive(db, id, isActive) {
  return updateSubcategory(db, id, { isActive });
}

function removeSubcategory(db, id) {
  const svcCount = db.scalar('SELECT COUNT(*) FROM catalog_services WHERE subcategory_id = ?', [id]) || 0;
  if (svcCount > 0) throw new Error('Subcategory is in use and cannot be deleted. Deactivate it instead.');
  db.run('DELETE FROM subcategories WHERE id = ?', [id]);
  return true;
}

function reorder(db, categoryId, orderedIds) {
  db.transaction(() => {
    orderedIds.forEach((id, index) => {
      db.run("UPDATE subcategories SET sort_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND category_id = ?", [index, id, categoryId]);
    });
  });
}

function findById(db, id) {
  const row = db.get(`SELECT ${COLUMNS} FROM subcategories WHERE id = ?`, [id]);
  if (!row) return null;
  return { ...row, is_active: Boolean(row.is_active) };
}

function findBySlug(db, slug) {
  const row = db.get(`SELECT ${COLUMNS} FROM subcategories WHERE slug = ?`, [slug]);
  if (!row) return null;
  return { ...row, is_active: Boolean(row.is_active) };
}

function findByCategory(db, categoryId, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'AND is_active = 1';
  return db.all(
    `SELECT ${COLUMNS} FROM subcategories WHERE category_id = ? ${where} ORDER BY sort_order, name`,
    [categoryId],
  ).map((r) => ({ ...r, is_active: Boolean(r.is_active) }));
}

function findAll(db, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  return db.all(`SELECT ${COLUMNS} FROM subcategories ${where} ORDER BY sort_order, name`).map((r) => ({ ...r, is_active: Boolean(r.is_active) }));
}

function count(db, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  return Number(db.scalar(`SELECT COUNT(*) FROM subcategories ${where}`) ?? 0);
}

function search(db, query, { categoryId = null, includeInactive = false, limit = 50 } = {}) {
  const text = cleanText(query, 80);
  if (!text) return [];
  const like = likePattern(text);
  const clauses = ["(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')"];
  const params = [like, like];
  if (!includeInactive) clauses.push('is_active = 1');
  if (categoryId) {
    clauses.push('category_id = ?');
    params.push(categoryId);
  }
  params.push(limit);
  return db.all(
    `SELECT ${COLUMNS} FROM subcategories WHERE ${clauses.join(' AND ')} ORDER BY sort_order, name LIMIT ?`,
    params,
  ).map((r) => ({ ...r, is_active: Boolean(r.is_active) }));
}

function withCategory(db, id) {
  const sub = findById(db, id);
  if (!sub) return null;
  const cat = db.get('SELECT id, name, slug FROM categories WHERE id = ?', [sub.category_id]);
  return { ...sub, category: cat || null };
}

module.exports = {
  COLUMNS,
  ensureSubcategory,
  createSubcategory,
  updateSubcategory,
  setActive,
  removeSubcategory,
  reorder,
  findById,
  findBySlug,
  findByCategory,
  findAll,
  count,
  search,
  withCategory,
};
