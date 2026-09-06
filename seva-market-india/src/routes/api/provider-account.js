'use strict';
/**
 * API: the provider's own account — listing, services, coverage, enquiries.
 *
 * Every route here resolves the caller's listing first (`ownedProvider`) and
 * never accepts a provider id from the client, so "PATCH my service" cannot
 * become "PATCH someone else's service". `/me` is registered before
 * `/api/v1/providers/:slug`, so the literal path wins the match.
 */

const { HttpError, unwrapAction } = require('../../http/respond');
const authHttp = require('../../http/auth');
const dashboard = require('../../actions/dashboard');
const providers = require('../../models/provider');
const services = require('../../models/service');
const leads = require('../../models/lead');
const verification = require('../../models/verification');
const locations = require('../../models/location');
const { cleanText, isValidPin } = require('../../db/values');

function register(router, { db, config }) {
  /** All routes below require a provider (or an admin acting for one). */
  const guard = (ctx) => {
    const result = authHttp.requireProvider(ctx);
    if (result.redirect) throw new HttpError(401, 'Sign in with the account that owns this listing.');
    return ctx.user;
  };
  const as = (ctx) => (ctx.user?.role === 'admin' && ctx.query?.get?.('provider_id') ? Number(ctx.query.get('provider_id')) : null);

  /** GET /api/v1/providers/me — the caller's listing, draft fields included. */
  router.get('/api/v1/providers/me', (ctx) => {
    const user = guard(ctx);
    const provider = db.get(`SELECT ${providers.OWNER_COLUMNS} FROM providers WHERE user_id = ? ORDER BY status = 'active' DESC, id DESC LIMIT 1`, [user.id]);
    if (!provider) return { provider: null, services: [], stats: null, leads: null };
    return {
      provider: { ...provider, is_verified: Boolean(provider.is_verified), service_areas: providers.serviceAreas(db, provider.id) },
      services: services.listForProvider(db, provider.id),
      stats: providers.statsFor(db, provider.id),
      completeness: providers.completeness({ ...provider, service_areas: providers.serviceAreas(db, provider.id) }),
      lead_counts: leads.countsByStatus(db, provider.id),
      documents: verification.documents(db, provider.id),
    };
  });

  /** PATCH /api/v1/providers/me — edit the business (never status/verified). */
  router.patch('/api/v1/providers/me', async (ctx) => {
    const user = guard(ctx);
    const body = await ctx.readBody();
    const result = dashboard.saveProfile(db, config, { user, body, asProviderId: as(ctx) });
    unwrapAction(result, 'The listing could not be saved.');
    return { provider: result.provider, stats: result.stats };
  });

  /**
   * POST /api/v1/providers/me/services — add a service.
   * PATCH/DELETE live under `/services/:id` so one listing's ids cannot be
   * mixed with another's.
   */
  router.post('/api/v1/providers/me/services', async (ctx) => {
    const user = guard(ctx);
    const body = await ctx.readBody();
    const result = dashboard.saveService(db, config, { user, body, asProviderId: as(ctx) });
    unwrapAction(result, 'The service could not be saved.');
    return { __status: result.created ? 201 : 200, data: { service: result.service } };
  });

  /** PUT /api/v1/providers/me/services/:id — replace a service's fields. */
  router.put('/api/v1/providers/me/services/:id', async (ctx) => {
    const user = guard(ctx);
    const body = await ctx.readBody();
    const result = dashboard.saveService(db, config, {
      user,
      body,
      serviceId: Number(ctx.params.id),
      asProviderId: as(ctx),
    });
    unwrapAction(result, 'The service could not be saved.');
    return { service: result.service };
  });

  /** PATCH /api/v1/providers/me/services/:id — publish, pause or archive. */
  router.patch('/api/v1/providers/me/services/:id', async (ctx) => {
    const user = guard(ctx);
    const body = await ctx.readBody();
    if (body.status && !body.title && !body.description) {
      const result = dashboard.setServiceStatus(db, {
        user,
        serviceId: Number(ctx.params.id),
        status: body.status,
        asProviderId: as(ctx),
      });
      unwrapAction(result, 'The service status could not be changed.');
      return { service: result.service };
    }
    const result = dashboard.saveService(db, config, {
      user,
      body,
      serviceId: Number(ctx.params.id),
      asProviderId: as(ctx),
    });
    unwrapAction(result, 'The service could not be saved.');
    return { service: result.service };
  });

  /**
   * PUT /api/v1/providers/me/service-areas — replace the coverage list.
   * PUT, not POST: the body is the complete set, so sending the same set
   * twice is idempotent, which is what a mobile form needs.
   */
  router.put('/api/v1/providers/me/service-areas', async (ctx) => {
    const user = guard(ctx);
    const body = await ctx.readBody();
    const pins = body.pins ?? body.service_areas ?? body.areas;
    const result = dashboard.saveCoverage(db, config, { user, pins, asProviderId: as(ctx) });
    unwrapAction(result, 'The coverage areas could not be saved.');
    return { service_areas: result.serviceAreas };
  });

  /** GET /api/v1/providers/me/leads — the enquiry inbox. */
  router.get('/api/v1/providers/me/leads', (ctx) => {
    const user = guard(ctx);
    const provider = dashboard.ownedProvider(db, user, { asProviderId: as(ctx) });
    const status = cleanText(ctx.query.get('status'), 20);
    if (status && !leads.LEAD_STATUSES.includes(status)) {
      throw new HttpError(400, `status must be one of: ${leads.LEAD_STATUSES.join(', ')}.`);
    }
    const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit')) || 25));
    const page = Math.max(1, Number(ctx.query.get('page')) || 1);
    const result = leads.listForProvider(db, provider.id, { status, limit, offset: (page - 1) * limit });
    return {
      items: result.items.map((row) => ({ ...row, phone: row.phone, is_read: Boolean(row.read_at) })),
      total: result.total,
      counts: leads.countsByStatus(db, provider.id),
      page,
      pageSize: limit,
    };
  });

  /** PATCH /api/v1/providers/me/leads/:id — contacted / closed / spam. */
  router.patch('/api/v1/providers/me/leads/:id', async (ctx) => {
    const user = guard(ctx);
    const body = await ctx.readBody();
    const result = dashboard.triageLead(db, {
      user,
      leadId: Number(ctx.params.id),
      status: body.status,
      note: body.note,
      asProviderId: as(ctx),
    });
    unwrapAction(result, 'The enquiry could not be updated.');
    return { lead: result.lead };
  });

  /** POST /api/v1/providers/me/documents — a masked reference for review. */
  router.post('/api/v1/providers/me/documents', async (ctx) => {
    const user = guard(ctx);
    const body = await ctx.readBody();
    const result = dashboard.submitDocument(db, {
      user,
      kind: body.kind,
      reference: body.reference,
      note: body.note,
      asProviderId: as(ctx),
    });
    unwrapAction(result, 'The document reference could not be saved.');
    return { __status: 201, data: { document: result.document } };
  });

  /**
   * POST /api/v1/providers/me/publish — ask for review, or go live directly
   * when auto-approval is configured. Providers cannot approve themselves:
   * this only flips `pending` -> `pending` again with a fresh audit entry,
   * or publishes when the deployment says self-serve publishing is allowed.
   */
  router.post('/api/v1/providers/me/publish', (ctx) => {
    const user = guard(ctx);
    const provider = dashboard.ownedProvider(db, user, { asProviderId: as(ctx) });
    if (provider.status === 'active') return { published: true, already_live: true, status: 'active' };
    if (config.onboarding.autoApprove) {
      const reviewed = verification.review(db, provider.id, { decision: 'approve', actor: `user:${user.id}` });
      return { published: true, status: reviewed.status, verified: Boolean(reviewed.is_verified) };
    }
    db.run(`UPDATE providers SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [provider.id]);
    verification.documents(db, provider.id);
    return {
      published: false,
      status: provider.status,
      queued_for_review: provider.status === 'pending',
      message: provider.status === 'suspended'
        ? 'This listing needs administrator attention before it can be published.'
        : 'Your listing is queued for review. We publish it as soon as it is checked.',
    };
  });

  /**
   * GET /api/v1/providers/me/pickers — data the dashboard forms need:
   * categories and the location nodes near a PIN. Kept in one call so a
   * phone fetches it once instead of on every keystroke.
   */
  router.get('/api/v1/providers/me/pickers', (ctx) => {
    guard(ctx);
    const pin = cleanText(ctx.query.get('pin'), 6);
    const found = pin && isValidPin(pin) ? locations.findByPin(db, pin) : null;
    return {
      categories: dashboard.categoryOptions(db),
      location: found ? { pin: found.node.pin_code, chain: found.chain.map((n) => n.name), locality_id: found.node.id } : null,
      price_units: ['visit', 'hour', 'day', 'sqft', 'job', 'month'],
      lead_statuses: leads.LEAD_STATUSES,
      service_statuses: services.STATUSES,
      document_kinds: verification.DOC_KINDS,
      max_service_areas: config.onboarding.maxServiceAreas,
    };
  });
}

module.exports = { register };
