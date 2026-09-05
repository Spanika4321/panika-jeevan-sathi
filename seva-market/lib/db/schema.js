/**
 * Table registry derived from the domain models.
 *
 * The in-memory driver registers its tables from here, and tests/schema.test.js
 * asserts this registry still matches the SQL in lib/db/migrations — if a
 * migration and a model ever disagree, the test suite fails instead of prod.
 */
import { MODELS } from '../domain/index.js';

export const TABLES = Object.fromEntries(
  Object.values(MODELS).map((model) => [model.table, { columns: [...model.columns], unique: model.unique || [] }])
);

export const TABLE_NAMES = Object.keys(TABLES).sort();

export function columnsOf(table) {
  const entry = TABLES[table];
  if (!entry) throw new Error(`Unknown table: ${table}`);
  return entry.columns;
}
