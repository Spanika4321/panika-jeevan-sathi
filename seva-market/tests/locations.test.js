import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from './helpers/app.js';
import { COUNTRY, STATES } from '../lib/seed/data/states.js';

describe('India location hierarchy', () => {
  test('seeding creates the country, all 36 states and union territories', async () => {
    const app = await createTestApp();
    const states = await app.services.geo.states();
    assert.equal(states.length, STATES.length);
    assert.equal(states.length, 36);

    const byName = new Map(states.map((row) => [row.name, row]));
    assert.equal(byName.get('Maharashtra').code, 'MH');
    assert.equal(byName.get('Delhi').type, 'union_territory');
    assert.equal(byName.get('Manipur').type, 'state');
    assert.ok(byName.get('Jammu and Kashmir'), 'union territories are seeded too');
  });

  test('every state belongs to India', async () => {
    const app = await createTestApp();
    const country = await app.services.locations.countryByCode(COUNTRY.code);
    assert.equal(country.name, 'India');
    assert.equal(country.currency_code, 'INR');

    const delhi = (await app.services.geo.states()).find((row) => row.name === 'Delhi');
    const place = await app.services.geo.describeFor({ city_id: (await app.services.locations.listCities({ stateId: delhi.id }))[0].id });
    assert.equal(place.country.code, 'IN');
    assert.equal(place.country.name, 'India');
  });

  test('state → district → city → pincode → locality chain resolves', async () => {
    const app = await createTestApp();
    const { locations, geo } = app.services;

    const pin = await locations.pincodeByCode('110005');
    assert.equal(pin.office_name, 'Karol Bagh');

    const place = await geo.describeFor({ pincode_id: pin.id });
    assert.equal(place.pincode.code, '110005');
    assert.equal(place.city.name, 'New Delhi');
    assert.equal(place.district.name, 'New Delhi');
    assert.equal(place.state.name, 'Delhi');
    assert.equal(place.country.code, 'IN');

    const localities = await locations.listLocalities({ pincodeId: pin.id });
    const names = localities.map((row) => row.name).sort();
    assert.deepEqual(names, ['Karol Bagh', 'Rajendra Place']);
  });

  test('a PIN code can be resolved into a full place for search', async () => {
    const app = await createTestApp();
    const place = await app.services.geo.resolve({ pincode: '560034' });
    assert.equal(place.matched, 'pincode');
    assert.equal(place.pincode, '560034');
    assert.equal(place.cityId, place.place.city.id);
    assert.equal(place.place.city.name, 'Bengaluru');
    assert.equal(place.place.state.name, 'Karnataka');
    assert.match(place.label, /Bengaluru/);
  });

  test('a city name or state name can be resolved from free text', async () => {
    const app = await createTestApp();
    const byCity = await app.services.geo.resolve({ q: 'Bengaluru' });
    assert.equal(byCity.matched, 'city');
    assert.equal(byCity.place.city.name, 'Bengaluru');

    const byState = await app.services.geo.resolve({ q: 'Manipur' });
    assert.equal(byState.matched, 'state');
    assert.equal(byState.place.state.name, 'Manipur');
  });

  test('an unknown place resolves to an empty result rather than throwing', async () => {
    const app = await createTestApp();
    const place = await app.services.geo.resolve({ q: 'Atlantis' });
    assert.equal(place.matched, null);
    assert.equal(place.cityId, null);
    assert.equal(place.label, '');
  });

  test('Manipur is represented, including the Bishnupur district', async () => {
    const app = await createTestApp();
    const manipur = await app.services.locations.stateBySlug('manipur');
    const districts = await app.services.locations.listDistricts({ stateId: manipur.id });
    const names = districts.map((row) => row.name).sort();
    assert.deepEqual(names, ['Bishnupur', 'Imphal West']);

    const moirang = await app.services.locations.cityBySlug('moirang');
    assert.ok(moirang);
    const pin = await app.services.locations.pincodeByCode('795133');
    assert.equal(pin.city_id, moirang.id);
  });

  test('metro cities are flagged for the home screen shortcuts', async () => {
    const app = await createTestApp();
    const metros = await app.services.geo.cities({ metroOnly: true });
    const names = metros.map((row) => row.name);
    for (const city of ['New Delhi', 'Mumbai', 'Bengaluru', 'Chennai', 'Kolkata', 'Hyderabad']) {
      assert.ok(names.includes(city), `${city} is a metro`);
    }
  });

  test('city and locality slugs are unique inside their parent', async () => {
    const app = await createTestApp();
    const { locations } = app.services;
    const delhi = await locations.stateBySlug('delhi');
    const cities = await locations.listCities({ stateId: delhi.id });
    assert.equal(cities.length, 1);

    // Re-seeding must not duplicate anything.
    const before = await app.db.count('cities', {});
    await app.services.locations.createCity({
      state_id: delhi.id,
      district_id: cities[0].district_id,
      name: 'New Delhi'
    });
    assert.equal(await app.db.count('cities', {}), before, 'creating the same city twice is a no-op');
  });

  test('PIN codes are unique and validated', async () => {
    const app = await createTestApp();
    await assert.rejects(() => app.services.locations.createPincode({ code: '00000' }));
    await assert.rejects(() => app.services.locations.createPincode({ code: '12' }));

    const before = await app.db.count('pincodes', {});
    await app.services.locations.createPincode({ code: '110005', office_name: 'Karol Bagh' });
    assert.equal(await app.db.count('pincodes', {}), before, 're-seeding a PIN updates instead of duplicating');
  });
});
