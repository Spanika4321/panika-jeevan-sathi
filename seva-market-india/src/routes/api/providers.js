'use strict';
/** API: provider search, detail and enquiry capture. */

const { HttpError } = require('../../http/respond');
const providerModel = require('../../models/provider');
const serviceModel = require('../../models/service');
const leadModel = require('../../models/lead');
const { resolveSearchFilters } = require('../search-context');
const { validate, validators, readBody } = require('../../http/request');

function register(router, { db, config }) {
  /** GET /api/v1/providers?category=&place=&pin=&q=&verified=1 */
  router.get('/api/v1/providers', ({ query }) => {
    const filters = resolveSearchFilters(db, query);
    const { items, total } = providerModel.searchProviders(db, {
      ...filters,
      verifiedOnly: validators.boolean(query.get('verified')),
    });
    return {
      items: items.map((item) => ({ ...item, service_areas: providerModel.serviceAreas(db, item.id) })),
      total,
      page: filters.page,
      pageSize: filters.limit,
      pages: Math.max(1, Math.ceil(total / filters.limit)),
    };
  });

  /** GET /api/v1/providers/:slug — public profile with services. */
  router.get('/api/v1/providers/:slug', ({ params }) => {
    const provider = providerModel.findBySlug(db, params.slug);
    if (!provider || provider.status !== 'active') {
      throw HttpError.notFound(`Provider "${params.slug}" not found.`);
    }
    return {
      ...provider,
      service_areas: providerModel.serviceAreas(db, provider.id),
      services: serviceModel.byProvider(db, provider.id),
    };
  });

  /**
   * POST /api/v1/leads — customer enquiry. The marketplace's conversion
   * event. Throttled per IP; returns 201 without echoing the phone back.
   */
  router.post('/api/v1/leads', async ({ req }) => {
    const body = await readBody(req, config.http.maxBodyBytes);
    const { value, errors, valid } = validate({
      name: () => validators.text(body.name, { field: 'name', max: 120 }),
      phone: () => validators.phone(body.phone, { field: 'phone' }),
      email: () => validators.email(body.email, { field: 'email' }),
      pin: () => validators.pin(body.pin_code ?? body.pin, { field: 'pin_code' }),
      message: () => validators.text(body.message, { field: 'message', required: false, max: 1000 }),
      providerId: () => validators.int(body.provider_id ?? body.providerId, { field: 'provider_id', required: true, min: 1 }),
      serviceId: () => validators.int(body.service_id ?? body.serviceId, { field: 'service_id', min: 1 }),
    });
    if (!valid) throw HttpError.badRequest('Please correct the highlighted fields.', errors);

    const tooMany = leadModel.recentCountFromIp(db, req.socket?.remoteAddress, {
      minutes: 60,
      secret: config.security.sessionSecret,
    });
    if (tooMany >= 5) throw HttpError.tooManyRequests('Too many enquiries from your connection. Try again later.');

    const lead = leadModel.createLead(db, {
      providerId: value.providerId,
      serviceId: value.serviceId,
      name: value.name,
      phone: value.phone,
      email: value.email,
      pinCode: value.pin,
      message: value.message,
      ip: req.socket?.remoteAddress,
      secret: config.security.sessionSecret,
    });
    // 201: a new resource really was created.
    return { __status: 201, data: { id: lead.id, status: 'received' } };
  });
}

module.exports = { register };
