'use strict';
/**
 * SEVA MARKET INDIA — provider dashboard.
 *
 * A logged-in provider manages their live listing here: services, the PIN
 * codes they cover, incoming enquiries (leads) and reviews. Every action is
 * a small POST that redirects back (PRG), so it works without JavaScript and
 * is safe against accidental refresh double-submits.
 */

const { layout, esc } = require('../views/layout');
const { readBody, validators, validate } = require('../http/request');
const { ensureProvider } = require('../http/auth');
const providerModel = require('../models/provider');
const serviceModel = require('../models/service');
const leadModel = require('../models/lead');
const reviewModel = require('../models/review');
const { isValidPin } = require('../db/values');

const PRICE_UNITS = ['visit', 'hour', 'day', 'sqft', 'job', 'month'];
const UNIT_LABEL = {
  visit: 'per visit', hour: 'per hour', day: 'per day',
  sqft: 'per sq.ft', job: 'per job', month: 'per month',
};

const q = (value) => encodeURIComponent(String(value ?? ''));

function render(config, ctx, { title, body }) {
  return layout({
    title,
    body,
    currentPath: '/dashboard',
    site: config.site,
    user: ctx.user,
  });
}

function leafCategoryOptions(db, selectedId = null) {
  const rows = db.all(
    `SELECT c.id AS child_id, c.name AS child_name, p.name AS parent_name, p.icon AS icon
       FROM categories c JOIN categories p ON p.id = c.parent_id
      WHERE c.is_active = 1 ORDER BY p.sort_order, c.name`,
  );
  return rows
    .map((row) => {
      const sel = Number(row.child_id) === Number(selectedId) ? ' selected' : '';
      return `<option value="${row.child_id}"${sel}>${esc(row.icon || '')} ${esc(row.parent_name)} → ${esc(row.child_name)}</option>`;
    })
    .join('\n');
}

function moneyLabel(service) {
  if (service.price_min === null && service.price_max === null) return 'Price on request';
  const suffix = UNIT_LABEL[service.price_unit] || '';
  if (service.price_min !== null && service.price_max !== null) {
    return `₹${service.price_min}–₹${service.price_max} ${suffix}`;
  }
  const single = service.price_min ?? service.price_max;
  return `₹${single} ${suffix}`;
}

function flashMarkup(ctx) {
  const ok = ctx.query.get('ok');
  const error = ctx.query.get('error');
  if (ok) return `<div class="alert alert--success" role="status">${esc(ok)}</div>`;
  if (error) return `<div class="alert alert--error" role="alert">${esc(error)}</div>`;
  return '';
}

function statusButton(service) {
  const slug = service.slug;
  if (service.status === 'active') {
    return `<form method="post" action="/dashboard/services/${esc(slug)}/status">
        <input type="hidden" name="status" value="paused">
        <button class="btn btn--ghost btn--sm" type="submit">Pause</button>
      </form>
      <form method="post" action="/dashboard/services/${esc(slug)}/status">
        <input type="hidden" name="status" value="archived">
        <button class="btn btn--danger btn--sm" type="submit">Archive</button>
      </form>`;
  }
  if (service.status === 'paused') {
    return `<form method="post" action="/dashboard/services/${esc(slug)}/status">
        <input type="hidden" name="status" value="active">
        <button class="btn btn--primary btn--sm" type="submit">Publish</button>
      </form>`;
  }
  return `<form method="post" action="/dashboard/services/${esc(slug)}/status">
      <input type="hidden" name="status" value="active">
      <button class="btn btn--primary btn--sm" type="submit">Republish</button>
    </form>`;
}

function register(router, { db, config }) {
  /* ----------------------------------------------------------- overview */
  router.get('/dashboard', (ctx) => {
    const { provider } = ensureProvider(ctx);
    const services = serviceModel.byProviderAll(db, provider.id);
    const areas = providerModel.serviceAreas(db, provider.id);
    const counts = leadModel.statusCounts(db, provider.id);
    const recentLeads = leadModel.byProvider(db, provider.id, { limit: 10 });
    const pendingReviews = reviewModel.byStatus(db, provider.id, 'pending');
    const approvedReviews = reviewModel.byStatus(db, provider.id, 'approved');
    const welcome = ctx.query.get('welcome') === '1';

    const body = `
    <section class="page-head"><div class="container">
      <div class="dash-head">
        <div>
          <h1 class="page-head__title">Provider dashboard</h1>
          <p class="page-head__lede">${esc(provider.business_name)} · ${esc(provider.category_name)} ·
            ${esc(provider.pin_code || '—')} ${provider.is_verified ? '<span class="badge badge--verified">Verified</span>' : '<span class="badge">Unverified</span>'}
            · <a href="/providers/${esc(provider.slug)}">View public profile</a></p>
        </div>
      </div>
    </div></section>
    <section class="section"><div class="container">
      ${welcome ? '<div class="alert alert--success" role="status">Your listing is live. Add your first service below to start appearing in search.</div>' : ''}
      ${flashMarkup(ctx)}
      <div class="stat-row">
        <span class="stat-pill">${counts.new} new enquiries</span>
        <span class="stat-pill">${services.filter((s) => s.status === 'active').length} live services</span>
        <span class="stat-pill">${areas.length} PINs covered</span>
        <span class="stat-pill">★ ${provider.rating_avg || '—'} (${provider.rating_count} reviews)</span>
      </div>

      <div class="dash-grid">

        <div class="panel">
          <h2 class="panel__title">Add a service</h2>
          <form class="form" action="/dashboard/services" method="post">
            <label for="title">Service title</label>
            <input id="title" name="title" required maxlength="140" placeholder="e.g. Bathroom tap &amp; shower repair">
            <label for="category_id">Category</label>
            <select id="category_id" name="category_id" required>
              <option value="">Choose a category…</option>
              ${leafCategoryOptions(db, provider.category_id)}
            </select>
            <div class="form__row">
              <div>
                <label for="price_min">Min price (₹)</label>
                <input id="price_min" name="price_min" type="number" inputmode="numeric" min="0">
              </div>
              <div>
                <label for="price_max">Max price (₹)</label>
                <input id="price_max" name="price_max" type="number" inputmode="numeric" min="0">
              </div>
              <div>
                <label for="price_unit">Unit</label>
                <select id="price_unit" name="price_unit">
                  ${PRICE_UNITS.map((u) => `<option value="${u}">${UNIT_LABEL[u]}</option>`).join('')}
                </select>
              </div>
            </div>
            <label for="description">Description</label>
            <textarea id="description" name="description" rows="3" maxlength="2000"></textarea>
            <button class="btn btn--primary" type="submit">Add service</button>
          </form>

          <h2 class="panel__title panel__title--top">Your services</h2>
          ${services.length ? `<ul class="svc-list">${services.map((service) => `
            <li class="svc-list__item">
              <div class="svc-list__main">
                <a class="svc-list__name" href="/services/${esc(service.slug)}">${esc(service.title)}</a>
                <span class="svc-list__meta">${esc(moneyLabel(service))} ·
                  <span class="badge badge--${service.status === 'active' ? 'verified' : 'neutral'}">${esc(service.status)}</span>
                </span>
              </div>
              <div class="svc-list__actions">${statusButton(service)}</div>
            </li>`).join('')}</ul>`
        : '<p class="empty">No services yet. Add your first one above.</p>'}
        </div>

        <div class="panel">
          <h2 class="panel__title">Incoming enquiries</h2>
          ${recentLeads.length ? `<ul class="lead-list">${recentLeads.map((lead) => `
            <li class="lead-list__item">
              <p class="lead-list__who">${esc(lead.name)} · <a href="tel:+91${esc(lead.phone)}">${esc(lead.phone)}</a>
                <span class="badge badge--neutral">${esc(lead.status)}</span></p>
              ${lead.message ? `<p class="lead-list__msg">${esc(lead.message)}</p>` : ''}
              <p class="lead-list__meta">${esc(lead.pin_code || '—')} · ${esc((lead.created_at || '').slice(0, 10))}</p>
              ${lead.status !== 'closed' ? `
                <div class="row-actions">
                  <form method="post" action="/dashboard/leads/${lead.id}/status"><input type="hidden" name="status" value="contacted"><button class="btn btn--ghost btn--sm" type="submit">Mark contacted</button></form>
                  <form method="post" action="/dashboard/leads/${lead.id}/status"><input type="hidden" name="status" value="closed"><button class="btn btn--primary btn--sm" type="submit">Close</button></form>
                  <form method="post" action="/dashboard/leads/${lead.id}/status"><input type="hidden" name="status" value="spam"><button class="btn btn--ghost btn--sm" type="submit">Spam</button></form>
                </div>` : ''}
            </li>`).join('')}</ul>`
        : '<p class="empty">No enquiries yet. When a customer contacts you they will appear here.</p>'}

          <h2 class="panel__title panel__title--top">PIN codes you cover</h2>
          <div class="pill-wrap">
            ${areas.length ? areas.map((pin) => `
              <span class="pill-remove">${esc(pin)}
                <form method="post" action="/dashboard/coverage/remove"><input type="hidden" name="pin" value="${esc(pin)}"><button class="pill-remove__btn" type="submit" aria-label="Remove ${esc(pin)}">×</button></form>
              </span>`).join('') : '<span class="muted">No extra PINs.</span>'}
          </div>
          <form class="form form--inline" method="post" action="/dashboard/coverage/add">
            <label for="pins">Add PIN codes (comma separated)</label>
            <input id="pins" name="pins" type="text" inputmode="numeric" placeholder="781002, 781003">
            <button class="btn btn--primary btn--sm" type="submit">Add</button>
          </form>

          ${pendingReviews.length ? `
            <h2 class="panel__title panel__title--top">Reviews awaiting moderation</h2>
            <ul class="lead-list">${pendingReviews.map((review) => `
              <li class="lead-list__item">
                <p>${esc(review.customer_name)} — ${esc('★'.repeat(review.rating))}</p>
                ${review.comment ? `<p class="lead-list__msg">${esc(review.comment)}</p>` : ''}
                <div class="row-actions">
                  <form method="post" action="/dashboard/reviews/${review.id}/status"><input type="hidden" name="status" value="approved"><button class="btn btn--primary btn--sm" type="submit">Approve</button></form>
                  <form method="post" action="/dashboard/reviews/${review.id}/status"><input type="hidden" name="status" value="rejected"><button class="btn btn--ghost btn--sm" type="submit">Reject</button></form>
                </div>
              </li>`).join('')}</ul>` : ''}

          <p class="muted">${approvedReviews.length} approved review${approvedReviews.length === 1 ? '' : 's'} shown on your public profile.</p>
        </div>

      </div>
    </div></section>`;

    return { html: render(config, ctx, { title: 'Provider dashboard', body }) };
  });

  /* ------------------------------------------------------ add service */
  router.post('/dashboard/services', async (ctx) => {
    const { provider } = ensureProvider(ctx);
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const { value, errors, valid } = validate({
      title: () => validators.text(body.title, { field: 'title', max: 140 }),
      categoryId: () => validators.int(body.category_id, { field: 'category_id', required: true, min: 1 }),
      priceMin: () => validators.int(body.price_min, { field: 'price_min', min: 0 }),
      priceMax: () => validators.int(body.price_max, { field: 'price_max', min: 0 }),
      priceUnit: () => validators.enum(body.price_unit, PRICE_UNITS, { field: 'price_unit' }),
      description: () => validators.text(body.description, { field: 'description', required: false, max: 2000 }),
    });
    if (!valid) {
      return { redirect: `/dashboard?error=${q('Please fix the form: ' + Object.values(errors).join(' '))}`, status: 303 };
    }
    if (value.priceMin !== null && value.priceMax !== null && value.priceMax < value.priceMin) {
      return { redirect: `/dashboard?error=${q('Max price cannot be below min price.')}`, status: 303 };
    }
    try {
      serviceModel.createService(db, {
        providerId: provider.id,
        categoryId: value.categoryId,
        locationId: provider.location_id,
        title: value.title,
        description: value.description,
        priceMin: value.priceMin,
        priceMax: value.priceMax,
        priceUnit: value.priceUnit || 'visit',
        status: 'active',
      });
    } catch (err) {
      return { redirect: `/dashboard?error=${q('Could not add service: ' + err.message)}`, status: 303 };
    }
    return { redirect: '/dashboard?ok=' + q('Service published.'), status: 303 };
  });

  /* ------------------------------------------------- service status */
  router.post('/dashboard/services/:slug/status', async (ctx) => {
    const { provider } = ensureProvider(ctx);
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const status = validators.enum(body.status, ['active', 'paused', 'archived'], { field: 'status' });
    const service = serviceModel.findBySlug(db, ctx.params.slug);
    if (!service || service.provider_id !== provider.id) {
      return { redirect: `/dashboard?error=${q('Service not found.')}`, status: 303 };
    }
    serviceModel.updateStatus(db, service.id, { providerId: provider.id, status });
    return { redirect: `/dashboard?ok=${q(`Service ${status}.`)}`, status: 303 };
  });

  /* ------------------------------------------------- add/remove PINs */
  router.post('/dashboard/coverage/add', async (ctx) => {
    const { provider } = ensureProvider(ctx);
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const raw = String(body.pins || '').split(/[\s,]+/).map((p) => p.trim()).filter(Boolean);
    const good = [...new Set(raw.filter(isValidPin))];
    const current = providerModel.serviceAreas(db, provider.id);
    const merged = [...new Set([...current, ...good])];
    providerModel.setServiceAreas(db, provider.id, merged);
    const dropped = raw.length - good.length;
    return {
      redirect: `/dashboard?ok=${q(`Added ${good.length} PIN${good.length === 1 ? '' : 's'}${dropped ? `, ignored ${dropped} invalid` : ''}.`)}`,
      status: 303,
    };
  });

  router.post('/dashboard/coverage/remove', async (ctx) => {
    const { provider } = ensureProvider(ctx);
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const current = providerModel.serviceAreas(db, provider.id);
    providerModel.setServiceAreas(db, provider.id, current.filter((pin) => pin !== String(body.pin)));
    return { redirect: '/dashboard?ok=' + q('PIN removed.'), status: 303 };
  });

  /* ---------------------------------------------------- lead status */
  router.post('/dashboard/leads/:id/status', async (ctx) => {
    const { provider } = ensureProvider(ctx);
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const status = validators.enum(body.status, leadModel.LEAD_STATUSES, { field: 'status' });
    try {
      leadModel.setStatus(db, Number(ctx.params.id), { providerId: provider.id, status });
    } catch (err) {
      return { redirect: `/dashboard?error=${q(err.message)}`, status: 303 };
    }
    return { redirect: '/dashboard?ok=' + q('Enquiry updated.'), status: 303 };
  });

  /* ------------------------------------------------ review moderation */
  router.post('/dashboard/reviews/:id/status', async (ctx) => {
    const { provider } = ensureProvider(ctx);
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const status = validators.enum(body.status, ['approved', 'rejected'], { field: 'status' });
    const review = reviewModel.findById(db, Number(ctx.params.id));
    if (!review || review.provider_id !== provider.id) {
      return { redirect: `/dashboard?error=${q('Review not found.')}`, status: 303 };
    }
    reviewModel.setStatus(db, review.id, status);
    return { redirect: '/dashboard?ok=' + q('Review updated.'), status: 303 };
  });
}

module.exports = { register };
