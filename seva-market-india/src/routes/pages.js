'use strict';
/**
 * SEVA MARKET INDIA — core server-rendered pages.
 *
 * Rendered on the server (not in the browser) so every listing is indexable
 * and the first paint works on a 2G phone. Handlers return an HTML string;
 * app.js sends it with the security headers.
 */

const { layout, esc } = require('../views/layout');
const { homeBody } = require('../views/home');
const {
  serviceCardMarkup, priceLabel, tintIndex, alertMarkup,
} = require('../views/ui');
const categoryModel = require('../models/category');
const locationModel = require('../models/location');
const providerModel = require('../models/provider');
const serviceModel = require('../models/service');
const { resolveSearchFilters, describeFilters } = require('./search-context');
const { HttpError } = require('../http/respond');

function register(router, { db, config }) {
  const render = (ctx, { title, description = '', body, currentPath = null }) => layout({
    title,
    description,
    body,
    currentPath: currentPath || ctx.pathname,
    user: ctx.auth,
    site: config.site,
  });

  /* ------------------------------------------------------------- home */
  router.get('/', (ctx) => {
    const totals = locationModel.stats(db);
    const popular = serviceModel.popularCategories(db, 8);
    const featured = serviceModel.searchServices(db, { limit: 6 });
    const markup = homeBody({
      stats: {
        states: totals.state,
        cities: totals.city,
        pincodes: totals.pincode,
        categories: categoryModel.count(db),
        providers: providerModel.count(db),
      },
      popularCategories: popular,
      states: locationModel.findChildren(db, locationModel.ensureIndia(db).id, 'state').slice(0, 12),
      featured,
      site: config.site,
    });
    return {
      html: render(ctx, {
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
        <p class="hero__eyebrow">Search results</p>
        <h1 class="page-head__title">${esc(heading)}</h1>
        <p class="page-head__lede">${total} ${total === 1 ? 'service' : 'services'} available${filters.place ? ` for "${esc(filters.place)}"` : (filters.location ? ` in ${esc(filters.location.name)}` : '')}${filters.pin ? ` near ${esc(filters.pin)}` : ''}${filters.category ? ` in ${esc(filters.category.name)}` : ''}</p>
      </div>
    </section>
    <section class="section">
      <div class="container container--results">
        ${ctx.query.get('sent') === '1' ? alertMarkup('Enquiry sent — the provider will contact you.', { tone: 'ok' }) : ''}
        ${items.length
          ? `<div class="service-grid service-grid--rows">${items.map((row) => serviceCardMarkup(row)).join('\n')}</div>`
          : `
          <div class="empty">
            <span class="empty__icon" aria-hidden="true">🔍</span>
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
    const count = categoryModel.count(db);
    const body = `
    <section class="page-head">
      <div class="container">
        <p class="hero__eyebrow">Marketplace</p>
        <h1 class="page-head__title">Service categories</h1>
        <p class="page-head__lede">${count} categories, from home repair to tutoring. Pick one to see live services near you.</p>
      </div>
    </section>
    <section class="section">
      <div class="container">
        ${tree.length ? tree.map((parent, index) => `
        <div class="category-block">
          <h2 class="category-block__title">
            <span class="category-block__icon tint-${index}" aria-hidden="true">${esc(parent.icon || '🧰')}</span>
            <a href="/search?category=${esc(parent.slug)}">${esc(parent.name)}</a>
            <span class="category-block__count">${esc(parent.children.length)} sub-categories</span>
          </h2>
          ${parent.children.length ? `<ul class="pill-list">${parent.children
            .map((child) => `<li><a href="/search?category=${esc(child.slug)}">${esc(child.icon || '')} ${esc(child.name)}</a></li>`)
            .join('')}</ul>` : ''}
        </div>`).join('') : '<p class="empty">No categories yet.</p>'}
      </div>
    </section>`;

    return {
      html: render(ctx, { title: 'Service categories', description: 'Browse every service category on SEVA MARKET INDIA.', body }),
    };
  });

  /* -------------------------------------------------------- locations */
  router.get('/locations', (ctx) => {
    const india = locationModel.ensureIndia(db);
    const states = locationModel.findChildren(db, india.id, 'state');
    const totals = locationModel.stats(db);
    const body = `
    <section class="page-head">
      <div class="container">
        <p class="hero__eyebrow">Coverage</p>
        <h1 class="page-head__title">States, cities and PIN codes</h1>
        <p class="page-head__lede">${totals.state} states &amp; UTs, ${totals.district} districts, ${totals.city} cities,
          ${totals.locality} localities and ${totals.pincode} PIN codes covered — and growing every week.</p>
      </div>
    </section>
    <section class="section">
      <div class="container">
        ${states.length ? `<h2 class="section__title">Start from your state</h2>
          <ul class="state-grid">${states
            .map((state) => `<li><a href="/search?state=${esc(state.slug)}">
              <span class="state-grid__pin" aria-hidden="true">📍</span>
              <span><strong>${esc(state.name)}</strong><small>${esc(state.code || '')}</small></span>
            </a></li>`)
            .join('')}</ul>` : '<p class="empty">No locations seeded yet. Run <code>npm run seed</code>.</p>'}
      </div>
    </section>`;

    return {
      html: render(ctx, { title: 'Locations across India', description: 'Every state, district, city, locality and PIN code covered by SEVA MARKET INDIA.', body }),
    };
  });

  /* -------------------------------------------------- static pages */
  const staticPages = [
    {
      path: '/about', title: 'About us', icon: '💙',
      text: `${config.site.name} connects customers with local service providers across India, organised by state, district, city, locality and PIN code. What makes us different: providers register free, customers contact them directly, and nothing sits between you and a fair price.`,
    },
    {
      path: '/contact', title: 'Contact', icon: '📮',
      text: 'Questions about a listing? Contact the provider directly from their profile. For site issues or provider support, reach the team through the GitHub repository of this project.',
    },
    {
      path: '/privacy', title: 'Privacy', icon: '🔒',
      text: 'We store only what is needed to connect a customer with a provider: account details for registration, and enquiry details for the provider you contacted. Enquiry phone numbers are never sold or shared beyond the provider contacted.',
    },
    {
      path: '/terms', title: 'Terms', icon: '📄',
      text: 'Listings are provided by independent providers. SEVA MARKET INDIA introduces the two parties and is not a party to the service agreement. Prices shown are starting estimates; always confirm the final quote before work begins.',
    },
  ];

  for (const page of staticPages) {
    router.get(page.path, (ctx) => {
      const body = `
    <section class="page-head page-head--plain">
      <div class="container container--narrow">
        <p class="page-head__emoji" aria-hidden="true">${esc(page.icon)}</p>
        <h1 class="page-head__title">${esc(page.title)}</h1>
      </div>
    </section>
    <section class="section">
      <div class="container container--narrow panel page-prose">
        <p class="prose">${esc(page.text)}</p>
        <p class="prose">This is the foundation build of the site; full policies ship with the provider onboarding milestone.</p>
      </div>
    </section>`;
      return {
        html: render(ctx, { title: page.title, description: page.text, body }),
      };
    });
  }
}

module.exports = {
  register,
  priceLabel,
  resultCardMarkup: serviceCardMarkup,
  tintIndex,
};
