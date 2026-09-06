'use strict';
/** API: service categories (two-level tree). */

const { HttpError } = require('../../http/respond');
const categoryModel = require('../../models/category');
const serviceModel = require('../../models/service');

function register(router, { db }) {
  /** GET /api/v1/categories — full tree with live service counts. */
  router.get('/api/v1/categories', () => {
    const tree = categoryModel.tree(db);
    const counts = new Map(
      db.all(
        `SELECT category_id, COUNT(*) AS total FROM services WHERE status = 'active' GROUP BY category_id`,
      ).map((row) => [row.category_id, row.total]),
    );

    const withCount = (node) => ({ ...node, is_active: Boolean(node.is_active), service_count: counts.get(node.id) || 0 });
    return {
      items: tree.map((parent) => ({
        ...withCount(parent),
        children: parent.children.map(withCount),
      })),
      total: tree.length,
    };
  });

  /** GET /api/v1/categories/popular — homepage strip data. */
  router.get('/api/v1/categories/popular', ({ query }) => {
    const limit = Math.min(24, Math.max(1, Number(query.get('limit')) || 8));
    return { items: serviceModel.popularCategories(db, limit) };
  });

  /** GET /api/v1/categories/:slug — one category + its children. */
  router.get('/api/v1/categories/:slug', ({ params }) => {
    const category = categoryModel.findBySlug(db, params.slug);
    if (!category) throw HttpError.notFound(`Category "${params.slug}" not found.`);
    const children = db.all(
      `SELECT ${categoryModel.COLUMNS} FROM categories WHERE parent_id = ? AND is_active = 1 ORDER BY sort_order, name`,
      [category.id],
    );
    return {
      ...category,
      is_active: Boolean(category.is_active),
      parent: category.parent_id ? categoryModel.findById(db, category.parent_id) : null,
      children,
      descendantIds: categoryModel.selfAndDescendantIds(db, category.id),
    };
  });
}

module.exports = { register };
