'use strict';
/**
 * SEVA MARKET INDIA — response helpers.
 *
 * One JSON envelope everywhere: `{ ok, data }` or `{ ok:false, error }`.
 * Predictable envelopes are what make a future mobile app and the SEO
 * renderer cheap to build.
 */

const { applySecurityHeaders } = require('./security');

const STATUSES = {
  ok: 200,
  created: 201,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  conflict: 409,
  tooManyRequests: 429,
  serverError: 500,
};

/** Typed application error carrying an HTTP status. */
class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }

  static badRequest(message, details) { return new HttpError(400, message, details); }
  static notFound(message = 'Not found') { return new HttpError(404, message); }
  static conflict(message) { return new HttpError(409, message); }
  static tooManyRequests(message = 'Too many requests') { return new HttpError(429, message); }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  applySecurityHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function ok(res, data, status = 200) {
  return json(res, status, { ok: true, data });
}

function created(res, data) {
  return json(res, STATUSES.created, { ok: true, data });
}

function fail(res, status, message, details) {
  const payload = { ok: false, error: { message } };
  if (details) payload.error.details = details;
  return json(res, status, payload);
}

function html(res, status, markup) {
  const body = Buffer.from(markup, 'utf8');
  applySecurityHeaders(res, { html: true });
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function redirect(res, location, status = 302) {
  applySecurityHeaders(res);
  res.writeHead(status, { Location: location, 'Content-Length': 0 });
  res.end();
}

module.exports = { HttpError, json, ok, created, fail, html, redirect, STATUSES };
