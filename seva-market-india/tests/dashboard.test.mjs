/**
 * SEVA MARKET INDIA — provider dashboard, enquiries and the public page.
 *
 * The dashboard is where a listing is maintained, the enquiry form is where
 * the marketplace earns its keep, and the review queue is where trust is
 * granted. All three are driven through the real HTTP surface here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeApp, request, makeAgent, cookieValue } from './helpers.mjs';

const require = createRequire(import.meta.url);
const providers = require('../src/models/provider');
const services = require('../src/models/service');
const leads = require('../src/models/lead');
const locations = require('../src/models/location');
const categories = require('../src/models/category');

const PASSWORD = 'seva-market1';

/** Register, onboard and hand back an agent plus the ids it needs. */
async function makeProvider(app, label, { business = 'Dashboard Test Plumbing', pin = '781001' } = {}) {
  const email = `${label}@example.com`;
  const agent = makeAgent(app);
  const registered = await agent.post('/api/v1/auth/register', {
    email, password: PASSWORD, full_name: `Test ${label}`, phone: '9000011111', role: 'provider',
  });
  assert.equal(registered.statusCode, 201, registered.body);
  agent.state.csrf = registered.json().data.csrf_token;

  const onboard = await agent.api('POST', '/api/v1/providers', {
    business_name: business,
    phone: '9000011111',
    category_id: 2,
    pin_code: pin,
    service_title: 'Tap and pipe repair',
    price_min: 300,
    price_max: 900,
    service_areas: `${pin}, 781005`,
  });
  assert.equal(onboard.statusCode, 201, onboard.body);
  const provider = onboard.json().data.provider;
  return { agent, email, provider, service: onboard.json().data.service };
}

/** Approve a listing the way an administrator does, through the HTML form. */
async function approve(app, { email = 'admin-reviewer@example.com', providerId, verified = '1' } = {}) {
  const admin = makeAgent(app);
  // The admin is created from configuration, so the test writes the row the
  // same way the boot sequence would and signs in with it.
  const users = require('../src/models/user');
  const created = users.createUser(app.db, { email, fullName: 'Reviewer', password: PASSWORD, role: 'admin', status: 'active' });
  const login = await admin.signIn(email, PASSWORD);
  assert.equal(login.statusCode, 200, login.body);
  const res = await admin.postForm(`/admin/providers/${providerId}/review`, {
    _csrf: admin.csrf(),
    decision: 'approve',
    verified,
    note: 'Looks good.',
  });
  return { admin, res, userId: created.user.id };
}

/* ------------------------------------------------------------- overview */

test('the dashboard renders the listing, its numbers and its next steps', async () => {
  const app = makeApp();
  const { agent, provider } = await makeProvider(app, 'dash-view');
  const res = await agent.get('/dashboard');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Dashboard Test Plumbing/);
  assert.match(res.body, /Waiting for review/);
  assert.match(res.body, /Profile strength/);
  assert.match(res.body, /New enquiries/);
  assert.match(res.body, /name="robots" content="noindex, nofollow"/, 'a dashboard must never be indexed');
  assert.match(res.body, /href="\/dashboard\/services"/);
  assert.match(res.body, /Pin code|Coverage/, 'coverage is a first-class tab');
  assert.ok(!res.body.includes('<script>'), 'no inline script, as the CSP requires');

  const me = await agent.get('/api/v1/providers/me');
  assert.equal(me.json().data.provider.id, provider.id);
  assert.equal(me.json().data.stats.total_services, 1);
});

test('the dashboard for a provider account with no listing is a nudge, not an error', async () => {
  const app = makeApp();
  const agent = makeAgent(app);
  await agent.post('/api/v1/auth/register', {
    email: 'no-listing@example.com', password: PASSWORD, full_name: 'Nobody', role: 'provider',
  });
  await agent.signIn('no-listing@example.com', PASSWORD);
  const res = await agent.get('/dashboard');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /No listing on no-listing@example.com yet/);
  assert.match(res.body, /href="\/providers\/new"/);
});

test('a customer who opens the provider area is sent to the listing form', async () => {
  const app = makeApp();
  const agent = makeAgent(app);
  await agent.post('/api/v1/auth/register', { email: 'shopper@example.com', password: PASSWORD, full_name: 'Shopper' });
  await agent.signIn('shopper@example.com', PASSWORD);
  const page = await agent.get('/dashboard');
  assert.equal(page.statusCode, 303);
  assert.equal(page.headers.location, '/providers/new?intent=provider');
  const landing = await agent.get(page.headers.location);
  assert.equal(landing.statusCode, 200);
  assert.match(landing.body, /turns this account into a provider account/, 'and explains what happens');
  const api = await agent.get('/api/v1/providers/me');
  assert.equal(api.statusCode, 403, 'the API keeps saying no');
});

/* ------------------------------------------------------------- services */

test('a provider can add, edit, pause and archive a service from the dashboard', async () => {
  const app = makeApp();
  const { agent, provider } = await makeProvider(app, 'dash-services');
  await approve(app, { providerId: provider.id });

  const added = await agent.postForm('/dashboard/services', {
    _csrf: agent.csrf(),
    title: 'Motor rewinding',
    description: 'Borewell and domestic motors.',
    price_min: '1200',
    price_max: '4000',
    price_unit: 'job',
    publish: 'active',
  });
  assert.equal(added.statusCode, 303);
  assert.match(added.headers.location, /ok=service-added/);

  const list = services.listForProvider(app.db, provider.id);
  const created = list.find((row) => row.title === 'Motor rewinding');
  assert.ok(created, 'the service must exist');
  assert.equal(created.status, 'active', 'publish=active went live because the listing is approved');
  assert.equal(created.price_min, 1200);

  const edited = await agent.postForm(`/dashboard/services/${created.id}`, {
    _csrf: agent.csrf(),
    title: 'Motor rewinding & repair',
    price_min: '1500',
    price_max: '5000',
    publish: 'active',
  });
  assert.equal(edited.statusCode, 303);
  assert.equal(services.findById(app.db, created.id).title, 'Motor rewinding & repair');

  const paused = await agent.postForm(`/dashboard/services/${created.id}/status`, { _csrf: agent.csrf(), status: 'paused' });
  assert.equal(paused.statusCode, 303);
  assert.equal(services.findById(app.db, created.id).status, 'paused');
  assert.equal(services.searchServices(app.db, { pin: '781001' }).items.some((row) => row.id === created.id), false, 'a paused service leaves search');

  await agent.postForm(`/dashboard/services/${created.id}/status`, { _csrf: agent.csrf(), status: 'archived' });
  assert.equal(services.findById(app.db, created.id).status, 'archived', 'archive, never hard-delete: leads may point here');
});

test('an invalid service form re-renders with the errors, and writes nothing', async () => {
  const app = makeApp();
  const { agent, provider } = await makeProvider(app, 'dash-bad-service');
  const before = services.listForProvider(app.db, provider.id).length;
  const res = await agent.postForm('/dashboard/services', {
    _csrf: agent.csrf(), title: '', price_min: 'abc', price_max: '100',
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /Service name/);
  assert.match(res.body, /number in rupees/);
  assert.equal(services.listForProvider(app.db, provider.id).length, before);
});

test('a provider cannot edit a service they do not own', async () => {
  const app = makeApp();
  const victim = await makeProvider(app, 'dash-victim', { business: 'Victim Plumbing' });
  const attacker = await makeProvider(app, 'dash-attacker', { business: 'Attacker Plumbing' });

  const victimService = services.listForProvider(app.db, victim.provider.id)[0];
  const res = await attacker.agent.postForm(`/dashboard/services/${victimService.id}/status`, {
    _csrf: attacker.agent.csrf(), status: 'archived',
  });
  assert.equal(res.statusCode, 404, 'someone else’s service does not exist for you');
  assert.equal(services.findById(app.db, victimService.id).status, victimService.status);
});

test('services stay drafts until the business itself is approved', async () => {
  const app = makeApp();
  const { agent, provider } = await makeProvider(app, 'dash-pending');
  const res = await agent.postForm(`/dashboard/services/${services.listForProvider(app.db, provider.id)[0].id}/status`, {
    _csrf: agent.csrf(), status: 'active',
  });
  assert.equal(res.statusCode, 409, 'publishing a service before the listing is approved is refused');
  assert.match(res.body, /Publish your listing first/);
});

/* ------------------------------------------------------------- coverage */

test('coverage PINs are replaced wholesale and validated', async () => {
  const app = makeApp();
  const { agent, provider } = await makeProvider(app, 'dash-coverage');

  const saved = await agent.postForm('/dashboard/coverage', { _csrf: agent.csrf(), service_areas: '781006 781033,781006' });
  assert.equal(saved.statusCode, 303);
  assert.deepEqual(providers.serviceAreas(app.db, provider.id), ['781006', '781033'], 'a PUT-like replace, deduplicated');

  const rejected = await agent.postForm('/dashboard/coverage', { _csrf: agent.csrf(), service_areas: '781006, 12345, not-a-pin' });
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.body, /Not a valid PIN code/);
  assert.deepEqual(providers.serviceAreas(app.db, provider.id), ['781006', '781033'], 'a rejected save changes nothing');

  const cleared = await agent.postForm('/dashboard/coverage', { _csrf: agent.csrf(), service_areas: '' });
  assert.equal(cleared.statusCode, 303);
  assert.deepEqual(providers.serviceAreas(app.db, provider.id), []);
});

/* ------------------------------------------------------------- profile */

test('business details save, and the status fields are not editable here', async () => {
  const app = makeApp();
  const { agent, provider } = await makeProvider(app, 'dash-profile');
  const res = await agent.postForm('/dashboard/profile', {
    _csrf: agent.csrf(),
    about: 'Fifteen years of taps, motors and borewells across Guwahati. Brass fittings in the van.',
    experience_years: '15',
    website: 'instagram.com/dashtest',
    gst_number: '22AAAAA0000A1Z5',
    status: 'active',
    is_verified: '1',
  });
  assert.equal(res.statusCode, 303);
  const row = app.db.get('SELECT about, website, gst_number, status, is_verified, experience_years FROM providers WHERE id = ?', [provider.id]);
  assert.match(row.about, /Fifteen years/);
  assert.equal(row.website, 'https://instagram.com/dashtest');
  assert.equal(row.gst_number, '22AAAAA0000A1Z5');
  assert.equal(row.experience_years, 15);
  assert.equal(row.status, 'pending', 'the review queue owns status');
  assert.equal(row.is_verified, 0, 'and so does the badge');
});

test('a bad phone or GSTIN on the profile is refused with the field named', async () => {
  const app = makeApp();
  const { agent } = await makeProvider(app, 'dash-bad-profile');
  const res = await agent.postForm('/dashboard/profile', { _csrf: agent.csrf(), phone: '12345', gst_number: 'nonsense' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /10-digit/);
  assert.match(res.body, /GSTIN is 15 characters/);
});

/* -------------------------------------------------------------- enquiry */

test('a customer enquiry reaches the provider inbox, and only theirs', async () => {
  const app = makeApp();
  const provider = await makeProvider(app, 'dash-lead-a', { business: 'Alpha Plumbing' });
  const other = await makeProvider(app, 'dash-lead-b', { business: 'Beta Plumbing' });
  await approve(app, { providerId: provider.provider.id });

  const form = await request(app, {
    method: 'POST', url: `/providers/${provider.provider.slug}/enquiry`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Anupam Sharma', phone: '9876543210', pin_code: '781005', message: 'Bathroom tap has been leaking for two days.' }).toString(),
  });
  assert.equal(form.statusCode, 303, 'a browser gets a redirect, not JSON');
  assert.match(form.headers.location, /ok=enquiry-sent/);

  const inbox = await provider.agent.get('/dashboard/enquiries');
  assert.equal(inbox.statusCode, 200);
  assert.match(inbox.body, /Anupam Sharma/);
  assert.match(inbox.body, /href="tel:\+919876543210"/, 'the call button is the point of the product');

  const theirs = await other.agent.get('/dashboard/enquiries');
  assert.ok(!theirs.body.includes('Anupam Sharma'), 'a lead is visible to exactly one provider');

  const api = await other.agent.get('/api/v1/providers/me/leads');
  assert.equal(api.json().data.total, 0);
});

test('an enquiry form re-renders with the field errors instead of dropping the message', async () => {
  const app = makeApp();
  const { provider } = await makeProvider(app, 'dash-bad-lead');
  await approve(app, { providerId: provider.id });
  const res = await request(app, {
    method: 'POST', url: `/providers/${provider.slug}/enquiry`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: '', phone: '12345', message: 'Leaking tap' }).toString(),
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /Mobile number/);
  assert.match(res.body, /Leaking tap/, 'what the customer typed must survive the failed submit');
  assert.equal(leads.count(app.db), 0);
});

test('enquiries from one connection are throttled on the page route too', async () => {
  const app = makeApp();
  const { provider } = await makeProvider(app, 'dash-spam');
  await approve(app, { providerId: provider.id });
  const codes = [];
  for (let i = 0; i < 7; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, {
      method: 'POST', url: `/providers/${provider.slug}/enquiry`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      ip: '198.51.100.44',
      body: new URLSearchParams({ name: `Spam ${i}`, phone: '9876543210' }).toString(),
    });
    codes.push(res.statusCode);
  }
  assert.equal(codes.filter((code) => code === 303).length, 5, 'five go through');
  assert.ok(codes.includes(429), 'the sixth is refused');
});

test('a provider triages an enquiry and can only touch their own', async () => {
  const app = makeApp();
  const mine = await makeProvider(app, 'dash-triage-a');
  const theirs = await makeProvider(app, 'dash-triage-b');
  await approve(app, { providerId: mine.provider.id });
  const providerRow = providers.findBySlug(app.db, mine.provider.slug);
  leads.createLead(app.db, { providerId: providerRow.id, name: 'Caller', phone: '9876543210', message: 'Need a quote' });
  const lead = leads.listForProvider(app.db, providerRow.id).items[0];

  const saved = await mine.agent.postForm(`/dashboard/enquiries/${lead.id}`, {
    _csrf: mine.agent.csrf(), status: 'contacted', note: 'Called twice, asked to WhatsApp.',
  });
  assert.equal(saved.statusCode, 303);
  const after = leads.findById(app.db, lead.id);
  assert.equal(after.status, 'contacted');
  assert.equal(after.provider_note, 'Called twice, asked to WhatsApp.');
  assert.ok(after.read_at, 'touching a lead marks it read');

  const hijack = await theirs.agent.postForm(`/dashboard/enquiries/${lead.id}`, { _csrf: theirs.agent.csrf(), status: 'spam' });
  assert.equal(hijack.statusCode, 404, 'the id is checked against the caller’s listing');
  assert.equal(leads.findById(app.db, lead.id).status, 'contacted');
});

/* ---------------------------------------------------- public pages */

test('the public provider page shows contact, services and coverage', async () => {
  const app = makeApp();
  const { provider } = await makeProvider(app, 'dash-public', { business: 'Guwahati Tap Works' });
  await approve(app, { providerId: provider.id });

  const res = await request(app, { url: `/providers/${provider.slug}` });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<h1 class="profile-head__title">Guwahati Tap Works/);
  assert.match(res.body, /href="tel:\+919000011111"/);
  assert.match(res.body, /781005/, 'coverage PINs are shown');
  assert.match(res.body, /Tap and pipe repair/);
  assert.match(res.body, /₹300–₹900\/visit/);
  assert.match(res.body, /Send enquiry/);
  assert.match(res.body, /<title>Guwahati Tap Works — Plumber in .*SEVA MARKET INDIA<\/title>/s);

  // Approved: the draft became live, so it is searchable.
  const search = await request(app, { url: '/api/v1/services?q=Guwahati%20Tap' });
  assert.equal(search.json().data.total, 1);
});

test('the service page links back to its provider and carries the price', async () => {
  const app = makeApp();
  const { provider, service } = await makeProvider(app, 'dash-service-page', { business: 'Service Page Plumbing' });
  await approve(app, { providerId: provider.id });
  const res = await request(app, { url: `/services/${service.slug}` });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<h1 class="profile-head__title">Tap and pipe repair<\/h1>/);
  assert.match(res.body, /₹300–₹900\/visit/);
  assert.match(res.body, new RegExp(`/providers/${provider.slug}`));
  assert.match(res.body, /action="\/services\/.*\/enquiry"/);
});

test('a suspended or pending provider has no public page', async () => {
  const app = makeApp();
  const { provider } = await makeProvider(app, 'dash-hidden');
  const anon = await request(app, { url: `/providers/${provider.slug}` });
  assert.equal(anon.statusCode, 404);
  const json = await request(app, { url: `/api/v1/providers/${provider.slug}` });
  assert.equal(json.statusCode, 404);
  const service = await request(app, { url: `/api/v1/services?q=Tap%20and%20pipe` });
  assert.equal(service.json().data.items.filter((row) => row.provider_id === provider.id).length, 0);
});

test('a review from the admin queue publishes the listing and emails the owner', async () => {
  const app = makeApp();
  const { provider } = await makeProvider(app, 'dash-approve');
  const { res } = await approve(app, { providerId: provider.id });
  assert.equal(res.statusCode, 303);
  assert.match(res.headers.location, /review-approved/);

  const row = providers.findById(app.db, provider.id);
  assert.equal(row.status, 'active');
  assert.equal(row.is_verified, true);
  const queue = require('../src/models/verification').pendingQueue(app.db);
  assert.equal(queue.items.some((item) => item.id === provider.id), false);
  const audit = app.db.get("SELECT action, actor FROM audit_logs WHERE entity = 'provider' AND entity_id = ? ORDER BY id DESC LIMIT 1", [provider.id]);
  assert.equal(audit.action, 'provider.approve');
  assert.match(audit.actor, /^admin:/);
});

test('the admin page lists the pending queue with the fields a reviewer needs', async () => {
  const app = makeApp();
  const { provider } = await makeProvider(app, 'dash-queue');
  const users = require('../src/models/user');
  users.createUser(app.db, { email: 'queue-admin@example.com', fullName: 'Q', password: PASSWORD, role: 'admin', status: 'active' });
  const admin = makeAgent(app);
  await admin.signIn('queue-admin@example.com', PASSWORD);

  const res = await admin.get('/admin');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Dashboard Test Plumbing|1 listing is waiting|Review queue/);
  assert.match(res.body, new RegExp(`action="/admin/providers/${provider.id}/review"`));
  assert.match(res.body, /Grant the verified badge/);
  assert.match(res.body, /name="robots" content="noindex, nofollow"/);
});

test('the admin overview shows coverage, marketplace totals and the audit trail', async () => {
  const app = makeApp();
  const { provider } = await makeProvider(app, 'dash-overview');
  const users = require('../src/models/user');
  users.createUser(app.db, { email: 'overview-admin@example.com', fullName: 'O', password: PASSWORD, role: 'admin', status: 'active' });
  const admin = makeAgent(app);
  await admin.signIn('overview-admin@example.com', PASSWORD);

  const res = await admin.get('/admin/overview');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Marketplace health at a glance/);
  assert.match(res.body, /Recent audit log/);
  assert.match(res.body, /1 listing<\/p>|listing<\/p>|open the queue/, 'the queue count is surfaced');
  assert.match(res.body, /action="\/admin\/housekeeping"/);
  assert.equal(res.headers['x-frame-options'], 'DENY');

  const purged = await admin.postForm('/admin/housekeeping', { _csrf: admin.csrf() });
  assert.equal(purged.statusCode, 303);
  assert.match(purged.headers.location, /ok=housekeeping/);

  // A non-admin never sees any of it.
  const outsider = await request(app, { url: '/admin/overview' });
  assert.equal(outsider.statusCode, 303);
  assert.match(outsider.headers.location, /^\/login\?next=/);
});

/* ------------------------------------------------------- search surface */

test('searching a state finds the listings in its cities', async () => {
  const app = makeApp();
  const { provider } = await makeProvider(app, 'dash-search');
  await approve(app, { providerId: provider.id });

  const assam = await request(app, { url: '/search?state=assam&category=plumber' });
  assert.equal(assam.statusCode, 200);
  assert.match(assam.body, /Plumber in Assam/);
  assert.match(assam.body, /Dashboard Test Plumbing/);

  const api = await request(app, { url: '/api/v1/services?state=karnataka' });
  assert.equal(api.json().data.filters.place, 'Karnataka');
  assert.ok(api.json().data.items.every((row) => /Karnataka/.test(row.location_label || '')));
});

test('an unknown place is an honest empty page, never "everything"', async () => {
  const app = makeApp();
  const res = await request(app, { url: '/search?state=arunachal-pradesh' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /No listings in arunachal-pradesh/);
  assert.match(res.body, /0 services available/);

  const api = await request(app, { url: '/api/v1/services?place=nowhereville' });
  assert.equal(api.json().data.total, 0);
  assert.equal(api.json().data.filters.place_found, false);
});

test('a provider can be found by the PIN code they cover, not only where they sit', async () => {
  const app = makeApp();
  const { provider } = await makeProvider(app, 'dash-areas', { pin: '781001' });
  await approve(app, { providerId: provider.id });
  const home = await request(app, { url: '/api/v1/providers?pin=781001&q=Dashboard' });
  assert.ok(home.json().data.total >= 1);
  const covered = await request(app, { url: '/api/v1/providers?pin=781005&q=Dashboard' });
  assert.equal(covered.json().data.total, 1, 'service_areas is what makes "near me" work');
  const elsewhere = await request(app, { url: '/api/v1/providers?pin=411038&q=Dashboard' });
  assert.equal(elsewhere.json().data.total, 0);
});

/* ------------------------------------------------------------ hygiene */

test('no dashboard or account page emits inline JavaScript', async () => {
  const app = makeApp();
  const { agent } = await makeProvider(app, 'dash-hygiene');
  for (const url of ['/dashboard', '/dashboard/services', '/dashboard/coverage', '/dashboard/enquiries', '/dashboard/profile', '/account']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await agent.get(url);
    assert.equal(res.statusCode, 200, `${url} should render`);
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(res.body), `${url}: no inline script`);
    for (const handler of ['onclick=', 'onsubmit=', 'onchange=', 'onerror=']) {
      assert.ok(!res.body.includes(handler), `${url}: no inline ${handler}`);
    }
  }
});

test('every dashboard form carries the CSRF proof and posts to a same-origin action', async () => {
  const app = makeApp();
  const { agent } = await makeProvider(app, 'dash-csrf-forms');
  const res = await agent.get('/dashboard/services');
  const forms = res.body.match(/<form[^>]*action="\/dashboard[^"]*"[^>]*>/g) || [];
  assert.ok(forms.length >= 2, 'the page should contain dashboard forms');
  for (const form of forms) {
    assert.match(form, /action="\/dashboard/, 'forms post to the same origin');
    assert.match(form, /method="post"/);
  }
  assert.ok((res.body.match(/name="_csrf"/g) || []).length >= forms.length, 'one hidden proof per form');
  assert.match(res.headers['content-security-policy'], /form-action 'self'/);
});

test('the public profile escapes provider-supplied text', async () => {
  const app = makeApp();
  const { provider } = await makeProvider(app, 'dash-xss');
  await approve(app, { providerId: provider.id });
  app.db.run('UPDATE providers SET business_name = ?, about = ? WHERE id = ?', [
    'Xss <script>alert(1)</script> Works', '<img src=x onerror=alert(2)>', provider.id,
  ]);
  const res = await request(app, { url: `/providers/${provider.slug}` });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'no executable script tag');
  assert.ok(!res.body.includes('<img src=x'), 'no injected image tag');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'it is there, as text');
  assert.match(res.body, /&lt;img src=x onerror=alert\(2\)&gt;/);
  assert.equal((res.body.match(/<script/g) || []).length, 1, 'the only script on the page is the deferred bundle');
});

test('a signed-in customer cannot reach the provider dashboard', async () => {
  const app = makeApp();
  const agent = makeAgent(app);
  await agent.post('/api/v1/auth/register', { email: 'customer-only@example.com', password: PASSWORD, full_name: 'C' });
  await agent.signIn('customer-only@example.com', PASSWORD);
  const api = await agent.get('/api/v1/providers/me');
  assert.equal(api.statusCode, 403, 'the role, not the login, decides');
});

test('the lead phone number is never written to a public listing page as data', async () => {
  const app = makeApp();
  const { provider } = await makeProvider(app, 'dash-privacy');
  await approve(app, { providerId: provider.id });
  await request(app, {
    method: 'POST', url: `/providers/${provider.slug}/enquiry`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Private Person', phone: '9812345678', message: 'Call me' }).toString(),
  });
  const page = await request(app, { url: `/providers/${provider.slug}` });
  assert.ok(!page.body.includes('9812345678'), 'one customer’s number must not be shown to the next');
  assert.ok(!(await request(app, { url: '/api/v1/providers/me/leads' })).body.includes('9812345678'));
});
