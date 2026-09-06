'use strict';
/**
 * SEVA MARKET INDIA — auth guards.
 *
 * Tiny helpers used by page/route handlers to enforce login and a provider
 * role, reading `ctx.user` that app.js attaches from the session cookie.
 */

const { HttpError } = require('./respond');
const providerModel = require('../models/provider');

/** Carry a browser redirect for "must log in first" flows. */
class RedirectError extends Error {
  constructor(location, message = 'Please log in.') {
    super(message);
    this.name = 'RedirectError';
    this.location = location;
  }
}

/** Ensure the caller is logged in; throws a browser redirect otherwise. */
function ensureLogin(ctx) {
  if (!ctx.user) {
    throw new RedirectError('/login?next=' + encodeURIComponent(ctx.pathname));
  }
  return ctx.user;
}

/**
 * Ensure the caller is logged in *and* owns a provider listing.
 * @returns {{user: object, provider: object}}
 */
function ensureProvider(ctx) {
  const user = ensureLogin(ctx);
  const provider = user && providerModel.findByUserId(ctx.db, user.id);
  if (!provider) {
    throw new RedirectError('/providers/new', 'Create your provider listing to open the dashboard.');
  }
  return { user, provider };
}

/** API-style guard: throw a JSON 401 when there is no logged-in user. */
function requireApiUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Please log in.');
  return ctx.user;
}

module.exports = { requireUser: requireApiUser, ensureLogin, ensureProvider, RedirectError };
