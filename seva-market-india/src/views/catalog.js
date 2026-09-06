'use strict';
/**
 * SEVA MARKET INDIA — catalog view helpers.
 *
 * Mobile-first cards for categories, subcategories and services.
 * Every view is server-rendered and escaped, so the CSP can stay strict.
 */

const { esc } = require('./escape');

function breadcrumbMarkup(items) {
  // items: [{ label, href }]
  const parts = items.map((item, idx) => {
    const isLast = idx === items.length - 1;
    if (isLast || !item.href) return `<span class="breadcrumb__current" aria-current="page">${esc(item.label)}</span>`;
    return `<a class="breadcrumb__link" href="${esc(item.href)}">${esc(item.label)}</a>`;
  }).join('<span class="breadcrumb__sep" aria-hidden="true">›</span>');
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${parts}</nav>`;
}

function categoryCard(category) {
  const count = category.service_count ?? category.catalog_service_count ?? 0;
  const subCount = category.subcategory_count ?? 0;
  return `
      <a class="catalog-card catalog-card--category" href="/categories/${esc(category.slug)}">
        <span class="catalog-card__icon" aria-hidden="true">${esc(category.icon || '📦')}</span>
        <span class="catalog-card__name">${esc(category.name)}</span>
        ${category.description ? `<span class="catalog-card__desc">${esc(category.description.slice(0, 90))}</span>` : ''}
        <span class="catalog-card__meta">${subCount} subcategories • ${count} services</span>
      </a>`;
}

function subcategoryCard(sub, categorySlug) {
  return `
      <a class="catalog-card catalog-card--sub" href="/categories/${esc(categorySlug)}/${esc(sub.slug)}">
        <span class="catalog-card__icon" aria-hidden="true">${esc(sub.icon || '🗂️')}</span>
        <span class="catalog-card__name">${esc(sub.name)}</span>
        ${sub.description ? `<span class="catalog-card__desc">${esc(sub.description.slice(0, 80))}</span>` : ''}
      </a>`;
}

function serviceCard(svc) {
  const catSlug = svc.category_slug || '';
  const subSlug = svc.subcategory_slug || '';
  const href = `/services/${esc(svc.slug)}`;
  return `
      <a class="catalog-card catalog-card--service" href="${href}">
        <span class="catalog-card__icon" aria-hidden="true">${esc(svc.icon || '🔧')}</span>
        <span class="catalog-card__name">${esc(svc.name)}</span>
        ${svc.description ? `<span class="catalog-card__desc">${esc(svc.description.slice(0, 100))}</span>` : ''}
        <span class="catalog-card__meta">${esc(svc.category_name || '')}${svc.subcategory_name ? ` › ${esc(svc.subcategory_name)}` : ''}</span>
      </a>`;
}

function serviceDetailMarkup(svc, category, subcategory, related = []) {
  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'Categories', href: '/categories' },
    category ? { label: category.name, href: `/categories/${category.slug}` } : null,
    subcategory ? { label: subcategory.name, href: `/categories/${category.slug}/${subcategory.slug}` } : null,
    { label: svc.name },
  ].filter(Boolean);

  const relatedMarkup = related.length ? `
      <section class="section">
        <h2 class="section__title">Related services</h2>
        <div class="catalog-grid">${related.slice(0, 6).map(serviceCard).join('')}</div>
      </section>` : '';

  return `
    <section class="page-head">
      <div class="container container--narrow">
        ${breadcrumbMarkup(crumbs)}
        <h1 class="page-head__title"><span aria-hidden="true">${esc(svc.icon || '🔧')} </span>${esc(svc.name)}</h1>
        <p class="page-head__lede">${esc(svc.description || '')}</p>
        <p class="page-head__meta">
          <span class="badge">${esc(category ? category.name : '')}</span>
          ${subcategory ? `<span class="dot">•</span><span>${esc(subcategory.name)}</span>` : ''}
        </p>
        <div class="service-actions">
          <a class="btn btn--primary" href="/search?q=${esc(svc.name)}">Find providers for ${esc(svc.name)}</a>
          <a class="btn btn--ghost" href="/categories/${esc(category.slug)}">Browse ${esc(category.name)}</a>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="container container--narrow">
        <div class="detail-card">
          <h2 class="detail-card__heading">About ${esc(svc.name)}</h2>
          <p class="prose">${esc(svc.description || 'Professional service available across India. Book verified providers near your PIN code.')}</p>
          <p class="prose">Available pan-India. Search by your city or PIN code to find verified providers, compare prices and contact directly — no commission, no middleman.</p>
          <div class="detail-card__meta">
            <span>Category: <a href="/categories/${esc(category.slug)}">${esc(category.name)}</a></span>
            ${subcategory ? `<span>Subcategory: <a href="/categories/${esc(category.slug)}/${esc(subcategory.slug)}">${esc(subcategory.name)}</a></span>` : ''}
            <span>SEO slug: <code>${esc(svc.slug)}</code></span>
          </div>
        </div>
      </div>
    </section>
    ${relatedMarkup}`;
}

function categoryFilterMarkup(categories, activeSlug) {
  if (!categories.length) return '';
  const items = categories.map((cat) =>
    `<a class="chip ${activeSlug === cat.slug ? 'chip--active' : ''}" href="/services?category=${esc(cat.slug)}">${esc(cat.icon || '')} ${esc(cat.name)}</a>`
  ).join('');
  return `<div class="filter-bar" aria-label="Category filters"><a class="chip ${!activeSlug ? 'chip--active' : ''}" href="/services">All</a>${items}</div>`;
}

module.exports = {
  breadcrumbMarkup,
  categoryCard,
  subcategoryCard,
  serviceCard,
  serviceDetailMarkup,
  categoryFilterMarkup,
};
