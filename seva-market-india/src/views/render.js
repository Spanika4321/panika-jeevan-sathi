'use strict';
/**
 * SEVA MARKET INDIA — page rendering helpers.
 *
 * Every HTML route returns the same envelope: layout + the signed-in user +
 * the CSRF proof + a flash message read from the query string. Centralising
 * that is what keeps the CSP, the `noindex` rules and the nav consistent
 * without each page re-deciding them.
 */

const { layout } = require('./layout');
const flashQuery = require('./flash');

/**
 * @param {object} ctx the request context from app.js
 * @returns {{html: string, status?: number}}
 */
function renderPage(ctx, { title, description = '', body, currentPath, flash, tabs = null, noIndex = false, status = 200 }) {
  return {
    status,
    html: layout({
      title,
      description,
      body,
      currentPath: currentPath || ctx.pathname,
      site: ctx.config.site,
      user: ctx.user || null,
      csrf: ctx.csrfToken || '',
      flash: flash === undefined ? flashQuery.fromQuery(ctx.query) : flash,
      noIndex,
      tabs,
    }),
  };
}

/** Flash a message through the query string, keeping existing parameters. */
function redirectTo(path, code, { kind = 'ok', params = null } = {}) {
  const url = new URL(path, 'http://localhost');
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value);
    }
  }
  url.searchParams.set(kind === 'error' ? 'err' : 'ok', code);
  return { redirect: `${url.pathname}${url.search}` };
}

/**
 * A form handler's happy path and error path in one call: re-render the page
 * with the values the user typed and the field errors, or redirect.
 */
function formOutcome(result, renderErrors, success) {
  if (result && result.ok) return success;
  return renderErrors(result && result.errors ? result.errors : { form: result && result.error ? result.error : 'The form could not be saved.' });
}

const DASHBOARD_TABS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/services', label: 'Services' },
  { href: '/dashboard/coverage', label: 'Coverage' },
  { href: '/dashboard/enquiries', label: 'Enquiries' },
  { href: '/dashboard/profile', label: 'Business details' },
];

const ACCOUNT_TABS = [
  { href: '/account', label: 'Account' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/providers/new', label: 'List your service' },
];

module.exports = { renderPage, redirectTo, formOutcome, DASHBOARD_TABS, ACCOUNT_TABS };
