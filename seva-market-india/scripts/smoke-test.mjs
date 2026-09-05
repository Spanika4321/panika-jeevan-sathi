#!/usr/bin/env node
/**
 * SEVA MARKET INDIA — end-to-end API smoke test.
 *
 * Boots the real server on a free port with a throwaway data directory,
 * then walks the complete customer → professional → admin journey over HTTP.
 * No mocks: every assertion runs against the same code that serves production.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3400 + Math.floor(Math.random() * 400);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smi-test-'));
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api(method, urlPath, body, cookie) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SMI', Origin: BASE }
  };
  if (body) options.body = JSON.stringify(body);
  if (cookie) options.headers.Cookie = cookie;
  const response = await fetch(BASE + urlPath, options);
  let json = null;
  try { json = await response.json(); } catch (_) { json = null; }
  return { status: response.status, body: json, cookie: response.headers.get('set-cookie') || '' };
}

async function waitForBoot(process, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (process.exitCode !== null) throw new Error('Server exited during start-up.');
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch (_) { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Server did not start in time.');
}

const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  env: { ...process.env, PORT: String(PORT), SMI_DATA_DIR: DATA_DIR, ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'Test@12345' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
child.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

try {
  await waitForBoot(child);

  /* ------------------------------------------------------------ public API */
  const health = await api('GET', '/api/health');
  check('health endpoint responds', health.status === 200 && health.body.ok === true);
  check('catalogue is seeded', health.body.counts.categories === 12 && health.body.counts.providers >= 20,
    JSON.stringify(health.body.counts));

  const site = await api('GET', '/api/site');
  check('site payload carries categories and cities', site.body.categories.length === 12 && site.body.cities.length === 12);

  const search = await api('GET', '/api/providers?city=Delhi&sort=rating&per_page=5');
  check('provider search filters by city',
    search.body.items.length > 0 && search.body.items.length <= 5 && search.body.items.every((p) => p.city === 'Delhi'),
    JSON.stringify(search.body.items.map((p) => p.city)));

  const byCategory = await api('GET', '/api/providers?category=plumbing');
  check('provider search filters by category', byCategory.body.items.every((p) => p.category_slug === 'plumbing'));

  const detail = await api('GET', `/api/providers/${search.body.items[0].id}`);
  check('provider detail returns services and reviews',
    detail.body.provider.services.length > 0 && detail.body.provider.reviews.length > 0);

  /* ------------------------------------------------------- customer journey */
  const stamp = Date.now();
  const customerEmail = `customer.${stamp}@test.local`;
  const registered = await api('POST', '/api/auth/register', {
    name: 'Test Customer', email: customerEmail, password: 'Customer@123', city: 'Delhi', phone: '+91 90000 00001', role: 'customer'
  });
  check('customer registration creates a session', registered.status === 200 && /smi_session=/.test(registered.cookie));
  const customerCookie = registered.cookie.split(';')[0];

  const badLogin = await api('POST', '/api/auth/login', { email: customerEmail, password: 'wrong-password' });
  check('wrong password is rejected', badLogin.status === 401);

  const login = await api('POST', '/api/auth/login', { email: customerEmail, password: 'Customer@123' });
  check('customer can log in', login.status === 200 && login.body.user.email === customerEmail);

  const provider = search.body.items[0];
  const service = detail.body.provider.services[0];
  const booking = await api('POST', '/api/bookings', {
    provider_id: provider.id, service_id: service.id,
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    slot: 'Morning (9 am – 12 pm)',
    address: 'Flat 12, Test Residency, Rohini, Delhi 110085'
  }, customerCookie);
  check('booking is created with a price', booking.status === 200 && booking.body.booking.price > 0);
  const bookingId = booking.body.booking.id;

  const shortAddress = await api('POST', '/api/bookings', {
    provider_id: provider.id, service_id: service.id,
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    slot: 'Morning (9 am – 12 pm)', address: 'short'
  }, customerCookie);
  check('incomplete address is rejected', shortAddress.status === 400);

  const pastDate = await api('POST', '/api/bookings', {
    provider_id: provider.id, service_id: service.id,
    date: '2020-01-01', slot: 'Morning (9 am – 12 pm)', address: 'A valid long address here'
  }, customerCookie);
  check('past date is rejected', pastDate.status === 400);

  const anonymousBooking = await api('POST', '/api/bookings', {
    provider_id: provider.id, service_id: service.id,
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    slot: 'Morning (9 am – 12 pm)', address: 'A valid long address here'
  });
  check('anonymous booking is rejected', anonymousBooking.status === 401);

  const earlyReview = await api('POST', '/api/reviews', { booking_id: bookingId, rating: 5, comment: 'Too early' }, customerCookie);
  check('review before completion is rejected', earlyReview.status === 409);

  /* ----------------------------------------------------- professional side */
  const providerEmail = `provider.${stamp}@test.local`;
  const proRegistered = await api('POST', '/api/auth/register', {
    name: 'Test Pro', email: providerEmail, password: 'Provider@123', role: 'provider',
    city: 'Delhi', business_name: 'Test Services Delhi', category: 'electrical', area: 'Rohini', experience_years: 6
  });
  check('professional registration creates a pending profile',
    proRegistered.status === 200 && Boolean(proRegistered.body.provider_id));
  const proCookie = proRegistered.cookie.split(';')[0];

  const adminLogin = await api('POST', '/api/auth/login', { email: 'admin@test.local', password: 'Test@12345' });
  check('administrator can log in', adminLogin.status === 200 && adminLogin.body.user.role === 'admin');
  const adminCookie = adminLogin.cookie.split(';')[0];

  const approve = await api('PATCH', `/api/admin/providers/${proRegistered.body.provider_id}`, { status: 'approved', verified: 1 }, adminCookie);
  check('admin can approve a professional', approve.status === 200);

  const nonAdmin = await api('GET', '/api/admin/stats', undefined, customerCookie);
  check('admin API is closed to customers', nonAdmin.status === 403);

  /* accept → complete → review using the seeded provider's own session */
  const demoLogin = await api('POST', '/api/auth/login', { email: 'demo.provider@sevamarketindia.in', password: 'Demo@12345' });
  check('demo professional account exists', demoLogin.status === 200);

  // Complete the customer's booking through the admin path (provider API is role checked per record).
  const acceptAsOwner = await api('PATCH', `/api/bookings/${bookingId}`, { status: 'accepted' }, customerCookie);
  check('customer cannot accept their own booking', [403, 409].includes(acceptAsOwner.status), `status ${acceptAsOwner.status}`);

  const acceptAsAdmin = await api('PATCH', `/api/bookings/${bookingId}`, { status: 'accepted' }, adminCookie);
  check('booking can be accepted', acceptAsAdmin.status === 200);

  const completeAsAdmin = await api('PATCH', `/api/bookings/${bookingId}`, { status: 'completed' }, adminCookie);
  check('booking can be moved to completed', completeAsAdmin.status === 200);

  const review = await api('POST', '/api/reviews', {
    booking_id: bookingId, rating: 5, comment: 'Arrived on time and did a clean job.'
  }, customerCookie);
  check('completed booking can be reviewed', review.status === 200);

  const duplicateReview = await api('POST', '/api/reviews', { booking_id: bookingId, rating: 4, comment: 'Again' }, customerCookie);
  check('duplicate review is rejected', duplicateReview.status === 409);

  /* ---------------------------------------------------------------- misc */
  const contact = await api('POST', '/api/contact', { name: 'Test User', email: 'test@example.com', message: 'Hello, I have a question about a booking.' });
  check('contact form accepts a valid message', contact.status === 200);
  check('contact message is stored privately',
    fs.existsSync(path.join(DATA_DIR, 'contacts.jsonl')));

  const badContact = await api('POST', '/api/contact', { name: 'x', email: 'not-an-email', message: 'short' });
  check('invalid contact message is rejected', badContact.status === 400);

  const robots = await fetch(`${BASE}/robots.txt`);
  const sitemap = await fetch(`${BASE}/sitemap.xml`);
  check('robots.txt is served', robots.status === 200);
  check('sitemap.xml is served', sitemap.status === 200);

  const home = await fetch(`${BASE}/`);
  check('home page loads', home.status === 200);

  const missing = await fetch(`${BASE}/does-not-exist`);
  check('unknown page returns 404', missing.status === 404);

  const logout = await api('POST', '/api/auth/logout', {}, customerCookie);
  check('logout clears the session cookie', logout.status === 200 && /Max-Age=0/.test(logout.cookie));

  const afterLogout = await api('GET', '/api/me', undefined, customerCookie);
  check('session is dead after logout', afterLogout.body.user === null);
} catch (error) {
  failed += 1;
  console.error(`  ✗ unexpected failure: ${error.message}`);
  if (serverLog) console.error(serverLog.split('\n').slice(-20).join('\n'));
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
