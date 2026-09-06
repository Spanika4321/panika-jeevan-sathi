'use strict';
/**
 * API: admin — manage categories, subcategories and catalog services
 * without code changes.
 *
 * All endpoints are idempotent and validate slugs/permissions so the admin
 * UI can drive them directly. For now authentication is a simple shared
 * secret via header `x-admin-token` matching `config.admin.password` or
 * `config.security.sessionSecret` when set; when neither is configured the
 * routes are open (development mode) but still validate input.
 *
 * Each resource supports:
 *   POST   /api/v1/admin/<resource>        — create
 *   PUT    /api/v1/admin/<resource>/:id    — update
 *   PATCH  /api/v1/admin/<resource>/:id/active — activate/deactivate
 *   DELETE /api/v1/admin/<resource>/:id    — delete
 *   POST   /api/v1/admin/<resource>/reorder — reorder
 */

const { HttpError } = require('../../http/respond');
const categoryModel = require('../../models/category');
const subcategoryModel = require('../../models/subcategory');
const catalogServiceModel = require('../../models/catalogService');
const { readBody, validators, validate } = require('../../http/request');
const { cleanText } = require('../../db/values');

function isAuthorized(req, config) {
  const secret = config.admin.password || config.security.sessionSecret;
  if (!secret) return true; // dev: no secret configured → allow
  const token = req.headers['x-admin-token'] || req.headers['x-admin-secret'] || '';
  return token === secret;
}

function requireAdmin(req, config) {
  if (!isAuthorized(req, config)) throw new HttpError(401, 'Admin token required. Send header x-admin-token.');
}

function register(router, { db, config }) {
  // Helper to wrap admin handlers with auth + body parsing
  const adminHandler = (fn) => async (ctx) => {
    requireAdmin(ctx.req, config);
    return fn(ctx);
  };

  // ----------------------------- categories
  router.post('/api/v1/admin/categories', adminHandler(async ({ req }) => {
    const body = await readBody(req, config.http.maxBodyBytes);
    const { value, errors, valid } = validate({
      name: () => validators.text(body.name, { field: 'name', max: 80 }),
      description: () => validators.text(body.description, { field: 'description', required: false, max: 500 }),
      icon: () => validators.text(body.icon, { field: 'icon', required: false, max: 40 }),
      image: () => validators.text(body.image, { field: 'image', required: false, max: 500 }),
      sort_order: () => validators.int(body.sort_order ?? body.sortOrder, { field: 'sort_order', required: false, min: 0 }),
      is_active: () => body.is_active === undefined && body.isActive === undefined ? true : validators.boolean(body.is_active ?? body.isActive, { fallback: true }),
    });
    if (!valid) throw HttpError.badRequest('Please correct the highlighted fields.', errors);
    try {
      const created = categoryModel.createCategory(db, {
        name: value.name,
        description: value.description,
        icon: value.icon,
        image: value.image,
        sortOrder: value.sort_order ?? 0,
        isActive: value.is_active,
      });
      return { __status: 201, data: created };
    } catch (err) {
      if (err.message && err.message.includes('already exists')) throw HttpError.conflict(err.message);
      throw err;
    }
  }));

  router.put('/api/v1/admin/categories/:id', adminHandler(async ({ req, params }) => {
    const id = validators.int(params.id, { field: 'id', min: 1 });
    const body = await readBody(req, config.http.maxBodyBytes);
    try {
      const updated = categoryModel.updateCategory(db, id, {
        name: body.name ?? null,
        description: body.description ?? null,
        icon: body.icon ?? null,
        image: body.image ?? null,
        sortOrder: body.sort_order ?? body.sortOrder ?? null,
        isActive: body.is_active ?? body.isActive ?? null,
      });
      return updated;
    } catch (err) {
      if (err.message && err.message.includes('already exists')) throw HttpError.conflict(err.message);
      if (err.message && err.message.includes('not found')) throw HttpError.notFound(err.message);
      throw err;
    }
  }));

  router.patch('/api/v1/admin/categories/:id/active', adminHandler(async ({ req, params }) => {
    const id = validators.int(params.id, { field: 'id', min: 1 });
    const body = await readBody(req, config.http.maxBodyBytes);
    const isActive = validators.boolean(body.is_active ?? body.isActive ?? body.active, { fallback: true });
    return categoryModel.setActive(db, id, isActive);
  }));

  router.delete('/api/v1/admin/categories/:id', adminHandler(({ params }) => {
    const id = validators.int(params.id, { field: 'id', min: 1 });
    try {
      categoryModel.removeCategory(db, id);
      return { deleted: true, id };
    } catch (err) {
      if (err.message && err.message.includes('in use')) throw HttpError.badRequest(err.message);
      if (err.message && err.message.includes('child')) throw HttpError.badRequest(err.message);
      throw err;
    }
  }));

  router.post('/api/v1/admin/categories/reorder', adminHandler(async ({ req }) => {
    const body = await readBody(req, config.http.maxBodyBytes);
    const ids = body.orderedIds || body.ordered_ids || body.ids;
    if (!Array.isArray(ids) || !ids.length) throw HttpError.badRequest('orderedIds must be a non-empty array of category ids.');
    categoryModel.reorder(db, ids.map((v) => validators.int(v, { field: 'orderedIds', min: 1 })));
    return { reordered: true, count: ids.length };
  }));

  // ----------------------------- subcategories
  router.post('/api/v1/admin/subcategories', adminHandler(async ({ req }) => {
    const body = await readBody(req, config.http.maxBodyBytes);
    const { value, errors, valid } = validate({
      category_id: () => validators.int(body.category_id ?? body.categoryId, { field: 'category_id', required: true, min: 1 }),
      name: () => validators.text(body.name, { field: 'name', max: 80 }),
      description: () => validators.text(body.description, { field: 'description', required: false, max: 500 }),
      icon: () => validators.text(body.icon, { field: 'icon', required: false, max: 40 }),
      image: () => validators.text(body.image, { field: 'image', required: false, max: 500 }),
      sort_order: () => validators.int(body.sort_order ?? body.sortOrder, { field: 'sort_order', required: false, min: 0 }),
      is_active: () => body.is_active === undefined && body.isActive === undefined ? true : validators.boolean(body.is_active ?? body.isActive, { fallback: true }),
    });
    if (!valid) throw HttpError.badRequest('Please correct the highlighted fields.', errors);
    try {
      const created = subcategoryModel.createSubcategory(db, {
        categoryId: value.category_id,
        name: value.name,
        description: value.description,
        icon: value.icon,
        image: value.image,
        sortOrder: value.sort_order ?? 0,
        isActive: value.is_active,
      });
      return { __status: 201, data: created };
    } catch (err) {
      if (err.message && err.message.includes('already exists')) throw HttpError.conflict(err.message);
      if (err.message && err.message.includes('Unknown category')) throw HttpError.badRequest(err.message);
      throw err;
    }
  }));

  router.put('/api/v1/admin/subcategories/:id', adminHandler(async ({ req, params }) => {
    const id = validators.int(params.id, { field: 'id', min: 1 });
    const body = await readBody(req, config.http.maxBodyBytes);
    try {
      return subcategoryModel.updateSubcategory(db, id, {
        categoryId: body.category_id ?? body.categoryId ?? null,
        name: body.name ?? null,
        description: body.description ?? null,
        icon: body.icon ?? null,
        image: body.image ?? null,
        sortOrder: body.sort_order ?? body.sortOrder ?? null,
        isActive: body.is_active ?? body.isActive ?? null,
      });
    } catch (err) {
      if (err.message && err.message.includes('already exists')) throw HttpError.conflict(err.message);
      if (err.message && err.message.includes('not found')) throw HttpError.notFound(err.message);
      if (err.message && err.message.includes('Unknown category')) throw HttpError.badRequest(err.message);
      throw err;
    }
  }));

  router.patch('/api/v1/admin/subcategories/:id/active', adminHandler(async ({ req, params }) => {
    const id = validators.int(params.id, { field: 'id', min: 1 });
    const body = await readBody(req, config.http.maxBodyBytes);
    const isActive = validators.boolean(body.is_active ?? body.isActive ?? body.active, { fallback: true });
    return subcategoryModel.setActive(db, id, isActive);
  }));

  router.delete('/api/v1/admin/subcategories/:id', adminHandler(({ params }) => {
    const id = validators.int(params.id, { field: 'id', min: 1 });
    try {
      subcategoryModel.removeSubcategory(db, id);
      return { deleted: true, id };
    } catch (err) {
      if (err.message && err.message.includes('in use')) throw HttpError.badRequest(err.message);
      throw err;
    }
  }));

  router.post('/api/v1/admin/subcategories/reorder', adminHandler(async ({ req }) => {
    const body = await readBody(req, config.http.maxBodyBytes);
    const categoryId = validators.int(body.category_id ?? body.categoryId, { field: 'category_id', required: true, min: 1 });
    const ids = body.orderedIds || body.ordered_ids || body.ids;
    if (!Array.isArray(ids) || !ids.length) throw HttpError.badRequest('orderedIds must be a non-empty array.');
    subcategoryModel.reorder(db, categoryId, ids.map((v) => validators.int(v, { field: 'orderedIds', min: 1 })));
    return { reordered: true, count: ids.length };
  }));

  // ----------------------------- catalog services
  router.post('/api/v1/admin/catalog-services', adminHandler(async ({ req }) => {
    const body = await readBody(req, config.http.maxBodyBytes);
    const { value, errors, valid } = validate({
      category_id: () => validators.int(body.category_id ?? body.categoryId, { field: 'category_id', required: true, min: 1 }),
      subcategory_id: () => body.subcategory_id === undefined && body.subcategoryId === undefined ? null : validators.int(body.subcategory_id ?? body.subcategoryId, { field: 'subcategory_id', required: false, min: 1 }),
      name: () => validators.text(body.name, { field: 'name', max: 100 }),
      description: () => validators.text(body.description, { field: 'description', required: false, max: 1000 }),
      icon: () => validators.text(body.icon, { field: 'icon', required: false, max: 40 }),
      image: () => validators.text(body.image, { field: 'image', required: false, max: 500 }),
      sort_order: () => validators.int(body.sort_order ?? body.sortOrder, { field: 'sort_order', required: false, min: 0 }),
      is_active: () => body.is_active === undefined && body.isActive === undefined ? true : validators.boolean(body.is_active ?? body.isActive, { fallback: true }),
    });
    if (!valid) throw HttpError.badRequest('Please correct the highlighted fields.', errors);
    try {
      const created = catalogServiceModel.createCatalogService(db, {
        categoryId: value.category_id,
        subcategoryId: value.subcategory_id,
        name: value.name,
        description: value.description,
        icon: value.icon,
        image: value.image,
        sortOrder: value.sort_order ?? 0,
        isActive: value.is_active,
      });
      return { __status: 201, data: created };
    } catch (err) {
      if (err.message && err.message.includes('already exists')) throw HttpError.conflict(err.message);
      if (err.message && (err.message.includes('Unknown category') || err.message.includes('Unknown subcategory') || err.message.includes('does not belong'))) throw HttpError.badRequest(err.message);
      throw err;
    }
  }));

  router.put('/api/v1/admin/catalog-services/:id', adminHandler(async ({ req, params }) => {
    const id = validators.int(params.id, { field: 'id', min: 1 });
    const body = await readBody(req, config.http.maxBodyBytes);
    try {
      return catalogServiceModel.updateCatalogService(db, id, {
        categoryId: body.category_id ?? body.categoryId ?? null,
        subcategoryId: body.subcategory_id !== undefined ? body.subcategory_id : (body.subcategoryId !== undefined ? body.subcategoryId : undefined),
        name: body.name ?? null,
        description: body.description ?? null,
        icon: body.icon ?? null,
        image: body.image ?? null,
        sortOrder: body.sort_order ?? body.sortOrder ?? null,
        isActive: body.is_active ?? body.isActive ?? null,
      });
    } catch (err) {
      if (err.message && err.message.includes('already exists')) throw HttpError.conflict(err.message);
      if (err.message && err.message.includes('not found')) throw HttpError.notFound(err.message);
      if (err.message && (err.message.includes('Unknown') || err.message.includes('does not belong'))) throw HttpError.badRequest(err.message);
      throw err;
    }
  }));

  router.patch('/api/v1/admin/catalog-services/:id/active', adminHandler(async ({ req, params }) => {
    const id = validators.int(params.id, { field: 'id', min: 1 });
    const body = await readBody(req, config.http.maxBodyBytes);
    const isActive = validators.boolean(body.is_active ?? body.isActive ?? body.active, { fallback: true });
    return catalogServiceModel.setActive(db, id, isActive);
  }));

  router.delete('/api/v1/admin/catalog-services/:id', adminHandler(({ params }) => {
    const id = validators.int(params.id, { field: 'id', min: 1 });
    catalogServiceModel.removeCatalogService(db, id);
    return { deleted: true, id };
  }));

  router.post('/api/v1/admin/catalog-services/reorder', adminHandler(async ({ req }) => {
    const body = await readBody(req, config.http.maxBodyBytes);
    const subcategoryId = body.subcategory_id ?? body.subcategoryId ?? null;
    const ids = body.orderedIds || body.ordered_ids || body.ids;
    if (!Array.isArray(ids) || !ids.length) throw HttpError.badRequest('orderedIds must be a non-empty array.');
    catalogServiceModel.reorder(db, subcategoryId ? validators.int(subcategoryId, { field: 'subcategory_id', min: 1 }) : null, ids.map((v) => validators.int(v, { field: 'orderedIds', min: 1 })));
    return { reordered: true, count: ids.length };
  }));

  // Admin overview: counts and recent items
  router.get('/api/v1/admin/overview', adminHandler(() => {
    return {
      categories: categoryModel.count(db, { includeInactive: true }),
      subcategories: subcategoryModel.count(db, { includeInactive: true }),
      catalog_services: catalogServiceModel.count(db, { includeInactive: true }),
      providers: db.scalar('SELECT COUNT(*) FROM providers') || 0,
      services: db.scalar('SELECT COUNT(*) FROM services') || 0,
    };
  }));
}

module.exports = { register };
