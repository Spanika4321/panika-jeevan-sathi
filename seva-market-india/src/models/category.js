'use strict';
/**
 * SEVA MARKET INDIA — category model.
 *
 * Categories are a two-level tree ("Home Repair" -> "Plumber"). Slugs are
 * globally unique because they appear in public search URLs.
 */

const { slugify, cleanText } = require('../db/values');

const COLUMNS = 'id, parent_id, name, slug, description, icon, sort_order, is_active';

function ensureCategory(db, { name, parentId = null, description = null, icon = null, sortOrder = 0 }) {
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
    `INSERT INTO categories (parent_id, name, slug, description, icon, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [parentId ?? null, cleanName, slug, cleanText(description, 300), cleanText(icon, 40), sortOrder],
  );
  return db.get(`SELECT ${COLUMNS} FROM categories WHERE id = ?`, [Number(result.lastInsertRowid)]);
}

/** Top-level categories with their children attached. */
function tree(db) {
  const rows = db.all(
    `SELECT ${COLUMNS} FROM categories WHERE is_active = 1 ORDER BY sort_order, name`,
  );
  const parents = rows.filter((row) => row.parent_id === null);
  return parents.map((parent) => ({
    ...parent,
    children: rows.filter((row) => row.parent_id === parent.id),
  }));
}

function findAll(db) {
  return db.all(`SELECT ${COLUMNS} FROM categories WHERE is_active = 1 ORDER BY sort_order, name`);
}

function findById(db, id) {
  return db.get(`SELECT ${COLUMNS} FROM categories WHERE id = ?`, [id]);
}

function findBySlug(db, slug) {
  return db.get(`SELECT ${COLUMNS} FROM categories WHERE slug = ?`, [slug]);
}

/** A category plus its parent (for "Plumber in Home Repair" headings). */
function withParent(db, id) {
  const category = findById(db, id);
  if (!category) return null;
  return { ...category, parent: category.parent_id ? findById(db, category.parent_id) : null };
}

/**
 * Every category id that should match a query on `id`: the category itself
 * plus its descendants, so searching "Home Repair" also returns plumbers.
 */
function selfAndDescendantIds(db, id) {
  const ids = [id];
  const children = db.all('SELECT id FROM categories WHERE parent_id = ?', [id]);
  for (const child of children) ids.push(child.id);
  return ids;
}

function count(db) {
  return Number(db.scalar('SELECT COUNT(*) FROM categories WHERE is_active = 1') ?? 0);
}

module.exports = {
  COLUMNS,
  ensureCategory,
  tree,
  findAll,
  findById,
  findBySlug,
  withParent,
  selfAndDescendantIds,
  count,
};
