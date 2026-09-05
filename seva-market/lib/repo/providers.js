/**
 * Provider repository.
 *
 * Search deliberately uses only the portable driver API (no raw SQL) so the
 * same code path — and therefore the same behaviour — is exercised by the
 * in-memory driver in tests and the SQLite driver in development.
 */
import { provider, providerService, providerArea } from '../domain/index.js';
import { validate } from '../validate.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 60;

export function createProviderRepository(db) {
  return {
    async create(input) {
      const clean = validate(input, {
        business_name: provider.rules.business_name,
        tagline: { ...provider.rules.tagline, required: false },
        description: { ...provider.rules.description, required: false },
        user_id: { ...provider.rules.user_id, required: false },
        primary_category_id: { ...provider.rules.primary_category_id, required: false },
        address_line: { ...provider.rules.address_line, required: false },
        locality_id: { ...provider.rules.locality_id, required: false },
        city_id: { ...provider.rules.city_id, required: false },
        district_id: { ...provider.rules.district_id, required: false },
        state_id: { ...provider.rules.state_id, required: false },
        pincode_id: { ...provider.rules.pincode_id, required: false },
        pincode: { ...provider.rules.pincode, required: false },
        latitude: { ...provider.rules.latitude, required: false },
        longitude: { ...provider.rules.longitude, required: false },
        service_radius_km: provider.rules.service_radius_km,
        phone: { ...provider.rules.phone, required: false },
        whatsapp: { ...provider.rules.whatsapp, required: false },
        email: { ...provider.rules.email, required: false },
        website: { ...provider.rules.website, required: false },
        experience_years: provider.rules.experience_years,
        team_size: provider.rules.team_size,
        status: provider.rules.status,
        verification_level: provider.rules.verification_level
      });

      const withSlug = await provider.withUniqueSlug(clean, async (slug) => Boolean(await db.one(provider.table, { slug })));
      const row = provider.toRow({ ...withSlug, search_text: input.search_text || '' });
      return db.insert(provider.table, row);
    },

    byId(id) {
      return db.one(provider.table, { id });
    },

    bySlug(slug) {
      return db.one(provider.table, { slug: String(slug || '').toLowerCase() });
    },

    listByUser(userId) {
      return db.all(provider.table, { where: { user_id: userId }, order: '-created_at' });
    },

    update(id, patch) {
      return db.update(provider.table, { id }, { ...patch, updated_at: Date.now() });
    },

    count(where = {}) {
      return db.count(provider.table, where);
    },

    /* -------------------------------------------------------------- services */
    async addService(input) {
      const clean = validate(input, providerService.rules);
      const row = providerService.toRow(clean);
      const existing = await db.one(providerService.table, {
        provider_id: row.provider_id,
        service_id: row.service_id
      });
      if (existing) {
        await db.update(providerService.table, { id: existing.id }, { ...row, id: existing.id });
        return db.one(providerService.table, { id: existing.id });
      }
      return db.insert(providerService.table, row);
    },

    servicesFor(providerIds) {
      const ids = [].concat(providerIds).filter(Boolean);
      if (!ids.length) return [];
      return db.all(providerService.table, { where: { provider_id: { in: ids } }, order: ['-is_primary', 'id'] });
    },

    /* ----------------------------------------------------------------- areas */
    async addArea(input) {
      const clean = validate(input, providerArea.rules);
      const row = providerArea.toRow(clean);
      const existing = await db.one(providerArea.table, { provider_id: row.provider_id, pincode: row.pincode });
      if (existing) return existing;
      return db.insert(providerArea.table, row);
    },

    areasFor(providerId) {
      return db.all(providerArea.table, { where: { provider_id: providerId }, order: 'pincode' });
    },

    /**
     * The marketplace's core query: find approved providers for a service in a
     * place. Returns rows plus pagination metadata.
     */
    async search({
      pincode = '',
      cityId = null,
      stateId = null,
      localityId = null,
      serviceIds = [],
      categoryId = null,
      keyword = '',
      page = 1,
      limit = DEFAULT_PAGE_SIZE,
      sort = 'relevance'
    } = {}) {
      const size = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
      const pageNumber = Math.max(Number(page) || 1, 1);

      // 1. Providers whose own PIN, service area or city matches the place.
      let candidates = null; // null = "no place filter"
      if (pincode) {
        const exact = await db.all(provider.table, {
          where: { pincode: String(pincode), is_active: 1, status: 'approved' }
        });
        const byArea = await db.all(providerArea.table, { where: { pincode: String(pincode) } });
        const areaIds = byArea.map((row) => row.provider_id);
        const areaProviders = areaIds.length
          ? await db.all(provider.table, { where: { id: { in: areaIds }, is_active: 1, status: 'approved' } })
          : [];
        const byCity = cityId
          ? await db.all(provider.table, { where: { city_id: cityId, is_active: 1, status: 'approved' } })
          : [];
        const merged = new Map();
        for (const row of [...exact, ...areaProviders, ...byCity]) merged.set(row.id, row);
        candidates = [...merged.values()];
      } else if (localityId) {
        const rows = await db.all(provider.table, {
          where: { locality_id: localityId, is_active: 1, status: 'approved' }
        });
        const inCity = cityId
          ? await db.all(provider.table, { where: { city_id: cityId, is_active: 1, status: 'approved' } })
          : [];
        const merged = new Map();
        for (const row of [...rows, ...inCity]) merged.set(row.id, row);
        candidates = [...merged.values()];
      } else if (cityId) {
        candidates = await db.all(provider.table, { where: { city_id: cityId, is_active: 1, status: 'approved' } });
      } else if (stateId) {
        candidates = await db.all(provider.table, { where: { state_id: stateId, is_active: 1, status: 'approved' } });
      } else {
        candidates = await db.all(provider.table, { where: { is_active: 1, status: 'approved' } });
      }

      // 2. Narrow by service (exact) and/or category.
      let idPool = new Set(candidates.map((row) => row.id));
      const serviceIdList = [].concat(serviceIds).filter(Boolean);

      if (serviceIdList.length) {
        const links = await db.all(providerService.table, {
          where: { service_id: { in: serviceIdList }, provider_id: { in: [...idPool] } }
        });
        idPool = new Set(links.map((row) => row.provider_id));
      } else if (categoryId) {
        const links = await db.all(providerService.table, {
          where: { category_id: categoryId, provider_id: { in: [...idPool] } }
        });
        const direct = candidates.filter((row) => row.primary_category_id === categoryId).map((row) => row.id);
        idPool = new Set([...links.map((row) => row.provider_id), ...direct].filter((id) => idPool.has(id)));
      }

      // 3. Keyword match against the maintained search_text column.
      let results = candidates.filter((row) => idPool.has(row.id));
      if (keyword) {
        const needle = String(keyword).toLowerCase().trim();
        results = results.filter((row) => String(row.search_text || '').includes(needle));
      }

      // 4. Sort. `relevance` prefers verified, better rated and nearer providers.
      const rank = (row) =>
        (row.verification_level === 'trusted' ? 3 : row.verification_level === 'document' ? 2 : row.verification_level === 'phone' ? 1 : 0);
      const rating = (row) => (row.rating_count ? row.rating_sum / row.rating_count : 0);

      if (sort === 'rating') results.sort((a, b) => rating(b) - rating(a) || b.rating_count - a.rating_count);
      else if (sort === 'experience') results.sort((a, b) => b.experience_years - a.experience_years);
      else if (sort === 'newest') results.sort((a, b) => b.created_at - a.created_at);
      else results.sort((a, b) => rank(b) - rank(a) || rating(b) - rating(a) || b.view_count - a.view_count);

      const total = results.length;
      const start = (pageNumber - 1) * size;
      const items = results.slice(start, start + size);

      return {
        items,
        pagination: {
          page: pageNumber,
          limit: size,
          total,
          pages: Math.max(1, Math.ceil(total / size)),
          has_more: start + items.length < total
        }
      };
    }
  };
}
