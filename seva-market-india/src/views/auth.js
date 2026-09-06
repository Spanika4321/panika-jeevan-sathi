'use strict';
/**
 * SEVA MARKET INDIA — account pages (sign in, register, verify, reset).
 *
 * Two rules hold on every one of them: the field errors come back next to the
 * field that caused them, and no page ever tells an attacker whether an email
 * address exists.
 */

const { esc } = require('./escape');
const form = require('./form');

/** Small helper so each page reads as: title, lede, then the form. */
function head(title, lede) {
  return `
    <section class="page-head"><div class="container container--narrow">
      <h1 class="page-head__title">${esc(title)}</h1>
      ${lede ? `<p class="page-head__lede">${esc(lede)}</p>` : ''}
    </div></section>`;
}

function loginBody({ errors = {}, values = {}, next = '/', site, notice = null, csrf = '' }) {
  return `
    ${head('Sign in', 'Manage your listing, answer enquiries and keep your contact details current.')}
    <section class="section"><div class="container container--narrow">
      ${notice ? `<div class="alert alert--ok"><p class="alert__title">${esc(notice)}</p></div>` : ''}
      ${form.errorSummary(errors)}
      ${form.openForm({ action: `/login?next=${encodeURIComponent(next)}`, method: 'post', csrf })}
        ${form.input({ name: 'email', label: 'Email address', type: 'email', value: values.email || '', error: errors.email, required: true, attrs: { autocomplete: 'email', maxlength: 254, inputmode: 'email' } })}
        ${form.input({ name: 'password', label: 'Password', type: 'password', value: '', error: errors.password, required: true, hint: 'Ten failed attempts in 15 minutes pauses sign-in for this email on this connection.', attrs: { autocomplete: 'current-password', maxlength: 1024 } })}
        <p class="form__footnote"><a href="/forgot-password">Forgot your password?</a> · <a href="/register">Create an account</a></p>
        ${form.actions({ label: 'Sign in' })}
      ${form.closeForm}
    </div></section>`;
}

function registerBody({ errors = {}, values = {}, intent = 'customer', site, next = '/', csrf = '' }) {
  const isProvider = intent === 'provider';
  return `
    ${head(isProvider ? 'Create your provider account' : 'Create your account',
      isProvider ? 'One account per business. You can add your services right after this.' : 'An account keeps your enquiries together so you can find a provider again in a tap.')}
    <section class="section"><div class="container container--narrow">
      ${form.errorSummary(errors)}
      ${form.openForm({ action: `/register?intent=${esc(intent)}&next=${encodeURIComponent(next)}`, method: 'post', csrf })}
        ${form.fieldRow([
          form.input({ name: 'full_name', label: 'Your name', value: values.full_name || '', error: errors.full_name, required: true, attrs: { autocomplete: 'name', maxlength: 120 } }),
          form.input({ name: 'phone', label: 'Mobile number', type: 'tel', value: values.phone || '', error: errors.phone, attrs: { autocomplete: 'tel', inputmode: 'numeric', pattern: '[6-9][0-9]{9}', maxlength: 10 } }),
        ])}
        ${form.input({ name: 'email', label: 'Email address', type: 'email', value: values.email || '', error: errors.email, required: true, attrs: { autocomplete: 'email', maxlength: 254 } })}
        ${form.input({ name: 'password', label: 'Password', type: 'password', value: '', error: errors.password, required: true, hint: 'At least 8 characters, with one letter and one number.', attrs: { autocomplete: 'new-password', maxlength: 1024 } })}
        ${isProvider ? '<input type="hidden" name="intent" value="provider">' : '<input type="hidden" name="intent" value="customer">'}
        <p class="prose form__note">By creating an account you agree to the <a href="/terms">terms</a>. We only use your contact details to run the marketplace — see our <a href="/privacy">privacy notice</a>.</p>
        ${form.actions({ label: isProvider ? 'Create account and continue' : 'Create account' })}
      ${form.closeForm}
      <p class="form__footnote">Already listed with us? <a href="/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}">Sign in instead</a>.</p>
    </div></section>`;
}

/** Shown after register when verification is mandatory, and after a link click. */
function noticeBody({ title, lede, children = '' }) {
  return `
    ${head(title, lede)}
    <section class="section"><div class="container container--narrow">
      ${children}
      <p class="form__footnote"><a href="/">Back to search</a> · <a href="/login">Sign in</a></p>
    </div></section>`;
}

function verifyBody({ result, csrf = '' }) {
  const ok = result.ok;
  return `
    ${head(ok ? 'Email confirmed' : 'We could not confirm that email',
      ok ? 'Your address is verified. Your listing and enquiries are now tied to a confirmed contact.' : result.error || 'That link is not valid.')}
    <section class="section"><div class="container container--narrow">
      <div class="empty">
        ${ok
          ? '<p>You can close this tab — the link has been used.</p><p><a class="btn btn--primary" href="/dashboard">Open your dashboard</a></p>'
          : '<p>Request a fresh link by signing in; we send a new one with every failed attempt.</p><p><a class="btn btn--primary" href="/login">Sign in</a></p>'}
      </div>
    </div></section>`;
}

function forgotBody({ errors = {}, values = {}, sent = false, debugLink = null, csrf = '' }) {
  return `
    ${head('Reset your password', 'Tell us the email on your account and we will send a one-time link.')}
    <section class="section"><div class="container container--narrow">
      ${sent ? `
        <div class="alert alert--ok">
          <p class="alert__title">If that email is registered, a reset link is on its way.</p>
          <p class="alert__text">The link works once and expires within an hour. Nothing changes if the address is not on file.</p>
          ${debugLink ? `<p class="alert__text">No inbox in this environment — open it here: <a href="${esc(debugLink)}">${esc(debugLink)}</a></p>` : ''}
        </div>` : ''}
      ${form.errorSummary(errors)}
      ${form.openForm({ action: '/forgot-password', method: 'post', csrf })}
        ${form.input({ name: 'email', label: 'Email address', type: 'email', value: values.email || '', error: errors.email, required: true, attrs: { autocomplete: 'email', maxlength: 254 } })}
        ${form.actions({ label: 'Send reset link' })}
      ${form.closeForm}
      <p class="form__footnote"><a href="/login">Back to sign in</a></p>
    </div></section>`;
}

function resetBody({ errors = {}, token = '', done = false, error = null, csrf = '' }) {
  if (done) {
    return `
    ${head('Password changed', 'Every other device has been signed out. Sign in here with the new password.')}
    <section class="section"><div class="container container--narrow">
      <p><a class="btn btn--primary" href="/login">Sign in</a></p>
    </div></section>`;
  }
  return `
    ${head('Choose a new password', error || 'Pick something you have not used on this site before.')}
    <section class="section"><div class="container container--narrow">
      ${form.errorSummary(errors)}
      ${form.openForm({ action: '/reset-password', method: 'post', csrf })}
        <input type="hidden" name="token" value="${esc(token)}">
        ${form.input({ name: 'password', label: 'New password', type: 'password', value: '', error: errors.password, required: true, hint: 'At least 8 characters, with one letter and one number.', attrs: { autocomplete: 'new-password', maxlength: 1024 } })}
        ${form.actions({ label: 'Change password' })}
      ${form.closeForm}
    </div></section>`;
}

/** `/account` — a person's own details, not a business dashboard. */
function accountBody({ user, provider, sessions, emailRequired, errors = {}, csrf = '', flash = null, site }) {
  const statusBadges = provider
    ? {
      active: '<span class="badge badge--verified">Live in search</span>',
      pending: '<span class="badge badge--pending">Waiting for review</span>',
      suspended: '<span class="badge badge--danger">Suspended</span>',
    }[provider.status] || ''
    : '';

  return `
    ${head('My account', `${user.email} · signed in since this session was created.`)}
    <section class="section"><div class="container container--narrow">
      ${flash && flash.message ? `<div class="alert alert--${flash.kind === 'error' ? 'error' : 'ok'}"><p class="alert__title">${esc(flash.message)}</p></div>` : ''}
      <div class="panel">
        <h2 class="panel__title">Profile</h2>
        <dl class="definition">
          <div><dt>Name</dt><dd>${esc(user.full_name)}</dd></div>
          <div><dt>Email</dt><dd>${esc(user.email)}${user.email_verified_at ? ' <span class="badge badge--verified">Verified</span>' : ' <span class="badge badge--pending">Not verified</span>'}</dd></div>
          <div><dt>Account type</dt><dd>${esc(user.role)}</dd></div>
          <div><dt>Sessions</dt><dd>${Number(sessions)} active · signing out here revokes this one only</dd></div>
        </dl>
        ${emailRequired ? `<p class="prose">Check your inbox and confirm ${esc(user.email)} — verification links expire in 24 hours.</p>` : ''}
      </div>

      <div class="panel">
        <h2 class="panel__title">Your listing</h2>
        ${provider ? `
          <p class="prose">${esc(provider.business_name)} ${statusBadges}</p>
          <p class="form__footnote"><a href="/providers/${esc(provider.slug)}">Public profile</a> · <a class="btn btn--primary btn--sm" href="/dashboard">Open dashboard</a></p>` : `
          <p class="prose">No listing yet. Add your business once and customers in your PIN code can find you.</p>
          <p><a class="btn btn--primary" href="/providers/new">List your service</a></p>`}
      </div>

      <div class="panel">
        <h2 class="panel__title">Change password</h2>
        <p class="prose">Changing it signs every other device out, so a lost phone does not mean a lost account.</p>
        ${form.errorSummary(errors)}
        ${form.openForm({ action: '/account/password', method: 'post', csrf })}
          ${form.input({ name: 'current_password', label: 'Current password', type: 'password', required: true, error: errors.current_password, attrs: { autocomplete: 'current-password', maxlength: 1024 } })}
          ${form.input({ name: 'new_password', label: 'New password', type: 'password', required: true, error: errors.new_password, hint: 'At least 8 characters, with one letter and one number.', attrs: { autocomplete: 'new-password', maxlength: 1024 } })}
          ${form.actions({ label: 'Update password' })}
        ${form.closeForm}
      </div>

      <div class="panel">
        <h2 class="panel__title">Sign out everywhere</h2>
        <p class="prose">Use this if you signed in on a shared device or think someone else has your password.</p>
        ${form.openForm({ action: '/account/sessions/revoke', method: 'post', csrf })}
          ${form.actions({ label: 'Sign out of all devices', danger: true, small: true })}
        ${form.closeForm}
      </div>
    </div></section>`;
}

module.exports = { loginBody, registerBody, noticeBody, verifyBody, forgotBody, resetBody, accountBody, head };
