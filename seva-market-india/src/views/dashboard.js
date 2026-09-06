'use strict';
/**
 * SEVA MARKET INDIA — provider dashboard.
 *
 * Four jobs, in the order a provider actually needs them: answer enquiries,
 * keep services accurate, widen coverage, fix contact details. Everything is
 * a plain form POST so it works on a 2G connection and with JavaScript off.
 */

const { esc } = require('./escape');
const form = require('./form');
const { head } = require('./auth');

const STATUS_BADGE = {
  active: '<span class="badge badge--verified">Live</span>',
  pending: '<span class="badge badge--pending">In review</span>',
  suspended: '<span class="badge badge--danger">Suspended</span>',
  draft: '<span class="badge badge--pending">Draft</span>',
  paused: '<span class="badge badge--muted">Paused</span>',
  archived: '<span class="badge badge--muted">Archived</span>',
};

const badge = (status) => STATUS_BADGE[status] || `<span class="badge">${esc(status)}</span>`;

function priceText(row) {
  if (row.price_min === null && row.price_max === null) return 'Price on request';
  const unit = { visit: '/visit', hour: '/hour', day: '/day', sqft: '/sq.ft', job: '/job', month: '/month' }[row.price_unit] || '';
  if (row.price_min !== null && row.price_max !== null) return `₹${row.price_min}–₹${row.price_max}${unit}`;
  return `₹${row.price_min ?? row.price_max}${unit}`;
}

function statusNotice(provider, autoApprove) {
  if (provider.status === 'active') {
    return `<div class="alert alert--ok"><p class="alert__title">Your listing is live and appearing in search.</p></div>`;
  }
  if (provider.status === 'pending') {
    return `<div class="alert alert--warn">
      <p class="alert__title">Waiting for review</p>
      <p class="alert__text">We check each new business before it appears${autoApprove ? ' (auto-approval is on in this environment)' : ''}. Keep your details ready — an approved profile gets about three times the calls.</p>
    </div>`;
  }
  return `<div class="alert alert--error">
    <p class="alert__title">This listing is not published</p>
    <p class="alert__text">${esc(provider.review_note || 'Contact support and we will tell you exactly what to fix.')}</p>
  </div>`;
}

function statsStrip(stats) {
  const items = [
    { label: 'New enquiries', value: stats.new_leads },
    { label: 'Total enquiries', value: stats.total_leads },
    { label: 'Live services', value: stats.active_services },
    { label: 'Drafts', value: stats.draft_services },
    { label: 'Coverage PINs', value: stats.area_count },
  ];
  return `
      <ul class="stats stats--dash">${items
    .map((item) => `<li class="stat stat--sm"><span class="stat__value">${esc(item.value)}</span><span class="stat__label">${esc(item.label)}</span></li>`)
    .join('')}</ul>`;
}

/* ----------------------------------------------------------- overview */

function overviewBody({ provider, stats, services, recentLeads, completeness, documents, csrf, autoApprove, categories }) {
  const needsService = stats.total_services === 0;
  const missingAreas = stats.area_count === 0;
  return `
    ${head('Dashboard', `${provider.business_name} · ${provider.pin_code ? `PIN ${provider.pin_code}` : 'India-wide'}`)}
    <section class="section"><div class="container">
      ${statusNotice(provider, autoApprove)}
      <div class="panel panel--wide">
        <div class="panel__head">
          <h2 class="panel__title">Profile strength</h2>
          <span class="panel__metric">${esc(completeness)}%</span>
        </div>
        <div class="progress" role="img" aria-label="Profile ${esc(completeness)} percent complete">
          <span class="progress__bar" style="width: ${Number(completeness) || 0}%"></span>
        </div>
        <ul class="checklist">
          <li class="${provider.about && provider.about.length >= 60 ? 'is-done' : ''}">Describe your work in a couple of lines</li>
          <li class="${!needsService ? 'is-done' : ''}">Add at least one service with a price</li>
          <li class="${!missingAreas ? 'is-done' : ''}">List the extra PIN codes you cover</li>
          <li class="${documents.length ? 'is-done' : ''}">Add a GSTIN or shop photo to earn the verified badge</li>
        </ul>
      </div>

      ${statsStrip(stats)}

      <div class="grid-2">
        <div class="panel">
          <div class="panel__head"><h2 class="panel__title">Recent enquiries</h2><a class="panel__link" href="/dashboard/enquiries">Open inbox</a></div>
          ${recentLeads.length ? `<ul class="lead-list">${recentLeads.map((lead) => `
            <li class="lead">
              <p class="lead__who">${esc(lead.name)} ${lead.read_at ? '' : '<span class="badge badge--new">new</span>'}</p>
              <p class="lead__contact"><a href="tel:+91${esc(lead.phone)}">${esc(lead.phone)}</a>${lead.pin_code ? ` · PIN ${esc(lead.pin_code)}` : ''}</p>
              ${lead.message ? `<p class="lead__text">${esc(lead.message)}</p>` : ''}
            </li>`).join('')}</ul>` : `<p class="empty">No enquiries yet. Customers find you through search — <a href="/providers/${esc(provider.slug)}">see your public profile</a>.</p>`}
        </div>

        <div class="panel">
          <div class="panel__head"><h2 class="panel__title">Your services</h2><a class="panel__link" href="/dashboard/services">Manage</a></div>
          ${services.length ? `<ul class="mini-list">${services.slice(0, 5).map((row) => `
            <li class="mini-list__row"><span>${esc(row.title)}</span><span class="mini-list__meta">${esc(priceText(row))} ${badge(row.status)}</span></li>`).join('')}</ul>` : '<p class="empty">Nothing listed yet.</p>'}
          ${needsService ? `
            <h3 class="panel__subtitle">Add a service now</h3>
            ${form.openForm({ action: '/dashboard/services', method: 'post', csrf })}
              ${form.input({ name: 'title', label: 'Service name', required: true, attrs: { maxlength: 140 } })}
              ${form.fieldRow([
                form.input({ name: 'price_min', label: 'From (₹)', type: 'number', attrs: { min: 0 } }),
                form.select({ name: 'category_id', label: 'Category', options: categories, value: provider.category_id, placeholder: 'Same as my business' }),
              ])}
              ${form.actions({ label: 'Add service', small: true })}
            ${form.closeForm}` : ''}
        </div>
      </div>

      <div class="panel">
        <h2 class="panel__title">Verification</h2>
        <p class="prose">Verified profiles are shown first in search. ${documents.length ? 'You have submitted documents for review.' : 'Add a document reference so we can verify you faster.'}</p>
        ${form.openForm({ action: '/dashboard/documents', method: 'post', csrf })}
          ${form.fieldRow([
            form.select({ name: 'kind', label: 'Type', options: [['gst', 'GSTIN'], ['udyam', 'Udyam / MSME'], ['pan', 'PAN'], ['licence', 'Trade licence'], ['photo', 'Shop photo ref'], ['other', 'Other']].map(([value, label]) => ({ value, label })) }),
            form.input({ name: 'reference', label: 'Number or file reference', hint: 'Stored masked — we never keep the document itself.', attrs: { maxlength: 40 } }),
          ])}
          ${form.actions({ label: documents.length ? 'Update reference' : 'Submit for verification', small: true })}
        ${form.closeForm}
        ${documents.length ? `<ul class="mini-list">${documents.map((doc) => `<li class="mini-list__row"><span>${esc(doc.kind)} · ${esc(doc.reference)}</span><span class="mini-list__meta">${badge(doc.status)}</span></li>`).join('')}</ul>` : ''}
      </div>
    </div></section>`;
}

/* ----------------------------------------------------------- services */

function servicesBody({ provider, services, categories, csrf, errors = {}, editing = null, priceUnits }) {
  const formValues = editing || {};
  return `
    ${head('My services', 'Only live services appear in search. Prices are what customers compare on — keep them honest.')}
    <section class="section"><div class="container">
      <div class="grid-2">
        <div class="panel">
          <h2 class="panel__title">${editing ? 'Edit service' : 'Add a service'}</h2>
          ${Object.keys(errors).length ? form.errorSummary(errors) : ''}
          ${form.openForm({ action: editing ? `/dashboard/services/${editing.id}` : '/dashboard/services', method: 'post', csrf })}
            ${form.input({ name: 'title', label: 'Service name', value: formValues.title || '', error: errors.title, required: true, attrs: { maxlength: 140 } })}
            ${form.textarea({ name: 'description', label: 'What is included', value: formValues.description || '', error: errors.description, rows: 3, maxlength: 2000 })}
            ${form.fieldRow([
              form.input({ name: 'price_min', label: 'From (₹)', type: 'number', value: formValues.price_min ?? '', error: errors.price_min, attrs: { min: 0, max: 10000000 } }),
              form.input({ name: 'price_max', label: 'To (₹)', type: 'number', value: formValues.price_max ?? '', error: errors.price_max, attrs: { min: 0, max: 10000000 } }),
            ])}
            ${form.fieldRow([
              form.select({ name: 'price_unit', label: 'Price is per', options: priceUnits.map((unit) => ({ value: unit, label: unit })), value: formValues.price_unit || 'visit' }),
              form.select({ name: 'category_id', label: 'Category', options: categories, value: formValues.category_id || provider.category_id }),
            ])}
            ${form.input({ name: 'pin_code', label: 'PIN code for this service', value: formValues.pin_code || provider.pin_code || '', error: errors.pin_code, hint: 'Leave as your main PIN unless you serve it from another address.', attrs: { inputmode: 'numeric', pattern: '[1-9][0-9]{5}', maxlength: 6 } })}
            <div class="form__actions form__actions--split">
              <button class="btn btn--primary" type="submit" name="publish" value="active">${editing ? 'Save & publish' : 'Add & publish'}</button>
              <button class="btn btn--ghost" type="submit" name="publish" value="draft">Save as draft</button>
            </div>
          ${form.closeForm}
        </div>

        <div class="panel">
          <div class="panel__head"><h2 class="panel__title">Listed services (${services.length})</h2>${provider.status !== 'active' ? '<span class="panel__note">Publishing your business brings drafts live</span>' : ''}</div>
          ${services.length ? `<ul class="service-list">${services.map((row) => `
            <li class="service-row">
              <div class="service-row__main">
                <p class="service-row__title">${esc(row.title)}</p>
                <p class="service-row__meta">${esc(priceText(row))} · ${esc(row.category_name)}${row.pin_code ? ` · PIN ${esc(row.pin_code)}` : ''} ${badge(row.status)}</p>
              </div>
              <div class="service-row__actions">
                <a class="btn btn--ghost btn--sm" href="/dashboard/services/${esc(row.id)}">Edit</a>
                ${row.status !== 'active' ? statusForm(row.id, 'active', csrf, 'Publish') : statusForm(row.id, 'paused', csrf, 'Pause')}
                ${row.status !== 'archived' ? statusForm(row.id, 'archived', csrf, 'Archive') : ''}
              </div>
            </li>`).join('')}</ul>` : '<p class="empty">No services yet — add one on the left.</p>'}
        </div>
      </div>
    </div></section>`;
}

/** A one-button form for a status change; separate forms keep each action explicit. */
function statusForm(serviceId, status, csrf, label) {
  return `<form class="inline-form" action="/dashboard/services/${serviceId}/status" method="post">
            <input type="hidden" name="_csrf" value="${esc(csrf)}">
            <input type="hidden" name="status" value="${esc(status)}">
            <button class="btn btn--ghost btn--sm" type="submit">${esc(label)}</button>
          </form>`;
}

/* ----------------------------------------------------------- coverage */

function coverageBody({ provider, pins, csrf, errors = {}, maxAreas }) {
  return `
    ${head('Coverage areas', 'Add the PIN codes you are happy to travel to. Search matches a customer’s PIN against this list.')}
    <section class="section"><div class="container container--narrow">
      ${Object.keys(errors).length ? form.errorSummary(errors) : ''}
      ${form.openForm({ action: '/dashboard/coverage', method: 'post', csrf })}
        ${form.textarea({ name: 'service_areas', label: `PIN codes (up to ${maxAreas})`, value: pins.join(', '), rows: 4, maxlength: 400, hint: 'Comma or space separated. Your main PIN is always included: ' + (provider.pin_code || '—') })}
        ${form.actions({ label: 'Save coverage' })}
      ${form.closeForm}
      <div class="panel">
        <h2 class="panel__title">Currently covering ${pins.length + 1} PIN ${pins.length === 0 ? 'code' : 'codes'}</h2>
        <ul class="pill-list">
          ${provider.pin_code ? `<li class="pill pill--strong">${esc(provider.pin_code)}</li>` : ''}
          ${pins.map((pin) => `<li class="pill">${esc(pin)}</li>`).join('')}
        </ul>
      </div>
    </div></section>`;
}

/* ---------------------------------------------------------- enquiries */

const LEAD_NOTE = {
  new: 'Waiting for you to call back.',
  contacted: 'You said you reached them.',
  closed: 'Job booked or politely declined.',
  spam: 'Hidden from your counts and reported.',
};

function enquiriesBody({ provider, leads, counts, csrf, filter = null }) {
  const tabs = ['new', 'contacted', 'closed', 'spam'];
  return `
    ${head('Enquiries', 'Every customer who asked to be contacted. Answer fast — the first call usually wins.')}
    <section class="section"><div class="container">
      <div class="tabs tabs--inline">
        <a class="tabs__link${!filter ? ' is-current' : ''}" href="/dashboard/enquiries">All (${counts.total})</a>
        ${tabs.map((status) => `<a class="tabs__link${filter === status ? ' is-current' : ''}" href="/dashboard/enquiries?status=${status}">${esc(status[0].toUpperCase() + status.slice(1))} (${counts[status] || 0})</a>`).join('')}
      </div>
      ${leads.length ? `<ul class="lead-board">${leads.map((lead) => `
        <li class="lead-card">
          <div class="lead-card__head">
            <p class="lead-card__who">${esc(lead.name)} ${lead.read_at ? '' : '<span class="badge badge--new">new</span>'} ${badge(lead.status)}</p>
            <p class="lead-card__when">Received ${esc(String(lead.created_at || '').slice(0, 16).replace('T', ' '))} UTC</p>
          </div>
          <p class="lead-card__contact">
            <a class="btn btn--primary btn--sm" href="tel:+91${esc(lead.phone)}">Call ${esc(lead.phone)}</a>
            ${lead.email ? `<a class="btn btn--ghost btn--sm" href="mailto:${esc(lead.email)}">Email</a>` : ''}
            ${lead.pin_code ? `<span class="lead-card__pin">PIN ${esc(lead.pin_code)}</span>` : ''}
          </p>
          ${lead.message ? `<p class="lead-card__text">${esc(lead.message)}</p>` : ''}
          ${lead.provider_note ? `<p class="lead-card__note">Your note: ${esc(lead.provider_note)}</p>` : ''}
          <form class="form form--inline" action="/dashboard/enquiries/${lead.id}" method="post">
            <input type="hidden" name="_csrf" value="${esc(csrf)}">
            ${form.input({ name: 'note', label: 'Note to yourself', value: lead.provider_note || '', attrs: { maxlength: 300 } })}
            <div class="form__actions">
              ${tabs.filter((status) => status !== lead.status).map((status) => `<button class="btn btn--ghost btn--sm" type="submit" name="status" value="${status}">Mark ${esc(status)}</button>`).join('')}
              <button class="btn btn--primary btn--sm" type="submit" name="status" value="${lead.status}">Save note</button>
            </div>
          </form>
        </li>`).join('')}</ul>` : `<p class="empty">Nothing here yet. ${filter ? '<a href="/dashboard/enquiries">See all enquiries</a> · ' : ''}<a href="/providers/${esc(provider.slug)}">Share your profile</a> — every listing page has an enquiry form.</p>`}
    </div></section>`;
}

/* ------------------------------------------------------------ profile */

function profileBody({ provider, categories, csrf, errors = {}, values = null }) {
  const v = values || provider;
  return `
    ${head('Business details', 'This is what customers see. Keep the phone number reachable — a missed call is a lost job.')}
    <section class="section"><div class="container container--narrow">
      ${Object.keys(errors).length ? form.errorSummary(errors) : ''}
      ${form.openForm({ action: '/dashboard/profile', method: 'post', csrf })}
        ${form.input({ name: 'business_name', label: 'Business name', value: v.business_name || '', error: errors.business_name, required: true, attrs: { maxlength: 140 } })}
        ${form.fieldRow([
          form.input({ name: 'contact_name', label: 'Contact person', value: v.contact_name || '', attrs: { maxlength: 120 } }),
          form.input({ name: 'experience_years', label: 'Years of experience', type: 'number', value: v.experience_years ?? 0, attrs: { min: 0, max: 70 } }),
        ])}
        ${form.fieldRow([
          form.input({ name: 'phone', label: 'Primary mobile', type: 'tel', value: v.phone || '', error: errors.phone, required: true, attrs: { inputmode: 'numeric', pattern: '[6-9][0-9]{9}', maxlength: 10 } }),
          form.input({ name: 'alt_phone', label: 'Second mobile', type: 'tel', value: v.alt_phone || '', attrs: { inputmode: 'numeric', pattern: '[6-9][0-9]{9}', maxlength: 10 } }),
        ])}
        ${form.input({ name: 'email', label: 'Public email (optional)', type: 'email', value: v.email || '', hint: 'Shown on your profile so customers can write to you.', attrs: { maxlength: 254 } })}
        ${form.select({ name: 'category_id', label: 'Main category', options: categories, value: v.category_id })}
        ${form.fieldRow([
          form.input({ name: 'pin_code', label: 'PIN code', value: v.pin_code || '', error: errors.pin_code, attrs: { inputmode: 'numeric', pattern: '[1-9][0-9]{5}', maxlength: 6 } }),
          form.input({ name: 'website', label: 'Website / social link', type: 'url', value: v.website || '', attrs: { maxlength: 200 } }),
        ])}
        ${form.input({ name: 'address_line', label: 'Shop or area', value: v.address_line || '', attrs: { maxlength: 200 } })}
        ${form.textarea({ name: 'about', label: 'About your work', value: v.about || '', rows: 5, maxlength: 2000 })}
        ${form.input({ name: 'gst_number', label: 'GSTIN', value: v.gst_number || '', error: errors.gst_number, hint: 'Adds the verified badge once our team checks it.', attrs: { maxlength: 15 } })}
        ${form.actions({ label: 'Save changes', secondary: { href: `/providers/${provider.slug}`, label: 'View public profile' } })}
      ${form.closeForm}
      <p class="form__footnote">Status and the verified badge are decided by SEVA MARKET INDIA after review — they are not editable here.</p>
    </div></section>`;
}

/** Shown when the account has no listing yet (e.g. a customer signed in). */
function emptyDashboardBody({ user }) {
  return `
    ${head('Dashboard', 'Add your business and your dashboard fills up with enquiries.')}
    <section class="section"><div class="container container--narrow">
      <div class="empty">
        <h2>No listing on ${esc(user.email)} yet</h2>
        <p>Listing takes about two minutes: business name, category, PIN code, one service.</p>
        <p><a class="btn btn--primary" href="/providers/new">List your service</a> <a class="btn btn--ghost" href="/account">My account</a></p>
      </div>
    </div></section>`;
}

module.exports = {
  overviewBody,
  servicesBody,
  coverageBody,
  enquiriesBody,
  profileBody,
  emptyDashboardBody,
  statusForm,
  priceText,
  badge,
  LEAD_NOTE,
};
