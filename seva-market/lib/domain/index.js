/**
 * Domain model registry.
 *
 * `MODELS` is the single place that knows every table, its columns and its
 * unique constraints. It feeds:
 *   • lib/db/schema.js      — the in-memory driver's table registration,
 *   • tests/schema.test.js  — a drift guard against lib/db/migrations/*.sql,
 *   • scripts and seeders that need to know a table's shape.
 */
import { LOCATION_MODELS } from './location.js';
import { CATALOG_MODELS } from './catalog.js';
import { user } from './user.js';
import { PROVIDER_MODELS } from './provider.js';

export { LOCATION_MODELS, CATALOG_MODELS, PROVIDER_MODELS };
export { country, state, district, city, pincode, locality } from './location.js';
export { category, service } from './catalog.js';
export { user, ROLES, STATUSES } from './user.js';
export { provider, providerService, providerArea, PROVIDER_STATUSES, VERIFICATION_LEVELS, PRICE_UNITS } from './provider.js';

export const MODELS = {
  ...LOCATION_MODELS,
  ...CATALOG_MODELS,
  user,
  ...PROVIDER_MODELS
};

/** table name → model (used by validation and repository helpers). */
export const MODEL_BY_TABLE = Object.fromEntries(Object.values(MODELS).map((model) => [model.table, model]));

export function columnsOf(table) {
  const model = MODEL_BY_TABLE[table];
  if (!model) throw new Error(`Unknown table: ${table}`);
  return model.columns;
}
