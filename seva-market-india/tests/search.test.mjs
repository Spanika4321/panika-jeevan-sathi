/**
 * SEVA MARKET INDIA — search behaviour tests.
 *
 * The marketplace exists to answer "who can fix X near Y, PIN Z". These
 * tests pin that contract down, including the awkward combinations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeDb } from './helpers.mjs';

const require = createRequire(import.meta.url);
const services = require('../src/models/service');
const categories = require('../src/models/category');
const locations = require('../src/models/location');
const providers = require('../src/models/provider');
const { resolveSearchFilters, describeFilters } = require('../src/routes/search-context');

test('searching by PIN returns services covering that PIN', () => {
  const { db } = makeDb();
  const result = services.searchServices(db, { pin: '781001' });
  assert.ok(result.total >= 2, 'Guwahati 781001 has two seeded plumbers/services');
  assert.ok(result.items.every((item) => item.status === 'active'));
  db.close();
});

test('searching by category name expands to child categories', () => {
  const { db } = makeDb();
  const parent = categories.findBySlug(db, 'home-repair-maintenance');
  const ids = categories.selfAndDescendantIds(db, parent.id);
  const result = services.searchServices(db, { categoryIds: ids });
  assert.ok(result.total > 0);
  // Every result must sit inside the requested subtree.
  for (const item of result.items) {
    assert.ok(item.category_id, 'results must expose their category id');
    assert.ok(ids.includes(item.category_id), 'result must sit inside the requested subtree');
  }
  db.close();
});

test('searching by free text matches title, description and business name', () => {
  const { db } = makeDb();
  assert.ok(services.searchServices(db, { query: 'Bathroom' }).total >= 1, 'title match');
  assert.ok(services.searchServices(db, { query: 'inverter' }).total >= 1, 'description match');
  assert.ok(services.searchServices(db, { query: 'Cool Care' }).total >= 1, 'provider name match');
  assert.equal(services.searchServices(db, { query: 'zzzznotathing' }).total, 0);
  db.close();
});

test('searching by free text also matches the category name', () => {
  const { db } = makeDb();
  // The homepage placeholder invites exactly these words: "Plumber,
  // electrician, tutor..." — they must find that category's services.
  assert.ok(services.searchServices(db, { query: 'plumber' }).total >= 1, 'category word "plumber" finds plumber services');
  assert.ok(services.searchServices(db, { query: 'Plumber' }).total >= 1, 'category match is case-insensitive');
  for (const item of services.searchServices(db, { query: 'plumber' }).items) {
    assert.equal(item.category_slug, 'plumber', 'matched service belongs to the searched category');
  }
  db.close();
});

test('service and PIN filters combine with AND, not OR', () => {
  const { db } = makeDb();
  const plumber = categories.findBySlug(db, 'plumber');
  const both = services.searchServices(db, { categoryIds: [plumber.id], pin: '781001' });
  const eitherPin = services.searchServices(db, { pin: '781001' });
  assert.ok(both.total > 0);
  assert.ok(both.total <= eitherPin.total);
  assert.ok(both.items.every((item) => item.category_slug === 'plumber'));
  db.close();
});

test('a PIN the provider only *serves* still matches (service_areas)', () => {
  const { db } = makeDb();
  // Cool Care Delhi sits in Lajpat Nagar 110024 but also covers Dwarka 110075.
  const direct = services.searchServices(db, { pin: '110024' });
  const covered = services.searchServices(db, { pin: '110075' });
  assert.ok(direct.total >= 1);
  assert.ok(covered.total >= 1, 'coverage PINs must be searchable');
  assert.ok(covered.items.every((item) => item.pin_code !== '110075'), 'matched via service_areas, not the primary PIN');
  db.close();
});

test('LIKE wildcards in user input are escaped, not interpreted', () => {
  const { db } = makeDb();
  // A raw '%' would otherwise match every row.
  assert.equal(services.searchServices(db, { query: '%' }).total, 0);
  assert.equal(services.searchServices(db, { query: '___' }).total, 0);
  db.close();
});

test('pagination clamps limits and reports page counts', () => {
  const { db } = makeDb();
  const page1 = services.searchServices(db, { limit: 2, offset: 0 });
  const page2 = services.searchServices(db, { limit: 2, offset: 2 });
  assert.equal(page1.items.length, 2);
  assert.ok(page2.items.length <= 2);
  assert.equal(page1.total, page2.total, 'total must not depend on the page');
  const ids1 = page1.items.map((item) => item.id);
  const ids2 = page2.items.map((item) => item.id);
  assert.equal(ids1.filter((id) => ids2.includes(id)).length, 0, 'pages must not overlap');
  db.close();
});

test('resolveSearchFilters maps query strings to typed filters', () => {
  const { db } = makeDb();
  const filters = resolveSearchFilters(db, new URLSearchParams('category=plumber&pin=781001&place=Guwahati&q=tap&limit=5&page=2'));

  assert.equal(filters.category.slug, 'plumber');
  assert.ok(filters.categoryIds.includes(filters.category.id));
  assert.equal(filters.pin, '781001');
  assert.equal(filters.location.name, 'Guwahati');
  assert.equal(filters.query, 'tap');
  assert.equal(filters.limit, 5);
  assert.equal(filters.page, 2);
  assert.equal(filters.offset, 5);
  db.close();
});

test('an invalid PIN is flagged but does not throw during resolution', () => {
  const { db } = makeDb();
  const bad = resolveSearchFilters(db, new URLSearchParams('pin=000111'));
  assert.equal(bad.pin, null);
  assert.equal(bad.pinValid, false);
  db.close();
});

test('an unknown place yields an honest empty page, not every listing in India', () => {
  const { db } = makeDb();
  const filters = resolveSearchFilters(db, new URLSearchParams('place=Atlantis'));
  assert.equal(filters.location, null);
  assert.equal(filters.locationId, null);
  assert.deepEqual(filters.locationIds, [], 'unresolved place must not silently widen the search');
  const result = services.searchServices(db, filters);
  assert.equal(result.total, 0, 'an unknown place must not show services from other cities');
  // The heading still names the place the customer typed.
  assert.match(describeFilters(filters), /Atlantis/);
  db.close();
});

test('an unknown category slug degrades to an unfiltered category', () => {
  const { db } = makeDb();
  const filters = resolveSearchFilters(db, new URLSearchParams('category=astrologer'));
  assert.equal(filters.category, null);
  assert.equal(filters.categoryIds, null);
  const result = services.searchServices(db, filters);
  assert.ok(result.total > 0, 'an unknown filter must not return a hard failure');
  db.close();
});

test('describeFilters produces a readable heading', () => {
  const { db } = makeDb();
  const filters = resolveSearchFilters(db, new URLSearchParams('category=plumber&pin=781001'));
  const text = describeFilters(filters);
  assert.match(text, /Plumber/);
  assert.match(text, /781001/);
  assert.equal(describeFilters(resolveSearchFilters(db, new URLSearchParams(''))), 'All services across India');
  db.close();
});

test('popular categories only include categories with live services', () => {
  const { db } = makeDb();
  const popular = services.popularCategories(db, 8);
  assert.ok(popular.length > 0);
  assert.ok(popular.every((row) => row.service_count > 0));
  const counts = popular.map((row) => row.service_count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'must be sorted by service count');
  db.close();
});

test('search never returns services from suspended providers', () => {
  const { db } = makeDb();
  const provider = providers.searchProviders(db, { pin: '781001' }).items[0];
  const before = services.searchServices(db, { pin: '781001' }).total;
  providers.setStatus(db, provider.id, 'suspended');
  const after = services.searchServices(db, { pin: '781001' }).total;
  assert.ok(after < before, 'suspending a provider must remove its services from search');
  db.close();
});

test('breadcrumb labels survive into search results', () => {
  const { db } = makeDb();
  const result = services.searchServices(db, { pin: '781001' });
  const item = result.items[0];
  assert.ok(item.location_label, 'results need a human-readable place label');
  assert.match(item.location_label, /India$/);
  const resolved = locations.findByPin(db, item.pin_code);
  assert.ok(resolved, 'every result PIN must be resolvable back to the tree');
  db.close();
});
