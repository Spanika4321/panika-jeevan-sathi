'use strict';
/**
 * SEVA MARKET INDIA — HTTP auth plumbing.
 *
 * Translates "who is calling?" into a request-local value, and turns the
 * guards into HTTP responses. `src/actions/auth.js` owns the rules; this file
 * only moves bytes between the socket and those rules.
 */

const cookies = require('./cookies');
const auth = require('../models/auth');
const { HttpError } = require('./respond');

/** Session cookie options, from config, so callers do not repeat the flags. */
function cookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    secure: Boolean(config.auth.secureCookies),
    path: '/',
  };
}

/**
 * Resolve the caller from the request. Returns null for anonymous traffic —
 * never throws, because most pages are public.
 * @returns {{user: object, session: object, token: string}|null}
 */
function resolvePrincipal(db, config, req) {
  const jar = cookies.parseCookieHeader(req.headers.cookie);
  const token = jar[config.auth.sessionCookie];
  if (!token) return null;
  const found = auth.readSession(db, token, config.security.sessionSecret);
  if (!found) return null;
  return { user: found.user, session: found.session, token };
}

/** Attach a fresh session cookie (call after `createSession`). */
function startSession(ctx, token) {
  cookies.push(ctx.res, cookies.serialize(ctx.config.auth.sessionCookie, token, {
    ...cookieOptions(ctx.config),
    maxAge: ctx.config.auth.sessionDays * 24 * 60 * 60,
  }));
}

function endSession(ctx) {
  cookies.clear(ctx.res, ctx.config.auth.sessionCookie, cookieOptions(ctx.config));
}

/** The CSRF proof a form must echo back, or null when signed out. */
function csrfToken(ctx) {
  if (!ctx.csrfToken) return '';
  return ctx.csrfToken;
}

/** A hidden input for server-rendered forms. */
function csrfField(ctx) {
  const token = csrfToken(ctx);
  return token ? `<input type="hidden" name="_csrf" value="${token.replace(/"/g, '&quot;')}">` : '';
}

/**
 * Guards. `requireUser` throws a 401 for API traffic and, for browsers,
 * returns a redirect instruction instead so a form page can bounce to /login
 * with a `next` parameter — one call site, both surfaces behave sensibly.
 */
function isApiPath(pathname) {
  return String(pathname || '').startsWith('/api/');
}

function requireUser(ctx, { roles = null } = {}) {
  if (!ctx.user) {
    if (isApiPath(ctx.pathname) || ctx.wantsJson) {
      throw new HttpError(401, 'Sign in to continue.');
    }
    const next = encodeURIComponent(ctx.pathname + (ctx.query?.toString ? `?${ctx.query.toString()}` : ''));
    return { redirect: `/login?next=${next}` };
  }
  if (roles && !roles.includes(ctx.user.role)) {
    throw new HttpError(403, 'This area is not available to your account type.');
  }
  return { user: ctx.user };
}

function requireProvider(ctx) {
  // The role check is done here rather than through requireUser({roles}), so a
  // browser can be redirected to the form that fixes the problem instead of
  // being shown a 403.
  const result = requireUser(ctx);
  if (result.redirect) return result;
  if (ctx.user.role !== 'provider' && ctx.user.role !== 'admin') {
    if (isApiPath(ctx.pathname) || ctx.wantsJson) {
      throw new HttpError(403, 'Your account cannot manage provider listings.');
    }
    // A signed-in customer in the provider area is not an attacker, they are
    // a lead: send them to the listing form.
    return { redirect: '/providers/new?intent=provider' };
  }
  return result;
}

function requireAdmin(ctx) {
  if (!ctx.user) {
    if (isApiPath(ctx.pathname)) throw new HttpError(401, 'Sign in as an administrator.');
    return { redirect: '/login?next=%2Fadmin' };
  }
  if (ctx.user.role !== 'admin') throw new HttpError(403, 'Administrator access required.');
  return { user: ctx.user };
}

/** Redirect a signed-in visitor away from login/register pages. */
function redirectIfSignedIn(ctx, target = '/dashboard') {
  return ctx.user ? { redirect: target } : null;
}

/** Where to send a user after sign-in, validating `next` against open redirects. */
function safeNext(raw, fallback = '/') {
  const value = String(raw || '');
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /^[a-z]+:/i.test(value)) return fallback;
  return value;
}

/** Read the body once per request and keep it for the CSRF check and the handler. */
function readJsonOrFormBody(ctx, maxBytes) {
  if (!ctx._bodyPromise) {
    const { readBody } = require('./request');
    ctx._bodyPromise = readBody(ctx.req, maxBytes);
  }
  return ctx._bodyPromise;
}

module.exports = {
  cookieOptions,
  resolvePrincipal,
  startSession,
  endSession,
  csrfToken,
  csrfField,
  requireUser,
  requireProvider,
  requireAdmin,
  redirectIfSignedIn,
  safeNext,
  readJsonOrFormBody,
  isApiPath,
};
