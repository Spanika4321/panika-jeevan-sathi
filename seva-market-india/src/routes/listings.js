'use strict';
/**
 * SEVA MARKET INDIA — public listing pages + the customer enquiry flow.
 *
 *   GET  /services/:slug     one service, with provider + enquiry card
 *   GET  /providers/:slug    a provider business profile + its services
 *   GET  /providers/new      "list your service" landing
 *   POST /contact            the HTML enquiry form (creates a lead)
 *
 * These pages make the marketplace real for customers: search results and
 * home cards link here, and the enquiry form reaches a provider without a
 * phone call. Server-rendered (indexable, fast on 2G), plain-HTML POSTs.
 */

const { layout, esc, canonicalUrl } = require('../views/layout');
const {
  priceLabel, ratingMarkup, verifiedMarkup, tintIndex, field,
  textareaField, alertMarkup, serviceCardMarkup, shareMarkup,
} = require('../views/ui');
const serviceModel = require('../models/service');
const providerModel = require('../models/provider');
const { HttpError } = require('../http/respond');
const { assertSameOrigin } = require('../http/security');

function register(router, { db, store, config }) {
  const render = (ctx, { title, description = '', body, jsonLd = [] }) => layout({
    title,
    description,
    body,
    currentPath: ctx.pathname,
    user: ctx.auth,
    site: config.site,
    jsonLd,
    googleSiteVerification: config.googleSiteVerification,
  });

  /* ------------------------------------------- structured data (JSON-LD) */

  /** Breadcrumb trail matching the visible .crumbs nav (Home / Category / …). */
  function breadcrumbJsonLd(items) {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    };
  }

  /**
   * LocalBusiness for a provider page. Google's LocalBusiness rules: mark up
   * only what the page itself shows, name + address are required, telephone
   * in international format. Providers are service-area businesses, so the
   * address is the locality they registered plus areaServed PINs — exactly
   * the "Areas we serve" list rendered on the page.
   */
  function localBusinessJsonLd(provider, areas) {
    const origin = canonicalUrl(config.site, '/');
    const locality = String(provider.location_label || '').split(',')[0].trim();
    const node = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: provider.business_name,
      url: `${origin}providers/${provider.slug}`,
      telephone: `+91${provider.phone}`,
      image: provider.photo_urls?.length ? `${origin.replace(/\/$/, '')}${provider.photo_urls[0]}` : undefined,
      address: {
        '@type': 'PostalAddress',
        addressLocality: locality || undefined,
        addressRegion: provider.location_label?.split(',').slice(-2)[0]?.trim() || undefined,
        postalCode: provider.pin_code || undefined,
        addressCountry: 'IN',
      },
      areaServed: areas.length
        ? areas.map((pin) => ({ '@type': 'Place', name: `PIN ${pin}` }))
        : undefined,
    };
    // A rating is only marked up when the page actually shows one — Google
    // rejects invisible rating markup.
    if (Number(provider.rating_count) > 0) {
      node.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: Number(provider.rating_avg).toFixed(1),
        reviewCount: Number(provider.rating_count),
      };
    }
    return node;
  }

  /** Service node for a service detail page; provider referenced by URL. */
  function serviceJsonLd(service, provider) {
    const origin = canonicalUrl(config.site, '/');
    const locality = String(service.location_label || '').split(',')[0].trim();
    const offers = {
      '@type': 'Offer',
      priceCurrency: 'INR',
      url: `${origin}services/${service.slug}`,
    };
    if (service.price_min !== null && service.price_min !== undefined) {
      offers.priceSpecification = {
        '@type': 'PriceSpecification',
        price: String(service.price_min),
        priceCurrency: 'INR',
      };
      if (service.price_max !== null && service.price_max !== undefined && service.price_max !== service.price_min) {
        offers.priceSpecification.maxPrice = String(service.price_max);
      }
    }
    return {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: service.title,
      description: service.description || `${service.title} by ${service.business_name}`,
      serviceType: service.category_name,
      provider: {
        '@type': 'LocalBusiness',
        name: service.business_name,
        url: `${origin}providers/${service.provider_slug}`,
      },
      areaServed: locality ? { '@type': 'Place', name: locality } : undefined,
      offers,
    };
  }

  /* ------------------------------------------------ enquiry form ---- */

  function enquiryFormMarkup({
    providerId, serviceId = '', back = '', values = {}, errors = {}, sent = false,
  }) {
    const banner = sent
      ? alertMarkup('Enquiry sent! The provider will call or message you back shortly.', { tone: 'ok' })
      : (errors.form ? alertMarkup(errors.form, { tone: 'err' }) : '');
    return `
      <div class="enquiry" id="enquiry">
        <div class="enquiry__head">
          <span class="enquiry__icon" aria-hidden="true">📨</span>
          <div>
            <h2 class="enquiry__title">Send an enquiry</h2>
            <p class="enquiry__sub">Free — the provider calls you back. No middleman.</p>
          </div>
        </div>
        ${banner}
        <form class="form-stack" action="/contact" method="post" data-enquiry-form>
          <input type="hidden" name="provider_id" value="${esc(providerId)}">
          <input type="hidden" name="service_id" value="${esc(serviceId)}">
          <input type="hidden" name="back" value="${esc(back)}">
          ${field({ id: 'enq_name', name: 'name', label: 'Your name', required: true, value: values.name || '', autocomplete: 'name', error: errors.name })}
          ${field({ id: 'enq_phone', type: 'tel', name: 'phone', label: 'Your mobile number', required: true, value: values.phone || '', autocomplete: 'tel', inputmode: 'numeric', maxlength: 10, error: errors.phone })}
          ${field({ id: 'enq_email', type: 'email', name: 'email', label: 'Email (optional)', value: values.email || '', autocomplete: 'email', error: errors.email })}
          ${textareaField({ id: 'enq_msg', name: 'message', label: 'What do you need?', value: values.message || '', rows: 3, maxlength: 1000, placeholder: 'e.g. Two leaking taps in the kitchen — when can you visit?', error: errors.message })}
          <button class="btn btn--orange btn--block" type="submit">Send enquiry</button>
        </form>
        <p class="enquiry__fine">Your details go only to this provider — never sold, never spammed.</p>
      </div>`;
  }

  /* ------------------------------------------- provider landing ---- */

  router.get('/providers/new', (ctx) => {
    const claims = ctx.auth;
    const banner = ctx.query.get('ok') === '1'
      ? alertMarkup('Business profile saved.', { tone: 'ok' }) : '';

    let action;
    let steps = '';
    if (claims && claims.rl === 'provider') {
      action = `
        <div class="cta-card">
          <p class="cta-card__kicker">You are logged in as a provider.</p>
          <h2 class="cta-card__title">Set up your business in minutes</h2>
          <p class="cta-card__text">Add your business details, choose your services and pricing — then go live for
            your whole PIN code area.</p>
          <div class="cta-card__actions">
            <a class="btn btn--yellow btn--lg" href="/account/provider">Set up my business</a>
            <a class="btn btn--white-line btn--lg" href="/account/services">My services</a>
          </div>
        </div>`;
    } else if (claims) {
      action = `
        <div class="cta-card">
          <p class="cta-card__kicker">Logged in as a customer.</p>
          <h2 class="cta-card__title">Want to list your own service too?</h2>
          <p class="cta-card__text">Switch your account to provider mode — one account can hire and list.</p>
          <form method="post" action="/account/role/provider">
            <button class="btn btn--yellow btn--lg" type="submit">Switch to provider mode</button>
          </form>
        </div>`;
    } else {
      action = `
        <div class="cta-card">
          <p class="cta-card__kicker">Free forever · No listing fees</p>
          <h2 class="cta-card__title">Register as a provider &amp; list your service</h2>
          <p class="cta-card__text">Join as a provider, tell us about your business and start receiving enquiries
            from your area the same day.</p>
          <div class="cta-card__actions">
            <a class="btn btn--yellow btn--lg" href="/register?role=provider">Create free provider account</a>
            <a class="btn btn--white-line btn--lg" href="/login?next=/account/provider">I already have an account</a>
          </div>
        </div>`;
      steps = `
        <ol class="steps">
          <li class="step tint-0">
            <span class="step__num" aria-hidden="true">1</span>
            <h3 class="step__title">Create your free account</h3>
            <p class="step__text">Register as a provider with your name, email and mobile number.</p>
          </li>
          <li class="step tint-1">
            <span class="step__num" aria-hidden="true">2</span>
            <h3 class="step__title">Add your business</h3>
            <p class="step__text">Tell us what you do, where you work (down to the locality) and what you charge.</p>
          </li>
          <li class="step tint-2">
            <span class="step__num" aria-hidden="true">3</span>
            <h3 class="step__title">Start receiving enquiries</h3>
            <p class="step__text">Customers in your area find you in search — enquiries land in your dashboard.</p>
          </li>
        </ol>`;
    }

    const why = `
      <ul class="feature-list">
        <li><span aria-hidden="true">🎯</span><div><strong>Reach your neighbourhood</strong><p>Customers search by city, locality and PIN — your listing shows for your exact area.</p></div></li>
        <li><span aria-hidden="true">📥</span><div><strong>Enquiries, not just calls</strong><p>People send you what they need plus their number; you decide when to follow up.</p></div></li>
        <li><span aria-hidden="true">🛡️</span><div><strong>Verified badge</strong><p>Providers are checked before earning the Verified badge customers trust.</p></div></li>
        <li><span aria-hidden="true">0️⃣</span><div><strong>Zero fees</strong><p>No listing charge, no commission on leads in this build. If that ever changes, we will say so first.</p></div></li>
      </ul>`;

    const body = `
    <section class="page-head page-head--gradient">
      <div class="container">
        <p class="hero__eyebrow">For providers</p>
        <h1 class="page-head__title">List your service on ${esc(config.site.name)}</h1>
        <p class="page-head__lede">${esc(config.site.tagline)} Join free and start getting enquiries from your own area.</p>
      </div>
    </section>
    <section class="section">
      <div class="container listing-grid">
        <div>
          ${banner}
          ${steps}
          ${why}
        </div>
        <aside class="listing-aside">${action}</aside>
      </div>
    </section>`;
    return { html: render(ctx, { title: 'List your service', body }) };
  });

  /* ---------------------------------------------- service detail ---- */

  function servicePageBody(ctx, service, provider, extra = {}) {
    const sent = Boolean(extra.sent);
    const values = extra.values || {};
    const errors = extra.errors || {};
    const places = (service.location_label || '').split(',').slice(0, 3).join(',');
    const similar = serviceModel.searchServices(db, {
      categoryIds: [service.category_id],
      limit: 4,
    }).items.filter((row) => row.id !== service.id).slice(0, 2);
    return `
    <section class="section section--top">
      <div class="container detail-grid">
        <div class="detail-main">
          <nav class="crumbs" aria-label="Breadcrumb">
            <a href="/">Home</a><span aria-hidden="true">/</span>
            <a href="/search">Services</a><span aria-hidden="true">/</span>
            <a href="/search?category=${esc(service.category_slug)}">${esc(service.category_name)}</a>
          </nav>

          <article class="panel detail-card">
            <div class="detail-card__top">
              <span class="detail-card__icon tint-${tintIndex(service.category_slug)}" aria-hidden="true">${esc(service.category_icon || '🧰')}</span>
              <div>
                <h1 class="detail-card__title">${esc(service.title)}</h1>
                <p class="detail-card__provider">
                  by <a href="/providers/${esc(service.provider_slug)}">${esc(service.business_name)}</a>
                  ${service.is_verified ? '<span class="badge badge--verified">✓ Verified provider</span>' : ''}
                </p>
              </div>
              ${ratingMarkup(service)}
            </div>
            <dl class="price-row">
              <div class="price-row__main">
                <dt>Price</dt>
                <dd class="price-row__value">${esc(priceLabel(service))}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>${esc(places || 'India')}${service.pin_code ? ` · PIN ${esc(service.pin_code)}` : ''}</dd>
              </div>
              <div>
                <dt>Provider experience</dt>
                <dd>${esc(provider.experience_years || 0)}+ years</dd>
              </div>
            </dl>
          </article>

          <article class="panel detail-card">
            <h2 class="panel__title">About this service</h2>
            <p class="prose">${esc(service.description || 'Contact the provider for full details, availability and a free estimate.')}</p>
          </article>

          <article class="panel detail-card">
            <h2 class="panel__title">About the provider</h2>
            <p class="prose">${esc(provider.about || `${provider.business_name} is a ${provider.category_name} provider serving ${places || 'your area'}.`)}</p>
            <ul class="tick-list">
              <li>📍 Based in ${esc(places || 'India')}${provider.pin_code ? ` (PIN ${esc(provider.pin_code)})` : ''}</li>
              <li>⏱️ ${esc(provider.experience_years || 0)} years of experience</li>
              ${service.is_verified
                ? '<li>🛡️ Verified provider</li>'
                : '<li>🕓 Verification in progress — contact before booking</li>'}
            </ul>
            <a class="btn btn--ghost" href="/providers/${esc(service.provider_slug)}">View full provider profile</a>
          </article>

          ${similar.length ? `
          <section class="related">
            <h2 class="section__title">More ${esc(service.category_name)} services</h2>
            <div class="service-grid">${similar.map((row) => serviceCardMarkup(row)).join('\n')}</div>
          </section>` : ''}
        </div>

        <aside class="detail-aside">
          <div class="panel contact-card">
            <a class="btn btn--primary btn--block btn--lg" href="tel:+91${esc(service.phone)}">📞 Call ${esc(service.phone)}</a>
            <p class="contact-card__or">or send an enquiry — we do the connecting</p>
            ${enquiryFormMarkup({
              providerId: service.provider_id,
              serviceId: service.id,
              back: `/services/${esc(service.slug)}`,
              sent,
              values,
              errors,
            })}
          </div>
        </aside>
      </div>
    </section>`;
  }

  router.get('/services/:slug', (ctx) => {
    const service = serviceModel.findBySlug(db, ctx.params.slug);
    if (!service || service.status !== 'active') {
      throw HttpError.notFound(`Service "${ctx.params.slug}" not found.`);
    }
    const provider = providerModel.findById(db, service.provider_id);
    if (!provider || provider.status !== 'active') {
      throw HttpError.notFound('Provider not found.');
    }
    const places = (service.location_label || '').split(',').slice(0, 3).join(', ');
    const body = servicePageBody(ctx, service, provider, { sent: ctx.query.get('sent') === '1' });
    return {
      html: render(ctx, {
        title: `${service.title} — ${service.business_name}`,
        description: `${service.title} in ${places} for ${priceLabel(service)}. Contact ${service.business_name} directly — free, no middleman.`,
        body,
        jsonLd: [
          serviceJsonLd(service, provider),
          breadcrumbJsonLd([
            { name: 'Home', url: canonicalUrl(config.site, '/') },
            { name: service.category_name, url: `${canonicalUrl(config.site, '/')}search?category=${service.category_slug}` },
            { name: service.title, url: canonicalUrl(config.site, `/services/${service.slug}`) },
          ]),
        ],
      }),
    };
  });

  /* ---------------------------------------------- provider detail ---- */

  router.get('/providers/:slug', (ctx) => {
    const provider = providerModel.findBySlug(db, ctx.params.slug);
    if (!provider || provider.status !== 'active') {
      throw HttpError.notFound(`Provider "${ctx.params.slug}" not found.`);
    }
    const services = serviceModel.byProvider(db, provider.id);
    const areas = providerModel.serviceAreas(db, provider.id);
    const places = (provider.location_label || '').split(',').slice(0, 3).join(', ');

    const body = `
    <section class="section section--top">
      <div class="container detail-grid">
        <div class="detail-main">
          <nav class="crumbs" aria-label="Breadcrumb">
            <a href="/">Home</a><span aria-hidden="true">/</span>
            <a href="/search?category=${esc(provider.category_slug)}">${esc(provider.category_name)}</a>
          </nav>

          <article class="panel profile-head">
            <span class="detail-card__icon tint-${tintIndex(provider.category_slug)}" aria-hidden="true">${esc(provider.category_icon || '🧰')}</span>
            <div class="profile-head__main">
              <h1 class="detail-card__title">${esc(provider.business_name)}</h1>
              <p class="detail-card__provider">${esc(provider.category_name)} ${verifiedMarkup(provider)}</p>
              <p class="result-card__meta">
                <span>📍 ${esc(places || 'India')}${provider.pin_code ? ` · PIN ${esc(provider.pin_code)}` : ''}</span>
                ${provider.experience_years ? `<span>⏱️ ${esc(provider.experience_years)} yrs experience</span>` : ''}
              </p>
            </div>
            ${ratingMarkup(provider)}
          </article>

          ${provider.photo_urls?.length ? `
          <section class="business-gallery" aria-labelledby="business-gallery-title">
            <div class="business-gallery__head">
              <h2 class="section__title" id="business-gallery-title">Business photos</h2>
              <p>Shop, team and recent work from ${esc(provider.business_name)}.</p>
            </div>
            <div class="business-photo-grid business-photo-grid--public">
              ${provider.photo_urls.map((url, index) => `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(provider.business_name)} photo ${index + 1}" loading="lazy"></a>`).join('')}
            </div>
          </section>` : ''}

          ${provider.about ? `
          <article class="panel detail-card">
            <h2 class="panel__title">About us</h2>
            <p class="prose">${esc(provider.about)}</p>
          </article>` : ''}

          ${areas.length ? `
          <article class="panel detail-card">
            <h2 class="panel__title">Areas we serve</h2>
            <ul class="pill-list">${areas.map((pin) => `<li><span class="pill pill--static">PIN ${esc(pin)}</span></li>`).join('')}</ul>
          </article>` : ''}

          <section class="related">
            <h2 class="section__title">${esc(provider.business_name)}'s services</h2>
            ${services.length
              ? `<div class="service-grid">${services.map((row) => serviceCardMarkup(row)).join('\n')}</div>`
              : '<p class="empty">No active services listed right now — call to ask what is available.</p>'}
          </section>
        </div>

        <aside class="detail-aside">
          <div class="panel contact-card">
            <a class="btn btn--primary btn--block btn--lg" href="tel:+91${esc(provider.phone)}">📞 Call ${esc(provider.phone)}</a>
            ${provider.alt_phone ? `<a class="btn btn--ghost btn--block" href="tel:+91${esc(provider.alt_phone)}">Alt: ${esc(provider.alt_phone)}</a>` : ''}
            <p class="contact-card__or">or send an enquiry</p>
            ${enquiryFormMarkup({
              providerId: provider.id,
              back: `/providers/${esc(provider.slug)}`,
              sent: ctx.query.get('sent') === '1',
            })}
          </div>

          <div class="panel">
            ${shareMarkup({
              url: canonicalUrl(config.site, `/providers/${provider.slug}`),
              heading: 'Recommend this business',
              note: 'Neighbours and family find good workers by word of mouth — send this page to your WhatsApp group.',
              text: `${provider.business_name} — ${provider.category_name} in ${places || 'India'}. Seva Market India par directly contact karein, koi commission nahi:`,
            })}
          </div>
        </aside>
      </div>
    </section>`;
    return {
      html: render(ctx, {
        title: `${provider.business_name} — ${provider.category_name}`,
        description: `${provider.business_name}: ${provider.category_name} in ${places}${areas.length ? `, serving PINs ${areas.slice(0, 3).join(', ')}` : ''}. Contact directly — free, no commission.`,
        body,
        jsonLd: [
          localBusinessJsonLd(provider, areas),
          breadcrumbJsonLd([
            { name: 'Home', url: canonicalUrl(config.site, '/') },
            { name: provider.category_name, url: `${canonicalUrl(config.site, '/')}search?category=${provider.category_slug}` },
            { name: provider.business_name, url: canonicalUrl(config.site, `/providers/${provider.slug}`) },
          ]),
        ],
      }),
    };
  });

  /* ------------------------------------------------- POST /contact --- */

  router.post('/contact', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    const { readBody, validators, validate } = require('../http/request');
    const body = await readBody(ctx.req, config.http.maxBodyBytes);

    const { value, errors, valid } = validate({
      name: () => validators.text(body.name, { field: 'name', max: 120 }),
      phone: () => validators.phone(body.phone, { field: 'phone' }),
      email: () => validators.email(body.email, { field: 'email' }),
      message: () => validators.text(body.message, { field: 'message', required: false, max: 1000 }),
      // Keys match the form's own input names so a field error lands next to
      // the field it belongs to (see validate() in http/request.js).
      provider_id: () => validators.int(body.provider_id ?? body.providerId, { field: 'provider id', required: true, min: 1 }),
      service_id: () => validators.int(body.service_id ?? body.serviceId, { field: 'service id', min: 1 }),
    });
    const back = safeBackPath(body.back);

    if (!valid) {
      return { html: renderEnquiryError(ctx, back, errors, body) };
    }

    const tooMany = await store.leads.recentCountFromIp(ctx.ip, { minutes: 60 });
    if (tooMany >= 5) {
      const errors2 = { form: 'Too many enquiries from your connection right now. Please try again in an hour.' };
      return { html: renderEnquiryError(ctx, back, errors2, body) };
    }

    try {
      await store.leads.create({
        providerId: value.provider_id,
        serviceId: value.service_id,
        name: value.name,
        phone: value.phone,
        email: value.email,
        pinCode: null,
        message: value.message,
        ip: ctx.ip,
      });
      return { redirect: `${back}?sent=1#enquiry` };
    } catch (err) {
      const errors2 = { form: String(err && err.message ? err.message : 'Could not send the enquiry. Please try again.') };
      return { html: renderEnquiryError(ctx, back, errors2, body) };
    }
  });

  /** Re-render the listing page the failed enquiry came from. */
  function renderEnquiryError(ctx, back, errors, values) {
    const trimmed = String(back).split('?')[0].replace(/\/+$/, '');
    const serviceMatch = /^\/services\/([a-z0-9-]+)$/i.exec(trimmed);
    const providerMatch = /^\/providers\/([a-z0-9-]+)$/i.exec(trimmed);
    const stub = { ...ctx, pathname: trimmed, query: new URLSearchParams() };
    if (serviceMatch) {
      const service = serviceModel.findBySlug(db, serviceMatch[1]);
      const provider = service && providerModel.findById(db, service.provider_id);
      if (service && provider) {
        return render(stub, {
          title: `${service.title} — ${service.business_name}`,
          body: servicePageBody(stub, service, provider, { values, errors }),
        });
      }
    }
    if (providerMatch) {
      // provider re-render keeps GET route code; just redirect with message.
      return render(stub, {
        title: 'Enquiry',
        body: `<section class="section"><div class="container container--narrow">
          ${alertMarkup(errors.form || 'Could not send the enquiry.', { tone: 'err' })}
          <p class="prose">Go back and try again, or call the provider directly.</p></div></section>`,
      });
    }
    return render(stub, {
      title: 'Enquiry',
      body: `<section class="section"><div class="container container--narrow">
        ${alertMarkup(errors.form || 'Could not send the enquiry.', { tone: 'err' })}
        <p class="prose"><a href="/search">Browse services</a> instead.</p></div></section>`,
    });
  }
}

/** Keep /contact redirects and hidden "back" fields on this site only. */
function safeBackPath(raw) {
  const candidate = String(raw || '').split('?')[0].split('#')[0];
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  const match = /^\/(services|providers)\/[a-z0-9-]+$/i.exec(candidate);
  return match ? match[0] : '/';
}

module.exports = { register, safeBackPath };
