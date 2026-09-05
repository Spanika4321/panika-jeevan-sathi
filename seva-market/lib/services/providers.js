/**
 * Provider onboarding service.
 *
 * Creating a listing touches four tables, so it runs in one transaction and
 * derives the search index and the serviceable PIN list from the input. No
 * payment, subscription or promotion logic lives here yet — listings are free
 * and go to `pending` review until the marketplace team approves them.
 */
import { provider } from '../domain/index.js';
import { validate, cleanText } from '../validate.js';
import { BadRequestError, ForbiddenError } from '../errors.js';

export function createProviderService({ db, providers, catalog, locations, log }) {
  return {
    /**
     * @param {object} input  listing draft
     * @param {object} actor  the signed-in user creating the listing
     */
    async createListing(input, actor) {
      if (!actor) throw new ForbiddenError('Sign in to list your business');

      const clean = validate(input, {
        business_name: provider.rules.business_name,
        tagline: { ...provider.rules.tagline, required: false },
        description: { ...provider.rules.description, required: false },
        address_line: { ...provider.rules.address_line, required: false },
        phone: provider.rules.phone,
        whatsapp: { ...provider.rules.whatsapp, required: false },
        email: { ...provider.rules.email, required: false },
        website: { ...provider.rules.website, required: false },
        pincode: provider.rules.pincode,
        locality_id: { ...provider.rules.locality_id, required: false },
        city_id: { ...provider.rules.city_id, required: false },
        experience_years: provider.rules.experience_years,
        team_size: provider.rules.team_size,
        service_radius_km: provider.rules.service_radius_km,
        latitude: { ...provider.rules.latitude, required: false },
        longitude: { ...provider.rules.longitude, required: false }
      });

      const serviceSlugs = [].concat(input.services || []).filter(Boolean);
      if (!serviceSlugs.length) throw new BadRequestError('Select at least one service you provide');

      const categoryRow = input.category
        ? await catalog.categoryBySlug(input.category)
        : await resolveCategoryFromService(catalog, serviceSlugs[0]);
      if (!categoryRow) throw new BadRequestError('Choose a valid category');

      const resolvedServices = [];
      for (const slug of serviceSlugs) {
        const row = await catalog.serviceBySlug(slug);
        if (!row) throw new BadRequestError(`Unknown service "${slug}"`);
        resolvedServices.push(row);
      }

      const pincodeRow = clean.pincode ? await locations.pincodeByCode(clean.pincode) : null;
      const cityId = clean.city_id || pincodeRow?.city_id || null;
      const cityRow = cityId ? await locations.cityById(cityId) : null;
      if (clean.pincode && !cityRow) {
        throw new BadRequestError('We do not serve this PIN code yet');
      }

      const searchText = buildSearchText({
        businessName: clean.business_name,
        tagline: clean.tagline,
        description: clean.description,
        categoryName: categoryRow.name,
        serviceNames: resolvedServices.map((row) => row.name),
        cityName: cityRow?.name,
        pincode: clean.pincode
      });

      const created = await db.transaction(async () => {
        const listing = await providers.create({
          ...clean,
          user_id: actor.id,
          primary_category_id: categoryRow.id,
          city_id: cityRow?.id || null,
          district_id: cityRow?.district_id || pincodeRow?.district_id || null,
          state_id: cityRow?.state_id || pincodeRow?.state_id || null,
          pincode_id: pincodeRow?.id || null,
          status: 'pending',
          is_active: false,
          search_text: searchText
        });

        for (const [index, serviceRow] of resolvedServices.entries()) {
          await providers.addService({
            provider_id: listing.id,
            service_id: serviceRow.id,
            category_id: serviceRow.category_id,
            is_primary: index === 0
          });
        }

        if (clean.pincode) {
          await providers.addArea({ provider_id: listing.id, pincode_id: pincodeRow?.id || null, pincode: clean.pincode });
        }

        return listing;
      });

      log?.info('provider listing created', { providerId: created.id, cityId, actorId: actor.id });
      return created;
    },

    async approve(id) {
      const updated = await providers.update(id, { status: 'approved', is_active: 1 });
      return updated;
    }
  };
}

async function resolveCategoryFromService(catalog, slug) {
  if (!slug) return null;
  for (const categoryRow of await catalog.listCategories()) {
    const services = await catalog.listServices({ categoryId: categoryRow.id });
    if (services.some((row) => row.slug === slug)) return categoryRow;
  }
  return null;
}

/** Lower-cased index kept on the provider row for portable keyword search. */
export function buildSearchText(parts) {
  return [
    parts.businessName,
    parts.tagline,
    parts.description,
    parts.categoryName,
    ...(parts.serviceNames || []),
    parts.cityName,
    parts.pincode
  ]
    .filter(Boolean)
    .map((value) => cleanText(value).toLowerCase())
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 2000);
}
