'use strict';
/**
 * SEVA MARKET INDIA — server-rendered pages.
 *
 * Rendered on the server (not in the browser) so every listing is indexable
 * and the first paint works on a 2G phone. Handlers return an HTML string;
 * app.js sends it with the security headers.
 */

const { layout, esc } = require('../views/layout');
const { homeBody } = require('../views/home');
const categoryModel = require('../models/category');
const locationModel = require('../models/location');
const providerModel = require('../models/provider');
const serviceModel = require('../models/service');
const { resolveSearchFilters, describeFilters } = require('./search-context');
const { HttpError } = require('../http/respond');

function priceLabel(service) {
  if (service.price_min === null && service.price_max === null) return 'Price on request';
  const unit = { visit: '/visit', hour: '/hour', day: '/day', sqft: '/sq.ft', job: '/job', month: '/month' };
  const suffix = unit[service.price_unit] || '';
  if (service.price_min !== null && service.price_max !== null) {
    return `₹${service.price_min}–₹${service.price_max}${suffix}`;
  }
  const single = service.price_min ?? service.price_max;
  return `₹${single}${suffix}`;
}

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

function register(router, { db, config }) {
  const render = (ctx, { title, description, body, currentPath }) =>
    layout({
      title,
      description,
      body,
      currentPath: currentPath || ctx.pathname,
      site: config.site,
    });

  /* ------------------------------------------------------------- home */
  router.get('/', () => {
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
    return {
      html: render(null, {
        title: 'Find local service providers by service, city and PIN code',
        description: `${config.site.name} — search plumbers, electricians, tutors and more across every state, district, city, locality and PIN code in India.`,
        body: markup,
        currentPath: '/',
      }),
    };
  });

  /* ----------------------------------------------------------- search */
  router.get('/search', (ctx) => {
    const filters = resolveSearchFilters(db, ctx.query);
    if (!filters.pinValid) {
      throw HttpError.badRequest('PIN code must be 6 digits and cannot start with 0.');
    }
    const { items, total } = serviceModel.searchServices(db, filters);
    const heading = describeFilters(filters);

    const body = `
    <section class="page-head">
      <div class="container">
        <h1 class="page-head__title">${esc(heading)}</h1>
        <p class="page-head__lede">${total} ${total === 1 ? 'service' : 'services'} available${filters.place ? ` for "${esc(filters.place)}"` : ' across India'}</p>
      </div>
    </section>
    <section class="section">
      <div class="container container--narrow">
        ${items.length ? items.map(resultCardMarkup).join('') : `
          <div class="empty">
            <h2>No services matched your search yet</h2>
            <p>Try a broader area, drop the PIN code, or <a href="/providers/new">be the first provider listed</a> for this area.</p>
          </div>`}
      </div>
    </section>`;

    return {
      html: render(ctx, {
        title: `${heading} — Services`,
        description: `${total} local services for ${heading}. Contact providers directly.`,
        body,
      }),
    };
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

    return { html: render(ctx, { title: 'Service categories', body }) };
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

    return { html: render(ctx, { title: 'Locations across India', body }) };
  });

  /* ------------------------------------------------- provider signup */
  router.get('/providers/new', (ctx) => {
    const body = `
    <section class="page-head"><div class="container container--narrow">
      <h1 class="page-head__title">List your service</h1>
      <p class="page-head__lede">Provider registration opens in the next build. Tell us where you work and we
        will prioritise your area.</p>
    </div></section>
    <section class="section"><div class="container container--narrow">
      <p class="empty">Coming soon — provider onboarding, verification and service management.</p>
    </div></section>`;
    return { html: render(ctx, { title: 'List your service', body }) };
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
      return { html: render(ctx, { title: page.title, body }) };
    });
  }
}

module.exports = { register, resultCardMarkup, priceLabel };
