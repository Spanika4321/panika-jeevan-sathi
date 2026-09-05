/**
 * Registers the model registry with the in-memory driver.
 *
 * The memory driver cannot execute DDL, so it learns the table names and unique
 * constraints from lib/db/schema.js — the same registry the SQLite migrations
 * are validated against.
 */
import { TABLES } from './schema.js';

export async function registerMemorySchema(driver, { log } = {}) {
  for (const [table, definition] of Object.entries(TABLES)) {
    // Register the shape, then the unique constraints.
    if (typeof driver.registerTable === 'function') {
      await driver.registerTable(table, definition.columns);
    }
    await driver.all(table, { limit: 0 });
    for (const unique of definition.unique || []) {
      await driver.createUniqueIndex(table, unique);
    }
  }
  log?.debug(`memory schema registered (${Object.keys(TABLES).length} tables)`);
  return driver;
}
