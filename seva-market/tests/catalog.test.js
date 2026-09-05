import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from './helpers/app.js';
import { CATALOG } from '../lib/seed/data/catalog.js';

describe('service catalogue', () => {
  test('seeding loads every category with its services', async () => {
    const app = await createTestApp();
    const categories = await app.services.catalog.listCategories();
    assert.equal(categories.length, CATALOG.length);
    assert.equal(categories.length, 12);

    const services = await app.services.catalog.listServices();
    const expected = CATALOG.reduce((total, category) => total + category.services.length, 0);
    assert.equal(services.length, expected);
  });

  test('categories are ordered for browsing and expose an icon token', async () => {
    const app = await createTestApp();
    const categories = await app.services.catalog.listCategories();
    assert.equal(categories[0].slug, 'plumbing');
    assert.ok(categories.every((row) => row.icon), 'every category has an icon token');
    const order = categories.map((row) => row.sort_order);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });

  test('services belong to exactly one category', async () => {
    const app = await createTestApp();
    const plumbing = await app.services.catalog.categoryBySlug('plumbing');
    const services = await app.services.catalog.listServices({ categoryId: plumbing.id });
    const names = services.map((row) => row.name);
    assert.ok(names.includes('Tap & Faucet Repair'));
    assert.ok(names.includes('Pipe Leak Repair'));
    assert.ok(!names.includes('AC Service & Repair'), 'AC belongs to appliance repair');

    for (const row of services) {
      assert.equal(row.category_id, plumbing.id);
    }
  });

  test('services can be listed by category slug', async () => {
    const app = await createTestApp();
    const services = await app.services.catalog.listServices({ categorySlug: 'appliance-repair' });
    assert.ok(services.some((row) => row.slug === 'ac-service-repair'));
  });

  test('categories with nested services power the home screen in one call', async () => {
    const app = await createTestApp();
    const grouped = await app.services.catalog.categoriesWithServices();
    const plumbing = grouped.find((row) => row.slug === 'plumbing');
    assert.ok(plumbing.services.length >= 5);
    assert.equal(plumbing.services[0].name, 'Tap & Faucet Repair');
  });

  test('slugs are unique across categories', async () => {
    const app = await createTestApp();
    const before = await app.db.count('categories', {});
    await app.services.catalog.createCategory({ name: 'Plumbing', slug: 'plumbing' });
    assert.equal(await app.db.count('categories', {}), before, 'duplicate category names are ignored');

    const plumbing = await app.services.catalog.categoryBySlug('plumbing');
    const servicesBefore = await app.db.count('services', {});
    await app.services.catalog.createService({ category_id: plumbing.id, name: 'Pipe Leak Repair' });
    assert.equal(await app.db.count('services', {}), servicesBefore, 'duplicate services are ignored');
  });

  test('category and service lookups return null for unknown slugs', async () => {
    const app = await createTestApp();
    assert.equal(await app.services.catalog.categoryBySlug('nope'), null);
    assert.equal(await app.services.catalog.serviceBySlug('nope'), null);
  });
});
