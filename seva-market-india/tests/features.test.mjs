/**
 * SEVA MARKET INDIA — marketplace feature tests (milestones 1–5):
 *   sessions & auth, provider onboarding + dashboard, reviews & ratings,
 *   and the SEO surface (robots/sitemap). These drive the real router and a
 *   fresh in-memory database, so a redirect + session-cookie round-trip is
 *   tested end to end without opening a socket.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeApp, request, makeDb } from './helpers.mjs';

const require = createRequire(import.meta.url);
const users = require('../src/models/user');
const sessions = require('../src/models/session');
const reviews = require('../src/models/review');
const providers = require('../src/models/provider');
const categories = require('../src/models/category');
const leads = require('../src/models/lead');
const services = require('../src/models/service');

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' };
const SEVA_SID = 'seva_sid';

/** A leaf service category (a listing lives on these, not parents). */
function leafCategory(db) {
  return categories.findAll(db).find((c) => c.parent_id !== null);
}

/** Pull the session token out of a Set-Cookie response header. */
function sessionToken(res) {
  const cookie = Array.isArray(res.headers['set-cookie'])
    ? res.headers['set-cookie'][0]
    : res.headers['set-cookie'];
  assert.ok(cookie, 'response should set a session cookie');
  return String(cookie).split(';')[0].split('=').slice(1).join('=');
}

function cookieHeader(token) {
  return { cookie: `${SEVA_SID}=${token}` };
}

async function signupProvider(app, { email, business = 'Web Flow Works', phone = '9123456789' }) {
  const cat = leafCategory(app.db);
  const res = await request(app, {
    method: 'POST', url: '/providers/new', headers: formHeaders,
    body: `business_name=${encodeURIComponent(business)}&category_id=${cat.id}&pin_code=781001&experience_years=4`
      + `&about=Demo+listing&contact_name=Ravi&email=${encodeURIComponent(email)}`
      + `&phone=${phone}&password=password123`,
  });
  assert.equal(res.statusCode, 303, 'signup should redirect after success');
  return sessionToken(res);
}

function providerFor(app, email) {
  const user = users.findByEmail(app.db, email);
  return providers.findByUserId(app.db, user.id);
}

function activeService(app, provider) {
  return services.searchServices(app.db, { query: provider.business_name }).items[0];
}

/* -------------------------------------------------------- sessions */
test('a session round-trips: create, resolve, then destroy', () => {
  const { db } = makeDb();
  const active = users.createUser(db, { email: 'a@example.com', fullName: 'A', password: 'password123', status: 'active' }).user;
  const pending = users.createUser(db, { email: 'p@example.com', fullName: 'P', password: 'password123' }).user;

  const session = sessions.create(db, active.id);
  assert.ok(session.token.length >= 32);
  assert.equal(sessions.userByToken(db, session.token).email, 'a@example.com');
  assert.throws(() => sessions.create(db, pending.id), /not active/);

  assert.equal(sessions.destroy(db, session.token), true);
  assert.equal(sessions.userByToken(db, session.token), null);
  db.close();
});

test('expired sessions are not honoured and are pruned on lookup', () => {
  const { db } = makeDb();
  const user = users.createUser(db, { email: 'x@example.com', fullName: 'X', password: 'password123', status: 'active' }).user;
  const old = sessions.create(db, user.id, { ttlSeconds: -60 });
  assert.equal(sessions.userByToken(db, old.token), null, 'an expired token must not resolve');
  assert.equal(sessions.count(db), 0, 'lookup should have pruned the expired row');
  db.close();
});

/* ------------------------------------------------ reviews & ratings */
test('a review rolls into the rating when approved, but not when pending', () => {
  const { db } = makeDb();
  const provider = providers.searchProviders(db, { pin: '781001' }).items[0];

  reviews.create(db, { providerId: provider.id, customerName: 'Anupam', rating: 5, comment: 'Excellent', approve: true });
  assert.equal(providers.findById(db, provider.id).rating_count, 1);
  assert.equal(providers.findById(db, provider.id).rating_avg, 5);

  reviews.create(db, { providerId: provider.id, customerName: 'Late', rating: 1, approve: false });
  assert.equal(providers.findById(db, provider.id).rating_count, 1, 'pending review must not count yet');
  db.close();
});

test('review validation rejects bad ratings and unknown providers', () => {
  const { db } = makeDb();
  const provider = providers.searchProviders(db, { pin: '781001' }).items[0];
  assert.throws(() => reviews.create(db, { providerId: 9999, customerName: 'A', rating: 5 }), /Unknown provider/);
  assert.throws(() => reviews.create(db, { providerId: provider.id, customerName: '', rating: 5 }), /name is required/);
  assert.throws(() => reviews.create(db, { providerId: provider.id, customerName: 'A', rating: 7 }), /between 1 and 5/);
  db.close();
});

/* --------------------------------------- onboarding via the web flow */
test('provider signup creates an account + live listing and opens the dashboard', async () => {
  const app = makeApp();
  const token = await signupProvider(app, { email: 'flow@example.com' });

  // No cookie: the dashboard must redirect to login.
  const anon = await request(app, { url: '/dashboard' });
  assert.equal(anon.statusCode, 303);
  assert.match(anon.headers.location, /\/login/);

  // With the cookie the provider dashboard renders.
  const dash = await request(app, { url: '/dashboard', headers: cookieHeader(token) });
  assert.equal(dash.statusCode, 200);
  assert.match(dash.body, /Provider dashboard/);
  assert.match(dash.body, /Web Flow Works/);

  // The listing is immediately findable by customers.
  const list = await request(app, { url: '/api/v1/providers?q=Web+Flow' });
  assert.ok(list.json().data.total >= 1);
  app.close();
});

test('login rejects bad passwords and grants a session for correct ones', async () => {
  const app = makeApp();
  await request(app, {
    method: 'POST', url: '/register', headers: formHeaders,
    body: 'full_name=Sam+Saha&email=sam@example.com&phone=9123456789&password=password123',
  });

  const bad = await request(app, {
    method: 'POST', url: '/login', headers: formHeaders,
    body: 'email=sam@example.com&password=wrongpass',
  });
  assert.equal(bad.statusCode, 200);
  assert.match(bad.body, /Incorrect email or password/);

  const good = await request(app, {
    method: 'POST', url: '/login', headers: formHeaders,
    body: 'email=sam@example.com&password=password123',
  });
  assert.equal(good.statusCode, 303);
  assert.ok(sessionToken(good).length > 0);
  app.close();
});

/* ------------------------------------------------ dashboard actions */
test('a provider adds a service, pauses it off the marketplace, and republishes', async () => {
  const app = makeApp();
  const email = 'pause@example.com';
  const token = await signupProvider(app, { email, business: 'Pause Works' });
  const cat = leafCategory(app.db);
  const header = { ...formHeaders, ...cookieHeader(token) };
  const provider = providerFor(app, email);

  const created = await request(app, {
    method: 'POST', url: '/dashboard/services', headers: header,
    body: `title=Leak+Repair&category_id=${cat.id}&price_min=200&price_max=500&price_unit=visit`,
  });
  assert.equal(created.statusCode, 303);
  // Re-fetch the provider (it owns the new service) and confirm it's live.
  const provider2 = providerFor(app, email);
  const svc = services.byProviderAll(app.db, provider2.id)[0];
  assert.ok(svc, 'the service should be created');
  assert.equal(svc.status, 'active');
  assert.ok(activeService(app, provider2), 'a published service must appear in search');

  const pause = await request(app, {
    method: 'POST', url: `/dashboard/services/${svc.slug}/status`, headers: header, body: 'status=paused',
  });
  assert.equal(pause.statusCode, 303);
  assert.equal(activeService(app, provider2), undefined, 'paused service must leave public search');

  await request(app, {
    method: 'POST', url: `/dashboard/services/${svc.slug}/status`, headers: header, body: 'status=active',
  });
  assert.ok(activeService(app, provider2), 'republishing restores it');

  // Provider can move an enquiry through its lifecycle.
  const lead = leads.createLead(app.db, { providerId: provider.id, name: 'Customer', phone: '9000000099' });
  await request(app, {
    method: 'POST', url: `/dashboard/leads/${lead.id}/status`, headers: header, body: 'status=contacted',
  });
  assert.equal(leads.findById(app.db, lead.id).status, 'contacted');
  app.close();
});

/* ------------------------------------------------------- reviews API */
test('the reviews API creates and lists an approved review', async () => {
  const app = makeApp();
  const provider = providers.searchProviders(app.db, { pin: '781001' }).items[0];
  const res = await request(app, {
    method: 'POST', url: `/api/v1/providers/${provider.slug}/reviews`,
    headers: { 'content-type': 'application/json' },
    body: { customer_name: 'Anu', rating: 4, comment: 'Good service' },
  });
  assert.equal(res.statusCode, 201);

  const detail = await request(app, { url: `/api/v1/providers/${provider.slug}/reviews` });
  const data = detail.json().data;
  assert.equal(data.rating_count, 1);
  assert.equal(data.items[0].customer_name, 'Anu');
  app.close();
});

/* ------------------------------------------- leads: service mismatch */
test('an enquiry referencing another provider\u2019s service is a 400, not a 500', async () => {
  const app = makeApp();
  const providerA = providers.searchProviders(app.db, { pin: '781001' }).items[0];
  const providerB = providers.searchProviders(app.db, { pin: '411038' }).items[0];
  const serviceOfB = services.byProvider(app.db, providerB.id)[0];

  const res = await request(app, {
    method: 'POST', url: '/api/v1/leads', headers: { 'content-type': 'application/json' },
    body: { provider_id: providerA.id, service_id: serviceOfB.id, name: 'A', phone: '9000000111' },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /does not belong/);
  app.close();
});

/* ------------------------------------------------------------- SEO */
test('robots.txt and sitemap.xml are served', async () => {
  const app = makeApp();
  const robots = await request(app, { url: '/robots.txt' });
  assert.equal(robots.statusCode, 200);
  assert.match(robots.headers['content-type'], /text\/plain/);
  assert.match(robots.body, /Sitemap:/);
  assert.match(robots.body, /Disallow: \/dashboard/);

  const sitemap = await request(app, { url: '/sitemap.xml' });
  assert.equal(sitemap.statusCode, 200);
  assert.match(sitemap.headers['content-type'], /application\/xml/);
  assert.match(sitemap.body, /<urlset/);
  assert.match(sitemap.body, /\/search\?category=plumber/);
  assert.match(sitemap.body, /\/providers\//);
  app.close();
});

/* -------------------------------- public profile & service pages */
test('public provider and service pages render for a live listing', async () => {
  const app = makeApp();
  const provider = providers.searchProviders(app.db, { pin: '781001' }).items[0];

  const providerPage = await request(app, { url: `/providers/${provider.slug}` });
  assert.equal(providerPage.statusCode, 200);
  assert.match(providerPage.body, /Leave a review/);

  const svc = services.byProvider(app.db, provider.id)[0];
  const servicePage = await request(app, { url: `/services/${svc.slug}` });
  assert.equal(servicePage.statusCode, 200);
  assert.match(servicePage.body, /Offered by/);
  app.close();
});
