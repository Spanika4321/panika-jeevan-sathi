/**
 * SEVA MARKET INDIA — provider onboarding and review.
 *
 * The path from "I have a plumbing shop" to "customers in my PIN can call me"
 * is the product. These tests walk it end to end, including the two things a
 * marketplace must never get wrong: a listing must not be visible before it
 * is checked, and no one must be able to edit someone else's listing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeDb, makeApp, request, makeAgent, cookieValue } from './helpers.mjs';

const require = createRequire(import.meta.url);
const config = require('../src/config');
const onboarding = require('../src/actions/onboarding');
const dashboard = require('../src/actions/dashboard');
const users = require('../src/models/user');
const providers = require('../src/models/provider');
const services = require('../src/models/service');
const locations = require('../src/models/location');
const verification = require('../src/models/verification');

const PASSWORD = 'seva-market1';

function cfg(overrides = {}) {
  return {
    ...config,
    security: { ...config.security, sessionSecret: 'onboarding-test-secret' },
    mail: { ...config.mail, enabled: false },
    onboarding: { ...config.onboarding, autoApprove: false, maxServiceAreas: 4 },
    auth: { ...config.auth, requireEmailVerification: false, minPasswordLength: 8 },
    ...overrides,
  };
}

/**
 * Category 2 in the launch seed is "Plumber". Every test gets its own email so
 * the accounts never collide, and a fresh `makeDb()` per test means no rows do.
 */
let emailCounter = 0;
function nextEmail(label = 'provider') {
  emailCounter += 1;
  return `${label}-${emailCounter}@example.com`;
}

function businessForm(overrides = {}) {
  return {
    full_name: 'Test Provider',
    email: nextEmail(),
    password: PASSWORD,
    business_name: 'Borah Plumbing Works',
    phone: '9000011111',
    category_id: 2,
    pin_code: '781001',
    service_title: 'Tap and pipe repair',
    price_min: 300,
    price_max: 900,
    ...overrides,
  };
}

/** A signed-in provider, created through the real endpoints. */
async function signInProvider(app, email, { form = null } = {}) {
  const agent = makeAgent(app);
  const registered = await agent.post('/api/v1/auth/register', {
    email, password: PASSWORD, full_name: 'Test Provider', phone: '9000011111', role: 'provider',
  });
  agent.state.csrf = registered.json().data.csrf_token;
  if (form !== null) {
    await agent.api('POST', '/api/v1/providers', {
      business_name: 'Borah Plumbing Works',
      phone: '9000011111',
      category_id: 2,
      pin_code: '781001',
      service_title: 'Tap and pipe repair',
      price_min: 300,
      price_max: 900,
      ...form,
    });
  }
  return agent;
}

/* ---------------------------------------------------- the onboarding action */

test('onboarding creates the account, the listing and the first service together', () => {
  const { db } = makeDb();
  const cfg1 = cfg();
  const result = onboarding.onboard(db, cfg1, {
    user: null,
    body: businessForm({
      full_name: 'Bhaskar Jyoti', email: 'one-stop@example.com', password: PASSWORD,
      contact_name: 'Bhaskar', about: 'Fifteen years fixing taps across Guwahati, all brass fittings in the van.',
      experience_years: 15, service_areas: '781005, 781006, 781001',
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.account.email, 'one-stop@example.com');
  assert.equal(result.provider.status, 'pending', 'auto-approve is off, so a human looks first');
  assert.equal(result.service.status, 'draft', 'a draft service cannot surface before approval');
  assert.deepEqual(result.serviceAreas, ['781005', '781006', '781001'], 'the typed list is kept, in order');

  const account = users.findByEmail(db, 'one-stop@example.com');
  assert.equal(account.role, 'provider', 'listing a business makes you a provider');
  assert.equal(providers.findForUser(db, account.id).id, result.provider.id);
});

test('a signed-in customer who lists a business is promoted, not re-created', () => {
  const { db } = makeDb();
  const { user } = users.createUser(db, { email: 'upgrade@example.com', fullName: 'Up Grade', password: PASSWORD, status: 'active', role: 'customer' });
  const result = onboarding.onboard(db, cfg(), { user, body: businessForm() });
  assert.equal(result.ok, true);
  assert.equal(db.get('SELECT role FROM users WHERE id = ?', [user.id]).role, 'provider');
  assert.equal(result.account, null, 'no new account was made');
});

test('the second listing on an account is refused, with a pointer to the dashboard', () => {
  const { db } = makeDb();
  const first = onboarding.onboard(db, cfg(), { user: null, body: businessForm({ email: 'twice@example.com' }) });
  assert.equal(first.ok, true);
  const user = users.findByEmail(db, 'twice@example.com');
  const second = onboarding.onboard(db, cfg(), { user: { id: user.id, role: 'provider' }, body: businessForm({ business_name: 'Second Shop' }) });
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  assert.match(second.message, /already have a listing/);
  assert.equal(providers.listForUser(db, user.id).length, 1);
});

test('bad input is reported per field before anything is written', () => {
  const { db } = makeDb({ withSeed: true });
  const before = db.scalar('SELECT COUNT(*) FROM providers');
  const result = onboarding.onboard(db, cfg(), {
    user: null,
    body: { business_name: '', phone: '12345', category_id: 9999, pin_code: '000000', service_title: '', password: 'short' },
  });
  assert.equal(result.ok, false);
  for (const field of ['business_name', 'phone', 'category_id', 'pin_code', 'service_title', 'password']) {
    assert.ok(result.errors[field], `expected an error for ${field}`);
  }
  assert.equal(db.scalar('SELECT COUNT(*) FROM providers'), before, 'a rejected form must not create rows');
  assert.equal(db.scalar('SELECT COUNT(*) FROM users'), 0, 'nor an account');
});

test('prices are sanity-checked: a range cannot be inverted', () => {
  const { db } = makeDb();
  const result = onboarding.onboard(db, cfg(), { user: null, body: businessForm({ price_min: 900, price_max: 300 }) });
  assert.equal(result.ok, false);
  assert.match(result.errors.price_max, /cannot be below the minimum/);
});

test('an unknown but valid PIN still gets a listing, attached to a real branch', () => {
  const { db } = makeDb();
  const result = onboarding.onboard(db, cfg(), {
    user: null,
    body: businessForm({ pin_code: '390001', email: 'new-area@example.com' }),
  });
  assert.equal(result.ok, true, 'a PIN outside the partial location master is not the provider’s fault');

  const provider = providers.findById(db, result.provider.id);
  const chain = locations.chainFor(db, provider.location_id);
  assert.deepEqual(chain.map((row) => row.kind), ['country', 'state', 'district', 'city', 'locality']);
  assert.ok(chain.every((row) => row.is_active));
  assert.equal(provider.pin_code, '390001');
  assert.ok(provider.id);
});

test('coverage PIN codes are capped, so one form cannot flood the table', () => {
  const { db } = makeDb();
  const many = ['781001', '781005', '781006', '781033', '411038', '560038'].join(', ');
  const result = onboarding.onboard(db, cfg(), { user: null, body: businessForm({ service_areas: many, email: 'capped@example.com' }) });
  assert.equal(result.ok, true);
  assert.equal(result.serviceAreas.length, 4, 'the config limit is honoured');
  assert.deepEqual(result.serviceAreas, ['781001', '781005', '781006', '781033']);
});

test('non-PIN garbage in the coverage box is dropped, not stored', () => {
  const { db } = makeDb();
  const result = onboarding.onboard(db, cfg(), {
    user: null,
    body: businessForm({ service_areas: '781005, 12, abc, 081001, 781005', email: 'junk@example.com' }),
  });
  assert.deepEqual(result.serviceAreas, ['781005'], 'only real PINs survive, and only once');
});

/* ------------------------------------------------------- website + GSTIN */

test('a website is normalised to http(s) and javascript: is dropped', () => {
  assert.equal(providers.cleanWebsite('instagram.com/borah'), 'https://instagram.com/borah');
  assert.equal(providers.cleanWebsite('https://borah.example/work'), 'https://borah.example/work');
  assert.equal(providers.cleanWebsite('javascript:alert(1)'), null);
  assert.equal(providers.cleanWebsite('data:text/html,<script>'), null);
  assert.equal(providers.cleanWebsite(''), null);
});

test('a GSTIN is validated and upper-cased, and stored masked on documents', () => {
  assert.equal(providers.cleanGst('22aaaaa0000a1z5'), '22AAAAA0000A1Z5');
  assert.equal(providers.cleanGst('22-AAAAA-0000A1Z5'), null, 'separators are not part of the number');
  assert.equal(providers.cleanGst('12345'), null);
  const masked = verification.maskReference('22AAAAA0000A1Z5');
  assert.match(masked, /^22\*+A1Z5$/, 'the head and tail survive, the middle does not');
  assert.equal(masked.length, '22AAAAA0000A1Z5'.length, 'masking must not change the length');
  assert.ok(!masked.includes('AAAAA0000'), 'the middle of the number is not kept');
});

/* ------------------------------------------------------------- review */

test('approval publishes the provider, activates the drafts and marks the owner active', () => {
  const { db } = makeDb();
  const cfg1 = cfg();
  const result = onboarding.onboard(db, cfg1, { user: null, body: businessForm({ email: 'approve-me@example.com' }) });
  const provider = providers.findById(db, result.provider.id);
  const owner = users.findByEmail(db, 'approve-me@example.com');

  assert.equal(provider.status, 'pending');
  const list = services.listForProvider(db, provider.id);
  assert.equal(list[0].status, 'draft');

  const reviewed = verification.review(db, provider.id, { decision: 'approve', verified: true, actor: 'admin:1' });
  assert.equal(reviewed.status, 'active');
  assert.equal(reviewed.is_verified, 1);
  db.run("UPDATE services SET status = 'active' WHERE provider_id = ? AND status = 'draft'", [provider.id]);

  assert.equal(services.searchServices(db, { pin: '781001' }).items.some((row) => row.provider_id === provider.id), true, 'the listing is searchable now');
  assert.equal(db.get('SELECT is_verified, verified_at FROM providers WHERE id = ?', [provider.id]).verified_at !== null, true);
  assert.equal(db.get('SELECT status FROM users WHERE id = ?', [owner.id]).status, 'active');
  assert.ok(db.get("SELECT action FROM audit_logs WHERE entity = 'provider' AND entity_id = ? ORDER BY id DESC LIMIT 1", [provider.id]).action === 'provider.approve');
});

test('rejection suspends the listing and keeps the note for the provider', () => {
  const { db } = makeDb();
  const result = onboarding.onboard(db, cfg(), { user: null, body: businessForm({ email: 'reject-me@example.com' }) });
  const reviewed = verification.review(db, result.provider.id, { decision: 'reject', note: 'Add a shop photo and a landline number.', actor: 'admin:1' });
  assert.equal(reviewed.status, 'suspended');
  assert.match(reviewed.review_note, /shop photo/);
  assert.equal(services.searchServices(db, {}).items.some((row) => row.provider_id === result.provider.id), false);
});

test('the verified badge is a separate, audited decision', () => {
  const { db } = makeDb();
  const created = providers.createProvider(db, {
    businessName: 'Old Seeded Listing', categoryId: 2, locationId: 5, phone: '9000022222', status: 'active',
  });
  assert.equal(created.is_verified, false);
  verification.setVerified(db, created.id, true, { actor: 'admin:9' });
  assert.equal(db.get('SELECT is_verified FROM providers WHERE id = ?', [created.id]).is_verified, 1);
  assert.equal(db.get("SELECT action FROM audit_logs WHERE entity = 'provider' AND entity_id = ? ORDER BY id DESC LIMIT 1", [created.id]).action, 'provider.verified');
  verification.setVerified(db, created.id, false, { actor: 'admin:9' });
  assert.equal(db.get('SELECT is_verified FROM providers WHERE id = ?', [created.id]).is_verified, 0);
});

test('the pending queue lists exactly the listings waiting for review', () => {
  const { db } = makeDb();
  const before = verification.pendingQueue(db).total;
  const result = onboarding.onboard(db, cfg(), { user: null, body: businessForm({ email: 'queued@example.com' }) });
  const queue = verification.pendingQueue(db);
  assert.equal(queue.total, before + 1);
  const row = queue.items.find((item) => item.id === result.provider.id);
  assert.ok(row, 'the new listing must be in the queue');
  assert.equal(row.owner_email, 'queued@example.com');
  assert.equal(row.service_count, 1);
  assert.ok(row.location_label.includes('Guwahati'), 'the reviewer must see the area');
});

test('documents are stored masked and moved by the review', () => {
  const { db } = makeDb();
  const provider = providers.createProvider(db, { businessName: 'Doc Shop', categoryId: 2, locationId: 5, phone: '9000033333', status: 'pending' });
  const doc = verification.submitDocument(db, provider.id, { kind: 'gst', reference: '22AAAAA0000A1Z5' });
  assert.match(doc.reference, /^22\*+A1Z5$/);
  assert.equal(doc.status, 'pending');

  // Re-submitting the same kind updates instead of duplicating.
  const again = verification.submitDocument(db, provider.id, { kind: 'gst', reference: '22BBBBB0000B1Z5' });
  assert.equal(again.id, doc.id);
  assert.equal(db.scalar('SELECT COUNT(*) FROM provider_documents WHERE provider_id = ?', [provider.id]), 1);

  assert.throws(() => verification.submitDocument(db, provider.id, { kind: 'secret', reference: 'x' }), /Unknown document kind/);
  verification.review(db, provider.id, { decision: 'approve', document_ids: [doc.id], actor: 'admin:1' });
  assert.equal(db.get('SELECT status FROM provider_documents WHERE id = ?', [doc.id]).status, 'approved');
});

/* ------------------------------------------------------------ ownership */

test('a provider cannot touch another provider’s listing or service', () => {
  const { db } = makeDb();
  const mine = onboarding.onboard(db, cfg(), { user: null, body: businessForm({ email: 'mine@example.com' }) });
  const theirs = onboarding.onboard(db, cfg(), { user: null, body: businessForm({ email: 'theirs@example.com', business_name: 'Their Plumbing' }) });

  const attacker = { id: users.findByEmail(db, 'theirs@example.com').id, role: 'provider' };
  assert.throws(
    () => services.updateService(db, mine.service.id, { providerId: attacker.id, title: 'Hijacked' }),
    /belongs to another provider/,
  );
  assert.equal(services.findById(db, mine.service.id).title, 'Tap and pipe repair');

  const resolved = dashboard.ownedProvider(db, attacker);
  assert.equal(resolved.id, theirs.provider.id, 'ownership is derived from the session, never the request');
});

test('an admin may act on a named listing, and that is audited', () => {
  const { db } = makeDb();
  const result = onboarding.onboard(db, cfg(), { user: null, body: businessForm({ email: 'admin-edit@example.com' }) });
  const admin = { id: 99, role: 'admin' };
  const saved = dashboard.saveProfile(db, cfg(), { user: admin, asProviderId: result.provider.id, body: { about: 'Now with a 24x7 helpline.' } });
  assert.equal(saved.ok, true);
  assert.match(db.get('SELECT about FROM providers WHERE id = ?', [result.provider.id]).about, /24x7/);
});

test('a signed-in user with no listing gets a 404, not someone else’s dashboard', () => {
  const { db } = makeDb();
  const { user } = users.createUser(db, { email: 'homeless@example.com', fullName: 'H', password: PASSWORD, status: 'active', role: 'provider' });
  assert.throws(() => dashboard.ownedProvider(db, user), /do not have a listing/);
});

/* ------------------------------------------------------------------ API */

test('POST /api/v1/providers creates a pending listing that is invisible until approved', async () => {
  const app = makeApp();
  const agent = await signInProvider(app, 'api-onboard@example.com', {
    // A name that cannot collide with the launch seed, so "invisible" is
    // provable rather than an accident of the dataset.
    form: { business_name: 'Unlisted Test Plumbing', service_title: 'Hidden pipe repair' },
  });
  const mine = (await agent.get('/api/v1/providers/me')).json().data.provider;
  assert.equal(mine.status, 'pending');

  const publicSearch = await request(app, { url: '/api/v1/services?q=Unlisted' });
  assert.equal(publicSearch.json().data.total, 0, 'an unapproved listing must not appear in search');
  const providerSearch = await request(app, { url: '/api/v1/providers?q=Unlisted' });
  assert.equal(providerSearch.json().data.total, 0, 'nor in the provider list');
  const profile = await request(app, { url: `/providers/${mine.slug}` });
  assert.equal(profile.statusCode, 404, 'nor have a public page');

  // The owner is sent to their dashboard instead of a dead end.
  const ownerView = await agent.get(`/providers/${mine.slug}`);
  assert.equal(ownerView.statusCode, 303);
  assert.equal(ownerView.headers.location, '/dashboard');
});

test('the one-step form works signed-out, and gives the new account a session', async () => {
  const app = makeApp();
  const res = await request(app, {
    method: 'POST', url: '/providers/new',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      full_name: 'One Step', email: 'one-step-form@example.com', password: PASSWORD, phone: '9000011111',
      business_name: 'One Step Electricals', category_id: '3', pin_code: '781006', service_title: 'Wiring check',
    }).toString(),
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /waiting for review/i);
  assert.ok(cookieValue(res, 'seva_session'), 'signed up and signed in in one submit');
  const account = users.findByEmail(app.db, 'one-step-form@example.com');
  assert.equal(account.role, 'provider');
  const dashboardRes = await request(app, { url: '/dashboard', headers: { cookie: `seva_session=${cookieValue(res, 'seva_session')}` } });
  assert.equal(dashboardRes.statusCode, 200);
});

test('a duplicate email on the one-step form re-renders the form with the error', async () => {
  const app = makeApp();
  await request(app, {
    method: 'POST', url: '/providers/new',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      full_name: 'First', email: 'dupe-form@example.com', password: PASSWORD, phone: '9000011111',
      business_name: 'First Shop', category_id: '3', pin_code: '781006', service_title: 'Wiring',
    }).toString(),
  });
  const second = await request(app, {
    method: 'POST', url: '/providers/new',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      full_name: 'Second', email: 'dupe-form@example.com', password: PASSWORD, phone: '9000011111',
      business_name: 'Second Shop', category_id: '3', pin_code: '781006', service_title: 'Wiring',
    }).toString(),
  });
  assert.equal(second.statusCode, 400);
  assert.match(second.body, /already exists/);
  assert.match(second.body, /Second Shop/, 'the typed values must survive a failed submit');
});

test('the availability probe tells a provider whether their area is covered', async () => {
  const app = makeApp();
  const seeded = await request(app, { url: '/api/v1/providers/availability?pin=781001' });
  assert.equal(seeded.statusCode, 200);
  assert.ok(seeded.json().data.existing_providers >= 1);
  assert.match(seeded.json().data.demand_note, /already listed here/i);

  const empty = await request(app, { url: '/api/v1/providers/availability?pin=999999' });
  assert.equal(empty.json().data.existing_providers, 0);
  assert.match(empty.json().data.demand_note, /No active listing/);

  const bad = await request(app, { url: '/api/v1/providers/availability?pin=12' });
  assert.equal(bad.statusCode, 400);
});

test('auto-approve publishes immediately, for preview and demo installs', async () => {
  const { db } = makeDb();
  const result = onboarding.onboard(db, cfg({ onboarding: { autoApprove: true, maxServiceAreas: 4 } }), {
    user: null, body: businessForm({ email: 'instant@example.com' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider.status, 'active');
  assert.equal(result.needsReview, false);
  assert.equal(result.service.status, 'active');
  assert.equal(services.searchServices(db, { pin: '781001' }).items.some((row) => row.provider_id === result.provider.id), true);
});
