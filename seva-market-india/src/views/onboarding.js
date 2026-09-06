'use strict';
/**
 * SEVA MARKET INDIA — provider onboarding page.
 *
 * One long mobile-first form instead of a wizard: the fields are the ones a
 * customer actually filters on, and everything else can be added later from
 * the dashboard. The "your area" block is what makes this a marketplace
 * rather than a directory — a listing without a PIN code cannot be found.
 */

const { esc } = require('./escape');
const form = require('./form');
const { head } = require('./auth');

function accountBlock({ values, errors, isNewAccount }) {
  if (!isNewAccount) {
    return `
        <fieldset class="fieldset">
          <legend class="fieldset__legend">Your details</legend>
          <p class="prose">Signed in as <strong>${esc(values.email || '')}</strong> — the listing will belong to this account.</p>
        </fieldset>`;
  }
  return `
        <fieldset class="fieldset">
          <legend class="fieldset__legend">Create your account</legend>
          <p class="prose form__note">We need one so you can come back and edit your listing, and so customers know a real person is behind the number.</p>
          ${form.fieldRow([
            form.input({ name: 'full_name', label: 'Your name', value: values.full_name || '', error: errors.full_name, required: true, attrs: { autocomplete: 'name', maxlength: 120 } }),
            form.input({ name: 'email', label: 'Email', type: 'email', value: values.email || '', error: errors.email, required: true, attrs: { autocomplete: 'email', maxlength: 254 } }),
          ])}
          ${form.input({ name: 'password', label: 'Password', type: 'password', value: '', error: errors.password, required: true, hint: 'At least 8 characters, with one letter and one number.', attrs: { autocomplete: 'new-password', maxlength: 1024 } })}
        </fieldset>`;
}

function businessBlock({ values, errors, categories }) {
  return `
        <fieldset class="fieldset">
          <legend class="fieldset__legend">Your business</legend>
          ${form.input({ name: 'business_name', label: 'Business name', value: values.business_name || '', error: errors.business_name, required: true, hint: 'What people call you — "Ravi Plumbing Works" beats a generic name.', attrs: { maxlength: 140 } })}
          ${form.fieldRow([
            form.input({ name: 'contact_name', label: 'Contact person', value: values.contact_name || '', error: errors.contact_name, attrs: { maxlength: 120 } }),
            form.input({ name: 'experience_years', label: 'Years of experience', type: 'number', value: values.experience_years || '', error: errors.experience_years, attrs: { min: 0, max: 70, inputmode: 'numeric' } }),
          ])}
          ${form.fieldRow([
            form.input({ name: 'phone', label: 'Mobile number customers can call', type: 'tel', value: values.phone || '', error: errors.phone, required: true, attrs: { autocomplete: 'tel', inputmode: 'numeric', pattern: '[6-9][0-9]{9}', maxlength: 10 } }),
            form.input({ name: 'alt_phone', label: 'Second number (optional)', type: 'tel', value: values.alt_phone || '', error: errors.alt_phone, attrs: { inputmode: 'numeric', pattern: '[6-9][0-9]{9}', maxlength: 10 } }),
          ])}
          ${form.select({ name: 'category_id', label: 'Main category', options: categories, value: values.category_id || '', error: errors.category_id, placeholder: 'Choose a category…', required: true })}
          ${form.fieldRow([
            form.input({ name: 'pin_code', label: 'PIN code', type: 'text', value: values.pin_code || '', error: errors.pin_code, required: true, hint: 'Six digits — this is how "near me" finds you.', attrs: { inputmode: 'numeric', pattern: '[1-9][0-9]{5}', maxlength: 6, autocomplete: 'postal-code' } }),
            form.input({ name: 'address_line', label: 'Shop / area (optional)', value: values.address_line || '', error: errors.address_line, attrs: { maxlength: 200, autocomplete: 'street-address' } }),
          ])}
          ${form.textarea({ name: 'about', label: 'About your work', value: values.about || '', error: errors.about, rows: 4, maxlength: 2000, hint: 'Tools you carry, materials you use, timings you keep. Two lines is enough to start.' })}
          ${form.fieldRow([
            form.input({ name: 'website', label: 'Website or Instagram (optional)', type: 'url', value: values.website || '', error: errors.website, attrs: { maxlength: 200 } }),
            form.input({ name: 'gst_number', label: 'GSTIN (optional)', value: values.gst_number || '', error: errors.gst_number, hint: 'Speeds up verification. Stored masked.', attrs: { maxlength: 15 } }),
          ])}
        </fieldset>`;
}

function serviceBlock({ values, errors, priceUnits }) {
  return `
        <fieldset class="fieldset">
          <legend class="fieldset__legend">Your first service</legend>
          <p class="prose form__note">Add one now, more later. Leave the price blank if you quote per job.</p>
          ${form.input({ name: 'service_title', label: 'Service name', value: values.service_title || '', error: errors.service_title, required: true, hint: 'e.g. "Bathroom tap & shower repair"', attrs: { maxlength: 140 } })}
          ${form.textarea({ name: 'service_description', label: 'What is included', value: values.service_description || '', error: errors.service_description, rows: 3, maxlength: 2000 })}
          ${form.fieldRow([
            form.input({ name: 'price_min', label: 'From (₹)', type: 'number', value: values.price_min || '', error: errors.price_min, attrs: { min: 0, max: 10000000, inputmode: 'numeric' } }),
            form.input({ name: 'price_max', label: 'To (₹)', type: 'number', value: values.price_max || '', error: errors.price_max, attrs: { min: 0, max: 10000000, inputmode: 'numeric' } }),
            form.select({ name: 'price_unit', label: 'Price is per', options: priceUnits.map((unit) => ({ value: unit, label: unit })), value: values.price_unit || 'visit' }),
          ])}
        </fieldset>`;
}

function coverageBlock({ values, errors, maxAreas }) {
  return `
        <fieldset class="fieldset">
          <legend class="fieldset__legend">Other PIN codes you travel to</legend>
          <p class="prose form__note">Separate them with commas. This is what makes you show up for customers just outside your own area.</p>
          ${form.input({ name: 'service_areas', label: `Coverage PIN codes (up to ${maxAreas})`, value: Array.isArray(values.service_areas) ? values.service_areas.join(', ') : (values.service_areas || ''), error: errors.service_areas, hint: 'e.g. 781001, 781005, 781006', attrs: { maxlength: 400 } })}
        </fieldset>`;
}

/**
 * @param {object} options
 * @param {object} options.values  previously typed values, so a failed submit
 *        never asks a provider to re-enter a phone number
 */
function onboardingBody({ values = {}, errors = {}, categories = [], priceUnits = ['visit', 'hour', 'day', 'sqft', 'job', 'month'], maxAreas = 25, isNewAccount = true, csrf = '', user = null, autoApprove = false, availability = null, notice = null }) {
  return `
    ${head('List your service', 'Free to list. Customers call you directly — we take no commission on the first contact.')}
    <section class="section"><div class="container container--narrow">
      ${Object.keys(errors).length ? form.errorSummary(errors) : ''}
      ${notice ? `<div class="alert alert--ok"><p class="alert__title">${esc(notice)}</p></div>` : ''}
      ${availability ? `<div class="callout"><p class="callout__title">${esc(availability.note)}</p>${availability.sample && availability.sample.length ? `<p class="callout__text">Already listed here: ${availability.sample.map((row) => esc(row.business_name)).join(', ')}.</p>` : ''}</div>` : ''}
      <div class="callout callout--muted">
        <p class="callout__title">${autoApprove ? 'Your listing goes live as soon as you submit.' : 'Every new listing is checked by a human before it appears in search.'}</p>
        <p class="callout__text">We do this so a phone number in our results belongs to a real business. You will get an email either way.</p>
      </div>

      ${form.openForm({ action: '/providers/new', method: 'post', csrf })}
        ${accountBlock({ values, errors, isNewAccount })}
        ${businessBlock({ values, errors, categories })}
        ${serviceBlock({ values, errors, priceUnits })}
        ${coverageBlock({ values, errors, maxAreas })}
        <label class="field field--check">
          <input type="checkbox" name="contact_ok" value="1" checked>
          <span>I agree these details may be shown to customers searching my area.</span>
        </label>
        ${form.actions({ label: isNewAccount ? 'Create account & list my business' : 'Publish my listing' })}
      ${form.closeForm}
    </div></section>`;
}

function submittedBody({ provider, service, needsReview, serviceAreas, site, email }) {
  return `
    ${head(needsReview ? 'Submitted — waiting for review' : 'Your listing is live',
      needsReview
        ? 'We check every new business before it appears. Usually the same day.'
        : 'Customers searching your category, city or PIN code can see you now.')}
    <section class="section"><div class="container container--narrow">
      <div class="panel">
        <h2 class="panel__title">${esc(provider.business_name)}</h2>
        <dl class="definition">
          <div><dt>Status</dt><dd>${needsReview ? '<span class="badge badge--pending">In review</span>' : '<span class="badge badge--verified">Active</span>'}</dd></div>
          <div><dt>First service</dt><dd>${esc(service.title)} <span class="badge">${esc(service.status)}</span></dd></div>
          <div><dt>Area</dt><dd>${provider.pin_code ? `PIN ${esc(provider.pin_code)}` : 'India-wide'}${serviceAreas.length ? ` + ${serviceAreas.length} coverage PIN codes` : ''}</dd></div>
          <div><dt>Public profile</dt><dd><a href="/providers/${esc(provider.slug)}">/providers/${esc(provider.slug)}</a></dd></div>
        </dl>
      </div>
      <div class="panel">
        <h2 class="panel__title">Next steps</h2>
        <ol class="steps steps--tight">
          <li class="step step--sm"><span class="step__title">Confirm your email</span><p class="step__text">We sent a link to ${esc(email || 'the address you gave')} so you can recover the account later.</p></li>
          <li class="step step--sm"><span class="step__title">Add 2-3 services with prices</span><p class="step__text">Listings with a price get more calls than "on request".</p></li>
          <li class="step step--sm"><span class="step__title">Cover the PINs you actually serve</span><p class="step__text">That is how you appear in a neighbour's search.</p></li>
        </ol>
        <p><a class="btn btn--primary" href="/dashboard">Open my dashboard</a></p>
      </div>
    </div></section>`;
}

module.exports = { onboardingBody, submittedBody, businessBlock, serviceBlock, coverageBlock };
