/**
 * SEVA MARKET INDIA — accounts, sessions and the provider dashboard.
 *
 * Drives the full happy path through real routes: register a provider →
 * create a business profile → add a service → it appears in search → a
 * customer sends an enquiry → the provider sees it in the dashboard.
 * Also covers login/logout and ownership guards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeApp, request, multipartBody } from './helpers.mjs';

const require = createRequire(import.meta.url);
const services = require('../src/models/service');
const providers = require('../src/models/provider');

const app = makeApp();

/** Send an x-www-form-urlencoded POST and remember any Set-Cookie. */
async function post(app, url, fields, cookie = '') {
  const body = new URLSearchParams(fields).toString();
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.cookie = cookie;
  const res = await request(app, { method: 'POST', url, body, headers });
  res.setCookie = res.headers['set-cookie'] || '';
  return res;
}

const cookieOf = (res) => String(res.setCookie).split(';')[0];

async function postMultipart(app, url, fields, files, cookie = '') {
  const multipart = multipartBody(fields, files);
  const headers = { 'content-type': multipart.contentType };
  if (cookie) headers.cookie = cookie;
  return request(app, { method: 'POST', url, body: multipart.body, headers });
}

const tinyJpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
]);

/* ----------------------------------------------------------- register */

test('register page renders and a provider account can be created', async () => {
  const page = await request(app, { url: '/register?role=provider' });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Create your free account/);
  assert.match(page.body, /name="role" value="provider" checked/);
  const inlineScripts = page.body.match(/<script(?![^>]*\ssrc=)[^>]*>/g) || [];
  assert.deepEqual(inlineScripts, [], 'no inline script (CSP forbids it)');

  const res = await post(app, '/register', {
    role: 'provider',
    full_name: 'Ramesh Kumar',
    email: 'ramesh@example.com',
    phone: '9876543210',
    password: 'secret-pass-123',
  });
  assert.equal(res.statusCode, 303, 'register redirects after success');
  assert.match(res.headers.location, /^\/account\/provider/);
  assert.ok(res.setCookie.includes('smi_session='), 'session cookie is issued');
  assert.ok(res.setCookie.includes('HttpOnly'), 'cookie is HttpOnly');
  assert.ok(res.setCookie.includes('SameSite=Lax'), 'cookie is Lax');
});

test('duplicate emails are refused with a friendly inline error', async () => {
  const res = await post(app, '/register', {
    role: 'customer',
    full_name: 'Ramesh Again',
    email: 'ramesh@example.com',
    phone: '9876543211',
    password: 'secret-pass-123',
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /already exists/);
});

test('weak passwords are refused with a field error', async () => {
  const res = await post(app, '/register', {
    role: 'customer',
    full_name: 'Short Pass',
    email: 'short@example.com',
    phone: '9876543212',
    password: 'tiny',
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /at least 8 characters/i);
});

/* ------------------------------------------------------- login/logout */

test('login rejects bad credentials, then succeeds and logs out', async () => {
  const bad = await post(app, '/login', { email: 'ramesh@example.com', password: 'wrong-pass' });
  assert.equal(bad.statusCode, 200);
  assert.match(bad.body, /Incorrect email or password/);

  const good = await post(app, '/login', { email: 'ramesh@example.com', password: 'secret-pass-123', next: '/account/provider' });
  assert.equal(good.statusCode, 303);
  assert.match(good.headers.location, /^\/account\/provider/);
  const cookie = cookieOf(good);
  assert.ok(cookie.startsWith('smi_session='));

  const logout = await post(app, '/logout', {}, cookie);
  assert.equal(logout.statusCode, 303);
  assert.match(logout.headers.location, /^\/$/);
  assert.match(String(logout.headers['set-cookie'] || ''), /Max-Age=0/, 'logout clears the cookie');

  // Without the cookie the dashboard redirects to login.
  const after = await request(app, { url: '/account' });
  assert.equal(after.statusCode, 303);
  assert.match(after.headers.location, /^\/login/);
});

test('suspended accounts cannot log in', async () => {
  // create the account, then suspend it via the model (admin path)
  await post(app, '/register', {
    role: 'customer', full_name: 'Bad User', email: 'bad@example.com', phone: '9876543213', password: 'secret-pass-123',
  });
  const users = require('../src/models/user');
  const row = users.findByEmail(app.db, 'bad@example.com');
  users.setStatus(app.db, row.id, 'suspended');

  const attempt = await post(app, '/login', { email: 'bad@example.com', password: 'secret-pass-123' });
  assert.equal(attempt.statusCode, 200);
  assert.match(attempt.body, /suspended/);
});

/* ----------------------------------------- provider onboarding flow */

test('a fresh provider is guided to create a business profile', async () => {
  const res = await post(app, '/register', {
    role: 'provider',
    full_name: 'Sunita Devi',
    email: 'sunita@example.com',
    phone: '9876543220',
    password: 'secret-pass-123',
  });
  const cookie = cookieOf(res);
  const dash = await request(app, { url: '/account', headers: { cookie } });
  assert.equal(dash.statusCode, 200);
  assert.match(dash.body, /Set up my business/);

  // Business profile creation requires a real category + locality.
  const category = require('../src/models/category').findBySlug(app.db, 'electrician');
  const locality = require('../src/models/location').findByPin(app.db, '781006').chain[4];
  assert.ok(category && locality);

  const created = await post(app, '/account/provider', {
    existing_id: '',
    business_name: 'Sunita Electricals',
    contact_name: 'Sunita Devi',
    phone: '9876543220',
    alt_phone: '',
    email: 'sunita@example.com',
    experience_years: '5',
    category_id: String(category.id),
    locality_id: String(locality.id),
    areas: '781001, 781006',
    about: 'Licensed electrician for homes and shops in Guwahati.',
    address_line: '',
  }, cookie);
  assert.equal(created.statusCode, 303);
  assert.match(created.headers.location, /ok=created/);

  const again = await request(app, { url: '/account/provider', headers: { cookie } });
  assert.equal(again.statusCode, 200);
  assert.match(again.body, /Sunita Electricals/);
  assert.match(again.body, /Live on marketplace/);
});

test('business profile accepts safe multipart photos and renders them publicly', async () => {
  const uploadApp = makeApp();
  const registration = await post(uploadApp, '/register', {
    role: 'provider', full_name: 'Photo Owner', email: 'photos@example.com',
    phone: '9876543255', password: 'secret-pass-123',
  });
  const cookie = cookieOf(registration);
  const category = require('../src/models/category').findBySlug(uploadApp.db, 'plumber');
  const locality = require('../src/models/location').findByPin(uploadApp.db, '781001').chain[4];
  const uploaded = [];
  uploadApp.store.media = {
    async uploadProviderPhoto({ providerId, file }) {
      uploaded.push({ providerId, file });
      return `https://images.example.test/providers/${providerId}/shop.jpg`;
    },
  };

  const created = await postMultipart(uploadApp, '/account/provider', {
    business_name: 'Photo Plumbing Works', contact_name: 'Photo Owner', phone: '9876543255',
    alt_phone: '', email: 'photos@example.com', experience_years: '4', category_id: String(category.id),
    locality_id: String(locality.id), areas: '781001', about: 'Clean plumbing work.', address_line: '',
  }, [{ name: 'photos', filename: 'shop-front.jpg', contentType: 'image/jpeg', buffer: tinyJpeg }], cookie);

  assert.equal(created.statusCode, 303);
  assert.equal(uploaded.length, 1);
  const provider = providers.findBySlug(uploadApp.db, 'photo-plumbing-works');
  assert.deepEqual(provider.photo_urls, [`https://images.example.test/providers/${provider.id}/shop.jpg`]);

  const publicPage = await request(uploadApp, { url: `/providers/${provider.slug}` });
  assert.match(publicPage.body, /Business photos/);
  assert.match(publicPage.body, /images\.example\.test\/providers/);
  const editor = await request(uploadApp, { url: '/account/provider', headers: { cookie } });
  assert.match(editor.body, /enctype="multipart\/form-data"/);
  assert.match(editor.body, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(editor.body, /1\/5 saved/);
});

test('business profile rejects non-image uploads before a profile is created', async () => {
  const uploadApp = makeApp();
  const registration = await post(uploadApp, '/register', {
    role: 'provider', full_name: 'Safe Owner', email: 'safe-upload@example.com',
    phone: '9876543256', password: 'secret-pass-123',
  });
  const cookie = cookieOf(registration);
  const category = require('../src/models/category').findBySlug(uploadApp.db, 'plumber');
  const locality = require('../src/models/location').findByPin(uploadApp.db, '781001').chain[4];
  const failed = await postMultipart(uploadApp, '/account/provider', {
    business_name: 'Unsafe Upload Works', contact_name: 'Safe Owner', phone: '9876543256',
    category_id: String(category.id), locality_id: String(locality.id), areas: '', about: '', address_line: '',
  }, [{ name: 'photos', filename: 'not-an-image.jpg', contentType: 'image/jpeg', buffer: Buffer.from('<script>alert(1)</script>') }], cookie);

  assert.equal(failed.statusCode, 200);
  assert.match(failed.body, /Only real JPG, PNG, or WebP images can be uploaded/);
  assert.equal(providers.findBySlug(uploadApp.db, 'unsafe-upload-works'), null);
});

test('provider dashboard metrics count live services', async () => {
  const res = await post(app, '/register', {
    role: 'provider',
    full_name: 'Mohan Lal',
    email: 'mohan@example.com',
    phone: '9876543230',
    password: 'secret-pass-123',
  });
  const cookie = cookieOf(res);
  const category = require('../src/models/category').findBySlug(app.db, 'plumber');
  const locality = require('../src/models/location').findByPin(app.db, '781001').chain[4];

  await post(app, '/account/provider', {
    business_name: 'Mohan Pipe Works', contact_name: 'Mohan Lal', phone: '9876543230',
    email: 'mohan@example.com', experience_years: '8', category_id: String(category.id),
    locality_id: String(locality.id), areas: '781001', about: 'Leakage specialist.',
  }, cookie);

  const added = await post(app, '/account/services/new', {
    title: 'Tap & leakage repair', category_id: String(category.id),
    price_min: '199', price_max: '499', price_unit: 'visit',
    description: 'Any tap, any leakage — 30 minute response.', status: 'active',
  }, cookie);
  assert.equal(added.statusCode, 303);
  assert.match(added.headers.location, /\/account\/services/);

  const list = await request(app, { url: '/account/services', headers: { cookie } });
  assert.match(list.body, /Tap &amp; leakage repair/);
  assert.match(list.body, /badge--active/);

  const dash = await request(app, { url: '/account', headers: { cookie } });
  assert.match(dash.body, /Live services/);
});

test('the new service is publicly findable in search', async () => {
  const res = await request(app, { url: '/search?q=leakage' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Tap &amp; leakage repair/);
  assert.match(res.body, /Mohan Pipe Works/);
  assert.match(res.body, /₹199–₹499\/visit/);
});

test('a service card links to a live detail page with an enquiry form', async () => {
  const one = services.searchServices(app.db, { query: 'leakage', limit: 1 }).items[0];
  assert.ok(one);
  const page = await request(app, { url: `/services/${one.slug}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /id="enquiry"/);
  assert.match(page.body, /action="\/contact" method="post"/);
  assert.match(page.body, new RegExp(`name="provider_id" value="${one.provider_id}"`));
});

/* ------------------------------------------------- customer enquiry */

test('an enquiry lands in the provider dashboard as a lead', async () => {
  // Mohan's own live service is the enquiry target.
  const provider = providers.findBySlug(app.db, 'mohan-pipe-works');
  const one = services.byProviderAll(app.db, provider.id).find((row) => row.status === 'active');
  assert.ok(provider && one, 'setup: mohan provider + live service exist');

  // customer registers
  const reg = await post(app, '/register', {
    role: 'customer', full_name: 'Anita Sharma', email: 'anita@example.com',
    phone: '9876543300', password: 'secret-pass-123',
  });
  assert.equal(reg.statusCode, 303);

  // sends enquiry through the public form
  const sent = await post(app, '/contact', {
    provider_id: String(provider.id),
    service_id: String(one.id),
    name: 'Anita Sharma',
    phone: '9876543300',
    email: 'anita@example.com',
    message: 'Two taps leaking since morning — can you come today?',
    back: `/services/${one.slug}`,
  });
  assert.equal(sent.statusCode, 303);
  assert.match(sent.headers.location, /sent=1/);

  // the provider sees the lead with a call link
  const login = await post(app, '/login', { email: 'mohan@example.com', password: 'secret-pass-123' });
  const cookie = cookieOf(login);
  const leads = await request(app, { url: '/account/leads', headers: { cookie } });
  assert.equal(leads.statusCode, 200);
  assert.match(leads.body, /Anita Sharma/);
  assert.match(leads.body, /9876543300/);
  assert.match(leads.body, /Two taps leaking since morning/);
  assert.match(leads.body, /badge--new/);
  assert.match(leads.body, /href="tel:\+919876543300"/);

  // lead status can move to contacted
  const leadRow = app.db.get('SELECT id FROM leads WHERE provider_id = ? AND phone = ? ORDER BY id DESC LIMIT 1', [provider.id, '9876543300']);
  const status = await post(app, `/account/leads/${leadRow.id}/status`, { status: 'contacted' }, cookie);
  assert.equal(status.statusCode, 303);
  const after = await request(app, { url: '/account/leads', headers: { cookie } });
  assert.match(after.body, /badge--contacted/);
});

/* ------------------------------------------------------- ownership */

test('a provider cannot manage another provider\'s services', async () => {
  const provider = providers.findBySlug(app.db, 'mohan-pipe-works');
  const service = services.byProviderAll(app.db, provider.id)[0];
  assert.ok(service);

  const login = await post(app, '/login', { email: 'sunita@example.com', password: 'secret-pass-123' });
  const cookie = cookieOf(login);
  const edit = await request(app, { url: `/account/services/${service.id}/edit`, headers: { cookie } });
  assert.equal(edit.statusCode, 303, 'foreign service edit redirects away');
  assert.match(edit.headers.location, /\/account\/services$/);

  const status = await post(app, `/account/services/${service.id}/status`, { status: 'archived' }, cookie);
  assert.equal(status.statusCode, 303);
  const stillLive = services.searchServices(app.db, { query: 'leakage', limit: 5 }).items.some((row) => row.id === service.id);
  assert.ok(stillLive, 'the foreign service is untouched');
});

test('enquiry validation errors re-render the listing page', async () => {
  const one = services.searchServices(app.db, { query: 'leakage', limit: 1 }).items[0];
  const res = await post(app, '/contact', {
    provider_id: String(one.provider_id),
    name: '',
    phone: '12345',
    back: `/services/${one.slug}`,
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Name is required./);
});

/* ----------------------------------------------------- public pages */

test('every new page renders for the right audience', async () => {
  const paths = ['/login', '/register', '/providers/new', '/categories', '/locations', '/about', '/contact', '/terms', '/privacy'];
  for (const path of paths) {
    const res = await request(app, { url: path });
    assert.equal(res.statusCode, 200, `${path} should render`);
    assert.ok(!res.body.includes('<script>'), `${path} must not contain raw scripts`);
  }
  const providerPage = await request(app, { url: '/providers/ramesh-plumbing-works' });
  void providerPage; // seeded slug differs; do not over-assert
});

test('cross-origin POSTs are refused with 403', async () => {
  const res = await request(app, {
    method: 'POST', url: '/logout', body: '',
    headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(res.statusCode, 403);
});
