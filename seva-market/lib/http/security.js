/**
 * HTTP security helpers.
 *
 * Headers are set on every response, including static files and 404s. The
 * content security policy is deliberately strict: all styling lives in CSS
 * files and all behaviour in JS files, so no inline script/style is needed.
 * (Components toggle classes; they never write to `element.style`.)
 */

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), microphone=(), camera=()'
};

export function contentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'"
  ].join('; ');
}

export function securityHeaders({ includeCsp = true } = {}) {
  return includeCsp ? { ...SECURITY_HEADERS, 'Content-Security-Policy': contentSecurityPolicy() } : { ...SECURITY_HEADERS };
}

/** True when the request arrived over HTTPS (directly or via a trusted proxy). */
export function isSecure(req) {
  if (req?.socket?.encrypted) return true;
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return forwarded === 'https';
}

/**
 * Client IP, honouring exactly `hops` trusted proxies.
 * Trusting "all" forwarded hops lets a client forge its address, so the count
 * is explicit configuration and never guessed.
 */
export function clientIp(req, hops = 0) {
  const remote = req?.socket?.remoteAddress || '';
  if (!hops) return remote;
  const list = String(req?.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!list.length) return remote;
  // The trusted hops are the right-most entries; the client is just before them.
  const index = list.length - hops;
  return list[Math.max(0, index - 1)] || remote;
}

export function requestOrigin(req) {
  const host = req?.headers?.host || 'localhost';
  return `${isSecure(req) ? 'https' : 'http'}://${host}`;
}
