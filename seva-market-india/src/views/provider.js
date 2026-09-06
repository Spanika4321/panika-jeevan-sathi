'use strict';
/**
 * SEVA MARKET INDIA — public provider and service pages.
 *
 * These are the pages a customer lands on from search, and the only place an
 * enquiry is captured. Contact details are shown without a login: gating a
 * phone number behind a signup is how marketplaces die in India.
 */

const { esc } = require('./escape');
const form = require('./form');
const { priceLabel } = require('./pricing');

function rating(provider) {
  if (!Number(provider.rating_count)) {
    return '<span class="rating rating--empty">No reviews yet</span>';
  }
  const value = Number(provider.rating_avg || 0).toFixed(1);
  return `<span class="rating" aria-label="Rated ${esc(value)} out of 5 from ${esc(provider.rating_count)} reviews">★ ${esc(value)} <span class="rating__count">(${esc(provider.rating_count)})</span></span>`;
}

function enquiryForm({ providerId, serviceId = null, csrf = '', errors = {}, values = {}, action }) {
  return form.openForm({ action, method: 'post', csrf }) + `
          <input type="hidden" name="provider_id" value="${esc(providerId)}">
          ${serviceId ? `<input type="hidden" name="service_id" value="${esc(serviceId)}">` : ''}
          ${Object.keys(errors).length ? form.errorSummary(errors) : ''}
          ${form.fieldRow([
            form.input({ name: 'name', label: 'Your name', value: values.name || '', error: errors.name, required: true, attrs: { maxlength: 120, autocomplete: 'name' } }),
            form.input({ name: 'phone', label: 'Mobile number', type: 'tel', value: values.phone || '', error: errors.phone, required: true, attrs: { inputmode: 'numeric', pattern: '[6-9][0-9]{9}', maxlength: 10, autocomplete: 'tel' } }),
          ])}
          ${form.fieldRow([
            form.input({ name: 'pin_code', label: 'Your PIN code', value: values.pin_code || '', error: errors.pin_code, attrs: { inputmode: 'numeric', pattern: '[1-9][0-9]{5}', maxlength: 6, autocomplete: 'postal-code' } }),
            form.input({ name: 'email', label: 'Email (optional)', type: 'email', value: values.email || '', attrs: { maxlength: 254, autocomplete: 'email' } }),
          ])}
          ${form.textarea({ name: 'message', label: 'What do you need?', value: values.message || '', rows: 3, maxlength: 1000, hint: 'Tell them the room, the model, the date — a specific message gets a faster answer.' })}
          ${form.actions({ label: 'Send enquiry' })}
          <p class="form__footnote">Five enquiries an hour per connection, then a short pause. Your number is shared only with this provider.</p>
        ${form.closeForm}`;
}

/**
 * @param {object} data
 * @param {object} data.provider   provider row (public columns only)
 * @param {Array}  data.services   active services
 * @param {string[]} data.areas    coverage PIN codes
 * @param {object} [data.flash]
 */
function providerProfileBody({ provider, services, areas = [], flash = null, errors = {}, values = {}, csrf = '', query = '' }) {
  const verified = provider.is_verified ? '<span class="badge badge--verified">Verified</span>' : '';
  return `
    <section class="profile-head">
      <div class="container">
        <p class="profile-head__crumb"><a href="/search">Browse</a> · <a href="/search?category=${esc(provider.category_slug || '')}">${esc(provider.category_name || 'Services')}</a></p>
        <h1 class="profile-head__title">${esc(provider.business_name)} ${verified}</h1>
        <p class="profile-head__meta">
          <span>${esc(provider.location_label || 'India')}</span>
          ${provider.pin_code ? `<span class="dot" aria-hidden="true">•</span><span>PIN ${esc(provider.pin_code)}</span>` : ''}
          <span class="dot" aria-hidden="true">•</span>
          ${rating(provider)}
          ${Number(provider.experience_years) > 0 ? `<span class="dot" aria-hidden="true">•</span><span>${esc(provider.experience_years)} yrs experience</span>` : ''}
        </p>
        <div class="profile-head__contact">
          <a class="btn btn--primary" href="tel:+91${esc(provider.phone)}">Call ${esc(provider.phone)}</a>
          ${provider.alt_phone ? `<a class="btn btn--ghost" href="tel:+91${esc(provider.alt_phone)}">Alt ${esc(provider.alt_phone)}</a>` : ''}
          ${provider.email ? `<a class="btn btn--ghost" href="mailto:${esc(provider.email)}">Email</a>` : ''}
          ${provider.website ? `<a class="btn btn--ghost" href="${esc(provider.website)}" rel="nofollow noopener" target="_blank">Website</a>` : ''}
        </div>
      </div>
    </section>

    <section class="section"><div class="container">
      ${flash && flash.message ? `<div class="alert alert--${flash.kind === 'error' ? 'error' : 'ok'}"><p class="alert__title">${esc(flash.message)}</p>${flash.detail ? `<p class="alert__text">${esc(flash.detail)}</p>` : ''}</div>` : ''}
      <div class="grid-2">
        <div>
          <div class="panel">
            <h2 class="panel__title">About</h2>
            <p class="prose">${provider.about ? esc(provider.about) : 'This provider has not written about their work yet — call them for details.'}</p>
            ${provider.address_line ? `<p class="prose"><strong>Where:</strong> ${esc(provider.address_line)}</p>` : ''}
            ${areas.length ? `<p class="prose"><strong>Also serves:</strong></p><ul class="pill-list">${areas.map((pin) => `<li class="pill">${esc(pin)}</li>`).join('')}</ul>` : ''}
          </div>

          <div class="panel">
            <h2 class="panel__title">Services (${services.length})</h2>
            ${services.length ? `<ul class="service-list service-list--public">${services.map((row) => `
              <li class="service-row service-row--public">
                <div class="service-row__main">
                  <p class="service-row__title"><a href="/services/${esc(row.slug)}">${esc(row.title)}</a></p>
                  <p class="service-row__meta">${esc(priceLabel(row))}${row.description ? ` · ${esc(row.description.slice(0, 120))}` : ''}</p>
                </div>
                <p class="service-row__aside"><a class="btn btn--ghost btn--sm" href="/search?pin=${esc(row.pin_code || provider.pin_code || '')}&category=${esc(row.category_slug || '')}">More nearby</a></p>
              </li>`).join('')}</ul>` : '<p class="empty">No services listed with prices yet. Call for a quote.</p>'}
          </div>
        </div>

        <div class="panel panel--sticky">
          <h2 class="panel__title">Ask for a quote</h2>
          <p class="prose">Send your requirement and ${esc(provider.contact_name || provider.business_name)} will call you back.</p>
          ${enquiryForm({
    providerId: provider.id,
    csrf,
    errors,
    values,
    action: `/providers/${esc(provider.slug)}/enquiry${query ? `?${esc(query)}` : ''}`,
  })}
        </div>
      </div>
    </div></section>`;
}

/** `/services/:slug` — the page every search result card links to. */
function serviceBody({ service, provider, errors = {}, values = {}, flash = null, csrf = '' }) {
  return `
    <section class="profile-head">
      <div class="container container--narrow">
        <p class="profile-head__crumb"><a href="/search">Browse</a> · <a href="/search?category=${esc(service.category_slug)}">${esc(service.category_name)}</a> · <a href="/providers/${esc(provider.slug)}">${esc(provider.business_name)}</a></p>
        <h1 class="profile-head__title">${esc(service.title)}</h1>
        <p class="profile-head__meta">
          <span class="profile-head__price">${esc(priceLabel(service))}</span>
          <span class="dot" aria-hidden="true">•</span>
          <span>${esc(service.location_label || 'India')}</span>
          ${service.pin_code ? `<span class="dot" aria-hidden="true">•</span><span>PIN ${esc(service.pin_code)}</span>` : ''}
          ${provider.is_verified ? '<span class="dot" aria-hidden="true">•</span><span class="badge badge--verified">Verified provider</span>' : ''}
        </p>
        <div class="profile-head__contact">
          <a class="btn btn--primary" href="tel:+91${esc(provider.phone)}">Call ${esc(provider.phone)}</a>
        </div>
      </div>
    </section>
    <section class="section"><div class="container container--narrow">
      ${flash && flash.message ? `<div class="alert alert--${flash.kind === 'error' ? 'error' : 'ok'}"><p class="alert__title">${esc(flash.message)}</p></div>` : ''}
      <div class="panel">
        <h2 class="panel__title">What you get</h2>
        <p class="prose">${service.description ? esc(service.description) : 'Details are agreed on the call — say what needs doing and ask for a firm price.'}</p>
        <dl class="definition">
          <div><dt>Price</dt><dd>${esc(priceLabel(service))}</dd></div>
          <div><dt>Provider</dt><dd><a href="/providers/${esc(provider.slug)}">${esc(provider.business_name)}</a> · ${rating(provider)}</dd></div>
          <div><dt>Area</dt><dd>${esc(service.location_label || 'India')}</dd></div>
        </dl>
      </div>
      <div class="panel">
        <h2 class="panel__title">Ask ${esc(provider.contact_name || provider.business_name)} for a quote</h2>
        ${enquiryForm({ providerId: provider.id, serviceId: service.id, csrf, errors, values, action: `/services/${esc(service.slug)}/enquiry` })}
      </div>
    </div></section>`;
}

module.exports = { providerProfileBody, serviceBody, enquiryForm, rating };
