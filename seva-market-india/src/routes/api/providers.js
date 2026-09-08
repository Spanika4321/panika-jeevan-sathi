'use strict';
/** API: provider search, detail and enquiry capture. */

const { HttpError } = require('../../http/respond');
const providerModel = require('../../models/provider');
const serviceModel = require('../../models/service');
const { resolveSearchFilters } = require('../search-context');
const { validate, validators, readBody } = require('../../http/request');

/**
 * Strip fields that are private to the account dashboard before a provider
 * row leaves the JSON API.
 *
 * The public HTML pages show only the phone numbers, business name, photos,
 * about text and coverage of a listing — the business email and street
 * address are dashboard-only (the edit form labels the address "shown only
 * to you"). The API must not widen that surface, so every provider response
 * goes through this gate, mirroring publicUser/publicLead in the stores.
 */
function publicProvider(row) {
  if (!row) return null;
  const out = { ...row };
  delete out.email;
  delete out.address_line;
  delete out.contact_name;
  return out;
}

function register(router, { db, store, config }) {
  /** GET /api/v1/providers?category=&place=&pin=&q=&verified=1 */
  router.get('/api/v1/providers', ({ query }) => {
    const filters = resolveSearchFilters(db, query);
    const { items, total } = providerModel.searchProviders(db, {
      ...filters,
      verifiedOnly: validators.boolean(query.get('verified')),
    });
    return {
      items: items.map((item) => publicProvider({ ...item, service_areas: providerModel.serviceAreas(db, item.id) })),
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
      ...publicProvider(provider),
      service_areas: providerModel.serviceAreas(db, provider.id),
      services: serviceModel.byProvider(db, provider.id),
    };
  });

  /**
   * POST /api/v1/leads — customer enquiry. The marketplace's conversion
   * event. Throttled per client IP; returns 201 without echoing the phone
   * back. `ctx.ip` is proxy-aware (TRUST_PROXY_HOPS), so behind Render's
   * edge each visitor is counted separately instead of every API caller
   * sharing one edge address.
   */
  router.post('/api/v1/leads', async ({ req, ip }) => {
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

    const tooMany = await store.leads.recentCountFromIp(ip, { minutes: 60 });
    if (tooMany >= 5) throw HttpError.tooManyRequests('Too many enquiries from your connection. Try again later.');

    // Awaited write-through: on the Supabase backend this only resolves once
    // Postgres has the row, so a 201 can never be a lie.
    const lead = await store.leads.create({
      providerId: value.providerId,
      serviceId: value.serviceId,
      name: value.name,
      phone: value.phone,
      email: value.email,
      pinCode: value.pin,
      message: value.message,
      ip,
    });
    // 201: a new resource really was created.
    return { __status: 201, data: { id: lead.id, status: 'received' } };
  });
}

module.exports = { register };
