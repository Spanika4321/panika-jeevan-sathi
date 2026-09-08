'use strict';
/**
 * SEVA MARKET INDIA — security headers.
 *
 * Applied to every response, HTML and JSON alike. A strict CSP is the reason
 * inline event handlers are never used in the templates.
 */

const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
].join('; ');

/**
 * @param {import('node:http').ServerResponse} res
 * @param {{html?: boolean}} [options]
 */
function applySecurityHeaders(res, options = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (options.html) {
    res.setHeader('Content-Security-Policy', CSP);
  }
}

/**
 * Decide whether a state-changing request comes from the same origin.
 *
 * Cross-site HTML forms are the one CSRF channel that SameSite=Lax cookies
 * do not fully close (they are Lax, not Strict), so every POST is checked:
 * when the browser sends an Origin header it must match this site. Requests
 * without Origin (curl, same-origin fetch with no CORS preflight, tests)
 * are accepted — the cookie is HttpOnly + Lax, which already stops the
 * cookie-sniffing and cross-site GET attacks.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{host: string, siteUrl?: string}} context
 */
function isSameOrigin(req, { host, siteUrl = '' } = {}) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const hostHeader = String(host || '');
    if (parsed.host === hostHeader) return true;
    // A configured canonical site URL is the second authority (the Host
    // header can be absent behind some proxies).
    if (siteUrl) {
      const canonical = new URL(siteUrl);
      if (parsed.host === canonical.host) return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

/**
 * Reject state-changing requests from foreign origins.
 * @throws {Error} with .status = 403 when the origin does not match
 */
function assertSameOrigin(req, { host, siteUrl = '' } = {}) {
  if (!isSameOrigin(req, { host, siteUrl })) {
    const error = new Error('Request came from a different origin and was blocked.');
    error.name = 'OriginError';
    error.status = 403;
    throw error;
  }
}

/**
 * Resolve the client IP behind a known number of proxies.
 * Only the last `hops` entries of X-Forwarded-For are trusted, so a client
 * cannot spoof its address by prepending values.
 */
function clientIp(req, hops = 0) {
  const header = req.headers['x-forwarded-for'];
  const socketIp = req.socket?.remoteAddress || '';
  if (!header || hops <= 0) return normalizeIp(socketIp);

  const parts = String(header).split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return normalizeIp(socketIp);
  const index = Math.max(0, parts.length - hops);
  return normalizeIp(parts[index]);
}

function normalizeIp(ip) {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

module.exports = { applySecurityHeaders, clientIp, isSameOrigin, assertSameOrigin, CSP };
