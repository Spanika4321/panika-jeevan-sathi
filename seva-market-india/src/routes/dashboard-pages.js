'use strict';
/**
 * SEVA MARKET INDIA — provider dashboard pages.
 *
 * Every route resolves the caller's listing through `dashboard.ownedProvider`,
 * which derives the provider id from the *session*, never from the request.
 * A 404 from that helper means "no listing yet", which is rendered as an
 * onboarding nudge rather than an error page.
 */

const authHttp = require('../http/auth');
const dashboard = require('../actions/dashboard');
const services = require('../models/service');
const providers = require('../models/provider');
const leads = require('../models/lead');
const { renderPage, DASHBOARD_TABS } = require('../views/render');
const {
  overviewBody, servicesBody, coverageBody, enquiriesBody, profileBody, emptyDashboardBody,
} = require('../views/dashboard');
const { HttpError } = require('../http/respond');

const PRICE_UNITS = ['visit', 'hour', 'day', 'sqft', 'job', 'month'];

function register(router, { db, config }) {
  /** Signed-in provider, or a redirect for the browser / 401 for the API. */
  function guard(ctx) {
    const result = authHttp.requireProvider(ctx);
    return result.redirect ? { redirect: result.redirect } : { user: ctx.user };
  }

  /** Load the listing, or hand back the "add your business" page. */
  function withProvider(ctx, handler) {
    let user;
    try {
      const blocked = guard(ctx);
      if (blocked.redirect) return blocked;
      user = blocked.user;
      const provider = dashboard.ownedProvider(db, user);
      return handler({ user, provider });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        return renderPage(ctx, {
          title: 'Dashboard',
          noIndex: true,
          tabs: DASHBOARD_TABS,
          body: emptyDashboardBody({ user: ctx.user || { email: '' } }),
          flash: null,
        });
      }
      throw err;
    }
  }

  const categories = () => dashboard.categoryOptions(db).map((row) => ({ value: row.id, label: row.label }));
  const csrf = (ctx) => ctx.csrfToken || '';

  /* --------------------------------------------------------- overview */

  router.get('/dashboard', (ctx) => withProvider(ctx, ({ user, provider }) => {
    const data = dashboard.overview(db, config, user);
    return renderPage(ctx, {
      title: 'Dashboard',
      description: '',
      noIndex: true,
      tabs: DASHBOARD_TABS,
      body: overviewBody({
        ...data,
        provider,
        csrf: csrf(ctx),
        autoApprove: config.onboarding.autoApprove,
        categories: categories(),
      }),
    });
  }));

  /* -------------------------------------------------------- services */

  router.get('/dashboard/services', (ctx) => withProvider(ctx, ({ user, provider }) => {
    const list = services.listForProvider(db, provider.id);
    return renderPage(ctx, {
      title: 'My services',
      noIndex: true,
      tabs: DASHBOARD_TABS,
      body: servicesBody({
        provider,
        services: list,
        categories: categories(),
        priceUnits: PRICE_UNITS,
        csrf: csrf(ctx),
      }),
    });
  }));

  router.get('/dashboard/services/:id', (ctx) => withProvider(ctx, ({ user, provider }) => {
    const id = Number(ctx.params.id);
    const row = Number.isInteger(id) ? services.findByIdForProvider(db, id, provider.id) : null;
    if (!row) throw new HttpError(404, 'That service is not part of your listing.');
    return renderPage(ctx, {
      title: `Edit — ${row.title}`,
      noIndex: true,
      tabs: DASHBOARD_TABS,
      body: servicesBody({
        provider,
        services: services.listForProvider(db, provider.id),
        categories: categories(),
        priceUnits: PRICE_UNITS,
        csrf: csrf(ctx),
        editing: row,
      }),
    });
  }));

  const saveServiceForm = (ctx, { serviceId = null }) => {
    const blocked = guard(ctx);
    if (blocked.redirect) return blocked;
    return ctx.readBody().then((body) => {
      const publish = body.publish && ['active', 'draft'].includes(body.publish) ? body.publish : null;
      const result = dashboard.saveService(db, config, {
        user: ctx.user,
        body,
        serviceId,
        publish,
      });
      if (!result.ok && result.status === 404) throw new HttpError(404, result.error);
      if (!result.ok) {
        const provider = dashboard.ownedProvider(db, ctx.user);
        return renderPage(ctx, {
          title: serviceId ? 'Edit service' : 'My services',
          noIndex: true,
          tabs: DASHBOARD_TABS,
          flash: null,
          status: 400,
          body: servicesBody({
            provider,
            services: services.listForProvider(db, provider.id),
            categories: categories(),
            priceUnits: PRICE_UNITS,
            csrf: csrf(ctx),
            errors: result.errors || {},
            editing: serviceId ? services.findByIdForProvider(db, serviceId, provider.id) : { ...body },
          }),
        });
      }
      return { redirect: `/dashboard/services?ok=${serviceId ? 'service-saved' : 'service-added'}` };
    });
  };

  router.post('/dashboard/services', (ctx) => saveServiceForm(ctx, {}));
  router.post('/dashboard/services/:id', (ctx) => saveServiceForm(ctx, { serviceId: Number(ctx.params.id) }));

  router.post('/dashboard/services/:id/status', async (ctx) => {
    const blocked = guard(ctx);
    if (blocked.redirect) return blocked;
    const body = await ctx.readBody();
    const result = dashboard.setServiceStatus(db, {
      user: ctx.user,
      serviceId: Number(ctx.params.id),
      status: body.status,
    });
    if (!result.ok) throw new HttpError(result.status || 400, result.error || 'The service could not be updated.');
    const code = { active: 'service-published', paused: 'service-paused', archived: 'service-archived', draft: 'service-saved' }[result.service.status] || 'service-saved';
    return { redirect: `/dashboard/services?ok=${code}` };
  });

  /* --------------------------------------------------------- coverage */

  router.get('/dashboard/coverage', (ctx) => withProvider(ctx, ({ user, provider }) => renderPage(ctx, {
    title: 'Coverage areas',
    noIndex: true,
    tabs: DASHBOARD_TABS,
    body: coverageBody({
      provider,
      pins: providers.serviceAreas(db, provider.id),
      csrf: csrf(ctx),
      maxAreas: config.onboarding.maxServiceAreas,
    }),
  })));

  router.post('/dashboard/coverage', async (ctx) => {
    const blocked = guard(ctx);
    if (blocked.redirect) return blocked;
    const body = await ctx.readBody();
    const result = dashboard.saveCoverage(db, config, { user: ctx.user, pins: body.service_areas ?? body.pins });
    if (!result.ok) {
      const provider = dashboard.ownedProvider(db, ctx.user);
      return renderPage(ctx, {
        title: 'Coverage areas',
        noIndex: true,
        tabs: DASHBOARD_TABS,
        flash: null,
        status: 400,
        body: coverageBody({
          provider,
          pins: providers.serviceAreas(db, provider.id),
          csrf: csrf(ctx),
          errors: result.errors || {},
          maxAreas: config.onboarding.maxServiceAreas,
        }),
      });
    }
    return { redirect: '/dashboard/coverage?ok=coverage-saved' };
  });

  /* -------------------------------------------------------- enquiries */

  router.get('/dashboard/enquiries', (ctx) => withProvider(ctx, ({ user, provider }) => {
    const filter = ctx.query.get('status');
    const page = Math.max(1, Number(ctx.query.get('page')) || 1);
    const result = leads.listForProvider(db, provider.id, {
      status: leads.LEAD_STATUSES.includes(filter) ? filter : null,
      limit: 25,
      offset: (page - 1) * 25,
    });
    return renderPage(ctx, {
      title: 'Enquiries',
      noIndex: true,
      tabs: DASHBOARD_TABS,
      body: enquiriesBody({
        provider,
        leads: result.items,
        counts: leads.countsByStatus(db, provider.id),
        csrf: csrf(ctx),
        filter: leads.LEAD_STATUSES.includes(filter) ? filter : null,
      }),
    });
  }));

  router.post('/dashboard/enquiries/:id', async (ctx) => {
    const blocked = guard(ctx);
    if (blocked.redirect) return blocked;
    const body = await ctx.readBody();
    const result = dashboard.triageLead(db, {
      user: ctx.user,
      leadId: Number(ctx.params.id),
      status: body.status,
      note: body.note,
    });
    if (!result.ok) throw new HttpError(result.status || 400, result.error || 'The enquiry could not be updated.');
    return { redirect: '/dashboard/enquiries?ok=lead-saved' };
  });

  /* ---------------------------------------------------------- profile */

  router.get('/dashboard/profile', (ctx) => withProvider(ctx, ({ provider }) => renderPage(ctx, {
    title: 'Business details',
    noIndex: true,
    tabs: DASHBOARD_TABS,
    body: profileBody({
      provider: { ...provider, ...providers.findForUser(db, ctx.user.id) },
      categories: categories(),
      csrf: csrf(ctx),
    }),
  })));

  router.post('/dashboard/profile', async (ctx) => {
    const blocked = guard(ctx);
    if (blocked.redirect) return blocked;
    const body = await ctx.readBody();
    const result = dashboard.saveProfile(db, config, { user: ctx.user, body });
    if (!result.ok) {
      const provider = dashboard.ownedProvider(db, ctx.user);
      return renderPage(ctx, {
        title: 'Business details',
        noIndex: true,
        tabs: DASHBOARD_TABS,
        flash: null,
        status: 400,
        body: profileBody({
          provider: { ...provider, ...providers.findForUser(db, ctx.user.id) },
          categories: categories(),
          csrf: csrf(ctx),
          errors: result.errors || {},
          values: body,
        }),
      });
    }
    return { redirect: '/dashboard/profile?ok=profile-saved' };
  });

  /* -------------------------------------------------------- documents */

  router.post('/dashboard/documents', async (ctx) => {
    const blocked = guard(ctx);
    if (blocked.redirect) return blocked;
    const body = await ctx.readBody();
    const result = dashboard.submitDocument(db, { user: ctx.user, kind: body.kind, reference: body.reference, note: body.note });
    if (!result.ok) throw new HttpError(400, Object.values(result.errors || { e: 'The document reference could not be saved.' })[0]);
    return { redirect: '/dashboard?ok=document-saved' };
  });
}

module.exports = { register, PRICE_UNITS };
