'use strict';
/**
 * SEVA MARKET INDIA — administrator review queue.
 *
 * Deliberately boring: one page, every pending listing, two buttons each.
 * The point of a moderation screen is that a decision takes ten seconds.
 */

const { esc } = require('./escape');
const form = require('./form');
const { head } = require('./auth');
const { priceLabel } = require('../views/pricing');

function reviewForm({ provider, csrf, documents = [] }) {
  return `
      <form class="form form--review" action="/admin/providers/${esc(provider.id)}/review" method="post">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        ${provider.review_note ? `<p class="prose">Last note: ${esc(provider.review_note)}</p>` : ''}
        ${documents.length ? `<ul class="mini-list">${documents.map((doc) => `<li class="mini-list__row"><span>${esc(doc.kind)} · ${esc(doc.reference)}</span><span class="mini-list__meta">${esc(doc.status)}</span></li>`).join('')}</ul>` : '<p class="prose">No documents submitted.</p>'}
        ${form.textarea({ name: 'note', label: 'Note to the provider (shown if rejected)', rows: 2, maxlength: 500 })}
        <label class="field field--check"><input type="checkbox" name="verified" value="1"><span>Grant the verified badge</span></label>
        <div class="form__actions">
          <button class="btn btn--primary btn--sm" type="submit" name="decision" value="approve">Approve &amp; publish</button>
          <button class="btn btn--danger btn--sm" type="submit" name="decision" value="reject">Reject</button>
        </div>
      </form>`;
}

function queueBody({ items, total, csrf, summary, documentsFor, flash }) {
  return `
    ${head('Review queue', `${total} ${total === 1 ? 'listing is' : 'listings are'} waiting. Approving publishes the business and its draft services.`)}
    <section class="section"><div class="container">
      ${flash && flash.message ? `<div class="alert alert--${flash.kind === 'error' ? 'error' : 'ok'}"><p class="alert__title">${esc(flash.message)}</p></div>` : ''}
      <ul class="stats stats--dash">
        <li class="stat stat--sm"><span class="stat__value">${esc(summary.providers.active)}</span><span class="stat__label">Live providers</span></li>
        <li class="stat stat--sm"><span class="stat__value">${esc(summary.providers.verified)}</span><span class="stat__label">Verified</span></li>
        <li class="stat stat--sm"><span class="stat__value">${esc(summary.services.active)}</span><span class="stat__label">Live services</span></li>
        <li class="stat stat--sm"><span class="stat__value">${esc(summary.leads.total)}</span><span class="stat__label">Enquiries</span></li>
        <li class="stat stat--sm"><span class="stat__value">${esc(summary.users.total)}</span><span class="stat__label">Accounts</span></li>
      </ul>

      ${items.length ? items.map((provider) => `
        <article class="panel panel--review">
          <div class="panel__head">
            <h2 class="panel__title">${esc(provider.business_name)}</h2>
            <span class="panel__metric">${esc(provider.status)}</span>
          </div>
          <dl class="definition definition--tight">
            <div><dt>Category</dt><dd>${esc(provider.category_name || '—')}</dd></div>
            <div><dt>Area</dt><dd>${esc(provider.location_label || '—')}${provider.pin_code ? ` · PIN ${esc(provider.pin_code)}` : ''}</dd></div>
            <div><dt>Contact</dt><dd><a href="tel:+91${esc(provider.phone)}">${esc(provider.phone)}</a>${provider.email ? ` · ${esc(provider.email)}` : ''}</dd></div>
            <div><dt>Owner</dt><dd>${esc(provider.owner_email || 'unclaimed account')}</dd></div>
            <div><dt>Services</dt><dd>${esc(provider.service_count)} listed</dd></div>
            <div><dt>Documents</dt><dd>${esc(provider.doc_count)} pending</dd></div>
          </dl>
          ${reviewForm({ provider, csrf, documents: documentsFor[provider.id] || [] })}
          <p class="form__footnote"><a href="/providers/${esc(provider.slug)}">Preview the public profile</a> · <a href="/api/v1/admin/providers/${esc(provider.id)}">raw JSON</a></p>
        </article>`).join('')
        : `<div class="empty"><h2>Nothing waiting</h2><p>New listings appear here the moment a provider submits one.</p></div>`}
    </div></section>`;
}

function adminHomeBody({ summary, queue, recent, csrf }) {
  return `
    ${head('Administration', 'Marketplace health at a glance, with the pending queue a scroll away.')}
    <section class="section"><div class="container">
      <div class="grid-2">
        <div class="panel">
          <h2 class="panel__title">Coverage</h2>
          <dl class="definition">
            <div><dt>States</dt><dd>${esc(summary.locations.state)}</dd></div>
            <div><dt>Districts</dt><dd>${esc(summary.locations.district)}</dd></div>
            <div><dt>Cities</dt><dd>${esc(summary.locations.city)}</dd></div>
            <div><dt>Localities</dt><dd>${esc(summary.locations.locality)}</dd></div>
            <div><dt>PIN codes</dt><dd>${esc(summary.locations.pincode)}</dd></div>
            <div><dt>Categories</dt><dd>${esc(summary.categories)}</dd></div>
          </dl>
        </div>
        <div class="panel">
          <h2 class="panel__title">Marketplace</h2>
          <dl class="definition">
            <div><dt>Providers</dt><dd>${esc(summary.providers.active)} live · ${esc(summary.providers.pending)} pending · ${esc(summary.providers.suspended)} suspended</dd></div>
            <div><dt>Services</dt><dd>${esc(summary.services.active)} live · ${esc(summary.services.draft)} draft · ${esc(summary.services.paused)} paused</dd></div>
            <div><dt>Enquiries</dt><dd>${esc(summary.leads.total)}</dd></div>
            <div><dt>Sessions</dt><dd>${esc(summary.sessions)} active</dd></div>
          </dl>
          <p><a class="btn btn--primary btn--sm" href="/admin">Review queue (${esc(summary.providers.pending)})</a>
             <form class="inline-form" action="/admin/housekeeping" method="post">
               <input type="hidden" name="_csrf" value="${esc(csrf)}">
               <button class="btn btn--ghost btn--sm" type="submit">Purge expired sessions</button>
             </form></p>
        </div>
      </div>
      ${queue.length ? `<p class="prose">${queue.length} listing${queue.length === 1 ? '' : 's'} in the queue — <a href="/admin">open the queue</a>.</p>` : ''}
      <div class="panel">
        <h2 class="panel__title">Recent audit log</h2>
        ${recent.length ? `<ul class="mini-list">${recent.map((row) => `<li class="mini-list__row"><span>${esc(row.action)}${row.entity ? ` · ${esc(row.entity)}#${esc(row.entity_id)}` : ''}</span><span class="mini-list__meta">${esc(row.actor)} · ${esc(String(row.created_at).slice(0, 16))}</span></li>`).join('')}</ul>` : '<p class="empty">No events yet.</p>'}
      </div>
    </div></section>`;
}

module.exports = { queueBody, reviewForm, adminHomeBody, priceLabel };
