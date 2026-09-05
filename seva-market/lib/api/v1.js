/**
 * SEVA MARKET INDIA — public API, version 1.
 *
 * Conventions:
 *   • every response is JSON; success is `{ok: true, ...}`;
 *   • failures are `{ok: false, error, code, details?}` with a proper status;
 *   • `/api/v1/home` returns one aggregated payload so a mobile home screen
 *     needs a single request on a slow connection.
 */
import { createRouter } from '../http/router.js';
import { city, state, district, locality, pincode, category, service, provider } from '../domain/index.js';
import { NotFoundError, UnauthorizedError } from '../errors.js';

export const API_VERSION = 'v1';

export function createApiV1({ db, config, services, bootedAt }) {
  const router = createRouter();
  const { users, geo, catalog, search, providers, locations } = services;

  const publicCategory = (row) => category.toPublic(row);
  const publicService = (row) => service.toPublic(row);

  /* ------------------------------------------------------------- platform */
  router.get('/api/v1/health', async () => ({
    status: 'ok',
    version: API_VERSION,
    environment: config.env,
    driver: db.kind,
    booted_at: bootedAt,
    uptime_ms: Date.now() - bootedAt
  }));

  router.get('/api/v1/meta', async () => ({
    site: config.site,
    api_version: API_VERSION,
    country: 'IN',
    counts: {
      categories: await db.count(category.table, {}),
      services: await db.count(service.table, {}),
      states: await db.count(state.table, {}),
      cities: await db.count(city.table, {}),
      providers: await db.count(provider.table, { status: 'approved', is_active: 1 })
    }
  }));

  /* -------------------------------------------------------------- catalogue */
  router.get('/api/v1/categories', async () => {
    const rows = await catalog.listCategories();
    return { items: rows.map(publicCategory), total: rows.length };
  });

  router.get('/api/v1/categories/:slug', async ({ params }) => {
    const row = await catalog.categoryBySlug(params.slug);
    if (!row) throw new NotFoundError('Category not found');
    const services = await catalog.listServices({ categoryId: row.id });
    return { item: { ...publicCategory(row), services: services.map(publicService) } };
  });

  router.get('/api/v1/services', async ({ query }) => {
    const rows = await catalog.listServices({ categorySlug: query.category, categoryId: query.category_id });
    return { items: rows.map(publicService), total: rows.length };
  });

  /* --------------------------------------------------------------- locations */
  router.get('/api/v1/locations/states', async () => {
    const rows = await geo.states();
    return { items: rows.map((row) => state.toPublic(row)), total: rows.length };
  });

  router.get('/api/v1/locations/districts', async ({ query }) => {
    const rows = await geo.districts({ stateSlug: query.state, stateId: query.state_id });
    return { items: rows.map((row) => district.toPublic(row)), total: rows.length };
  });

  router.get('/api/v1/locations/cities', async ({ query }) => {
    const rows = await geo.cities({ stateId: query.state_id, districtId: query.district_id, metroOnly: query.metro === '1' });
    return { items: rows.map((row) => city.toPublic(row)), total: rows.length };
  });

  router.get('/api/v1/locations/localities', async ({ query }) => {
    const rows = await geo.localities({ cityId: query.city_id, pincodeId: query.pincode_id });
    return { items: rows.map((row) => locality.toPublic(row)), total: rows.length };
  });

  router.get('/api/v1/locations/pincodes/:code', async ({ params }) => {
    const row = await geo.pincode(params.code);
    if (!row) throw new NotFoundError(`PIN code ${params.code} is not in our directory yet`);
    const place = await geo.describeFor({ pincode_id: row.id });
    return { item: { ...pincode.toPublic(row), place } };
  });

  router.get('/api/v1/locations/resolve', async ({ query }) => {
    const place = await geo.resolve({
      pincode: query.pincode,
      city: query.city,
      state: query.state,
      locality: query.locality,
      q: query.q
    });
    return { place };
  });

  /* ------------------------------------------------------------------ search */
  router.get('/api/v1/search', async ({ query }) => {
    const result = await search.search({
      service: query.service,
      category: query.category,
      city: query.city,
      state: query.state,
      pincode: query.pincode,
      locality: query.locality,
      q: query.q,
      keyword: query.keyword,
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 20,
      sort: query.sort || 'relevance'
    });
    return {
      items: result.items,
      pagination: result.pagination,
      place: result.place
    };
  });

  // Registered before the :slug route: a literal path must never be shadowed
  // by a parameter pattern of the same depth.
  router.get('/api/v1/providers/mine', async ({ user }) => {
    if (!user) throw new UnauthorizedError('Not signed in');
    const rows = await providers.listByUser(user.id);
    return { items: rows.map((row) => provider.toPublic(row)), total: rows.length };
  });

  router.get('/api/v1/providers/:slug', async ({ params }) => ({ item: await search.providerBySlug(params.slug) }));

  /* ----------------------------------------------------------------- home */
  router.get('/api/v1/home', async () => {
    const [categories, cities, featured] = await Promise.all([
      catalog.categoriesWithServices({ limit: 12 }),
      geo.cities({ metroOnly: true }),
      search.search({ limit: 6, sort: 'relevance' })
    ]);

    return {
      site: config.site,
      categories,
      popular_cities: cities.slice(0, 12).map((row) => city.toPublic(row)),
      featured_providers: featured.items,
      counts: {
        categories: await db.count(category.table, {}),
        cities: await db.count(city.table, {}),
        providers: await db.count(provider.table, { status: 'approved', is_active: 1 })
      }
    };
  });

  /* ------------------------------------------------------------------ auth */
  router.post(
    '/api/v1/auth/register',
    async ({ body, ip }) => {
      const result = await users.register(body, { ip });
      return {
        user: providerlessUser(result.user),
        token_expires_in_hours: result.expiresInHours,
        __cookie: result.cookie
      };
    },
    { rateLimit: { max: 10, windowMs: 60_000 } }
  );

  router.post(
    '/api/v1/auth/login',
    async ({ body, ip }) => {
      const result = await users.login(body, { ip });
      return {
        user: providerlessUser(result.user),
        token_expires_in_hours: result.expiresInHours,
        __cookie: result.cookie
      };
    },
    { rateLimit: { max: 10, windowMs: 60_000 } }
  );

  router.post('/api/v1/auth/logout', async () => ({ signed_out: true, __cookie: users.clearCookie() }));

  router.get('/api/v1/auth/me', async ({ user }) => {
    if (!user) throw new UnauthorizedError('Not signed in');
    return { user: providerlessUser(user) };
  });

  /* -------------------------------------------------------- provider listings */
  router.post('/api/v1/providers', async ({ body, user }) => {
    const listing = await services.providerService.createListing(body, user);
    return { item: provider.toPublic(listing), status: listing.status };
  });


  return router;
}

/** Strip every internal column before a user object leaves the process. */
function providerlessUser(row) {
  if (!row) return null;
  const { password_hash: _ignored, token_version: _alsoIgnored, ...safe } = row;
  return safe;
}
