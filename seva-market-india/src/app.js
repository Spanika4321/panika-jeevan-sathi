'use strict';
/**
 * SEVA MARKET INDIA — application core.
 *
 * `createApp()` wires config + database + routes into a single `handle(req,
 * res)` function. Keeping it a plain function (not a listening server) means
 * tests can drive the whole stack in-process, and server.js stays 20 lines.
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { Router } = require('./http/router');
const { ok, created, html, fail, redirect, HttpError } = require('./http/respond');
const { applySecurityHeaders, clientIp } = require('./http/security');
const { readBody } = require('./http/request');
const authHttp = require('./http/auth');
const authModel = require('./models/auth');
const userModel = require('./models/user');
const { Database } = require('./db/client');
const { migrate } = require('./db/migrate');
const { seed } = require('./db/seed');
const categoryModel = require('./models/category');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/** Methods that change state, and therefore need a CSRF proof when a session rides along. */
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/** Resolve a URL path to a file inside public/, refusing traversal. */
function resolveStatic(pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = path.normalize(path.join(PUBLIC_DIR, decoded));
  const root = path.resolve(PUBLIC_DIR);
  if (!target.startsWith(root + path.sep) && target !== root) return null;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  return target;
}

function serveStatic(req, res, pathname) {
  const file = resolveStatic(pathname);
  if (!file) return false;
  const type = STATIC_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const body = fs.readFileSync(file);
  applySecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

/**
 * @param {object} options
 * @param {import('./config')} options.config
 * @param {Database} [options.db]  supply one to reuse a connection (tests)
 * @returns {{handle: Function, router: Router, db: Database, close: Function}}
 */
function createApp({ config, db: injectedDb } = {}) {
  if (!config) throw new Error('createApp requires config.');

  const db = injectedDb || new Database(config.db.file);
  if (!injectedDb) {
    migrate(db, config.db.migrationsDir);
    // A brand-new development database would otherwise look broken: an empty
    // homepage, and an onboarding form with no category to choose. Seed it once
    // when nothing is there yet — never in production, where `npm run seed` is
    // the operator's decision, and never for an injected (test) connection.
    if (config.env !== 'production' && categoryModel.count(db) === 0) {
      const result = seed(db);
      console.log(`Seeded a fresh database: ${result.providers} providers, ${result.services} services, ${result.locations} locations.`);
    }
  }

  // Boot-time housekeeping, both idempotent: expired sessions/tokens are
  // dropped, and ADMIN_EMAIL (if configured) is created or promoted.
  authModel.purgeExpired(db);
  userModel.ensureAdmin(db, config.admin);

  const router = new Router();
  const context = { db, config };

  require('./routes/api/health').register(router, context);
  require('./routes/api/locations').register(router, context);
  require('./routes/api/categories').register(router, context);
  require('./routes/api/services').register(router, context);
  // Order matters: `/api/v1/providers/me` must be registered before the
  // pattern route `/api/v1/providers/:slug`, or "me" is read as a slug.
  require('./routes/api/onboarding').register(router, context);
  require('./routes/api/provider-account').register(router, context);
  require('./routes/api/providers').register(router, context);
  require('./routes/api/auth').register(router, context);
  require('./routes/api/admin').register(router, context);
  // HTML routes, most specific first: `/providers/new` must be registered
  // before the pattern route `/providers/:slug` or the literal is eaten.
  require('./routes/auth-pages').register(router, context);
  require('./routes/onboarding-pages').register(router, context);
  require('./routes/dashboard-pages').register(router, context);
  require('./routes/admin-pages').register(router, context);
  require('./routes/pages').register(router, context);

  /** Turn a handler's return value into a response. */
  function sendResult(req, res, result) {
    if (result === null || result === undefined) {
      return res.writeHead(204, { 'Content-Length': 0 }), res.end();
    }
    if (typeof result === 'object' && typeof result.html === 'string') {
      return html(res, result.status || 200, result.html);
    }
    // Handlers answer with `{ redirect }` after a successful form post, so
    // the browser ends on a GET it can reload without re-submitting.
    if (typeof result === 'object' && typeof result.redirect === 'string') {
      return redirect(res, result.redirect, result.status || 303);
    }
    if (typeof result === 'object' && result.__status === 201) {
      return created(res, result.data);
    }
    return ok(res, result);
  }

  async function handle(req, res) {
    const started = process.hrtime.bigint();
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (_) {
      return fail(res, 400, 'Malformed request URL.');
    }

    const pathname = url.pathname.replace(/\/{2,}/g, '/');

    // Static assets first: they are the cheapest response we can give.
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (pathname.startsWith('/assets/') || pathname === '/favicon.ico' || pathname === '/robots.txt') {
        if (serveStatic(req, res, pathname)) return undefined;
      }
    }

    // HEAD is served by the matching GET handler; only the body is dropped.
    const isHead = req.method === 'HEAD';
    const match = router.match(isHead ? 'GET' : req.method, pathname);
    if (!match) {
      return pathname.startsWith('/api/')
        ? fail(res, 404, `No API route for ${pathname}.`)
        : notFoundPage(res);
    }
    if (match.methodMismatch) {
      applySecurityHeaders(res);
      res.writeHead(405, { Allow: router.allowedMethods(pathname).join(', '), 'Content-Length': 0 });
      return res.end();
    }

    if (isHead) {
      // Content-Length is already set from the real body, so the client sees
      // exactly what a GET would return, minus the payload.
      const realEnd = res.end.bind(res);
      res.end = (chunk, ...rest) => realEnd(undefined, ...rest);
    }

    const ctx = {
      db,
      config,
      req,
      res,
      params: match.params,
      query: url.searchParams,
      pathname,
      ip: clientIp(req, config.http.trustProxyHops),
      userAgent: req.headers['user-agent'] || null,
    };

    /** Body parsing happens once; the CSRF check and the handler share it. */
    ctx.readBody = () => {
      if (!ctx._bodyPromise) ctx._bodyPromise = readBody(req, config.http.maxBodyBytes);
      return ctx._bodyPromise;
    };

    try {
      // 1. Who is calling? 2. If they are calling with a session and want to
      // change state, prove the request came from our own page.
      const principal = authHttp.resolvePrincipal(db, config, req);
      if (principal) {
        ctx.user = principal.user;
        ctx.session = principal.session;
        ctx.sessionToken = principal.token;
        ctx.csrfToken = authModel.csrfTokenFor(principal.token, config.security.sessionSecret);
      }
      if (!ctx.user) ctx.user = null;

      if (STATE_CHANGING.has(req.method) && ctx.sessionToken) {
        const header = req.headers['x-csrf-token'];
        const fromBody = header ? null : (await ctx.readBody())?._csrf ?? null;
        const submitted = header || fromBody;
        if (!authModel.csrfTokenMatches(ctx.sessionToken, submitted, config.security.sessionSecret)) {
          throw new HttpError(403, 'Your session expired or the form was not submitted from this site. Please try again.');
        }
      }

      const result = await match.handler(ctx);
      sendResult(req, res, result);
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(res, err.status, err.message, err.details);
      }
      if (err && err.name === 'ValidationError') {
        return fail(res, 400, err.message, { [err.field || 'field']: err.message });
      }
      // Never leak internals to the client; keep the detail server-side.
      const ref = crypto.randomBytes(6).toString('hex');
      console.error(`[${ref}] ${req.method} ${pathname} failed:`, err && err.stack ? err.stack : err);
      return fail(res, 500, `Something went wrong. Reference ${ref}.`);
    } finally {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      res.setHeader && !res.headersSent && res.setHeader('X-Response-Time', `${ms.toFixed(2)}ms`);
    }
    return undefined;
  }

  function close() {
    if (!injectedDb) db.close();
  }

  return { handle, router, db, close };
}

function notFoundPage(res) {
  const body = `<!DOCTYPE html>
<html lang="en-IN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found | SEVA MARKET INDIA</title>
<link rel="stylesheet" href="/assets/css/main.css"></head>
<body><main class="section"><div class="container container--narrow">
<h1 class="page-head__title">404 — page not found</h1>
<p class="prose">That page does not exist. Try the <a href="/search">service search</a> or go
<a href="/">home</a>.</p>
</div></main></body></html>`;
  return html(res, 404, body);
}

module.exports = { createApp, serveStatic, resolveStatic, STATIC_TYPES };
