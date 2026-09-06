'use strict';
/**
 * SEVA MARKET INDIA — server-rendered pages.
 *
 * Rendered on the server (not in the browser) so every listing is indexable
 * and the first paint works on a 2G phone. Handlers return an HTML string;
 * app.js sends it with the security headers.
 */

const { esc } = require('../views/layout');
const { homeBody } = require('../views/home');
const { renderPage, redirectTo } = require('../views/render');
const { fromQuery: flashFromQuery } = require('../views/flash');
const { providerProfileBody, serviceBody } = require('../views/provider');
const leadModel = require('../models/lead');
const categoryModel = require('../models/category');
const locationModel = require('../models/location');
const providerModel = require('../models/provider');
const serviceModel = require('../models/service');
const { resolveSearchFilters, describeFilters } = require('./search-context');
const { priceLabel } = require('../views/pricing');
const { HttpError } = require('../http/respond');

function resultCardMarkup(service) {
  return `
      <article class="result-card">
        <div class="result-card__main">
          <h3 class="result-card__title">
            <a href="/services/${esc(service.slug)}">${esc(service.title)}</a>
          </h3>
          <p class="result-card__provider">
            <a href="/providers/${esc(service.provider_slug)}">${esc(service.business_name)}</a>
            ${service.is_verified ? '<span class="badge badge--verified">Verified</span>' : ''}
          </p>
          <p class="result-card__meta">
            <span>${esc(service.category_name)}</span>
            <span class="dot" aria-hidden="true">•</span>
            <span>${esc(service.location_label || 'India')}</span>
            ${service.pin_code ? `<span class="dot" aria-hidden="true">•</span><span>PIN ${esc(service.pin_code)}</span>` : ''}
          </p>
          ${service.description ? `<p class="result-card__text">${esc(service.description)}</p>` : ''}
        </div>
        <div class="result-card__aside">
          <p class="result-card__price">${esc(priceLabel(service))}</p>
          <a class="btn btn--primary btn--sm" href="tel:+91${esc(service.phone)}">Call ${esc(service.phone)}</a>
        </div>
      </article>`;
}

/**
 * Enquiry capture shared by the provider and service pages. Field rules come
 * from the lead model so the JSON API and the HTML form cannot diverge; the
 * per-IP throttle is the same one the API applies.
 */
function captureEnquiry(db, config, ctx, provider, body) {
  const { validators, validate } = require('../http/request');
  const { value, errors, valid } = validate({
    name: () => validators.text(body.name, { field: 'name', max: 120 }),
    phone: () => validators.phone(body.phone, { field: 'phone' }),
    email: () => validators.email(body.email, { field: 'email' }),
    pin: () => validators.pin(body.pin_code ?? body.pin, { field: 'pin_code' }),
    message: () => validators.text(body.message, { field: 'message', required: false, max: 1000 }),
  });
  if (!valid) return { errors, status: 400 };

  const tooMany = leadModel.recentCountFromIp(db, ctx.ip, { minutes: 60, secret: config.security.sessionSecret });
  if (tooMany >= 5) return { errors: { form: 'Too many enquiries from this connection. Please call the provider or try again later.' }, status: 429 };

  try {
    const lead = leadModel.createLead(db, {
      providerId: provider.id,
      serviceId: body.service_id ? Number(body.service_id) : null,
      name: value.name,
      phone: value.phone,
      email: value.email,
      pinCode: value.pin,
      message: value.message,
      ip: ctx.ip,
      secret: config.security.sessionSecret,
    });
    require('../mail/mailer').newLeadMessage({ to: provider.email, business: provider.business_name, lead, config });
    return null;
  } catch (err) {
    return { errors: { form: err.message }, status: 400 };
  }
}

function register(router, { db, config }) {
  // Pages are rendered through the shared helper so the header, the flash
  // message and the `noindex` rule behave identically everywhere.
  const render = (ctx, { title, description, body, currentPath }) =>
    renderPage(ctx, { title, description, body, currentPath });

  /* ------------------------------------------------------------- home */
  router.get('/', (ctx) => {
    const totals = locationModel.stats(db);
    const markup = homeBody({
      stats: {
        states: totals.state,
        cities: totals.city,
        pincodes: totals.pincode,
        categories: categoryModel.count(db),
        providers: providerModel.count(db),
      },
      popularCategories: serviceModel.popularCategories(db, 8),
      states: locationModel.findChildren(db, locationModel.ensureIndia(db).id, 'state').slice(0, 12),
      site: config.site,
    });
    return render(ctx, {
      title: 'Find local service providers by service, city and PIN code',
      description: `${config.site.name} — search plumbers, electricians, tutors and more across every state, district, city, locality and PIN code in India.`,
      body: markup,
      currentPath: '/',
    });
  });

  /* ----------------------------------------------------------- search */
  router.get('/search', (ctx) => {
    const filters = resolveSearchFilters(db, ctx.query);
    if (!filters.pinValid) {
      throw HttpError.badRequest('PIN code must be 6 digits and cannot start with 0.');
    }
    const found = filters.locationNotFound
      ? { items: [], total: 0 }
      : serviceModel.searchServices(db, filters);
    const { items, total } = found;
    const heading = describeFilters(filters);
    const emptyNote = filters.locationNotFound
      ? `No listings in ${filters.placeRequested} yet — no provider has registered there. Be the first: <a href="/providers/new">list your service</a>.`
      : null;

    const body = `
    <section class="page-head">
      <div class="container">
        <h1 class="page-head__title">${esc(heading)}</h1>
        <p class="page-head__lede">${total} ${total === 1 ? 'service' : 'services'} available${filters.place ? ` for "${esc(filters.place)}"` : ' across India'}</p>
      </div>
    </section>
    <section class="section">
      <div class="container container--narrow">
        ${emptyNote ? `<div class="callout"><p class="callout__title">${esc(emptyNote)}</p></div>` : ''}
        ${items.length ? items.map(resultCardMarkup).join('') : `
          <div class="empty">
            <h2>No services matched your search yet</h2>
            <p>Try a broader area, drop the PIN code, or <a href="/providers/new">be the first provider listed</a> for this area.</p>
          </div>`}
      </div>
    </section>`;

    return render(ctx, {
      title: `${heading} — Services`,
      description: `${total} local services for ${heading}. Contact providers directly.`,
      body,
    });
  });

  /* ------------------------------------------------------- categories */
  router.get('/categories', (ctx) => {
    const tree = categoryModel.tree(db);
    const body = `
    <section class="page-head"><div class="container">
      <h1 class="page-head__title">Service categories</h1>
      <p class="page-head__lede">${tree.length} categories, from home repair to tutoring.</p>
    </div></section>
    <section class="section"><div class="container">
      ${tree.length ? tree.map((parent) => `
        <div class="category-block">
          <h2 class="category-block__title">
            <a href="/search?category=${esc(parent.slug)}">${esc(parent.name)}</a>
          </h2>
          ${parent.children.length ? `<ul class="pill-list">${parent.children
            .map((child) => `<li><a href="/search?category=${esc(child.slug)}">${esc(child.name)}</a></li>`)
            .join('')}</ul>` : ''}
        </div>`).join('') : '<p class="empty">No categories yet.</p>'}
    </div></section>`;

    return render(ctx, { title: 'Service categories', body });
  });

  /* -------------------------------------------------------- locations */
  router.get('/locations', (ctx) => {
    const india = locationModel.ensureIndia(db);
    const states = locationModel.findChildren(db, india.id, 'state');
    const totals = locationModel.stats(db);
    const body = `
    <section class="page-head"><div class="container">
      <h1 class="page-head__title">States, cities and PIN codes</h1>
      <p class="page-head__lede">${totals.state} states &amp; UTs, ${totals.district} districts, ${totals.city} cities,
        ${totals.locality} localities and ${totals.pincode} PIN codes covered.</p>
    </div></section>
    <section class="section"><div class="container">
      ${states.length ? `<ul class="pill-list">${states
        .map((state) => `<li><a href="/search?state=${esc(state.slug)}">${esc(state.name)}</a></li>`)
        .join('')}</ul>` : '<p class="empty">No locations seeded yet. Run <code>npm run seed</code>.</p>'}
    </div></section>`;

    return render(ctx, { title: 'Locations across India', body });
  });

  /* -------------------------------------------------- public profile */

  /**
   * GET /providers/:slug — the public business page.
   * Only an ACTIVE provider has a public page; the owner is sent to their
   * dashboard so a pending listing is never silently 404 on its author.
   */
  router.get('/providers/:slug', (ctx) => {
    const provider = providerModel.findBySlug(db, ctx.params.slug);
    if (!provider) throw HttpError.notFound(`Provider "${ctx.params.slug}" not found.`);
    if (provider.status !== 'active') {
      if (ctx.user && ctx.user.id === provider.user_id) return { redirect: '/dashboard' };
      throw HttpError.notFound('This listing is not published yet.');
    }
    const services = serviceModel.byProvider(db, provider.id);
    return render(ctx, {
      title: `${provider.business_name} — ${provider.category_name} in ${provider.location_label || 'India'}`,
      description: `${provider.business_name} in ${provider.location_label || 'India'}: ${services.length || 'no'} priced ${provider.category_name} ${services.length === 1 ? 'service' : 'services'}. Call or send an enquiry directly.`,
      body: providerProfileBody({
        provider,
        services,
        areas: providerModel.serviceAreas(db, provider.id),
        csrf: ctx.csrfToken || '',
        errors: {},
        values: {},
        query: ctx.query.toString(),
        flash: flashFromQuery(ctx.query),
      }),
    });
  });

  /** POST /providers/:slug/enquiry — the customer form behind "Ask for a quote". */
  router.post('/providers/:slug/enquiry', async (ctx) => {
    const provider = providerModel.findBySlug(db, ctx.params.slug);
    if (!provider || provider.status !== 'active') {
      throw HttpError.notFound('This listing is not accepting enquiries.');
    }
    const body = await ctx.readBody();
    const failure = captureEnquiry(db, config, ctx, provider, body);
    if (failure) {
      const services = serviceModel.byProvider(db, provider.id);
      return {
        ...render(ctx, {
          title: `${provider.business_name} — ${provider.category_name}`,
          body: providerProfileBody({
            provider,
            services,
            areas: providerModel.serviceAreas(db, provider.id),
            csrf: ctx.csrfToken || '',
            errors: failure.errors,
            values: body,
            query: ctx.query.toString(),
          }),
        }),
        status: failure.status,
      };
    }
    return redirectTo(`/providers/${provider.slug}`, 'enquiry-sent');
  });

  /* ------------------------------------------------ public service page */

  /** GET /services/:slug — every search result card links here. */
  router.get('/services/:slug', (ctx) => {
    const service = serviceModel.findBySlug(db, ctx.params.slug);
    if (!service || service.status !== 'active') throw HttpError.notFound(`Service "${ctx.params.slug}" not found.`);
    const provider = providerModel.findById(db, service.provider_id);
    if (!provider || provider.status !== 'active') throw HttpError.notFound('This listing is not published.');
    return render(ctx, {
      title: `${service.title} — ${priceLabel(service)} in ${service.location_label || 'India'}`,
      description: `${service.title} by ${provider.business_name}${service.description ? `: ${service.description.slice(0, 140)}` : ''}`,
      body: serviceBody({
        service,
        provider,
        csrf: ctx.csrfToken || '',
        errors: {},
        values: {},
        flash: flashFromQuery(ctx.query),
      }),
    });
  });

  /** POST /services/:slug/enquiry — same capture path, tagged with the service. */
  router.post('/services/:slug/enquiry', async (ctx) => {
    const service = serviceModel.findBySlug(db, ctx.params.slug);
    if (!service || service.status !== 'active') throw HttpError.notFound('This service is not available.');
    const provider = providerModel.findById(db, service.provider_id);
    if (!provider || provider.status !== 'active') throw HttpError.notFound('This listing is not published.');
    const body = await ctx.readBody();
    const failure = captureEnquiry(db, config, ctx, provider, { ...body, service_id: service.id });
    if (failure) {
      return {
        ...render(ctx, {
          title: `${service.title}`,
          body: serviceBody({ service, provider, csrf: ctx.csrfToken || '', errors: failure.errors, values: body }),
        }),
        status: failure.status,
      };
    }
    return redirectTo(`/services/${service.slug}`, 'enquiry-sent');
  });

  /* -------------------------------------------------- static pages */
  const staticPages = [
    { path: '/about', title: 'About us', text: `${config.site.name} connects customers with local service providers across India, organised by state, district, city, locality and PIN code.` },
    { path: '/contact', title: 'Contact', text: 'Questions about a listing? Contact the provider directly from their profile. For site issues, reach the team through the GitHub repository.' },
    { path: '/privacy', title: 'Privacy', text: 'We store only what is needed to connect a customer with a provider. Enquiry phone numbers are never sold or shared beyond the provider contacted.' },
    { path: '/terms', title: 'Terms', text: 'Listings are provided by independent providers. SEVA MARKET INDIA introduces the two parties and is not a party to the service agreement.' },
  ];

  for (const page of staticPages) {
    router.get(page.path, (ctx) => {
      const body = `
    <section class="page-head"><div class="container container--narrow">
      <h1 class="page-head__title">${esc(page.title)}</h1>
    </div></section>
    <section class="section"><div class="container container--narrow">
      <p class="prose">${esc(page.text)}</p>
      <p class="prose">This is the foundation build of the site; full policies ship with the provider onboarding milestone.</p>
    </div></section>`;
      return render(ctx, { title: page.title, body });
    });
  }
}

module.exports = { register, resultCardMarkup, priceLabel };
