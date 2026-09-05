/**
 * Location repository — all reads/writes for the place hierarchy.
 *
 * Repositories own SQL/driver access; services above them own rules. Nothing
 * outside this folder touches the driver for location data.
 */
import { country, state, district, city, pincode, locality } from '../domain/index.js';
import { validate } from '../validate.js';
import { NotFoundError } from '../errors.js';

export function createLocationRepository(db) {
  async function isSlugTaken(table, slug, extra = {}) {
    const row = await db.one(table, { slug, ...extra });
    return Boolean(row);
  }

  return {
    /* ------------------------------------------------------------ countries */
    async createCountry(input) {
      const clean = validate(input, country.rules);
      const row = country.toRow(clean);
      const existing = await db.one(country.table, { code: row.code });
      if (existing) return existing;
      return db.insert(country.table, row);
    },

    async countryByCode(code) {
      return db.one(country.table, { code: String(code || '').toUpperCase() });
    },

    /* --------------------------------------------------------------- states */
    async createState(input) {
      const clean = validate(input, state.rules);
      const withSlug = await state.withUniqueSlug(clean, (slug) => isSlugTaken(state.table, slug));
      const row = state.toRow(withSlug);
      const existing = await db.one(state.table, { country_id: row.country_id, name: row.name });
      if (existing) return existing;
      return db.insert(state.table, row);
    },

    listStates({ activeOnly = true } = {}) {
      return db.all(state.table, {
        where: activeOnly ? { is_active: 1 } : undefined,
        order: 'name'
      });
    },

    stateBySlug(slug) {
      return db.one(state.table, { slug: String(slug || '').toLowerCase() });
    },

    stateById(id) {
      return db.one(state.table, { id });
    },

    /* ------------------------------------------------------------ districts */
    async createDistrict(input) {
      const clean = validate(input, district.rules);
      const withSlug = await district.withUniqueSlug(clean, (slug) =>
        isSlugTaken(district.table, slug, { state_id: clean.state_id })
      );
      const row = district.toRow(withSlug);
      const existing = await db.one(district.table, { state_id: row.state_id, name: row.name });
      if (existing) return existing;
      return db.insert(district.table, row);
    },

    async listDistricts({ stateId, stateSlug } = {}) {
      let resolvedStateId = stateId || null;
      if (!resolvedStateId && stateSlug) {
        const stateRow = await db.one(state.table, { slug: String(stateSlug).toLowerCase() });
        if (!stateRow) return [];
        resolvedStateId = stateRow.id;
      }
      return db.all(district.table, {
        where: resolvedStateId ? { state_id: resolvedStateId, is_active: 1 } : { is_active: 1 },
        order: 'name'
      });
    },

    districtById(id) {
      return db.one(district.table, { id });
    },

    /* ---------------------------------------------------------------- cities */
    async createCity(input) {
      const clean = validate(input, city.rules);
      const withSlug = await city.withUniqueSlug(clean, (slug) =>
        isSlugTaken(city.table, slug, { state_id: clean.state_id })
      );
      const row = city.toRow(withSlug);
      const existing = await db.one(city.table, { district_id: row.district_id, name: row.name });
      if (existing) return existing;
      return db.insert(city.table, row);
    },

    listCities({ stateId, districtId, metroOnly = false, limit = 500 } = {}) {
      const where = { is_active: 1 };
      if (stateId) where.state_id = stateId;
      if (districtId) where.district_id = districtId;
      if (metroOnly) where.is_metro = 1;
      return db.all(city.table, { where, order: 'name', limit });
    },

    cityById(id) {
      return db.one(city.table, { id });
    },

    cityBySlug(slug, { stateId } = {}) {
      return db.one(city.table, { slug: String(slug || '').toLowerCase(), ...(stateId ? { state_id: stateId } : {}) });
    },

    /* ------------------------------------------------------------- pincodes */
    async createPincode(input) {
      const clean = validate(input, pincode.rules);
      const row = pincode.toRow(clean);
      const existing = await db.one(pincode.table, { code: row.code });
      if (existing) {
        await db.update(pincode.table, { id: existing.id }, { ...row, id: existing.id, created_at: existing.created_at });
        return db.one(pincode.table, { id: existing.id });
      }
      return db.insert(pincode.table, row);
    },

    pincodeByCode(code) {
      return db.one(pincode.table, { code: String(code || '').replace(/\D/g, '').slice(0, 6) });
    },

    listPincodes({ cityId } = {}) {
      return db.all(pincode.table, { where: cityId ? { city_id: cityId } : undefined, order: 'code' });
    },

    /* ------------------------------------------------------------ localities */
    async createLocality(input) {
      const clean = validate(input, locality.rules);
      const withSlug = await locality.withUniqueSlug(clean, (slug) =>
        isSlugTaken(locality.table, slug, { city_id: clean.city_id })
      );
      const row = locality.toRow(withSlug);
      const existing = await db.one(locality.table, { city_id: row.city_id, name: row.name });
      if (existing) return existing;
      return db.insert(locality.table, row);
    },

    listLocalities({ cityId, pincodeId, limit = 500 } = {}) {
      const where = { is_active: 1 };
      if (cityId) where.city_id = cityId;
      if (pincodeId) where.pincode_id = pincodeId;
      return db.all(locality.table, { where, order: 'name', limit });
    },

    localityById(id) {
      return db.one(locality.table, { id });
    },

    /**
     * Build the full place breadcrumb for an area: country → state → district
     * → city → locality, plus the PIN code. Missing links are returned as null
     * rather than throwing so a partially imported PIN still resolves.
     */
    async describe({ pincodeId, localityId, cityId, stateId } = {}) {
      let pincodeRow = pincodeId ? await db.one(pincode.table, { id: pincodeId }) : null;
      let localityRow = localityId ? await db.one(locality.table, { id: localityId }) : null;
      let cityRow = cityId ? await db.one(city.table, { id: cityId }) : null;
      let stateRow = null;

      if (!pincodeRow && localityRow?.pincode_id) pincodeRow = await db.one(pincode.table, { id: localityRow.pincode_id });
      if (!cityRow && localityRow) cityRow = await db.one(city.table, { id: localityRow.city_id });
      if (!cityRow && pincodeRow?.city_id) cityRow = await db.one(city.table, { id: pincodeRow.city_id });

      if (!stateRow && cityRow) stateRow = await db.one(state.table, { id: cityRow.state_id });
      if (!stateRow && stateId) stateRow = await db.one(state.table, { id: stateId });
      if (!stateRow && pincodeRow?.state_id) stateRow = await db.one(state.table, { id: pincodeRow.state_id });
      const districtRow = cityRow ? await db.one(district.table, { id: cityRow.district_id }) : null;
      const countryRow = stateRow ? await db.one(country.table, { id: stateRow.country_id }) : null;

      return {
        country: countryRow ? { id: countryRow.id, name: countryRow.name, code: countryRow.code } : null,
        state: stateRow ? state.toPublic(stateRow) : null,
        district: districtRow ? { id: districtRow.id, name: districtRow.name, slug: districtRow.slug } : null,
        city: cityRow ? city.toPublic(cityRow) : null,
        locality: localityRow ? locality.toPublic(localityRow) : null,
        pincode: pincodeRow ? pincode.toPublic(pincodeRow) : null
      };
    },

    /** Human label used in search boxes and breadcrumbs. */
    async label(described) {
      const parts = [];
      if (described?.locality) parts.push(described.locality.name);
      if (described?.city) parts.push(described.city.name);
      if (described?.state) parts.push(described.state.name);
      return parts.join(', ');
    },

    async requireState(slug) {
      const row = await this.stateBySlug(slug);
      if (!row) throw new NotFoundError(`State "${slug}" was not found`);
      return row;
    }
  };
}
