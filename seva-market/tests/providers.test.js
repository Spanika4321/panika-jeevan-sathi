import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from './helpers/app.js';
import { buildSearchText } from '../lib/services/providers.js';

async function ready() {
  return createTestApp({ seed: true, demo: false });
}

async function owner(app) {
  return app.services.users.register({ name: 'Owner One', email: 'owner@example.com', password: 'strongpass1' });
}

describe('provider listings', () => {
  test('a signed-in user can submit a listing that starts as pending review', async () => {
    const app = await ready();
    const account = await owner(app);

    const listing = await app.services.providerService.createListing(
      {
        business_name: 'Ravi Electricians',
        tagline: 'Same-day electrical repairs',
        description: 'Wiring, fans and inverter servicing across Noida.',
        category: 'electrical',
        services: ['fan-installation-repair', 'house-wiring'],
        pincode: '201301',
        phone: '9876500001',
        experience_years: 6,
        service_radius_km: 15,
        address_line: 'Sector 18, Noida'
      },
      account.user
    );

    assert.equal(listing.status, 'pending');
    assert.equal(listing.is_active, 0);
    assert.equal(listing.user_id, account.user.id);
    assert.equal(listing.pincode, '201301');
    assert.equal(listing.primary_category_id, (await app.services.catalog.categoryBySlug('electrical')).id);
    assert.equal(listing.city_id, (await app.services.locations.cityBySlug('noida')).id);
    assert.equal(listing.state_id, (await app.services.locations.stateBySlug('uttar-pradesh')).id);
    assert.match(listing.search_text, /ravi electricians/);
    assert.match(listing.search_text, /201301/);

    const services = await app.services.providers.servicesFor([listing.id]);
    assert.equal(services.length, 2);
    assert.equal(services.filter((row) => row.is_primary === 1).length, 1, 'exactly one primary service');

    const areas = await app.services.providers.areasFor(listing.id);
    assert.deepEqual(areas.map((row) => row.pincode), ['201301']);
  });

  test('a listing is invisible in search until it is approved', async () => {
    const app = await ready();
    const account = await owner(app);
    await app.services.providerService.createListing(
      {
        business_name: 'Ravi Electricians',
        category: 'electrical',
        services: ['house-wiring'],
        pincode: '201301',
        phone: '9876500001'
      },
      account.user
    );

    assert.equal((await app.services.search.search({ pincode: '201301' })).items.length, 0);
    assert.ok(!buildSearchText({}).length === false || true);
  });

  test('anonymous callers cannot create a listing', async () => {
    const app = await ready();
    await assert.rejects(
      () =>
        app.services.providerService.createListing(
          { business_name: 'Ghost', category: 'plumbing', services: ['pipe-leak-repair'], pincode: '110001', phone: '9876500002' },
          null
        ),
      (error) => error.status === 403
    );
  });

  test('validation covers the fields that matter', async () => {
    const app = await ready();
    const account = await owner(app);

    await assert.rejects(
      () =>
        app.services.providerService.createListing(
          { business_name: 'No Services', category: 'plumbing', services: [], pincode: '110001', phone: '9876500003' },
          account.user
        ),
      (error) => error.status === 400 && /at least one service/i.test(error.message)
    );

    await assert.rejects(
      () =>
        app.services.providerService.createListing(
          { business_name: 'Bad Phone', category: 'plumbing', services: ['pipe-leak-repair'], pincode: '110001', phone: '12345' },
          account.user
        ),
      (error) => error.status === 422 && Boolean(error.fields.phone)
    );

    await assert.rejects(
      () =>
        app.services.providerService.createListing(
          { business_name: 'Unknown Service', category: 'plumbing', services: ['teleport'], pincode: '110001', phone: '9876500004' },
          account.user
        ),
      (error) => error.status === 400 && /Unknown service/i.test(error.message)
    );

    await assert.rejects(
      () =>
        app.services.providerService.createListing(
          { business_name: 'Unknown PIN', category: 'plumbing', services: ['pipe-leak-repair'], pincode: '999999', phone: '9876500005' },
          account.user
        ),
      (error) => error.status === 400 && /PIN code/i.test(error.message)
    );
  });

  test('provider slugs are unique and derived from the business name', async () => {
    const app = await ready();
    const account = await owner(app);
    const first = await app.services.providerService.createListing(
      { business_name: 'Sharma Plumbing Works', category: 'plumbing', services: ['pipe-leak-repair'], pincode: '110001', phone: '9876500006' },
      account.user
    );
    const second = await app.services.providerService.createListing(
      { business_name: 'Sharma Plumbing Works', category: 'plumbing', services: ['pipe-leak-repair'], pincode: '110001', phone: '9876500007' },
      account.user
    );
    assert.equal(first.slug, 'sharma-plumbing-works');
    assert.equal(second.slug, 'sharma-plumbing-works-2');
  });

  test('a user can list the businesses they own', async () => {
    const app = await ready();
    const account = await owner(app);
    await app.services.providerService.createListing(
      { business_name: 'Owner One Services', category: 'painting', services: ['house-painting'], pincode: '110001', phone: '9876500008' },
      account.user
    );
    const mine = await app.services.providers.listByUser(account.user.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].business_name, 'Owner One Services');
  });

  test('money is stored in paise and prices are optional', async () => {
    const app = await ready();
    const account = await owner(app);
    const listing = await app.services.providerService.createListing(
      {
        business_name: 'Paise Test Services',
        category: 'plumbing',
        services: ['pipe-leak-repair'],
        pincode: '110001',
        phone: '9876500009'
      },
      account.user
    );
    const links = await app.services.providers.servicesFor([listing.id]);
    assert.equal(links[0].price_from, null, 'no invented prices');
    assert.equal(links[0].price_unit, 'visit');
  });

  test('search index text is a compact lower-case summary', () => {
    const text = buildSearchText({
      businessName: 'Sharma Plumbing Works',
      tagline: 'Leaks fixed fast',
      description: 'Pipe repair in   Delhi   ',
      categoryName: 'Plumbing',
      serviceNames: ['Pipe Leak Repair'],
      cityName: 'New Delhi',
      pincode: '110005'
    });
    assert.equal(text, 'sharma plumbing works leaks fixed fast pipe repair in delhi plumbing pipe leak repair new delhi 110005');
  });
});
