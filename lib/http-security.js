'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

function proxyHops(env = process.env) {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw === '') return env.RENDER === 'true' || env.RENDER_SERVICE_ID ? 1 : 0;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  return hops;
}

function clientIp(req, env = process.env) {
  const peer = req.socket?.remoteAddress || 'unknown';
  const hops = proxyHops(env);
  if (!hops) return peer;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (forwarded.some((ip) => !net.isIP(ip))) return peer;
  // Trust exactly the configured proxy hops from the RIGHT, never a caller's
  // arbitrary leftmost X-Forwarded-For value. The app must sit behind these proxies.
  const chain = [...forwarded, peer];
  return chain[Math.max(0, chain.length - 1 - hops)];
}

function isSecure(req, env = process.env) {
  return Boolean(req.socket?.encrypted) || (proxyHops(env) > 0 && String(req.headers['x-forwarded-proto'] || '').split(',').at(-1).trim() === 'https');
}

function requestOrigin(req, env = process.env) {
  const host = String(req.headers.host || 'localhost');
  return new URL(`${isSecure(req, env) ? 'https' : 'http'}://${host}`).origin;
}

function writeRequestProblem(req, env = process.env) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return null;
  if (req.headers['sec-fetch-site'] === 'cross-site') return { status: 403, error: 'Cross-site requests are not allowed.' };
  const origin = req.headers.origin;
  if (origin) {
    try {
      const allowed = new Set([requestOrigin(req, env)]);
      if (env.SITE_URL) allowed.add(new URL(env.SITE_URL).origin);
      if (!allowed.has(origin)) return { status: 403, error: 'Cross-origin requests are not allowed.' };
    } catch (_) {
      return { status: 403, error: 'Invalid request origin.' };
    }
  }
  if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    return { status: 415, error: 'Use Content-Type: application/json.' };
  }
  return null;
}

function contentSecurityPolicy(publicDir) {
  const hashes = new Set();
  for (const name of fs.readdirSync(publicDir).filter((file) => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(publicDir, name), 'utf8');
    for (const [, attrs, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/i.test(attrs) || !code.trim()) continue;
      // HTML normalises CRLF before the browser computes CSP hashes.
      hashes.add(`'sha256-${crypto.createHash('sha256').update(code.replace(/\r\n?/g, '\n')).digest('base64')}'`);
    }
  }
  return [
    "default-src 'self'", `script-src 'self' ${[...hashes].join(' ')}`,
    "script-src-attr 'none'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:", "font-src 'self' data:", "connect-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'"
  ].join('; ');
}

module.exports = { proxyHops, clientIp, isSecure, requestOrigin, writeRequestProblem, contentSecurityPolicy };
