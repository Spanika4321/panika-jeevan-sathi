/**
 * Provider detail page — /provider.html?p=<slug>
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    const host = document.getElementById('provider');
    if (!host) return;
    const slug = new URLSearchParams(window.location.search).get('p');
    if (!slug) {
      host.innerHTML = '<p class="empty">No provider was requested. <a href="/search.html">Browse providers</a>.</p>';
      return;
    }

    try {
      const payload = await window.SEVA.api.provider(slug);
      const item = payload.item;
      const place = item.location || {};
      const where = [place.locality && place.locality.name, place.city && place.city.name, place.state && place.state.name]
        .filter(Boolean)
        .join(', ');

      document.title = item.business_name + ' — SEVA MARKET INDIA';

      const priceLine = item.services && item.services.length ? window.SEVA.format.priceRange(item.services[0].price_from, item.services[0].price_to, item.services[0].price_unit) : null;

      host.innerHTML =
        '<article class="provider-card">' +
        '<div class="provider-card__head">' +
        '<div class="provider-card__avatar" aria-hidden="true">' + window.SEVA.escapeHtml(window.SEVA.format.initials(item.business_name)) + '</div>' +
        '<div><h1 class="page-title mb-0">' + window.SEVA.escapeHtml(item.business_name) + '</h1>' +
        '<p class="provider-card__sub mb-0">' + window.SEVA.escapeHtml(where || 'India') + (item.pincode ? ' · ' + window.SEVA.escapeHtml(item.pincode) : '') + '</p></div>' +
        '</div>' +
        '<div class="row row-wrap small">' +
        '<span class="rating' + (item.rating ? '' : ' rating--empty') + '">' + window.SEVA.icon('star', { size: 14 }) + ' ' +
        window.SEVA.escapeHtml(window.SEVA.format.rating(item.rating, item.rating_count)) + '</span>' +
        '<span class="chip chip--ok">' + window.SEVA.icon('verified', { size: 13 }) + ' ' + window.SEVA.escapeHtml(window.SEVA.format.verification(item.verification_level)) + '</span>' +
        (item.experience_years ? '<span class="chip">' + item.experience_years + ' years experience</span>' : '') +
        '<span class="chip">' + item.service_radius_km + ' km service radius</span>' +
        (priceLine ? '<span class="chip">From ' + window.SEVA.escapeHtml(priceLine) + '</span>' : '') +
        '</div>' +
        (item.tagline ? '<p class="strong mb-0">' + window.SEVA.escapeHtml(item.tagline) + '</p>' : '') +
        (item.description ? '<p class="muted mb-0">' + window.SEVA.escapeHtml(item.description) + '</p>' : '') +
        '<div><h3 class="small">Services</h3><div class="row row-wrap">' +
        (item.services || []).map((service) => '<span class="chip">' + window.SEVA.escapeHtml(service.name) + '</span>').join('') +
        '</div></div>' +
        (item.areas && item.areas.length ? '<p class="tiny muted mb-0">Serves PIN codes: ' + item.areas.map((code) => window.SEVA.escapeHtml(code)).join(', ') + '</p>' : '') +
        '<div class="provider-card__foot">' +
        (item.phone ? '<a class="btn" href="tel:+91' + window.SEVA.escapeHtml(String(item.phone).replace(/\D/g, '').slice(-10)) + '">' + window.SEVA.icon('phone', { size: 15 }) + ' Call now</a>' : '') +
        (item.phone ? '<a class="btn btn--ghost" target="_blank" rel="noopener noreferrer" href="https://wa.me/91' + window.SEVA.escapeHtml(String(item.phone).replace(/\D/g, '').slice(-10)) + '">' + window.SEVA.icon('whatsapp', { size: 15 }) + ' WhatsApp</a>' : '') +
        '</div></article>';
    } catch (error) {
      host.innerHTML = '<p class="empty">' + window.SEVA.escapeHtml(window.SEVA.errorMessage(error, 'Provider not found.')) + '</p>';
    } finally {
      host.setAttribute('aria-busy', 'false');
    }
  });
})();
