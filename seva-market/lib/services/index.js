/**
 * Service container.
 *
 * Repositories are constructed once from the driver and handed to the services
 * that need them. Creating the container is cheap and side-effect free, so
 * tests build one per case against the in-memory driver.
 */
import { createLocationRepository } from '../repo/locations.js';
import { createCatalogRepository } from '../repo/catalog.js';
import { createUserRepository } from '../repo/users.js';
import { createProviderRepository } from '../repo/providers.js';
import { createUserService } from './users.js';
import { createGeoService } from './geo.js';
import { createSearchService } from './search.js';
import { createProviderService } from './providers.js';

export function createServices({ db, config, log }) {
  const locations = createLocationRepository(db);
  const catalog = createCatalogRepository(db);
  const usersRepository = createUserRepository(db);
  const providers = createProviderRepository(db);

  const users = createUserService({ users: usersRepository, config, log });
  const geo = createGeoService({ locations });
  const search = createSearchService({ providers, catalog, geo });
  const providerService = createProviderService({ db, providers, catalog, locations, log });

  return { locations, catalog, usersRepository, providers, users, geo, search, providerService };
}
