/**
 * Search service — "plumber in 110001" end to end.
 *
 * The service owns the orchestration (resolve the place → query the repository
 * → enrich rows with catalogue and place names); the repository owns storage.
 */
import { provider } from '../domain/index.js';
import { NotFoundError } from '../errors.js';

export function createSearchService({ providers, catalog, geo }) {
  return {
    /**
     * @param {{service?: string|string[], category?: string, city?: string,
     *          state?: string, pincode?: string, locality?: string, q?: string,
     *          keyword?: string, page?: number, limit?: number, sort?: string}} query
     */
    async search(query = {}) {
      const place = await geo.resolve({
        pincode: query.pincode,
        city: query.city,
        state: query.state,
        locality: query.locality,
        q: query.q
      });

      let serviceIds = [];
      if (query.service) {
        const wanted = [].concat(query.service).filter(Boolean);
        const services = [];
        for (const token of wanted) {
          const bySlug = await catalog.serviceBySlug(token);
          if (bySlug) services.push(bySlug);
        }
        serviceIds = services.map((row) => row.id);
        if (wanted.length && !serviceIds.length) {
          // Unknown service slug: return an empty result rather than silently
          // ignoring the customer's intent.
          return { items: [], pagination: emptyPagination(query), place, services: [] };
        }
      }

      let categoryId = null;
      if (query.category) {
        const categoryRow = await catalog.categoryBySlug(query.category);
        if (!categoryRow) return { items: [], pagination: emptyPagination(query), place, services: [] };
        categoryId = categoryRow.id;
      }

      const result = await providers.search({
        pincode: place.pincode,
        cityId: place.cityId,
        stateId: place.stateId,
        localityId: place.localityId,
        serviceIds,
        categoryId,
        keyword: query.keyword || '',
        page: query.page,
        limit: query.limit,
        sort: query.sort
      });

      const allServices = await catalog.listServices();
      const serviceById = new Map(allServices.map((row) => [row.id, row]));
      const links = await providers.servicesFor(result.items.map((row) => row.id));
      const linksByProvider = new Map();
      for (const link of links) {
        if (!linksByProvider.has(link.provider_id)) linksByProvider.set(link.provider_id, []);
        linksByProvider.get(link.provider_id).push({
          id: serviceById.get(link.service_id)?.id || link.service_id,
          name: serviceById.get(link.service_id)?.name || '',
          slug: serviceById.get(link.service_id)?.slug || '',
          price_from: link.price_from,
          price_to: link.price_to,
          price_unit: link.price_unit
        });
      }

      const items = result.items.map((row) => ({
        ...provider.toPublic(row),
        services: linksByProvider.get(row.id) || [],
        location: place
      }));

      return { items, pagination: result.pagination, place };
    },

    async providerBySlug(slug) {
      const row = await providers.bySlug(slug);
      if (!row || row.status !== 'approved' || !row.is_active) throw new NotFoundError('Provider not found');
      const place = await geo.describeFor(row);
      const links = await providers.servicesFor([row.id]);
      const allServices = await catalog.listServices();
      const serviceById = new Map(allServices.map((row2) => [row2.id, row2]));
      const areas = await providers.areasFor(row.id);
      return {
        ...provider.toPublic(row),
        location: place,
        areas: areas.map((area) => area.pincode),
        services: links.map((link) => ({
          id: serviceById.get(link.service_id)?.id || link.service_id,
          name: serviceById.get(link.service_id)?.name || '',
          slug: serviceById.get(link.service_id)?.slug || '',
          price_from: link.price_from,
          price_to: link.price_to,
          price_unit: link.price_unit
        }))
      };
    }
  };
}

function emptyPagination(query) {
  return {
    page: Number(query.page) || 1,
    limit: Number(query.limit) || 20,
    total: 0,
    pages: 1,
    has_more: false
  };
}
