import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from './helpers/app.js';

/** App seeded with real reference data + the demonstration listings. */
async function marketplace() {
  return createTestApp({ seed: true, demo: true });
}

describe('provider search', () => {
  test('searching a PIN code returns providers serving it', async () => {
    const app = await marketplace();
    const result = await app.services.search.search({ pincode: '110005' });
    assert.ok(result.items.length >= 1);
    assert.ok(result.items.some((row) => row.business_name === 'Sharma Plumbing Works'));
    assert.equal(result.place.pincode, '110005');
    assert.equal(result.place.place.city.name, 'New Delhi');
  });

  test('searching by service slug finds the providers offering it', async () => {
    const app = await marketplace();
    const result = await app.services.search.search({ service: 'ac-service-repair' });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].business_name, 'Cool Care AC & Appliance Repair');
    assert.ok(result.items[0].services.some((service) => service.slug === 'ac-service-repair'));
  });

  test('searching by category covers every provider linked to a service in it', async () => {
    const app = await marketplace();
    const result = await app.services.search.search({ category: 'home-cleaning' });
    const names = result.items.map((row) => row.business_name).sort();
    assert.deepEqual(names, ['Loitongbam Home Care', 'Sparkle Home Deep Cleaning']);
  });

  test('service + PIN code together narrow the result set', async () => {
    const app = await marketplace();
    const inBengaluru = await app.services.search.search({ service: 'full-home-deep-cleaning', pincode: '560034' });
    assert.equal(inBengaluru.items.length, 1);
    assert.equal(inBengaluru.items[0].business_name, 'Sparkle Home Deep Cleaning');

    const wrongPin = await app.services.search.search({ service: 'full-home-deep-cleaning', pincode: '110005' });
    assert.equal(wrongPin.items.length, 0, 'a provider is not returned outside its service area');
  });

  test('an unknown service slug returns nothing instead of ignoring the filter', async () => {
    const app = await marketplace();
    const result = await app.services.search.search({ service: 'teleportation' });
    assert.equal(result.items.length, 0);
    assert.equal(result.pagination.total, 0);
  });

  test('a free-text query resolves to a city', async () => {
    const app = await marketplace();
    const result = await app.services.search.search({ q: 'Chennai' });
    assert.ok(result.items.some((row) => row.business_name === 'SafeHome Pest Control'));
    assert.equal(result.place.place.city.name, 'Chennai');
  });

  test('keyword search matches the maintained search index', async () => {
    const app = await marketplace();
    const result = await app.services.search.search({ keyword: 'waterproofing' });
    assert.ok(result.items.some((row) => row.business_name === 'Rangrez Painters & Waterproofing'));
  });

  test('results are paginated with honest metadata', async () => {
    const app = await marketplace();
    const first = await app.services.search.search({ limit: 5, page: 1 });
    assert.equal(first.items.length, 5);
    assert.equal(first.pagination.page, 1);
    assert.equal(first.pagination.limit, 5);
    assert.equal(first.pagination.total, 12);
    assert.equal(first.pagination.pages, 3);
    assert.equal(first.pagination.has_more, true);

    const last = await app.services.search.search({ limit: 5, page: 3 });
    assert.equal(last.items.length, 2);
    assert.equal(last.pagination.has_more, false);
  });

  test('page size is capped so nobody can ask for the whole table', async () => {
    const app = await marketplace();
    const result = await app.services.search.search({ limit: 5000 });
    assert.equal(result.pagination.limit, 60);
  });

  test('sorting by rating and by experience works', async () => {
    const app = await marketplace();
    const byExperience = await app.services.search.search({ sort: 'experience', limit: 3 });
    const years = byExperience.items.map((row) => row.experience_years);
    assert.deepEqual(years, [...years].sort((a, b) => b - a));
    assert.equal(byExperience.items[0].business_name, 'Irfan Carpentry & Modular Works');
  });

  test('only approved and active providers are ever returned', async () => {
    const app = await marketplace();
    const pending = await app.services.providers.create({
      business_name: 'Hidden Pending Provider',
      city_id: (await app.services.locations.cityBySlug('new-delhi')).id,
      pincode: '110005',
      status: 'pending',
      is_active: false,
      phone: '9000000001'
    });
    assert.ok(pending);

    const result = await app.services.search.search({ pincode: '110005' });
    assert.ok(!result.items.some((row) => row.business_name === 'Hidden Pending Provider'));

    await app.services.providerService.approve(pending.id);
    const afterApproval = await app.services.search.search({ pincode: '110005' });
    assert.ok(afterApproval.items.some((row) => row.business_name === 'Hidden Pending Provider'));
  });

  test('provider detail resolves the full place breadcrumb, services and areas', async () => {
    const app = await marketplace();
    const detail = await app.services.search.providerBySlug('sharma-plumbing-works');
    assert.equal(detail.business_name, 'Sharma Plumbing Works');
    assert.equal(detail.location.city.name, 'New Delhi');
    assert.equal(detail.location.state.name, 'Delhi');
    assert.equal(detail.location.locality.name, 'Karol Bagh');
    assert.deepEqual(detail.areas, ['110005']);
    assert.equal(detail.services.length, 3);
    assert.equal(detail.verification_level, 'trusted');
  });

  test('an unknown provider slug raises a 404', async () => {
    const app = await marketplace();
    await assert.rejects(() => app.services.search.providerBySlug('does-not-exist'), (error) => error.status === 404);
  });

  test('search results carry the price range in paise and a formatted rating', async () => {
    const app = await marketplace();
    const result = await app.services.search.search({ service: 'tap-faucet-repair', pincode: '110005' });
    const provider = result.items[0];
    assert.equal(provider.services[0].price_from, 19900);
    assert.equal(provider.rating, null, 'no reviews yet means no fabricated rating');
    assert.equal(provider.rating_count, 0);
  });
});
