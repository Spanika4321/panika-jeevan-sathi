'use strict';
/** API: provider search, detail and enquiry capture. */

const { HttpError } = require('../../http/respond');
const providerModel = require('../../models/provider');
const serviceModel = require('../../models/service');
const { resolveSearchFilters } = require('../search-context');
const { validate, validators, readBody } = require('../../http/request');

function register(router, { db, store, config }) {
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
    // Shape keys are the API's own field names: `validate()` keys the error
    // map by them, and `error.details` is part of the public contract, so a
    // client reads details.provider_id — never details.providerId.
    const { value, errors, valid } = validate({
      name: () => validators.text(body.name, { field: 'name', max: 120 }),
      phone: () => validators.phone(body.phone, { field: 'phone' }),
      email: () => validators.email(body.email, { field: 'email' }),
      pin_code: () => validators.pin(body.pin_code ?? body.pin, { field: 'PIN code' }),
      message: () => validators.text(body.message, { field: 'message', required: false, max: 1000 }),
      provider_id: () => validators.int(body.provider_id ?? body.providerId, { field: 'provider id', required: true, min: 1 }),
      service_id: () => validators.int(body.service_id ?? body.serviceId, { field: 'service id', min: 1 }),
    });
    if (!valid) throw HttpError.badRequest('Please correct the highlighted fields.', errors);

    const tooMany = await store.leads.recentCountFromIp(req.socket?.remoteAddress, { minutes: 60 });
    if (tooMany >= 5) throw HttpError.tooManyRequests('Too many enquiries from your connection. Try again later.');

    // Awaited write-through: on the Supabase backend this only resolves once
    // Postgres has the row, so a 201 can never be a lie.
    const lead = await store.leads.create({
      providerId: value.provider_id,
      serviceId: value.service_id,
      name: value.name,
      phone: value.phone,
      email: value.email,
      pinCode: value.pin_code,
      message: value.message,
      ip: req.socket?.remoteAddress,
    });
    // 201: a new resource really was created.
    return { __status: 201, data: { id: lead.id, status: 'received' } };
  });
}

module.exports = { register };
