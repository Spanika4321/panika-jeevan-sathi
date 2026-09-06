'use strict';
/**
 * SEVA MARKET INDIA — catalog service model.
 *
 * Catalog services are the leaf of the hierarchy:
 *   Category → Subcategory → CatalogService
 *
 * They are provider-agnostic definitions (e.g. "Bridal Makeup") used for
 * browsing, search and SEO. Provider-owned offers remain in the legacy
 * `services` table.
 */

const { slugify, cleanText, likePattern } = require('../db/values');

const COLUMNS = 'catalog_services.id, catalog_services.category_id, catalog_services.subcategory_id, catalog_services.name, catalog_services.slug, catalog_services.description, catalog_services.icon, catalog_services.image, catalog_services.sort_order, catalog_services.is_active, catalog_services.created_at, catalog_services.updated_at';
const CARD_COLUMNS = `catalog_services.id, catalog_services.category_id, catalog_services.subcategory_id, catalog_services.name, catalog_services.slug, catalog_services.description, catalog_services.icon, catalog_services.image, catalog_services.sort_order, catalog_services.is_active, catalog_services.created_at, catalog_services.updated_at, categories.name AS category_name, categories.slug AS category_slug, subcategories.name AS subcategory_name, subcategories.slug AS subcategory_slug`;

function ensureCatalogService(db, { categoryId, subcategoryId = null, name, description = null, icon = null, image = null, sortOrder = 0, isActive = true }) {
  const cleanName = cleanText(name, 100);
  if (!cleanName) throw new Error('Service name is required.');
  if (!categoryId) throw new Error('categoryId is required.');
  const cat = db.get('SELECT id FROM categories WHERE id = ?', [categoryId]);
  if (!cat) throw new Error(`Unknown category: ${categoryId}`);
  if (subcategoryId !== null && subcategoryId !== undefined) {
    const sub = db.get('SELECT id, category_id FROM subcategories WHERE id = ?', [subcategoryId]);
    if (!sub) throw new Error(`Unknown subcategory: ${subcategoryId}`);
    if (Number(sub.category_id) !== Number(categoryId)) {
      throw new Error('Subcategory does not belong to the given category.');
    }
  }
  const slug = slugify(cleanName);
  if (!slug) throw new Error(`Cannot slugify service name: ${name}`);
  const existing = db.get(`SELECT ${COLUMNS} FROM catalog_services WHERE slug = ?`, [slug]);
  if (existing) return { ...existing, is_active: Boolean(existing.is_active) };

  const result = db.run(
    `INSERT INTO catalog_services (category_id, subcategory_id, name, slug, description, icon, image, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [categoryId, subcategoryId ?? null, cleanName, slug, cleanText(description, 1000), cleanText(icon, 40), cleanText(image, 500), sortOrder, isActive ? 1 : 0],
  );
  return findById(db, Number(result.lastInsertRowid));
}

function createCatalogService(db, { categoryId, subcategoryId = null, name, description = null, icon = null, image = null, sortOrder = 0, isActive = true }) {
  const cleanName = cleanText(name, 100);
  if (!cleanName) throw new Error('Service name is required.');
  if (!categoryId) throw new Error('categoryId is required.');
  const cat = db.get('SELECT id FROM categories WHERE id = ?', [categoryId]);
  if (!cat) throw new Error(`Unknown category: ${categoryId}`);
  if (subcategoryId !== null && subcategoryId !== undefined) {
    const sub = db.get('SELECT id, category_id FROM subcategories WHERE id = ?', [subcategoryId]);
    if (!sub) throw new Error(`Unknown subcategory: ${subcategoryId}`);
    if (Number(sub.category_id) !== Number(categoryId)) throw new Error('Subcategory does not belong to the given category.');
  }
  const slug = slugify(cleanName);
  if (!slug) throw new Error(`Cannot slugify service name: ${name}`);
  if (db.get('SELECT id FROM catalog_services WHERE slug = ?', [slug])) {
    throw new Error(`Service slug "${slug}" already exists.`);
  }
  const result = db.run(
    `INSERT INTO catalog_services (category_id, subcategory_id, name, slug, description, icon, image, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [categoryId, subcategoryId ?? null, cleanName, slug, cleanText(description, 1000), cleanText(icon, 40), cleanText(image, 500), sortOrder, isActive ? 1 : 0],
  );
  return findById(db, Number(result.lastInsertRowid));
}

function updateCatalogService(db, id, { categoryId = null, subcategoryId = null, name = null, description = null, icon = null, image = null, sortOrder = null, isActive = null }) {
  const existing = findById(db, id);
  if (!existing) throw new Error(`Service ${id} not found.`);
  const updates = [];
  const params = [];

  let targetCategoryId = existing.category_id;
  if (categoryId !== null && categoryId !== undefined) {
    const cat = db.get('SELECT id FROM categories WHERE id = ?', [categoryId]);
    if (!cat) throw new Error(`Unknown category: ${categoryId}`);
    targetCategoryId = categoryId;
    updates.push('category_id = ?');
    params.push(categoryId);
  }
  if (subcategoryId !== null) {
    if (subcategoryId === undefined) {
      // no-op
    } else if (subcategoryId === null) {
      updates.push('subcategory_id = ?');
      params.push(null);
    } else {
      const sub = db.get('SELECT id, category_id FROM subcategories WHERE id = ?', [subcategoryId]);
      if (!sub) throw new Error(`Unknown subcategory: ${subcategoryId}`);
      if (Number(sub.category_id) !== Number(targetCategoryId)) throw new Error('Subcategory does not belong to the given category.');
      updates.push('subcategory_id = ?');
      params.push(subcategoryId);
    }
  }
  if (name !== null && name !== undefined) {
    const cleanName = cleanText(name, 100);
    if (!cleanName) throw new Error('Service name is required.');
    const slug = slugify(cleanName);
    if (!slug) throw new Error(`Cannot slugify service name: ${name}`);
    const clash = db.get('SELECT id FROM catalog_services WHERE slug = ? AND id != ?', [slug, id]);
    if (clash) throw new Error(`Service slug "${slug}" already exists.`);
    updates.push('name = ?', 'slug = ?');
    params.push(cleanName, slug);
  }
  if (description !== null && description !== undefined) {
    updates.push('description = ?');
    params.push(cleanText(description, 1000));
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
  db.run(`UPDATE catalog_services SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
  return findById(db, id);
}

function setActive(db, id, isActive) {
  return updateCatalogService(db, id, { isActive });
}

function removeCatalogService(db, id) {
  db.run('DELETE FROM catalog_services WHERE id = ?', [id]);
  return true;
}

function reorder(db, subcategoryId, orderedIds) {
  db.transaction(() => {
    orderedIds.forEach((id, index) => {
      if (subcategoryId) {
        db.run("UPDATE catalog_services SET sort_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND subcategory_id = ?", [index, id, subcategoryId]);
      } else {
        db.run("UPDATE catalog_services SET sort_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [index, id]);
      }
    });
  });
}

function findById(db, id) {
  const row = db.get(`SELECT ${CARD_COLUMNS} FROM catalog_services LEFT JOIN categories ON categories.id = catalog_services.category_id LEFT JOIN subcategories ON subcategories.id = catalog_services.subcategory_id WHERE catalog_services.id = ?`, [id]);
  if (!row) return null;
  return { ...row, is_active: Boolean(row.is_active) };
}

function findBySlug(db, slug) {
  const row = db.get(`SELECT ${CARD_COLUMNS} FROM catalog_services LEFT JOIN categories ON categories.id = catalog_services.category_id LEFT JOIN subcategories ON subcategories.id = catalog_services.subcategory_id WHERE catalog_services.slug = ?`, [slug]);
  if (!row) return null;
  return { ...row, is_active: Boolean(row.is_active) };
}

function findAll(db, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE catalog_services.is_active = 1';
  return db.all(`SELECT ${CARD_COLUMNS} FROM catalog_services LEFT JOIN categories ON categories.id = catalog_services.category_id LEFT JOIN subcategories ON subcategories.id = catalog_services.subcategory_id ${where} ORDER BY catalog_services.sort_order, catalog_services.name`).map((r) => ({ ...r, is_active: Boolean(r.is_active) }));
}

function findByCategory(db, categoryId, { includeInactive = false } = {}) {
  const where = includeInactive ? 'AND 1=1' : 'AND catalog_services.is_active = 1';
  return db.all(
    `SELECT ${CARD_COLUMNS} FROM catalog_services LEFT JOIN categories ON categories.id = catalog_services.category_id LEFT JOIN subcategories ON subcategories.id = catalog_services.subcategory_id WHERE catalog_services.category_id = ? ${where} ORDER BY catalog_services.sort_order, catalog_services.name`,
    [categoryId],
  ).map((r) => ({ ...r, is_active: Boolean(r.is_active) }));
}

function findBySubcategory(db, subcategoryId, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'AND catalog_services.is_active = 1';
  return db.all(
    `SELECT ${CARD_COLUMNS} FROM catalog_services LEFT JOIN categories ON categories.id = catalog_services.category_id LEFT JOIN subcategories ON subcategories.id = catalog_services.subcategory_id WHERE catalog_services.subcategory_id = ? ${where} ORDER BY catalog_services.sort_order, catalog_services.name`,
    [subcategoryId],
  ).map((r) => ({ ...r, is_active: Boolean(r.is_active) }));
}

function count(db, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  return Number(db.scalar(`SELECT COUNT(*) FROM catalog_services ${where}`) ?? 0);
}

function search(db, { query = null, categoryId = null, subcategoryId = null, includeInactive = false, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (!includeInactive) where.push('catalog_services.is_active = 1');
  const text = cleanText(query, 80);
  if (text) {
    where.push("(catalog_services.name LIKE ? ESCAPE '\\' OR catalog_services.description LIKE ? ESCAPE '\\')");
    const like = likePattern(text);
    params.push(like, like);
  }
  if (categoryId) {
    where.push('catalog_services.category_id = ?');
    params.push(categoryId);
  }
  if (subcategoryId) {
    where.push('catalog_services.subcategory_id = ?');
    params.push(subcategoryId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const items = db.all(
    `SELECT ${CARD_COLUMNS} FROM catalog_services LEFT JOIN categories ON categories.id = catalog_services.category_id LEFT JOIN subcategories ON subcategories.id = catalog_services.subcategory_id ${clause} ORDER BY catalog_services.sort_order, catalog_services.name LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).map((r) => ({ ...r, is_active: Boolean(r.is_active) }));
  const total = Number(db.scalar(`SELECT COUNT(*) FROM catalog_services ${clause}`, params) ?? 0);
  return { items, total };
}

function withHierarchy(db, id) {
  const svc = findById(db, id);
  if (!svc) return null;
  const category = db.get('SELECT id, name, slug FROM categories WHERE id = ?', [svc.category_id]);
  const subcategory = svc.subcategory_id ? db.get('SELECT id, name, slug FROM subcategories WHERE id = ?', [svc.subcategory_id]) : null;
  return { ...svc, category, subcategory };
}

module.exports = {
  COLUMNS,
  CARD_COLUMNS,
  ensureCatalogService,
  createCatalogService,
  updateCatalogService,
  setActive,
  removeCatalogService,
  reorder,
  findById,
  findBySlug,
  findAll,
  findByCategory,
  findBySubcategory,
  count,
  search,
  withHierarchy,
};
