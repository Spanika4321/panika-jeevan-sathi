/**
 * Geo service — turning whatever a customer typed into a concrete place.
 *
 * Accepts a PIN code, a city slug, a state slug, a locality id, or a free-text
 * query, and returns the canonical hierarchy plus the ids search needs.
 */
import { normalisePincode } from '../validate.js';

const PINCODE_ONLY = /^\d{6}$/;

export function createGeoService({ locations }) {
  return {
    states() {
      return locations.listStates();
    },

    districts(query = {}) {
      return locations.listDistricts(query);
    },

    cities(query = {}) {
      return locations.listCities(query);
    },

    localities(query = {}) {
      return locations.listLocalities(query);
    },

    pincode(code) {
      return locations.pincodeByCode(code);
    },

    /** Breadcrumb for a provider row (used by provider detail + search results). */
    async describeFor(row) {
      const place = await locations.describe({
        pincodeId: row?.pincode_id || null,
        localityId: row?.locality_id || null,
        cityId: row?.city_id || null
      });
      return { ...place, label: await locations.label(place) };
    },

    /**
     * Resolve a place for search.
     * @returns {Promise<{pincode, cityId, stateId, localityId, place, label, matched: string|null}>}
     */
    async resolve({ pincode = '', city = '', state = '', locality = '', q = '' } = {}) {
      let pincodeRow = null;
      let cityRow = null;
      let stateRow = null;
      let localityRow = null;

      const query = String(q || '').trim();
      const code = normalisePincode(pincode || (PINCODE_ONLY.test(query) ? query : ''));
      if (code) pincodeRow = await locations.pincodeByCode(code);

      if (locality) localityRow = await locations.localityById(locality);
      if (city) cityRow = await locations.cityBySlug(city);
      if (state) stateRow = await locations.stateBySlug(state);

      // Free text that is not a PIN: try a city, then a state.
      if (!cityRow && !stateRow && query && !PINCODE_ONLY.test(query)) {
        const needle = query.toLowerCase();
        const cityMatches = await locations.listCities({});
        cityRow = cityMatches.find((row) => row.slug === needle || row.name.toLowerCase() === needle) || null;
        if (!cityRow) {
          const stateMatches = await locations.listStates();
          const match = stateMatches.find((row) => row.slug === needle || row.name.toLowerCase() === needle);
          if (match) stateRow = match;
        }
      }

      if (!cityRow && pincodeRow?.city_id) cityRow = await locations.cityById(pincodeRow.city_id);
      if (!stateRow && cityRow?.state_id) stateRow = await locations.stateById(cityRow.state_id);

      const place = await locations.describe({
        pincodeId: pincodeRow?.id || null,
        localityId: localityRow?.id || null,
        cityId: cityRow?.id || null,
        stateId: stateRow?.id || null
      });

      return {
        pincode: pincodeRow?.code || '',
        cityId: cityRow?.id || null,
        stateId: stateRow?.id || null,
        localityId: localityRow?.id || null,
        place,
        label: await locations.label(place),
        matched: pincodeRow ? 'pincode' : localityRow ? 'locality' : cityRow ? 'city' : stateRow ? 'state' : null
      };
    }
  };
}
