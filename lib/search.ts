import { and, eq, inArray, like, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  cities,
  localities,
  providerProfiles,
  serviceListings,
  services,
} from "@/db/schema";
import type { SearchParams } from "@/lib/validation";

/**
 * Shared provider-search filter — single source of truth used by
 * app/search/page.tsx AND tests/db.test.ts.
 *
 * Matching semantics (SQLite `LIKE` is case-insensitive for ASCII):
 *  · service   → provider business name, service name, or category name
 *  · location  → locality name or city name
 *  · pin       → exact locality PIN (validated upstream)
 */
export function buildProviderWhere(f: SearchParams): SQL | undefined {
  const conditions: Array<SQL | undefined> = [eq(providerProfiles.isActive, true)];

  if (f.service) {
    const term = `%${f.service}%`;
    const matchingProviderIds = db
      .selectDistinct({ id: serviceListings.providerId })
      .from(serviceListings)
      .innerJoin(services, eq(serviceListings.serviceId, services.id))
      .innerJoin(categories, eq(services.categoryId, categories.id))
      .where(or(like(services.name, term), like(categories.name, term)));

    conditions.push(or(like(providerProfiles.businessName, term), inArray(providerProfiles.id, matchingProviderIds)));
  }

  if (f.location) {
    const term = `%${f.location}%`;
    const matchingLocalityIds = db
      .selectDistinct({ id: localities.id })
      .from(localities)
      .leftJoin(cities, eq(localities.cityId, cities.id))
      .where(or(like(localities.name, term), like(cities.name, term)));

    conditions.push(inArray(providerProfiles.localityId, matchingLocalityIds));
  }

  if (f.pin) {
    const matchingLocalityIds = db
      .selectDistinct({ id: localities.id })
      .from(localities)
      .where(eq(localities.pinCode, f.pin));

    conditions.push(inArray(providerProfiles.localityId, matchingLocalityIds));
  }

  return and(...conditions);
}
