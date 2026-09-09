'use strict';
/**
 * SEVA MARKET INDIA — shared UI fragments.
 *
 * Small, dependency-free markup builders used across server-rendered pages
 * (price labels, ratings, badges, form fields, option lists). Everything a
 * template needs twice lives here once.
 */

const { esc } = require('./escape');

/** ₹ labels: "₹299–₹699/visit", "Price on request". */
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

/** A rating chip: "4.4 ★ (33)" — green when rated, grey "New" otherwise. */
function ratingMarkup(serviceOrProvider) {
  const avg = Number(serviceOrProvider.rating_avg) || 0;
  const count = Number(serviceOrProvider.rating_count) || 0;
  if (avg <= 0 || count <= 0) {
    return '<span class="rating rating--new">New</span>';
  }
  const digits = String(avg).length > 3 ? avg.toFixed(1) : avg;
  return `<span class="rating" title="${esc(count)} customer rating${count === 1 ? '' : 's'}">${esc(digits)} ★ (${esc(count)})</span>`;
}

/** Verified / not-yet-verified pill. */
function verifiedMarkup(provider) {
  if (provider.is_verified) return '<span class="badge badge--verified">✓ Verified</span>';
  return '<span class="badge badge--pending">Verification pending</span>';
}

/** Service status pill used in the provider dashboard. */
function serviceStatusMarkup(status) {
  const labels = {
    active: 'Live', paused: 'Paused', draft: 'Draft', archived: 'Archived',
  };
  return `<span class="badge badge--${esc(status)}">${esc(labels[status] || status)}</span>`;
}

/** Lead status pill used in the enquiries dashboard. */
function leadStatusMarkup(status) {
  const labels = { new: 'New', contacted: 'Contacted', closed: 'Closed', spam: 'Spam' };
  return `<span class="badge badge--${esc(status)}">${esc(labels[status] || status)}</span>`;
}

/** Deterministic pastel tint for a category slug: tint-0 … tint-7. */
function tintIndex(slug) {
  let hash = 0;
  for (const char of String(slug || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 8;
}

/** Round avatar with initials for an account chip. */
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

/* ------------------------------------------------------------ forms --- */

/**
 * A labelled <input> with optional error + hint. Errors are linked via
 * aria-describedby and rendered next to the field, server-side, so the
 * form works without JavaScript.
 */
function field({
  type = 'text', id, name = id, label, value = '', error = null, required = false,
  placeholder = '', autocomplete = null, inputmode = null, pattern = null,
  maxlength = null, min = null, step = null, hint = null, suffix = null,
}) {
  const attrs = [
    `type="${type}"`,
    `id="${id}"`,
    `name="${name}"`,
    required ? 'required' : '',
    placeholder ? `placeholder="${esc(placeholder)}"` : '',
    autocomplete ? `autocomplete="${esc(autocomplete)}"` : '',
    inputmode ? `inputmode="${esc(inputmode)}"` : '',
    pattern ? `pattern="${esc(pattern)}"` : '',
    maxlength ? `maxlength="${maxlength}"` : '',
    min !== null && min !== undefined ? `min="${min}"` : '',
    step ? `step="${step}"` : '',
    error ? 'aria-invalid="true"' : '',
  ].filter(Boolean).join(' ');
  const described = error ? ` aria-describedby="${id}-err"` : '';
  return `
    <div class="field${error ? ' field--invalid' : ''}">
      <label for="${id}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
      <div class="field__control">
        <input ${attrs}${described} value="${esc(value === null || value === undefined ? '' : value)}">
        ${suffix ? `<span class="field__suffix">${esc(suffix)}</span>` : ''}
      </div>
      ${error ? `<p class="field__error" id="${id}-err" role="alert">${esc(error)}</p>` : ''}
      ${hint && !error ? `<p class="field__hint">${esc(hint)}</p>` : ''}
    </div>`;
}

function textareaField({
  id, name = id, label, value = '', error = null, required = false,
  placeholder = '', rows = 4, maxlength = null, hint = null,
}) {
  const described = error ? ` aria-describedby="${id}-err"` : '';
  return `
    <div class="field${error ? ' field--invalid' : ''}">
      <label for="${id}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
      <textarea id="${id}" name="${name}" rows="${rows}" placeholder="${esc(placeholder)}"
        ${maxlength ? `maxlength="${maxlength}"` : ''}${described}${required ? ' required' : ''}>${esc(value || '')}</textarea>
      ${error ? `<p class="field__error" id="${id}-err" role="alert">${esc(error)}</p>` : ''}
      ${hint && !error ? `<p class="field__hint">${esc(hint)}</p>` : ''}
    </div>`;
}

/**
 * A labelled <select>. `groups` may be null (flat options) or a list of
 * `{ label, options: [{value, label, data}] }` optgroups; `data` becomes
 * data-* attributes for client-side chained filtering (city → locality).
 */
function selectField({
  id, name = id, label, value = '', error = null, required = true,
  options = [], groups = null, hint = null, emptyLabel = 'Select…', dataPrefix = '',
}) {
  const chosen = String(value === null || value === undefined ? '' : value);
  const optionMarkup = (option) => {
    const data = (option.data || {});
    const dataAttrs = Object.entries(data)
      .map(([key, val]) => ` data-${dataPrefix}${esc(key)}="${esc(val)}"`)
      .join('');
    const selected = String(option.value) === chosen ? ' selected' : '';
    return `<option value="${esc(option.value)}"${selected}${dataAttrs}>${esc(option.label)}</option>`;
  };
  const body = groups
    ? groups.map((group) => `
      <optgroup label="${esc(group.label)}">${group.options.map(optionMarkup).join('')}</optgroup>`).join('')
    : options.map(optionMarkup).join('');
  const described = error ? ` aria-describedby="${id}-err"` : '';
  return `
    <div class="field${error ? ' field--invalid' : ''}">
      <label for="${id}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
      <select id="${id}" name="${name}"${required ? ' required' : ''}${described}>
        <option value="" disabled${chosen === '' ? ' selected' : ''}>${esc(emptyLabel)}</option>
        ${body}
      </select>
      ${error ? `<p class="field__error" id="${id}-err" role="alert">${esc(error)}</p>` : ''}
      ${hint && !error ? `<p class="field__hint">${esc(hint)}</p>` : ''}
    </div>`;
}

/** Dismissible status banner (success after a redirect, errors, info). */
/**
 * The split-panel wrapper every account page wears: a brand panel on the
 * left (hidden on phones) and the form card on the right.
 *
 * `lines` are literal marketing copy owned by the caller, not user data, so
 * they are inserted as markup; every dynamic value still goes through esc().
 */
function authShellMarkup(card, { title = 'One account for the whole neighbourhood.', lines = [] } = {}) {
  return `
    <section class="auth">
      <div class="auth__panel" aria-hidden="true">
        <p class="auth__panel-brand">से Seva Market <em>India</em></p>
        <p class="auth__panel-title">${esc(title)}</p>
        <ul>
          ${lines.map((line) => `<li>${line}</li>`).join('\n          ')}
        </ul>
      </div>
      ${card}
    </section>`;
}

function alertMarkup(message, { tone = 'ok' } = {}) {
  if (!message) return '';
  return `<p class="alert alert--${esc(tone)}" role="${tone === 'ok' ? 'status' : 'alert'}">${esc(message)}</p>`;
}

/* -------------------------------------------------------- service card */

/**
 * One marketplace listing card — used on the homepage ("popular services"),
 * on /search results and on provider pages. Always links through to the
 * public /services/:slug detail page and offers a direct tel: call.
 */
function serviceCardMarkup(service) {
  const icon = service.category_icon || '🧰';
  const verified = service.is_verified
    ? '<span class="badge badge--verified">✓ Verified</span>'
    : '';
  const where = [service.location_label ? esc(service.location_label.split(',').slice(0, 3).join(',')) : 'India'];
  if (service.pin_code) where.push(`PIN ${esc(service.pin_code)}`);
  const description = service.description ? `<p class="result-card__text">${esc(service.description)}</p>` : '';
  return `
      <article class="result-card">
        <a class="result-card__thumb" href="/providers/${esc(service.provider_slug)}" tabindex="-1" aria-hidden="true">
          <span class="result-card__emoji">${esc(icon)}</span>
        </a>
        <div class="result-card__main">
          <h3 class="result-card__title">
            <a href="/services/${esc(service.slug)}">${esc(service.title)}</a>
          </h3>
          <p class="result-card__provider">
            <a href="/providers/${esc(service.provider_slug)}">${esc(service.business_name)}</a>
            ${verified}
            ${ratingMarkup(service)}
          </p>
          <p class="result-card__meta"><span>${esc(service.category_name)}</span><span>${where.join(' • ')}</span></p>
          ${description}
        </div>
        <div class="result-card__aside">
          <p class="result-card__price">${esc(priceLabel(service))}</p>
          <div class="result-card__actions">
            <a class="btn btn--orange btn--sm" href="/services/${esc(service.slug)}">View details</a>
            <a class="btn btn--outline btn--sm" href="tel:+91${esc(service.phone)}">Call ${esc(service.phone)}</a>
          </div>
        </div>
      </article>`;
}

/** Compact provider row used on provider-search results and dashboards. */
function providerCardMarkup(provider) {
  const icon = provider.category_icon || '🧰';
  return `
    <article class="result-card result-card--provider">
      <a class="result-card__thumb" href="/providers/${esc(provider.slug)}" tabindex="-1" aria-hidden="true">
        <span class="result-card__emoji">${esc(icon)}</span>
      </a>
      <div class="result-card__main">
        <h3 class="result-card__title"><a href="/providers/${esc(provider.slug)}">${esc(provider.business_name)}</a></h3>
        <p class="result-card__provider">${verifiedMarkup(provider)} ${ratingMarkup(provider)}
          ${provider.experience_years ? `<span class="exp">${esc(provider.experience_years)} yrs experience</span>` : ''}
        </p>
        <p class="result-card__meta"><span>${esc(provider.category_name)}</span><span>${esc(provider.location_label || 'India')}${provider.pin_code ? ` • PIN ${esc(provider.pin_code)}` : ''}</span></p>
        ${provider.about ? `<p class="result-card__text">${esc(provider.about)}</p>` : ''}
      </div>
      <div class="result-card__aside">
        <a class="btn btn--primary btn--sm" href="/providers/${esc(provider.slug)}">View profile</a>
        <a class="btn btn--outline btn--sm" href="tel:+91${esc(provider.phone)}">Call ${esc(provider.phone)}</a>
      </div>
    </article>`;
}

/** Avatar circle from a name. */
function avatarMarkup(name, extraClass = '') {
  return `<span class="avatar${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true">${esc(initials(name))}</span>`;
}

/**
 * Share row — how this marketplace actually grows.
 *
 * Local services get recommended in family and neighbourhood WhatsApp groups,
 * so WhatsApp comes first, then Facebook, then a plain copy-link for anybody
 * who wants to paste it somewhere else. Server-rendered: the WhatsApp and
 * Facebook links work with JavaScript disabled; only the copy button needs
 * /assets/js/main.js, and it degrades to a selectable link when JS is off.
 */
function shareMarkup(options) {
  const opts = options || {};
  const url = String(opts.url || '/');
  const text = String(opts.text || '');
  const message = text ? `${text}\n${url}` : url;
  return `
    <div class="share">
      <p class="share__heading">${esc(opts.heading || 'Share this')}</p>
      ${opts.note ? `<p class="share__note">${esc(opts.note)}</p>` : ''}
      <div class="share__row">
        <a class="btn btn--ghost btn--sm" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener noreferrer">📱 WhatsApp</a>
        <a class="btn btn--ghost btn--sm" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">Facebook</a>
        <button type="button" class="btn btn--ghost btn--sm" data-share-copy="${esc(message)}">Copy link</button>
      </div>
      <noscript><p class="share__note">Direct link: <a href="${esc(url)}">${esc(url)}</a></p></noscript>
    </div>`;
}

module.exports = {
  esc,
  priceLabel,
  shareMarkup,
  ratingMarkup,
  verifiedMarkup,
  serviceStatusMarkup,
  leadStatusMarkup,
  tintIndex,
  initials,
  field,
  textareaField,
  selectField,
  alertMarkup,
  authShellMarkup,
  avatarMarkup,
  serviceCardMarkup,
  providerCardMarkup,
};
