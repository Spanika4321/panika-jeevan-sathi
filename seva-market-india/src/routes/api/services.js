'use strict';
/** API: service search + detail. The core marketplace read path. */

const { HttpError } = require('../../http/respond');
const serviceModel = require('../../models/service');
const { resolveSearchFilters } = require('../search-context');

function register(router, { db }) {
  /**
   * GET /api/v1/services?q=&category=&place=&pin=&limit=&page=
   * Returns live services from active providers only.
   */
  router.get('/api/v1/services', ({ query }) => {
    const filters = resolveSearchFilters(db, query);
    const { items, total } = serviceModel.searchServices(db, filters);
    return {
      items,
      total,
      page: filters.page,
      pageSize: filters.limit,
      pages: Math.max(1, Math.ceil(total / filters.limit)),
      filters: {
        q: filters.query,
        category: filters.category ? filters.category.slug : null,
        place: filters.location ? filters.location.name : null,
        pin: filters.pin,
      },
    };
  });

  /** GET /api/v1/services/:slug — one service with its provider. */
  router.get('/api/v1/services/:slug', ({ params }) => {
    const service = serviceModel.findBySlug(db, params.slug);
    if (!service || service.status !== 'active') {
      throw HttpError.notFound(`Service "${params.slug}" not found.`);
    }
    return service;
  });
}

module.exports = { register };
