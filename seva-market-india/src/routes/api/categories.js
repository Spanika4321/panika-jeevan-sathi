'use strict';
/** API: service categories (two-level tree) + extended catalog counts. */

const { HttpError } = require('../../http/respond');
const categoryModel = require('../../models/category');
const subcategoryModel = require('../../models/subcategory');
const catalogServiceModel = require('../../models/catalogService');
const serviceModel = require('../../models/service');

function register(router, { db }) {
  /** GET /api/v1/categories — full tree with live service counts (legacy + catalog). */
  router.get('/api/v1/categories', () => {
    const tree = categoryModel.tree(db);
    const legacyCounts = new Map(
      db.all(
        `SELECT category_id, COUNT(*) AS total FROM services WHERE status = 'active' GROUP BY category_id`,
      ).map((row) => [row.category_id, row.total]),
    );
    const catalogCounts = new Map(
      db.all(
        `SELECT category_id, COUNT(*) AS total FROM catalog_services WHERE is_active = 1 GROUP BY category_id`,
      ).map((row) => [row.category_id, row.total]),
    );
    const subCounts = new Map(
      db.all(
        `SELECT category_id, COUNT(*) AS total FROM subcategories WHERE is_active = 1 GROUP BY category_id`,
      ).map((row) => [row.category_id, row.total]),
    );

    const withCount = (node) => ({
      ...node,
      is_active: Boolean(node.is_active),
      service_count: legacyCounts.get(node.id) || 0,
      catalog_service_count: catalogCounts.get(node.id) || 0,
      subcategory_count: subCounts.get(node.id) || 0,
    });
    return {
      items: tree.map((parent) => ({
        ...withCount(parent),
        children: parent.children.map(withCount),
        subcategories: subcategoryModel.findByCategory(db, parent.id),
      })),
      total: tree.length,
    };
  });

  /** GET /api/v1/categories/popular — homepage strip data (catalog-aware). */
  router.get('/api/v1/categories/popular', ({ query }) => {
    const limit = Math.min(24, Math.max(1, Number(query.get('limit')) || 8));
    // Prefer catalog_services counts; fall back to provider services
    const catalogPopular = db.all(
      `SELECT categories.id, categories.name, categories.slug, categories.icon, categories.image,
              COUNT(catalog_services.id) AS service_count
       FROM categories
       LEFT JOIN catalog_services ON catalog_services.category_id = categories.id AND catalog_services.is_active = 1
       WHERE categories.is_active = 1
       GROUP BY categories.id
       HAVING service_count > 0
       ORDER BY service_count DESC, categories.sort_order
       LIMIT ?`,
      [limit],
    );
    if (catalogPopular.length >= limit) return { items: catalogPopular };
    return { items: serviceModel.popularCategories(db, limit) };
  });

  /** GET /api/v1/categories/:slug — one category + its children + subcategories + services. */
  router.get('/api/v1/categories/:slug', ({ params }) => {
    const category = categoryModel.findBySlug(db, params.slug);
    if (!category) throw HttpError.notFound(`Category "${params.slug}" not found.`);
    const children = db.all(
      `SELECT ${categoryModel.COLUMNS} FROM categories WHERE parent_id = ? AND is_active = 1 ORDER BY sort_order, name`,
      [category.id],
    );
    const subcategories = subcategoryModel.findByCategory(db, category.id);
    const services = catalogServiceModel.findByCategory(db, category.id);
    return {
      ...category,
      is_active: Boolean(category.is_active),
      parent: category.parent_id ? categoryModel.findById(db, category.parent_id) : null,
      children,
      subcategories,
      services,
      descendantIds: categoryModel.selfAndDescendantIds(db, category.id),
      subcategory_count: subcategories.length,
      service_count: services.length,
    };
  });
}

module.exports = { register };
