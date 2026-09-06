'use strict';
/**
 * SEVA MARKET INDIA — cookie parsing and serialisation.
 *
 * Deliberately tiny and dependency-free. `parseCookieHeader` is tolerant of
 * the junk real browsers send (duplicate names, stray spaces); `serialize`
 * always emits the SameSite / HttpOnly pair the app depends on, and appends
 * rather than overwrites so several cookies can be set on one response.
 */

/**
 * @param {string|undefined} header the raw Cookie request header
 * @returns {Record<string, string>}
 */
function parseCookieHeader(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in out) continue; // first wins, as browsers do
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[name] = value;
  }
  return out;
}

/**
 * Build a Set-Cookie value.
 * @param {string} name
 * @param {string} value
 * @param {object} [options]
 * @param {number} [options.maxAge] seconds; omit for a session cookie
 * @param {boolean} [options.httpOnly=true]
 * @param {boolean} [options.secure=false] required in production
 * @param {'Lax'|'Strict'|'None'} [options.sameSite='Lax']
 * @param {string} [options.path='/']
 */
function serialize(name, value, options = {}) {
  const { maxAge = null, httpOnly = true, secure = false, sameSite = 'Lax', path = '/' } = options;
  const segments = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (maxAge !== null) segments.push(`Max-Age=${Math.trunc(maxAge)}`, `Expires=${new Date(Date.now() + maxAge * 1000).toUTCString()}`);
  if (httpOnly) segments.push('HttpOnly');
  if (secure) segments.push('Secure');
  segments.push(`SameSite=${sameSite}`);
  return segments.join('; ');
}

/**
 * Append a Set-Cookie header without clobbering one already queued.
 * @param {import('node:http').ServerResponse} res
 */
function push(res, cookie) {
  const current = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : undefined;
  const list = current ? (Array.isArray(current) ? current : [current]) : [];
  list.push(cookie);
  res.setHeader('Set-Cookie', list);
  return list;
}

/** Remove a cookie by expiring it in the past with identical attributes. */
function clear(res, name, options = {}) {
  return push(res, serialize(name, '', { ...options, maxAge: 0 }));
}

module.exports = { parseCookieHeader, serialize, push, clear };
