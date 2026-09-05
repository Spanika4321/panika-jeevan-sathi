'use strict';
/**
 * SEVA MARKET INDIA — request level security helpers.
 *
 * Baseline headers, fixed-window rate limits and same-origin checks for
 * state-changing requests. Deliberately small: everything is in-process, so
 * it suits a single instance deployment (documented in DEPLOY.md).
 */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // 'unsafe-inline' is allowed for style-src only: the pages use static inline
  // style attributes for small layout hints. No style value is built from user
  // input, and script-src stays strict (all scripts are separate files).
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'"
  ].join('; '),
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

function clientIp(req, trustProxyHops = 0) {
  if (trustProxyHops > 0) {
    const forwarded = String(req.headers['x-forwarded-for'] || '');
    const parts = forwarded.split(',').map((value) => value.trim()).filter(Boolean);
    if (parts.length) return parts[Math.max(0, parts.length - trustProxyHops)];
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function createRateLimiter() {
  const hits = new Map();
  return function limit(key, max, windowMs) {
    const now = Date.now();
    const bucket = hits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= max;
  };
}

/**
 * State-changing requests must come from this origin and must be JSON.
 * A plain HTML form cannot set a custom header, so form posts are rejected.
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    try {
      return new URL(origin).host === String(host).split(',')[0].trim();
    } catch (_) {
      return false;
    }
  }
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  return true; // older browsers without Sec-Fetch-Site
}

function isJson(req) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('application/json');
}

module.exports = { SECURITY_HEADERS, clientIp, createRateLimiter, sameOrigin, isJson };
