#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — single process web server.
 *
 * Node core only: static pages, JSON API, sessions and SQLite. There is no
 * build step, no bundler and no third-party runtime dependency.
 *
 *   node server.js            # http://localhost:3000
 *   PORT=8080 node server.js
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const { Db } = require('./lib/db');
const { createApi } = require('./lib/api');
const auth = require('./lib/auth');
const { SECURITY_HEADERS } = require('./lib/http-security');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.SMI_DATA_DIR || path.join(ROOT, 'data'));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SITE_URL = process.env.SITE_URL || '';
const VERSION = '1.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2'
};

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Db(path.join(DATA_DIR, 'seva-market.sqlite'));
const api = createApi({ db, dataDir: DATA_DIR, version: VERSION });

/* ------------------------------------------------------------ first boot */
function ensureAccounts() {
  const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@sevamarketindia.in').trim().toLowerCase();
  let generatedPassword = '';
  if (!db.userByEmail(adminEmail)) {
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    if (!process.env.ADMIN_PASSWORD) generatedPassword = password;
    const hashed = auth.hashPassword(password);
    db.exec(
      `INSERT INTO users (email, password_hash, salt, name, phone, role, city, status, created_at)
       VALUES (?, ?, ?, ?, '', 'admin', '', 'active', ?)`,
      [adminEmail, hashed.hash, hashed.salt, 'Platform Administrator', Date.now()]
    );
  }

  const demoEnabled = String(process.env.SMI_DEMO_ACCOUNTS || '1') !== '0';
  if (demoEnabled && !db.userByEmail('demo.customer@sevamarketindia.in')) {
    const hashed = auth.hashPassword('Demo@12345');
    const id = db.createUser({
      email: 'demo.customer@sevamarketindia.in',
      password_hash: hashed.hash,
      salt: hashed.salt,
      name: 'Demo Customer',
      phone: '+91 90000 00001',
      role: 'customer',
      city: 'Delhi'
    });
    // One completed booking so the dashboard and review flow are not empty.
    const provider = db.get("SELECT id FROM providers WHERE city = 'Delhi' AND status = 'approved' ORDER BY rating DESC LIMIT 1");
    if (provider) {
      const service = db.get('SELECT service_id FROM provider_services WHERE provider_id = ? LIMIT 1', [provider.id]);
      if (service) {
        const bookingId = db.createBooking({
          customer_id: id,
          provider_id: provider.id,
          service_id: service.service_id,
          date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
          slot: 'Morning (9 am – 12 pm)',
          address: 'Flat 402, Sunrise Apartments, Rohini, Delhi 110085',
          notes: 'Please call before arriving.',
          price: db.priceFor(provider.id, service.service_id)
        });
        db.setBookingStatus(bookingId, 'accepted');
      }
    }
  }

  if (demoEnabled && !db.userByEmail('demo.provider@sevamarketindia.in')) {
    const hashed = auth.hashPassword('Demo@12345');
    const userId = db.createUser({
      email: 'demo.provider@sevamarketindia.in',
      password_hash: hashed.hash,
      salt: hashed.salt,
      name: 'Demo Professional',
      phone: '+91 90000 00002',
      role: 'provider',
      city: 'Delhi'
    });
    const category = db.categoryBySlug('plumbing');
    const providerId = db.createProvider({
      user_id: userId,
      business_name: 'Demo Plumbing Services',
      category_id: category ? category.id : 1,
      city: 'Delhi',
      area: 'Rohini',
      headline: 'Demo account — plumbing repairs across North Delhi.',
      experience_years: 8
    });
    db.updateProvider(providerId, { status: 'approved', verified: 1 });
  }

  if (generatedPassword) {
    const file = path.join(DATA_DIR, 'admin-credentials.txt');
    fs.writeFileSync(
      file,
      `SEVA MARKET INDIA — administrator account (generated on first boot)\n\n` +
        `Email:    ${adminEmail}\nPassword: ${generatedPassword}\n\n` +
        `Log in at /login.html and change this password immediately.\n`,
      { mode: 0o600 }
    );
    console.log(`  Administrator created: ${adminEmail} (password saved to ${file})`);
  }
}

ensureAccounts();
auth.purgeExpiredSessions(db);

/* ---------------------------------------------------------------- server */
function publicOrigin(req) {
  if (SITE_URL) return SITE_URL.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${host}`;
}

function resolveStatic(pathname) {
  let clean = decodeURIComponent(pathname);
  if (clean.endsWith('/')) clean += 'index.html';
  const target = path.normalize(path.join(PUBLIC_DIR, clean));
  if (!target.startsWith(PUBLIC_DIR)) return null;
  return target;
}

function sendFile(res, filePath, extraHeaders = {}) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, Object.assign({
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
  }, SECURITY_HEADERS, extraHeaders));
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function notFound(res) {
  const target = path.join(PUBLIC_DIR, '404.html');
  res.writeHead(404, Object.assign({ 'Content-Type': MIME['.html'] }, SECURITY_HEADERS));
  if (fs.existsSync(target)) fs.createReadStream(target).pipe(res);
  else res.end('<h1>404 — page not found</h1>');
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, SECURITY_HEADERS);
    res.end();
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    await api.handle(req, res, url);
    return;
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, Object.assign({ Allow: 'GET, HEAD, OPTIONS' }, SECURITY_HEADERS));
    res.end('Method not allowed');
    return;
  }

  if (url.pathname === '/robots.txt') {
    const origin = publicOrigin(req);
    res.writeHead(200, Object.assign({ 'Content-Type': MIME['.txt'] }, SECURITY_HEADERS));
    res.end(
      '# SEVA MARKET INDIA\nUser-agent: *\nAllow: /\nDisallow: /api/\n\n' +
        `Sitemap: ${origin}/sitemap.xml\n`
    );
    return;
  }

  if (url.pathname === '/sitemap.xml') {
    const origin = publicOrigin(req);
    const pages = ['', '/services.html', '/providers.html', '/about.html', '/contact.html', '/login.html', '/terms.html', '/privacy.html'];
    const categories = db.categories().map((c) => `/providers.html?category=${encodeURIComponent(c.slug)}`);
    const providers = db.listProviders({ status: 'approved' }).slice(0, 200).map((p) => `/provider.html?id=${p.id}`);
    const urls = [...pages, ...categories, ...providers]
      .map((p) => `  <url><loc>${origin}${p}</loc><changefreq>weekly</changefreq><priority>${p === '' ? '1.0' : '0.7'}</priority></url>`)
      .join('\n');
    res.writeHead(200, Object.assign({ 'Content-Type': MIME['.xml'] }, SECURITY_HEADERS));
    res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
    return;
  }

  // Clean URLs: /services → /services.html
  let target = resolveStatic(url.pathname);
  if (!target) {
    const withHtml = resolveStatic(`${url.pathname}.html`);
    if (withHtml && fs.existsSync(withHtml)) target = withHtml;
  }
  if (target && fs.existsSync(target)) {
    const isPrivate = /^\/(dashboard|provider-dashboard|admin)\.html$/.test(url.pathname);
    sendFile(res, target, isPrivate ? { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } : {});
    return;
  }

  notFound(res);
});

server.listen(PORT, HOST, () => {
  const stats = db.stats();
  console.log('');
  console.log('  SEVA MARKET INDIA');
  console.log(`  → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Catalogue: ${stats.categories} categories · ${stats.providers_approved} professionals · ${stats.bookings} bookings`);
  console.log('');
});

function shutdown() {
  console.log('\n  Shutting down…');
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
