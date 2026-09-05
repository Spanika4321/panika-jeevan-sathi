/**
 * Seeders.
 *
 * Two independent steps:
 *   1. `seedReferenceData` — countries, states/UTs, districts, cities, PIN
 *      codes, localities and the service catalogue. Safe to re-run: every write
 *      is idempotent and never overwrites an edited record.
 *   2. `seedDemoProviders` — demonstration listings, only ever run by an
 *      explicit command or in non-production environments.
 */
import { COUNTRY, STATES } from './data/states.js';
import { PLACES } from './data/places.js';
import { CATALOG } from './data/catalog.js';
import { DEMO_PROVIDERS } from './data/demo-providers.js';
import { buildSearchText } from '../services/providers.js';
import { slugify } from '../slug.js';

export async function seedReferenceData({ locations, catalog, log }) {
  const stats = { countries: 0, states: 0, districts: 0, cities: 0, pincodes: 0, localities: 0, categories: 0, services: 0 };

  const countryRow = await locations.createCountry(COUNTRY);
  stats.countries = 1;

  for (const entry of STATES) {
    const stateRow = await locations.createState({ ...entry, country_id: countryRow.id });
    if (stateRow) stats.states += 1;
  }

  for (const place of PLACES) {
    const stateRow = await locations.stateBySlug(slugify(place.state));
    if (!stateRow) {
      log?.warn(`seed: unknown state "${place.state}" — skipped`);
      continue;
    }

    for (const districtEntry of place.districts) {
      const districtRow = await locations.createDistrict({ state_id: stateRow.id, name: districtEntry.name });
      if (!districtRow) continue;
      stats.districts += 1;

      for (const cityEntry of districtEntry.cities) {
        const cityRow = await locations.createCity({
          state_id: stateRow.id,
          district_id: districtRow.id,
          name: cityEntry.name,
          is_metro: Boolean(cityEntry.metro)
        });
        if (!cityRow) continue;
        stats.cities += 1;

        for (const pinEntry of cityEntry.pincodes) {
          const pinRow = await locations.createPincode({
            code: pinEntry.code,
            office_name: pinEntry.office,
            city_id: cityRow.id,
            district_id: districtRow.id,
            state_id: stateRow.id
          });
          if (!pinRow) continue;
          stats.pincodes += 1;

          for (const localityName of pinEntry.localities || []) {
            const localityRow = await locations.createLocality({
              city_id: cityRow.id,
              pincode_id: pinRow.id,
              name: localityName
            });
            if (localityRow) stats.localities += 1;
          }
        }
      }
    }
  }

  for (const entry of CATALOG) {
    const categoryRow = await catalog.createCategory({
      name: entry.name,
      slug: entry.slug,
      icon: entry.icon,
      description: entry.description,
      sort_order: entry.sort_order
    });
    if (!categoryRow) continue;
    stats.categories += 1;

    for (const serviceEntry of entry.services) {
      const serviceRow = await catalog.createService({
        category_id: categoryRow.id,
        name: serviceEntry.name,
        slug: serviceEntry.slug,
        description: serviceEntry.description || '',
        sort_order: (entry.services.indexOf(serviceEntry) + 1) * 10
      });
      if (serviceRow) stats.services += 1;
    }
  }

  log?.info('reference data seeded', stats);
  return stats;
}

export async function seedDemoProviders({ db, providers, catalog, locations, log }) {
  let created = 0;

  for (const entry of DEMO_PROVIDERS) {
    const cityRow = await locations.cityBySlug(entry.city);
    const pincodeRow = entry.pincode ? await locations.pincodeByCode(entry.pincode) : null;
    const categoryRow = await catalog.categoryBySlug(entry.category);
    if (!cityRow || !categoryRow) {
      log?.warn(`seed: demo listing "${entry.business_name}" skipped (missing city or category)`);
      continue;
    }

    const localities = await locations.listLocalities({ cityId: cityRow.id });
    const localityRow =
      localities.find((row) => row.name.toLowerCase() === String(entry.locality || '').toLowerCase()) || null;

    const serviceRows = [];
    for (const slug of entry.services) {
      const serviceRow = await catalog.serviceBySlug(slug);
      if (serviceRow) serviceRows.push(serviceRow);
    }
    if (!serviceRows.length) continue;

    const existing = await providers.bySlug(slugify(entry.business_name));
    if (existing) continue;

    const searchText = buildSearchText({
      businessName: entry.business_name,
      tagline: entry.tagline,
      description: entry.description,
      categoryName: categoryRow.name,
      serviceNames: serviceRows.map((row) => row.name),
      cityName: cityRow.name,
      pincode: entry.pincode
    });

    const listing = await providers.create({
      business_name: entry.business_name,
      tagline: entry.tagline,
      description: entry.description,
      primary_category_id: categoryRow.id,
      address_line: localityRow ? `${localityRow.name}, ${cityRow.name}` : cityRow.name,
      locality_id: localityRow?.id || null,
      city_id: cityRow.id,
      district_id: cityRow.district_id,
      state_id: cityRow.state_id,
      pincode_id: pincodeRow?.id || null,
      pincode: entry.pincode || '',
      phone: entry.phone,
      whatsapp: entry.phone,
      experience_years: entry.experience_years,
      team_size: entry.team_size,
      service_radius_km: 12,
      status: 'approved',
      is_active: true,
      verification_level: entry.verification_level || 'phone',
      search_text: searchText
    });

    for (const [index, serviceRow] of serviceRows.entries()) {
      await providers.addService({
        provider_id: listing.id,
        service_id: serviceRow.id,
        category_id: serviceRow.category_id,
        price_from: entry.price_from,
        price_to: entry.price_to,
        price_unit: entry.price_unit || 'visit',
        is_primary: index === 0
      });
    }

    if (entry.pincode) {
      await providers.addArea({ provider_id: listing.id, pincode_id: pincodeRow?.id || null, pincode: entry.pincode });
    }

    created += 1;
  }

  log?.info('demo providers seeded', { created });
  return { created };
}

export async function seedAll({ db, services, log, demo = false }) {
  const reference = await seedReferenceData({ locations: services.locations, catalog: services.catalog, log });
  const demoResult = demo ? await seedDemoProviders({ db, providers: services.providers, catalog: services.catalog, locations: services.locations, log }) : { created: 0 };
  return { ...reference, demo_providers: demoResult.created };
}
