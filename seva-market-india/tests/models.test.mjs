/**
 * SEVA MARKET INDIA — model tests.
 *
 * Covers the location tree, categories, providers, services, users
 * (password hashing) and leads, each against a fresh in-memory database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeDb } from './helpers.mjs';

const require = createRequire(import.meta.url);
const locations = require('../src/models/location');
const categories = require('../src/models/category');
const providers = require('../src/models/provider');
const services = require('../src/models/service');
const users = require('../src/models/user');
const leads = require('../src/models/lead');
const values = require('../src/db/values');

/* ------------------------------------------------------------ values */

test('slugify normalises names, including transliterations', () => {
  assert.equal(values.slugify('Kamrup Metropolitan'), 'kamrup-metropolitan');
  assert.equal(values.slugify('AC Repair & Service'), 'ac-repair-service');
  assert.equal(values.slugify('  T. Nagar  '), 't-nagar');
  assert.equal(values.slugify('Bengalūru'), 'bengaluru', 'diacritics must be stripped');
  assert.equal(values.slugify('!!!'), '');
});

test('PIN and phone validators accept only valid Indian formats', () => {
  assert.equal(values.isValidPin('781001'), true);
  assert.equal(values.isValidPin('081001'), false, 'PIN cannot start with 0');
  assert.equal(values.isValidPin('78100'), false);
  assert.equal(values.isValidPin('7810011'), false);
  assert.equal(values.isValidPin(781001), false, 'must be a string');

  assert.equal(values.normalizePhone('+91 90000 00001'), '9000000001');
  assert.equal(values.normalizePhone('09000000001'), '9000000001');
  assert.equal(values.normalizePhone('5000000000'), null, 'must start 6-9');
  assert.equal(values.normalizePhone('12345'), null);
});

/* ---------------------------------------------------------- location */

test('the seeded tree resolves India -> state -> district -> city -> locality -> PIN', () => {
  const { db } = makeDb();
  const resolved = locations.findByPin(db, '781001');
  assert.ok(resolved, 'PIN 781001 should exist in the seed');

  const kinds = resolved.chain.map((node) => node.kind);
  assert.deepEqual(kinds, ['country', 'state', 'district', 'city', 'locality', 'pincode']);

  const names = resolved.chain.map((node) => node.name);
  assert.equal(names[0], 'India');
  assert.equal(names[1], 'Assam');
  assert.equal(names[2], 'Kamrup Metropolitan');
  assert.equal(names[3], 'Guwahati');
  assert.equal(names[4], 'Uzan Bazar');
  db.close();
});

test('unknown PIN codes resolve to null instead of throwing', () => {
  const { db } = makeDb();
  assert.equal(locations.findByPin(db, '999999'), null);
  assert.equal(locations.findByPin(db, 'abc'), null);
  db.close();
});

test('ensureLocation refuses an invalid parent level', () => {
  const { db } = makeDb();
  const india = locations.ensureIndia(db);
  const assam = locations.ensureLocation(db, { kind: 'state', parentId: india.id, name: 'Assam' });
  assert.throws(
    () => locations.ensureLocation(db, { kind: 'state', parentId: assam.id, name: 'Bihar' }),
    /cannot sit under/i,
  );
  assert.throws(
    () => locations.ensureLocation(db, { kind: 'pincode', parentId: assam.id, name: '781001', pinCode: '781001' }),
    /cannot sit under/i,
    'a PIN must hang off a locality, not a state',
  );
  db.close();
});

test('ensureLocation rejects malformed PIN codes', () => {
  const { db } = makeDb();
  const chain = locations.findByPin(db, '781001').chain;
  const locality = chain[4];
  assert.throws(
    () => locations.ensureLocation(db, { kind: 'pincode', parentId: locality.id, name: '000000', pinCode: '000000' }),
    /Invalid PIN/i,
  );
  db.close();
});

test('location search matches on the breadcrumb, not just the name', () => {
  const { db } = makeDb();
  const byCity = locations.search(db, 'Guwahati');
  assert.ok(byCity.length > 0);
  assert.ok(byCity.some((row) => row.kind === 'city'));

  // "Assam" appears in the breadcrumb of every Assam row.
  const byState = locations.search(db, 'Assam');
  assert.ok(byState.length > 5, 'breadcrumb search should widen the result set');

  const onlyCities = locations.search(db, 'Guwahati', { kind: 'city' });
  assert.ok(onlyCities.every((row) => row.kind === 'city'));
  db.close();
});

test('location search prefers exact names and broader areas', () => {
  const { db } = makeDb();
  // "Delhi" is a state whose name is exactly "Delhi"; Dwarka and New Delhi
  // merely mention Delhi in their breadcrumb. The state must come first so a
  // customer's "Delhi" search covers the whole city, not one suburb.
  const delhi = locations.search(db, 'Delhi');
  assert.ok(delhi.length >= 1);
  assert.equal(delhi[0].name, 'Delhi', 'exact name match ranks first');
  assert.equal(delhi[0].kind, 'state', 'the broader area wins among exact matches');

  // "Guwahati" resolves to the city, whose descendants carry the services.
  const guwahati = locations.search(db, 'Guwahati');
  assert.equal(guwahati[0].kind, 'city');
  db.close();
});

test('stats reports a count for all six levels', () => {
  const { db } = makeDb();
  const totals = locations.stats(db);
  assert.deepEqual(Object.keys(totals).sort(), ['city', 'country', 'district', 'locality', 'pincode', 'state'].sort());
  assert.equal(totals.country, 1);
  db.close();
});

/* ---------------------------------------------------------- category */

test('category tree nests children under parents', () => {
  const { db } = makeDb();
  const tree = categories.tree(db);
  const homeRepair = tree.find((node) => node.slug === 'home-repair-maintenance');
  assert.ok(homeRepair, 'Home Repair & Maintenance should be a top-level category');
  const childSlugs = homeRepair.children.map((child) => child.slug);
  assert.ok(childSlugs.includes('plumber'));
  assert.ok(childSlugs.includes('electrician'));
  db.close();
});

test('categories nest at most two levels deep', () => {
  const { db } = makeDb();
  const parent = categories.ensureCategory(db, { name: 'Temp Parent' });
  const child = categories.ensureCategory(db, { name: 'Temp Child', parentId: parent.id });
  assert.throws(
    () => categories.ensureCategory(db, { name: 'Temp Grandchild', parentId: child.id }),
    /at most two levels/i,
  );
  db.close();
});

test('searching a parent category includes its children', () => {
  const { db } = makeDb();
  const parent = categories.findBySlug(db, 'home-repair-maintenance');
  const ids = categories.selfAndDescendantIds(db, parent.id);
  assert.ok(ids.includes(parent.id));
  assert.ok(ids.length > 5, 'the parent should expand to its children');
  db.close();
});

/* ---------------------------------------------------------- provider */

test('creating a provider requires a real category, location and mobile number', () => {
  const { db } = makeDb();
  const category = categories.findBySlug(db, 'plumber');
  const place = locations.findByPin(db, '781001').chain[4];

  assert.throws(
    () => providers.createProvider(db, { businessName: 'X', categoryId: category.id, locationId: place.id, phone: '12345' }),
    /mobile number/i,
  );
  assert.throws(
    () => providers.createProvider(db, { businessName: 'X', categoryId: 99999, locationId: place.id, phone: '9000011111' }),
    /Unknown category/i,
  );
  assert.throws(
    () => providers.createProvider(db, { businessName: 'X', categoryId: category.id, locationId: 99999, phone: '9000011111' }),
    /Unknown location/i,
  );
  assert.throws(
    () => providers.createProvider(db, { businessName: '', categoryId: category.id, locationId: place.id, phone: '9000011111' }),
    /Business name is required/i,
  );
  db.close();
});

test('duplicate business names get distinct, readable slugs', () => {
  const { db } = makeDb();
  const category = categories.findBySlug(db, 'plumber');
  const place = locations.findByPin(db, '781001').chain[4];
  const first = providers.createProvider(db, { businessName: 'Sharma Works', categoryId: category.id, locationId: place.id, phone: '9000011111' });
  const second = providers.createProvider(db, { businessName: 'Sharma Works', categoryId: category.id, locationId: place.id, phone: '9000022222' });
  assert.equal(first.slug, 'sharma-works');
  assert.equal(second.slug, 'sharma-works-2');
  db.close();
});

test('a provider takes its PIN from its location when none is supplied', () => {
  const { db } = makeDb();
  const category = categories.findBySlug(db, 'plumber');

  // Located at the PIN node itself: the PIN is inherited.
  const pinNode = locations.findByPin(db, '411038').node;
  const atPin = providers.createProvider(db, { businessName: 'Kothrud Fixers', categoryId: category.id, locationId: pinNode.id, phone: '9000033333' });
  assert.equal(atPin.pin_code, '411038');

  // Located at the locality above it: no PIN column to inherit from.
  const locality = locations.findByPin(db, '411038').chain[4];
  const atLocality = providers.createProvider(db, { businessName: 'Kothrud Fixers Two', categoryId: category.id, locationId: locality.id, phone: '9000033334' });
  assert.equal(atLocality.pin_code, null);

  // An explicit PIN always wins, and a bad one is refused.
  const explicit = providers.createProvider(db, { businessName: 'Kothrud Fixers Three', categoryId: category.id, locationId: locality.id, phone: '9000033335', pinCode: '411057' });
  assert.equal(explicit.pin_code, '411057');
  assert.throws(
    () => providers.createProvider(db, { businessName: 'Kothrud Fixers Four', categoryId: category.id, locationId: locality.id, phone: '9000033336', pinCode: '12' }),
    /Invalid PIN/i,
  );
  db.close();
});

test('provider search filters by category, PIN and verification', () => {
  const { db } = makeDb();
  const plumber = categories.findBySlug(db, 'plumber');

  const byCategory = providers.searchProviders(db, { categoryIds: [plumber.id] });
  assert.ok(byCategory.total >= 2);
  assert.ok(byCategory.items.every((item) => item.category_slug === 'plumber'));

  const byPin = providers.searchProviders(db, { pin: '781001' });
  assert.ok(byPin.total >= 1, 'PIN 781001 has a seeded plumber');
  assert.ok(byPin.items.every((item) => item.pin_code === '781001' || providers.serviceAreas(db, item.id).includes('781001')));

  const verified = providers.searchProviders(db, { verifiedOnly: true });
  assert.ok(verified.items.every((item) => item.is_verified === true));

  // An unknown PIN returns an empty page, not an error.
  assert.equal(providers.searchProviders(db, { pin: '111111' }).total, 0);

  // A category word in the free-text query finds that trade's providers,
  // and the total agrees with the rows (count query must join categories).
  const byWord = providers.searchProviders(db, { query: 'plumber' });
  assert.ok(byWord.total >= 1, 'category word "plumber" finds plumber providers');
  assert.ok(byWord.items.every((item) => item.category_slug === 'plumber'));
  assert.ok(byWord.items.length <= byWord.total, 'row count never exceeds the total');
  db.close();
});

test('service areas are replaced, not appended', () => {
  const { db } = makeDb();
  const provider = providers.searchProviders(db, { pin: '781001' }).items[0];
  providers.setServiceAreas(db, provider.id, ['411038', '411057', '411038', 'bad']);
  assert.deepEqual(providers.serviceAreas(db, provider.id), ['411038', '411057']);
  db.close();
});

test('pending providers never appear in public search', () => {
  const { db } = makeDb();
  const category = categories.findBySlug(db, 'plumber');
  const place = locations.findByPin(db, '781001').chain[4];
  providers.createProvider(db, { businessName: 'Pending Only', categoryId: category.id, locationId: place.id, phone: '9000044444', status: 'pending' });
  const found = providers.searchProviders(db, { query: 'Pending Only' });
  assert.equal(found.total, 0);
  db.close();
});

/* ----------------------------------------------------------- service */

test('service price validation catches reversed and negative ranges', () => {
  const { db } = makeDb();
  const category = categories.findBySlug(db, 'plumber');
  const place = locations.findByPin(db, '781001').chain[4];
  const provider = providers.createProvider(db, { businessName: 'Price Test', categoryId: category.id, locationId: place.id, phone: '9000055555', status: 'active' });

  assert.throws(
    () => services.createService(db, { providerId: provider.id, categoryId: category.id, locationId: place.id, title: 'Bad range', priceMin: 500, priceMax: 100 }),
    /cannot be below/i,
  );
  assert.throws(
    () => services.createService(db, { providerId: provider.id, categoryId: category.id, locationId: place.id, title: 'Negative', priceMin: -5 }),
    />= 0/i,
  );
  assert.throws(
    () => services.createService(db, { providerId: provider.id, categoryId: category.id, locationId: place.id, title: 'Bad unit', priceUnit: 'fortnight' }),
    /price unit/i,
  );
  db.close();
});

test('draft services are excluded from search', () => {
  const { db } = makeDb();
  const category = categories.findBySlug(db, 'plumber');
  const place = locations.findByPin(db, '781001').chain[4];
  const provider = providers.createProvider(db, { businessName: 'Draft Test', categoryId: category.id, locationId: place.id, phone: '9000066666', status: 'active' });
  services.createService(db, { providerId: provider.id, categoryId: category.id, locationId: place.id, title: 'Hidden draft work', status: 'draft' });
  assert.equal(services.searchServices(db, { query: 'Hidden draft work' }).total, 0);
  db.close();
});

/* -------------------------------------------------------------- user */

test('passwords are hashed with scrypt and verified in constant time', () => {
  const hash = users.hashPassword('correct horse battery');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!hash.includes('correct horse battery'));
  assert.equal(users.verifyPassword('correct horse battery', hash), true);
  assert.equal(users.verifyPassword('wrong password', hash), false);
  assert.equal(users.verifyPassword('correct horse battery', 'not-a-hash'), false);
});

test('short passwords are refused', () => {
  assert.throws(() => users.hashPassword('short'), /at least 8 characters/i);
});

test('user creation validates email, deduplicates case-insensitively and normalises phone', () => {
  const { db } = makeDb();
  const { user } = users.createUser(db, { email: 'Rani@Example.com', fullName: 'Rani Das', password: 'password123', phone: '+91 90000 77777' });
  assert.equal(user.email, 'rani@example.com');
  assert.equal(user.phone, '9000077777');
  assert.equal(user.role, 'customer');
  assert.equal(user.status, 'pending');

  assert.throws(
    () => users.createUser(db, { email: 'RANI@example.com', fullName: 'Other', password: 'password123' }),
    /already exists/i,
  );
  assert.throws(
    () => users.createUser(db, { email: 'not-an-email', fullName: 'Other', password: 'password123' }),
    /valid email/i,
  );
  assert.throws(
    () => users.createUser(db, { email: 'ok@example.com', fullName: 'Other', password: 'password123', role: 'wizard' }),
    /Unknown role/i,
  );
  db.close();
});

/* -------------------------------------------------------------- lead */

test('an enquiry is captured against an active provider', () => {
  const { db } = makeDb();
  const provider = providers.searchProviders(db, { pin: '781001' }).items[0];
  const lead = leads.createLead(db, { providerId: provider.id, name: 'Anupam', phone: '9000088888', pinCode: '781001', message: 'Leaking kitchen tap' });
  assert.equal(lead.status, 'new');
  assert.equal(lead.phone, '9000088888');
  assert.equal(leads.count(db), 1);
  db.close();
});

test('enquiry validation rejects bad input and unknown providers', () => {
  const { db } = makeDb();
  const provider = providers.searchProviders(db, { pin: '781001' }).items[0];
  assert.throws(() => leads.createLead(db, { providerId: 99999, name: 'A', phone: '9000088888' }), /inactive provider/i);
  assert.throws(() => leads.createLead(db, { providerId: provider.id, name: '', phone: '9000088888' }), /name is required/i);
  assert.throws(() => leads.createLead(db, { providerId: provider.id, name: 'A', phone: '12345' }), /mobile number/i);
  assert.throws(() => leads.createLead(db, { providerId: provider.id, name: 'A', phone: '9000088888', pinCode: '12' }), /6 digits/i);
  db.close();
});

test('lead IPs are hashed, never stored raw', () => {
  const { db } = makeDb();
  const provider = providers.searchProviders(db, { pin: '781001' }).items[0];
  leads.createLead(db, { providerId: provider.id, name: 'A', phone: '9000088888', ip: '203.0.113.9', secret: 'test-secret' });
  const row = db.get('SELECT ip_hash FROM leads ORDER BY id DESC LIMIT 1');
  assert.match(row.ip_hash, /^[0-9a-f]{64}$/);
  assert.ok(!row.ip_hash.includes('203.0.113.9'));
  assert.equal(leads.recentCountFromIp(db, '203.0.113.9', { secret: 'test-secret' }), 1);
  assert.equal(leads.recentCountFromIp(db, '203.0.113.9', { secret: 'other-secret' }), 0, 'a different salt must not match');
  db.close();
});
