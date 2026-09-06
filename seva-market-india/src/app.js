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
const { ok, created, html, fail, HttpError } = require('./http/respond');
const { applySecurityHeaders, clientIp } = require('./http/security');
const { Database } = require('./db/client');
const { migrate } = require('./db/migrate');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

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
  if (!injectedDb) migrate(db, config.db.migrationsDir);

  const router = new Router();
  const context = { db, config };

  require('./routes/api/health').register(router, context);
  require('./routes/api/locations').register(router, context);
  require('./routes/api/categories').register(router, context);
  require('./routes/api/services').register(router, context);
  require('./routes/api/providers').register(router, context);
  require('./routes/pages').register(router, context);

  /** Turn a handler's return value into a response. */
  function sendResult(req, res, result) {
    if (result === null || result === undefined) {
      return res.writeHead(204, { 'Content-Length': 0 }), res.end();
    }
    if (typeof result === 'object' && typeof result.html === 'string') {
      return html(res, result.status || 200, result.html);
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
    };

    try {
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
