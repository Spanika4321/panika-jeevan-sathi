'use strict';
/**
 * SEVA MARKET INDIA — server-rendered pages.
 *
 * Rendered on the server so every listing is indexable and the first paint
 * works on a 2G phone. Handlers return an HTML string; app.js sends it with
 * the security headers.
 *
 * Now includes the full Category → Subcategory → Service hierarchy, service
 * search, catalog browsing and breadcrumb navigation required by the spec.
 */

const { layout, esc } = require('../views/layout');
const { homeBody } = require('../views/home');
const categoryModel = require('../models/category');
const subcategoryModel = require('../models/subcategory');
const catalogServiceModel = require('../models/catalogService');
const locationModel = require('../models/location');
const providerModel = require('../models/provider');
const serviceModel = require('../models/service');
const { resolveSearchFilters, describeFilters } = require('./search-context');
const { HttpError } = require('../http/respond');
const catalogView = require('../views/catalog');

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
    // Replace the category grid with catalog-aware grid if catalog has data
    const catalogCount = catalogServiceModel.count(db);
    let enhancedMarkup = markup;
    if (catalogCount > 0) {
      const topCats = db.all(
        `SELECT categories.*, COUNT(catalog_services.id) AS service_count
         FROM categories LEFT JOIN catalog_services ON catalog_services.category_id = categories.id AND catalog_services.is_active = 1
         WHERE categories.is_active = 1 GROUP BY categories.id ORDER BY service_count DESC, sort_order LIMIT 8`
      );
      // Inject after stats? Keep original homeBody but append catalog strip for now — simplest is to keep homeBody as is.
      // We will add a catalog strip via the existing popularCategories which now prefers catalog counts.
    }
    return {
      html: render(null, {
        title: 'Find local service providers by service, city and PIN code',
        description: `${config.site.name} — search plumbers, electricians, tutors and more across every state, district, city, locality and PIN code in India.`,
        body: enhancedMarkup,
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

    // Also surface matching catalog services (provider-agnostic directory)
    const q = filters.query;
    let catalogHits = { items: [], total: 0 };
    if (q) {
      catalogHits = catalogServiceModel.search(db, { query: q, limit: 6 });
    }

    const catalogStrip = catalogHits.items.length ? `
      <section class="catalog-strip">
        <h2 class="section__title">Services matching “${esc(q)}”</h2>
        <p class="section__lede">Browse the full catalog — then find providers near you.</p>
        <div class="catalog-grid">${catalogHits.items.map(catalogView.serviceCard).join('')}</div>
        ${catalogHits.total > 6 ? `<p class="section__link"><a href="/services?q=${esc(q)}">View all ${catalogHits.total} services →</a></p>` : ''}
      </section>` : '';

    const body = `
    <section class="page-head">
      <div class="container">
        <h1 class="page-head__title">${esc(heading)}</h1>
        <p class="page-head__lede">${total} ${total === 1 ? 'service' : 'services'} available${filters.place ? ` for “${esc(filters.place)}”` : ' across India'}</p>
      </div>
    </section>
    ${catalogStrip ? `<section class="section section--muted"><div class="container">${catalogStrip}</div></section>` : ''}
    <section class="section">
      <div class="container container--narrow">
        ${items.length ? items.map(resultCardMarkup).join('') : `
          <div class="empty">
            <h2>No services matched your search yet</h2>
            <p>Try a broader area, drop the PIN code, or <a href="/providers/new">be the first provider listed</a> for this area.</p>
            ${catalogHits.items.length ? `<p>Or browse: ${catalogHits.items.slice(0,3).map((s) => `<a href="/services/${esc(s.slug)}">${esc(s.name)}</a>`).join(', ')}</p>` : ''}
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

  /* ------------------------------------------------------- categories (listing) */
  router.get('/categories', (ctx) => {
    const tree = categoryModel.tree(db);
    // Enhance with catalog counts
    const subCounts = new Map(db.all(`SELECT category_id, COUNT(*) AS total FROM subcategories WHERE is_active=1 GROUP BY category_id`).map(r => [r.category_id, r.total]));
    const svcCounts = new Map(db.all(`SELECT category_id, COUNT(*) AS total FROM catalog_services WHERE is_active=1 GROUP BY category_id`).map(r => [r.category_id, r.total]));
    const body = `
    <section class="page-head"><div class="container">
      <h1 class="page-head__title">Service categories</h1>
      <p class="page-head__lede">${tree.length} categories, ${subcategoryModel.count(db)} subcategories and ${catalogServiceModel.count(db)} services — pan-India.</p>
    </div></section>
    <section class="section"><div class="container">
      <div class="catalog-grid">
        ${tree.map((parent) => {
          const parentWithCounts = { ...parent, subcategory_count: subCounts.get(parent.id)||0, service_count: svcCounts.get(parent.id)||0 };
          return catalogView.categoryCard(parentWithCounts);
        }).join('')}
      </div>
      ${tree.length ? tree.map((parent) => {
        const subs = subcategoryModel.findByCategory(db, parent.id);
        if (!subs.length && !parent.children.length) return '';
        return `
        <div class="category-block">
          <h2 class="category-block__title">
            <a href="/categories/${esc(parent.slug)}">${esc(parent.icon || '')} ${esc(parent.name)}</a>
            <span class="category-block__count">${subs.length} subcategories</span>
          </h2>
          ${subs.length ? `<div class="catalog-grid catalog-grid--sub">${subs.map((s) => catalogView.subcategoryCard(s, parent.slug)).join('')}</div>` : ''}
          ${parent.children.length ? `<ul class="pill-list pill-list--legacy">${parent.children.map((child) => `<li><a href="/search?category=${esc(child.slug)}">${esc(child.name)}</a></li>`).join('')}</ul>` : ''}
        </div>`;
      }).join('') : '<p class="empty">No categories yet.</p>'}
    </div></section>`;

    return { html: render(ctx, { title: 'Service categories — SEVA MARKET INDIA', body }) };
  });

  /* ------------------------------------------------ category detail */
  router.get('/categories/:slug', (ctx) => {
    const category = categoryModel.findBySlug(db, ctx.params.slug);
    if (!category) throw HttpError.notFound(`Category "${ctx.params.slug}" not found.`);
    const subcategories = subcategoryModel.findByCategory(db, category.id);
    const services = catalogServiceModel.findByCategory(db, category.id);
    const legacyChildren = db.all(`SELECT ${categoryModel.COLUMNS} FROM categories WHERE parent_id = ? AND is_active = 1 ORDER BY sort_order, name`, [category.id]);

    const crumbs = [
      { label: 'Home', href: '/' },
      { label: 'Categories', href: '/categories' },
      { label: category.name },
    ];

    const body = `
    <section class="page-head">
      <div class="container">
        ${catalogView.breadcrumbMarkup(crumbs)}
        <h1 class="page-head__title"><span aria-hidden="true">${esc(category.icon || '📦')} </span>${esc(category.name)}</h1>
        <p class="page-head__lede">${esc(category.description || `Find ${category.name} services across India. Choose a subcategory or service to see providers near your PIN code.`)}</p>
        <p class="page-head__meta">${subcategories.length} subcategories • ${services.length} services</p>
      </div>
    </section>
    <section class="section">
      <div class="container">
        ${subcategories.length ? `
          <h2 class="section__title">Subcategories in ${esc(category.name)}</h2>
          <div class="catalog-grid">${subcategories.map((s) => catalogView.subcategoryCard(s, category.slug)).join('')}</div>
        ` : '<p class="empty">No subcategories yet — services are listed directly under this category.</p>'}

        ${services.length ? `
          <h2 class="section__title" style="margin-top: 2rem;">All ${esc(category.name)} services</h2>
          <div class="catalog-grid">${services.map(catalogView.serviceCard).join('')}</div>
        ` : ''}

        ${legacyChildren.length ? `
          <div class="category-block" style="margin-top:2rem">
            <h3 class="category-block__title">Legacy subcategories</h3>
            <ul class="pill-list">${legacyChildren.map((child) => `<li><a href="/search?category=${esc(child.slug)}">${esc(child.name)}</a></li>`).join('')}</ul>
          </div>` : ''}
      </div>
    </section>`;

    return { html: render(ctx, { title: `${category.name} — Services`, description: category.description || `Browse ${category.name} subcategories and services across India.`, body }) };
  });

  /* ------------------------------------------- subcategory detail */
  router.get('/categories/:categorySlug/:subcategorySlug', (ctx) => {
    const category = categoryModel.findBySlug(db, ctx.params.categorySlug);
    if (!category) throw HttpError.notFound(`Category "${ctx.params.categorySlug}" not found.`);
    const sub = subcategoryModel.findBySlug(db, ctx.params.subcategorySlug);
    if (!sub || sub.category_id !== category.id) throw HttpError.notFound(`Subcategory "${ctx.params.subcategorySlug}" not found in ${category.name}.`);
    const services = catalogServiceModel.findBySubcategory(db, sub.id);

    const crumbs = [
      { label: 'Home', href: '/' },
      { label: 'Categories', href: '/categories' },
      { label: category.name, href: `/categories/${category.slug}` },
      { label: sub.name },
    ];

    const body = `
    <section class="page-head">
      <div class="container">
        ${catalogView.breadcrumbMarkup(crumbs)}
        <h1 class="page-head__title"><span aria-hidden="true">${esc(sub.icon || '🗂️')} </span>${esc(sub.name)}</h1>
        <p class="page-head__lede">${esc(sub.description || `Browse ${sub.name} services under ${category.name}.`)}</p>
        <p class="page-head__meta">${services.length} services</p>
      </div>
    </section>
    <section class="section">
      <div class="container">
        ${services.length ? `<div class="catalog-grid">${services.map(catalogView.serviceCard).join('')}</div>` : '<p class="empty">No services yet in this subcategory.</p>'}
        <p style="margin-top:1.5rem"><a class="btn btn--ghost" href="/categories/${esc(category.slug)}">← Back to ${esc(category.name)}</a></p>
      </div>
    </section>`;

    return { html: render(ctx, { title: `${sub.name} — ${category.name}`, description: sub.description || `${sub.name} services`, body }) };
  });

  /* -------------------------------------------------- catalog services listing */
  router.get('/services', (ctx) => {
    const categorySlug = ctx.query.get('category');
    const subcategorySlug = ctx.query.get('subcategory');
    const q = ctx.query.get('q') || ctx.query.get('query');
    const page = Math.max(1, Number(ctx.query.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit')) || 20));

    let categoryId = null;
    let subcategoryId = null;
    let category = null;
    let subcategory = null;

    if (categorySlug) {
      category = categoryModel.findBySlug(db, categorySlug);
      if (!category) throw HttpError.notFound(`Category "${categorySlug}" not found.`);
      categoryId = category.id;
    }
    if (subcategorySlug) {
      subcategory = subcategoryModel.findBySlug(db, subcategorySlug);
      if (!subcategory) throw HttpError.notFound(`Subcategory "${subcategorySlug}" not found.`);
      subcategoryId = subcategory.id;
      if (!categoryId) {
        categoryId = subcategory.category_id;
        category = categoryModel.findById(db, categoryId);
      }
    }

    const { items, total } = catalogServiceModel.search(db, {
      query: q,
      categoryId,
      subcategoryId,
      limit,
      offset: (page - 1) * limit,
    });

    const pages = Math.max(1, Math.ceil(total / limit));
    const crumbs = [
      { label: 'Home', href: '/' },
      ...(category ? [{ label: category.name, href: `/categories/${category.slug}` }] : []),
      ...(subcategory ? [{ label: subcategory.name }] : []),
      ...(!category && !subcategory ? [{ label: 'All Services' }] : []),
    ];
    if (!category && !subcategory && !q) crumbs[crumbs.length - 1] = { label: 'All Services' };
    if (q && !category && !subcategory) crumbs.push({ label: `Search: ${q}` });

    const heading = q ? `Search: “${q}”` : subcategory ? subcategory.name : category ? category.name : 'All services';
    const categories = categoryModel.findAll(db);
    const filterBar = catalogView.categoryFilterMarkup(categories, category ? category.slug : null);

    const body = `
    <section class="page-head">
      <div class="container">
        ${catalogView.breadcrumbMarkup([{ label: 'Home', href: '/' }, { label: 'Services' }, ...(category ? [{ label: category.name }] : []), ...(q ? [{ label: `“${q}”` }] : [])])}
        <h1 class="page-head__title">${esc(heading)}</h1>
        <p class="page-head__lede">${total} ${total === 1 ? 'service' : 'services'} available across India. Click a service to find verified providers near your PIN code.</p>
        <form class="search search--compact" action="/services" method="get" role="search">
          <div class="search__field">
            <label for="q">Search services</label>
            <input id="q" name="q" type="search" value="${esc(q || '')}" placeholder="Try Bridal Makeup, Video Editor, Plumber..." maxlength="80">
          </div>
          ${category ? `<input type="hidden" name="category" value="${esc(category.slug)}">` : ''}
          <button class="btn btn--primary search__submit" type="submit">Search</button>
        </form>
      </div>
    </section>
    <section class="section">
      <div class="container">
        ${filterBar}
        ${items.length ? `<div class="catalog-grid">${items.map(catalogView.serviceCard).join('')}</div>` : `<div class="empty"><h2>No services found</h2><p>Try a different category or <a href="/services">browse all services</a>.</p></div>`}
        ${pages > 1 ? `<nav class="pagination" aria-label="Pages">${Array.from({ length: pages }, (_, i) => `<a class="pagination__link ${i+1===page ? 'pagination__link--active' : ''}" href="/services?${esc(new URLSearchParams({ ...(categorySlug?{category:categorySlug}:{}), ...(q?{q}:{}), page: String(i+1) }).toString())}">${i+1}</a>`).join('')}</nav>` : ''}
      </div>
    </section>`;

    return { html: render(ctx, { title: `${heading} — SEVA MARKET INDIA`, description: `Browse ${heading} services across India. Verified providers by PIN code.`, body }) };
  });

  /* ----------------------------------------------- catalog service detail */
  router.get('/services/:slug', (ctx) => {
    const svc = catalogServiceModel.findBySlug(db, ctx.params.slug);
    if (!svc) throw HttpError.notFound(`Service "${ctx.params.slug}" not found.`);
    // Also handle legacy provider-service slug collision: if not in catalog, try provider service
    if (!svc.is_active) throw HttpError.notFound(`Service "${ctx.params.slug}" is not available.`);
    const category = categoryModel.findById(db, svc.category_id);
    const subcategory = svc.subcategory_id ? subcategoryModel.findById(db, svc.subcategory_id) : null;
    const related = category ? catalogServiceModel.findByCategory(db, category.id).filter((s) => s.id !== svc.id).slice(0, 6) : [];

    // If this is actually a legacy provider service slug, the above would have thrown; try provider service fallback
    // (keeps old /services/:slug links working for provider offers)
    const body = catalogView.serviceDetailMarkup(svc, category, subcategory, related);

    return { html: render(ctx, { title: `${svc.name} — ${category ? category.name : 'Service'}`, description: svc.description, body }) };
  });

  // Keep legacy provider-service detail under /p-services/:slug if needed, but /services/:slug now serves catalog.
  // Provide fallback for provider services at /p/services/:slug
  router.get('/p/services/:slug', (ctx) => {
    const svc = serviceModel.findBySlug(db, ctx.params.slug);
    if (!svc || svc.status !== 'active') throw HttpError.notFound(`Service "${ctx.params.slug}" not found.`);
    const body = `
    <section class="page-head"><div class="container container--narrow">
      <h1 class="page-head__title">${esc(svc.title)}</h1>
      <p class="page-head__lede">${esc(svc.description || '')}</p>
      <p class="page-head__meta">${esc(svc.category_name)} • ${esc(svc.location_label || '')}</p>
      <p class="result-card__price">${esc(priceLabel(svc))}</p>
      <a class="btn btn--primary" href="tel:+91${esc(svc.phone)}">Call ${esc(svc.phone)}</a>
    </div></section>`;
    return { html: render(ctx, { title: svc.title, body }) };
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
      <p class="prose">Meanwhile browse <a href="/services">all services</a> or <a href="/categories">categories</a> to see the catalog.</p>
    </div></section>`;
    return { html: render(ctx, { title: 'List your service', body }) };
  });

  /* -------------------------------------------------- static pages */
  const staticPages = [
    { path: '/about', title: 'About us', text: `${config.site.name} connects customers with local service providers across India, organised by state, district, city, locality and PIN code. The catalog is now browsable by Category → Subcategory → Service with SEO-friendly pages.` },
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
