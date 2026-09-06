'use strict';
/**
 * SEVA MARKET INDIA — public provider & service pages + reviews.
 *
 * Server-rendered so every provider and service is indexable (the SEO
 * surface). Each provider page also hosts the customer review form, which
 * POSTs back to the same provider and redirects on success (PRG). A review
 * is auto-approved unless REVIEWS_MODERATED=1 is set.
 */

const { layout, esc } = require('../views/layout');
const { readBody, validators, validate } = require('../http/request');
const { HttpError } = require('../http/respond');
const { priceLabel } = require('./pages');
const providerModel = require('../models/provider');
const serviceModel = require('../models/service');
const reviewModel = require('../models/review');

const q = (value) => encodeURIComponent(String(value ?? ''));

function render(config, ctx, { title, description = '', body, status = 200, currentPath }) {
  return {
    html: layout({
      title,
      description,
      body,
      currentPath: currentPath || (ctx && ctx.pathname) || '/',
      site: config.site,
      user: ctx.user || null,
    }),
    status,
  };
}

function notFoundPage(config, ctx, message) {
  const body = `
    <section class="page-head"><div class="container container--narrow">
      <h1 class="page-head__title">Not found</h1>
    </div></section>
    <section class="section"><div class="container container--narrow">
      <p class="prose">${esc(message)}</p>
      <p class="prose"><a href="/search">Browse services</a> or go <a href="/">home</a>.</p>
    </div></section>`;
  return render(config, ctx, { title: 'Not found', body, status: 404, currentPath: ctx.pathname });
}

function reviewStars(rating) {
  const stars = Math.max(0, Math.min(5, Number(rating) || 0));
  const full = Math.round(stars);
  return `${'★'.repeat(full)}${'☆'.repeat(5 - full)}`;
}

function register(router, { db, config }) {
  /* ------------------------------------------------- provider profile */
  router.get('/providers/:slug', (ctx) => {
    const provider = providerModel.findBySlug(db, ctx.params.slug);
    if (!provider || provider.status !== 'active') {
      return notFoundPage(config, ctx, 'This provider is not currently listed.');
    }
    const services = serviceModel.byProvider(db, provider.id);
    const areas = providerModel.serviceAreas(db, provider.id);
    const reviews = reviewModel.approvedByProvider(db, provider.id, { limit: 30 });
    const thanks = ctx.query.get('thanks') === '1';

    const body = `
    <section class="page-head page-head--alt">
      <div class="container">
        <p class="page-head__eyebrow">${esc(provider.category_name)}${provider.is_verified ? ' · <span class="badge badge--verified">Verified</span>' : ''}</p>
        <h1 class="page-head__title">${esc(provider.business_name)}</h1>
        <p class="page-head__lede">${esc(provider.location_label || 'India')}${provider.pin_code ? ` · PIN ${esc(provider.pin_code)}` : ''}</p>
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${thanks ? '<div class="alert alert--success" role="status">Thanks! Your review has been ${esc(config.reviews.moderated ? "submitted for moderation" : "published")}.</div>' : ''}
        <div class="profile-layout">
          <div class="panel">
            <h2 class="panel__title">About</h2>
            <p class="prose">${esc(provider.about || 'No description provided yet.')}</p>
            <dl class="def-list">
              <div><dt>Experience</dt><dd>${esc(provider.experience_years || 0)} years</dd></div>
              <div><dt>Primary category</dt><dd>${esc(provider.category_name)}</dd></div>
              <div><dt>Contact name</dt><dd>${esc(provider.contact_name || '—')}</dd></div>
              <div><dt>Area</dt><dd>${esc(provider.location_label || 'India')}</dd></div>
            </dl>
            ${areas.length ? `
              <h3 class="panel__title">Also serves PIN codes</h3>
              <div class="pill-wrap">${areas.map((pin) => `<span class="pill">${esc(pin)}</span>`).join('')}</div>` : ''}
          </div>

          <div class="panel">
            <h2 class="panel__title">Services</h2>
            ${services.length ? `<ul class="svc-list">${services.map((service) => `
              <li class="svc-list__item">
                <div class="svc-list__main">
                  <a class="svc-list__name" href="/services/${esc(service.slug)}">${esc(service.title)}</a>
                  <span class="svc-list__meta">${esc(priceLabel(service))}</span>
                </div>
              </li>`).join('')}</ul>` : '<p class="empty">No services listed right now.</p>'}

            <div class="contact-strip">
              <a class="btn btn--primary" href="tel:+91${esc(provider.phone)}">Call ${esc(provider.phone)}</a>
              <p class="muted">Contact the provider directly — no middleman, no booking fee.</p>
            </div>
          </div>
        </div>

        <div class="panel">
          <h2 class="panel__title">Rating &amp; reviews</h2>
          <p class="rating-line"><span class="rating-line__stars">${provider.rating_count ? esc(reviewStars(provider.rating_avg)) : ''}</span>
            ${provider.rating_count ? `${esc(provider.rating_avg)} out of 5 · ${esc(provider.rating_count)} review${provider.rating_count === 1 ? '' : 's'}` : 'No reviews yet — be the first to review this provider.'}</p>
          ${reviews.length ? `<ul class="review-list">${reviews.map((review) => `
            <li class="review-list__item">
              <p class="review-list__head"><span class="stars" aria-hidden="true">${esc(reviewStars(review.rating))}</span>
                <strong>${esc(review.customer_name)}</strong> · <span class="muted">${esc((review.created_at || '').slice(0, 10))}</span></p>
              ${review.comment ? `<p class="prose">${esc(review.comment)}</p>` : ''}
            </li>`).join('')}</ul>` : ''}

          <h3 class="panel__title panel__title--top">Leave a review</h3>
          <form class="form form--narrow" action="/providers/${esc(provider.slug)}/reviews" method="post">
            <label for="customer_name">Your name</label>
            <input id="customer_name" name="customer_name" required maxlength="120">
            <label for="rating">Rating</label>
            <select id="rating" name="rating" required>
              <option value="">Choose…</option>
              <option value="5">5 — Excellent</option>
              <option value="4">4 — Good</option>
              <option value="3">3 — Average</option>
              <option value="2">2 — Poor</option>
              <option value="1">1 — Very poor</option>
            </select>
            <label for="comment">Comment</label>
            <textarea id="comment" name="comment" rows="4" maxlength="2000"></textarea>
            <button class="btn btn--primary" type="submit">Submit review</button>
          </form>
        </div>
      </div>
    </section>`;

    return render(config, ctx, {
      title: provider.business_name,
      description: `${provider.business_name} — ${provider.category_name} in ${provider.location_label || 'India'}. ${provider.about || ''}`.slice(0, 200),
      body,
      currentPath: `/providers/${provider.slug}`,
    });
  });

  /* ------------------------------------------------ submit a review */
  router.post('/providers/:slug/reviews', async (ctx) => {
    const provider = providerModel.findBySlug(db, ctx.params.slug);
    if (!provider || provider.status !== 'active') {
      throw HttpError.notFound('Provider not found.');
    }
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const { value, errors, valid } = validate({
      customerName: () => validators.text(body.customer_name, { field: 'customer_name', max: 120 }),
      rating: () => validators.int(body.rating, { field: 'rating', required: true, min: 1, max: 5 }),
      comment: () => validators.text(body.comment, { field: 'comment', required: false, max: 2000 }),
    });
    if (!valid) {
      return { redirect: `/providers/${ctx.params.slug}?error=${q('Please provide a name and a rating between 1 and 5.')}`, status: 303 };
    }
    const tooMany = reviewModel.recentCountFromIp(db, ctx.ip, {
      minutes: 60,
      secret: config.security.sessionSecret,
    });
    if (tooMany >= config.reviews.perHourPerIp) {
      return { redirect: `/providers/${ctx.params.slug}?error=${q('Too many reviews from your connection. Try again later.')}`, status: 303 };
    }
    reviewModel.create(db, {
      providerId: provider.id,
      customerName: value.customerName,
      rating: value.rating,
      comment: value.comment,
      ip: ctx.ip,
      secret: config.security.sessionSecret,
      approve: !config.reviews.moderated,
    });
    return { redirect: `/providers/${ctx.params.slug}?thanks=1`, status: 303 };
  });

  /* --------------------------------------------------- service page */
  router.get('/services/:slug', (ctx) => {
    const service = serviceModel.findBySlug(db, ctx.params.slug);
    if (!service || service.status !== 'active') {
      return notFoundPage(config, ctx, 'This service is no longer listed.');
    }
    const body = `
    <section class="page-head page-head--alt">
      <div class="container">
        <p class="page-head__eyebrow">${esc(service.category_name)} · <a href="/providers/${esc(service.provider_slug)}">${esc(service.business_name)}</a>${service.is_verified ? ' · <span class="badge badge--verified">Verified</span>' : ''}</p>
        <h1 class="page-head__title">${esc(service.title)}</h1>
        <p class="page-head__lede">${esc(service.location_label || 'India')}${service.pin_code ? ` · PIN ${esc(service.pin_code)}` : ''}</p>
      </div>
    </section>
    <section class="section"><div class="container container--narrow">
      <div class="service-card">
        <div class="service-card__price">${esc(priceLabel(service))}</div>
        ${service.description ? `<p class="prose">${esc(service.description)}</p>` : '<p class="prose">Contact the provider for details and availability.</p>'}
        <p class="prose">Offered by <a href="/providers/${esc(service.provider_slug)}">${esc(service.business_name)}</a>, serving ${esc(service.location_label || 'India')}.</p>
        <div class="contact-strip">
          <a class="btn btn--primary" href="tel:+91${esc(service.phone)}">Call ${esc(service.phone)}</a>
          <a class="btn btn--ghost" href="/providers/${esc(service.provider_slug)}#reviews">View provider reviews</a>
        </div>
      </div>
    </div></section>`;
    return render(config, ctx, {
      title: service.title,
      description: `${service.business_name} offers ${service.title} in ${service.location_label || 'India'}${service.price_min ? ` from ₹${service.price_min}` : ''}.`.slice(0, 200),
      body,
      currentPath: `/services/${service.slug}`,
    });
  });
}

module.exports = { register };
