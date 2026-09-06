'use strict';
/**
 * API: comprehensive catalog — subcategories & catalog services.
 *
 * Public, read-only endpoints that expose the Category → Subcategory →
 * Service hierarchy built by migration 0002. All data is active-only
 * unless an admin token is supplied.
 */

const { HttpError } = require('../../http/respond');
const categoryModel = require('../../models/category');
const subcategoryModel = require('../../models/subcategory');
const catalogServiceModel = require('../../models/catalogService');
const { pagination } = require('../../http/request');
const { cleanText } = require('../../db/values');

function register(router, { db }) {
  // GET /api/v1/catalog/tree — full hierarchy with counts (for homepage + nav)
  router.get('/api/v1/catalog/tree', () => {
    const tree = categoryModel.tree(db);
    const items = tree.map((cat) => {
      const subs = subcategoryModel.findByCategory(db, cat.id);
      const withServices = subs.map((sub) => ({
        ...sub,
        is_active: Boolean(sub.is_active),
        services: catalogServiceModel.findBySubcategory(db, sub.id).map((s) => ({ ...s, is_active: Boolean(s.is_active) })),
      }));
      const directServices = catalogServiceModel.findByCategory(db, cat.id).filter((s) => !s.subcategory_id);
      return {
        ...cat,
        is_active: Boolean(cat.is_active),
        subcategories: withServices,
        direct_services: directServices,
        subcategory_count: subs.length,
        service_count: db.scalar('SELECT COUNT(*) FROM catalog_services WHERE category_id = ? AND is_active = 1', [cat.id]) || 0,
      };
    });
    return { items, total: items.length };
  });

  // GET /api/v1/subcategories?category=beauty-personal-care
  router.get('/api/v1/subcategories', ({ query }) => {
    const categorySlug = cleanText(query.get('category'), 80);
    if (categorySlug) {
      const cat = categoryModel.findBySlug(db, categorySlug);
      if (!cat) throw HttpError.notFound(`Category "${categorySlug}" not found.`);
      const items = subcategoryModel.findByCategory(db, cat.id);
      return { items, total: items.length, category: cat };
    }
    const items = subcategoryModel.findAll(db);
    return { items, total: items.length };
  });

  // GET /api/v1/subcategories/:slug
  router.get('/api/v1/subcategories/:slug', ({ params }) => {
    const sub = subcategoryModel.findBySlug(db, params.slug);
    if (!sub) throw HttpError.notFound(`Subcategory "${params.slug}" not found.`);
    const category = categoryModel.findById(db, sub.category_id);
    const services = catalogServiceModel.findBySubcategory(db, sub.id);
    return { ...sub, category, services, service_count: services.length };
  });

  // GET /api/v1/catalog/services?category=&subcategory=&q=
  router.get('/api/v1/catalog/services', ({ query }) => {
    const categorySlug = cleanText(query.get('category'), 80);
    const subcategorySlug = cleanText(query.get('subcategory'), 80);
    const q = cleanText(query.get('q') || query.get('query'), 80);
    let categoryId = null;
    let subcategoryId = null;
    if (categorySlug) {
      const cat = categoryModel.findBySlug(db, categorySlug);
      if (!cat) throw HttpError.notFound(`Category "${categorySlug}" not found.`);
      categoryId = cat.id;
    }
    if (subcategorySlug) {
      const sub = subcategoryModel.findBySlug(db, subcategorySlug);
      if (!sub) throw HttpError.notFound(`Subcategory "${subcategorySlug}" not found.`);
      subcategoryId = sub.id;
      if (categoryId && sub.category_id !== categoryId) {
        throw HttpError.badRequest('Subcategory does not belong to the given category.');
      }
      if (!categoryId) categoryId = sub.category_id;
    }
    const paging = pagination(query, { defaultSize: 20, maxSize: 100 });
    const { items, total } = catalogServiceModel.search(db, {
      query: q,
      categoryId,
      subcategoryId,
      limit: paging.limit,
      offset: paging.offset,
    });
    return {
      items,
      total,
      page: paging.page,
      pageSize: paging.limit,
      pages: Math.max(1, Math.ceil(total / paging.limit)),
      filters: { q: q || null, category: categorySlug || null, subcategory: subcategorySlug || null },
    };
  });

  // GET /api/v1/catalog/services/:slug — single service with hierarchy
  router.get('/api/v1/catalog/services/:slug', ({ params }) => {
    const svc = catalogServiceModel.findBySlug(db, params.slug);
    if (!svc || !svc.is_active) throw HttpError.notFound(`Service "${params.slug}" not found.`);
    const category = categoryModel.findById(db, svc.category_id);
    const subcategory = svc.subcategory_id ? subcategoryModel.findById(db, svc.subcategory_id) : null;
    return { ...svc, category, subcategory, breadcrumb: [category, subcategory, svc].filter(Boolean).map((n) => ({ name: n.name, slug: n.slug })) };
  });

  // GET /api/v1/catalog/search?q=makeup — unified search across categories/subcategories/services
  router.get('/api/v1/catalog/search', ({ query }) => {
    const q = cleanText(query.get('q'), 80);
    if (!q) throw HttpError.badRequest('Query parameter "q" is required.');
    const paging = pagination(query, { defaultSize: 20, maxSize: 50 });
    const services = catalogServiceModel.search(db, { query: q, limit: paging.limit, offset: paging.offset });
    const categories = categoryModel.search(db, q, { limit: 10 });
    const subcategories = subcategoryModel.search(db, q, { limit: 10 });
    return {
      query: q,
      services,
      categories: { items: categories, total: categories.length },
      subcategories: { items: subcategories, total: subcategories.length },
    };
  });
}

module.exports = { register };
