/**
 * SEVA MARKET INDIA — HTTP layer tests.
 *
 * Drives the real router and handlers in-process (no socket), asserting
 * status codes, the JSON envelope, security headers, static-file handling
 * and error behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeApp, request } from './helpers.mjs';

const require = createRequire(import.meta.url);
const providers = require('../src/models/provider');

const app = makeApp();

/* ------------------------------------------------------------- routes */

test('the router exposes the documented API surface', () => {
  const routes = app.router.describe();
  for (const expected of [
    'GET /',
    'GET /search',
    'GET /categories',
    'GET /locations',
    'GET /api/v1/health',
    'GET /api/v1/health/deep',
    'GET /api/v1/locations',
    'GET /api/v1/locations/:id',
    'GET /api/v1/categories',
    'GET /api/v1/categories/:slug',
    'GET /api/v1/services',
    'GET /api/v1/services/:slug',
    'GET /api/v1/providers',
    'GET /api/v1/providers/:slug',
    'POST /api/v1/leads',
  ]) {
    assert.ok(routes.includes(expected), `missing route: ${expected}`);
  }
});

/* ------------------------------------------------------------- health */

test('GET /api/v1/health reports ok and proves the DB is reachable', async () => {
  const res = await request(app, { url: '/api/v1/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.status, 'ok');
  assert.equal(body.data.app, 'seva-market-india');
  assert.match(res.headers['content-type'], /application\/json/);
});

test('GET /api/v1/health/deep lists the schema tables', async () => {
  const res = await request(app, { url: '/api/v1/health/deep' });
  const body = res.json();
  assert.equal(body.data.status, 'ok');
  assert.ok(body.data.tables.includes('locations'));
  assert.ok(body.data.tables.includes('services'));
});

/* ---------------------------------------------------------- locations */

test('GET /api/v1/locations returns India and its states', async () => {
  const res = await request(app, { url: '/api/v1/locations' });
  const body = res.json();
  assert.equal(body.data.country.name, 'India');
  assert.equal(body.data.country.kind, 'country');
  assert.ok(body.data.total >= 8);
  assert.ok(body.data.items.every((row) => row.kind === 'state'));
});

test('GET /api/v1/locations?parent= drills down one level', async () => {
  const root = (await request(app, { url: '/api/v1/locations' })).json().data;
  const res = await request(app, { url: `/api/v1/locations?parent=${root.country.id}&kind=state` });
  const body = res.json();
  assert.ok(body.data.total >= 8);
  assert.ok(body.data.items.every((row) => row.kind === 'state' && row.parent_id === root.country.id));
});

test('GET /api/v1/locations?pin= resolves the full chain', async () => {
  const res = await request(app, { url: '/api/v1/locations?pin=560038' });
  const body = res.json();
  assert.equal(body.data.pin, '560038');
  assert.deepEqual(body.data.chain.map((node) => node.kind), ['country', 'state', 'district', 'city', 'locality', 'pincode']);
  assert.match(body.data.label, /Bengaluru/);
});

test('GET /api/v1/locations?pin= returns 404 for an unknown PIN', async () => {
  const res = await request(app, { url: '/api/v1/locations?pin=999999' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().ok, false);
});

test('GET /api/v1/locations?parent=abc returns 400 with field details', async () => {
  const res = await request(app, { url: '/api/v1/locations?parent=abc' });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.ok, false);
  assert.ok(body.error.details.parent, 'validation errors must name the offending field');
});

test('GET /api/v1/locations/:id returns breadcrumb and children', async () => {
  const root = (await request(app, { url: '/api/v1/locations' })).json().data;
  const assam = root.items.find((row) => row.name === 'Assam');
  const res = await request(app, { url: `/api/v1/locations/${assam.id}` });
  const body = res.json();
  assert.equal(body.data.name, 'Assam');
  assert.deepEqual(body.data.breadcrumb.map((node) => node.name), ['India', 'Assam']);
  assert.ok(body.data.children.length >= 3);
});

test('GET /api/v1/locations/999999 returns 404', async () => {
  const res = await request(app, { url: '/api/v1/locations/999999' });
  assert.equal(res.statusCode, 404);
});

/* --------------------------------------------------------- categories */

test('GET /api/v1/categories returns the nested tree with live counts', async () => {
  const res = await request(app, { url: '/api/v1/categories' });
  const body = res.json();
  assert.ok(body.data.total >= 8);
  const homeRepair = body.data.items.find((row) => row.slug === 'home-repair-maintenance');
  assert.ok(homeRepair.children.length >= 6);
  const plumber = homeRepair.children.find((row) => row.slug === 'plumber');
  assert.ok(plumber.service_count >= 2);
});

test('GET /api/v1/categories/:slug returns 404 for an unknown slug', async () => {
  const res = await request(app, { url: '/api/v1/categories/astrology' });
  assert.equal(res.statusCode, 404);
});

/* ----------------------------------------------------------- services */

test('GET /api/v1/services filters by category and PIN', async () => {
  const res = await request(app, { url: '/api/v1/services?category=plumber&pin=781001' });
  const body = res.json();
  assert.ok(body.data.total >= 1);
  assert.equal(body.data.filters.category, 'plumber');
  assert.equal(body.data.filters.pin, '781001');
  assert.ok(body.data.items.every((item) => item.category_slug === 'plumber'));
  assert.ok(body.data.items[0].phone, 'contact number must be present');
});

test('GET /api/v1/services paginates', async () => {
  const res = await request(app, { url: '/api/v1/services?limit=3&page=1' });
  const body = res.json();
  assert.equal(body.data.pageSize, 3);
  assert.ok(body.data.items.length <= 3);
  assert.ok(body.data.pages >= 1);
});

test('GET /api/v1/services clamps an absurd page size', async () => {
  const res = await request(app, { url: '/api/v1/services?limit=99999' });
  assert.equal(res.json().data.pageSize, 100);
});

test('GET /api/v1/services/:slug returns one service', async () => {
  const list = (await request(app, { url: '/api/v1/services?limit=1' })).json().data;
  const res = await request(app, { url: `/api/v1/services/${list.items[0].slug}` });
  const body = res.json();
  assert.equal(body.data.slug, list.items[0].slug);
  assert.ok(body.data.business_name);
});

test('GET /api/v1/services/does-not-exist returns 404', async () => {
  const res = await request(app, { url: '/api/v1/services/does-not-exist' });
  assert.equal(res.statusCode, 404);
});

/* ---------------------------------------------------------- providers */

test('GET /api/v1/providers includes coverage PINs', async () => {
  const res = await request(app, { url: '/api/v1/providers?pin=781001' });
  const body = res.json();
  assert.ok(body.data.total >= 1);
  assert.ok(Array.isArray(body.data.items[0].service_areas));
});

test('GET /api/v1/providers?verified=1 filters to verified listings', async () => {
  const res = await request(app, { url: '/api/v1/providers?verified=1' });
  const body = res.json();
  assert.ok(body.data.total >= 1);
  assert.ok(body.data.items.every((item) => item.is_verified === true));
});

test('GET /api/v1/providers/:slug returns the profile with services', async () => {
  const list = (await request(app, { url: '/api/v1/providers?limit=1' })).json().data;
  const res = await request(app, { url: `/api/v1/providers/${list.items[0].slug}` });
  const body = res.json();
  assert.equal(body.data.slug, list.items[0].slug);
  assert.ok(body.data.services.length >= 1);
});

test('the public provider API never returns dashboard-private fields', async () => {
  // Real providers fill these in; the dashboard form labels the street
  // address "shown only to you", and the HTML pages never print them.
  const { items } = (await request(app, { url: '/api/v1/providers?limit=1' })).json().data;
  const providerId = items[0].id;
  app.db.run(
    `UPDATE providers SET email = ?, address_line = ?, contact_name = ? WHERE id = ?`,
    ['owner@example.com', 'Flat 9, Secret Lane, Guwahati', 'Hidden Contact Person', providerId],
  );

  const detail = (await request(app, { url: `/api/v1/providers/${items[0].slug}` })).json().data;
  for (const secret of ['email', 'address_line', 'contact_name']) {
    assert.ok(!(secret in detail), `detail must not expose ${secret}`);
  }
  assert.ok(detail.business_name, 'public identity fields survive');
  assert.ok(detail.phone, 'the call number stays public (product choice)');

  const listAgain = (await request(app, { url: '/api/v1/providers?limit=1' })).json().data;
  for (const secret of ['email', 'address_line', 'contact_name']) {
    assert.ok(!(secret in listAgain.items[0]), `list items must not expose ${secret}`);
  }
});

/* -------------------------------------------------------------- leads */

test('POST /api/v1/leads creates an enquiry and returns 201', async () => {
  const providerId = (await request(app, { url: '/api/v1/providers?limit=1' })).json().data.items[0].id;
  const res = await request(app, {
    method: 'POST',
    url: '/api/v1/leads',
    headers: { 'content-type': 'application/json' },
    body: { provider_id: providerId, name: 'Anupam Sharma', phone: '9000012345', pin_code: '781001', message: 'Tap is leaking' },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.status, 'received');
  assert.ok(body.data.id >= 1);
  // Prove the row actually landed in the database, not just in the response.
  const stored = app.db.get('SELECT name, phone, status FROM leads WHERE id = ?', [body.data.id]);
  assert.equal(stored.name, 'Anupam Sharma');
  assert.equal(stored.phone, '9000012345');
  assert.equal(stored.status, 'new');
});

test('POST /api/v1/leads validates every field and names them', async () => {
  const providerId = (await request(app, { url: '/api/v1/providers?limit=1' })).json().data.items[0].id;
  const res = await request(app, {
    method: 'POST',
    url: '/api/v1/leads',
    headers: { 'content-type': 'application/json' },
    body: { provider_id: providerId, name: '', phone: '123', pin_code: '99' },
  });
  assert.equal(res.statusCode, 400);
  const details = res.json().error.details;
  assert.ok(details.name, 'name error expected');
  assert.ok(details.phone, 'phone error expected');
  assert.ok(details.pin_code, 'pin error expected');
});

test('POST /api/v1/leads requires a provider id', async () => {
  const res = await request(app, {
    method: 'POST',
    url: '/api/v1/leads',
    headers: { 'content-type': 'application/json' },
    body: { name: 'A', phone: '9000012345' },
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.json().error.details.provider_id);
});

test('POST /api/v1/leads rejects malformed JSON with 400', async () => {
  const res = await request(app, {
    method: 'POST',
    url: '/api/v1/leads',
    headers: { 'content-type': 'application/json' },
    body: '{"provider_id": 1, ',
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /Malformed request body/);
});

test('POST /api/v1/leads rate-limits a single IP', async () => {
  const providerId = (await request(app, { url: '/api/v1/providers?limit=1' })).json().data.items[0].id;
  const payload = { provider_id: providerId, name: 'Spammer', phone: '9000099999' };
  const options = { method: 'POST', url: '/api/v1/leads', headers: { 'content-type': 'application/json' }, ip: '198.51.100.7' };

  const statuses = [];
  for (let i = 0; i < 7; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    statuses.push((await request(app, { ...options, body: payload })).statusCode);
  }
  assert.equal(statuses.filter((code) => code === 201).length, 5, 'the first five go through');
  assert.ok(statuses.includes(429), 'the sixth must be throttled');
});

test('POST /api/v1/leads throttles per client IP behind a trusted proxy', async () => {
  // On Render (TRUST_PROXY_HOPS=1) every request arrives from the edge's
  // address; the throttle and stored ip_hash must key on the X-Forwarded-For
  // client, otherwise one visitor's burst blocks the whole API for an hour.
  const proxied = makeApp({ trustProxyHops: 1 });
  const providerId = (await request(proxied, { url: '/api/v1/providers?limit=1' })).json().data.items[0].id;
  const payload = { provider_id: providerId, name: 'Amit', phone: '9000011223' };
  const common = { method: 'POST', url: '/api/v1/leads', headers: { 'content-type': 'application/json' }, ip: '203.0.113.9' };
  const fromClient = (xff) => request(proxied, { ...common, headers: { ...common.headers, 'x-forwarded-for': xff }, body: payload });

  const first = [];
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    first.push((await fromClient('198.51.100.7')).statusCode);
  }
  assert.equal(first.filter((code) => code === 201).length, 5, 'client A gets five enquiries');
  assert.equal(first.at(-1), 429, 'client A is throttled on the sixth');

  const otherClient = await fromClient('198.51.100.8');
  assert.equal(otherClient.statusCode, 201, 'client B behind the same edge is not throttled');

  // The stored hashes must also differ per client, not per edge.
  const hashes = proxied.db.all('SELECT DISTINCT ip_hash FROM leads').map((row) => row.ip_hash);
  assert.equal(hashes.length, 2, 'one hash per client IP, not one for the whole edge');
});

/* ------------------------------------------------------ error surface */

test('unknown API paths return a JSON 404', async () => {
  const res = await request(app, { url: '/api/v1/nope' });
  assert.equal(res.statusCode, 404);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.json().ok, false);
});

test('unknown pages return an HTML 404', async () => {
  const res = await request(app, { url: '/this-page-does-not-exist' });
  assert.equal(res.statusCode, 404);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /404/);
});

test('a wrong method returns 405 with an accurate Allow header', async () => {
  const res = await request(app, { method: 'DELETE', url: '/api/v1/health' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, HEAD', 'Allow must list what the path really accepts');

  const postOnly = await request(app, { method: 'GET', url: '/api/v1/leads' });
  assert.equal(postOnly.statusCode, 405);
  assert.equal(postOnly.headers.allow, 'POST');
});

test('HEAD returns the same headers as GET but no body', async () => {
  const head = await request(app, { method: 'HEAD', url: '/' });
  const get = await request(app, { method: 'GET', url: '/' });
  assert.equal(head.statusCode, 200, 'HEAD must not be a 405');
  assert.equal(head.body, '', 'HEAD must not send a body');
  assert.equal(head.headers['content-length'], get.headers['content-length'], 'Content-Length must match GET');
  assert.match(head.headers['content-type'], /text\/html/);

  const apiHead = await request(app, { method: 'HEAD', url: '/api/v1/health' });
  assert.equal(apiHead.statusCode, 200);
  assert.equal(apiHead.body, '');
});

test('a handler that throws leaks nothing to the client', async () => {
  app.router.get('/api/v1/__boom', () => {
    throw new Error('secret internal detail');
  });
  const res = await request(app, { url: '/api/v1/__boom' });
  assert.equal(res.statusCode, 500);
  assert.ok(!res.body.includes('secret internal detail'), 'internals must not reach the client');
  assert.match(res.json().error.message, /Reference [0-9a-f]{6}/);
});

test('malformed URLs are rejected with 400', async () => {
  const res = await request(app, { url: 'http://[bad' });
  assert.equal(res.statusCode, 400);
});

/* ------------------------------------------------------------- static */

test('static assets are served with the right content type', async () => {
  const res = await request(app, { url: '/assets/css/main.css' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/css/);
  assert.match(res.body, /SEVA MARKET INDIA/);
  assert.equal(res.headers['cache-control'], 'public, max-age=3600');
});

test('the enhancement script is served as JavaScript', async () => {
  const res = await request(app, { url: '/assets/js/main.js' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /javascript/);
});

test('path traversal outside public/ is refused', async () => {
  const res = await request(app, { url: '/assets/../../server.js' });
  assert.equal(res.statusCode, 404);
  assert.ok(!res.body.includes('createApp'));
});

test('HEAD on a static asset returns headers without a body', async () => {
  const res = await request(app, { method: 'HEAD', url: '/assets/css/main.css' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '');
  assert.ok(Number(res.headers['content-length']) > 0);
});

/* ---------------------------------------------------- security headers */

test('HTML responses carry a strict Content-Security-Policy', async () => {
  const res = await request(app, { url: '/' });
  assert.equal(res.statusCode, 200);
  const csp = res.headers['content-security-policy'];
  assert.ok(csp, 'CSP header missing');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!csp.includes('unsafe-eval'), 'no eval anywhere');
});

test('JSON responses do not carry a CSP but do carry nosniff', async () => {
  const res = await request(app, { url: '/api/v1/health' });
  assert.equal(res.headers['content-security-policy'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('every response sets the baseline security headers', async () => {
  for (const url of ['/', '/search', '/api/v1/health']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, { url });
    assert.equal(res.headers['x-frame-options'], 'DENY', `${url}: X-Frame-Options`);
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin', `${url}: Referrer-Policy`);
    assert.ok(res.headers['permissions-policy'], `${url}: Permissions-Policy`);
  }
});

test('X-Forwarded-For is only trusted for the configured hop count', async () => {
  const { clientIp } = require('../src/http/security');
  const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(clientIp(req, 0), '10.0.0.1', 'with no trusted proxy the socket wins');
  assert.equal(clientIp(req, 1), '5.6.7.8', 'one trusted hop takes the last entry');
  assert.equal(clientIp(req, 2), '1.2.3.4');
});
