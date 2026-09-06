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

module.exports = { applySecurityHeaders, clientIp, CSP };
