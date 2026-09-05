/**
 * Database factory — picks a driver from configuration and migrates it.
 *
 * Every driver exposes the same small contract (insert / update / upsert /
 * remove / one / all / count / query / transaction), so domain code never knows
 * whether it is talking to SQLite, Postgres or memory.
 */
import path from 'node:path';
import { createSqliteDriver } from './driver-sqlite.js';
import { createMemoryDriver } from './driver-memory.js';
import { migrate, migrationState } from './migrate.js';
import { MIGRATIONS_DIR } from '../config.js';
import { UnavailableError } from '../errors.js';

export { migrate, migrationState };

export function databaseFile(config) {
  if (config.driver === 'memory') return ':memory:';
  return path.join(config.dataDir, 'seva-market.db');
}

export async function openDatabase(config, { log, migrationsDir = MIGRATIONS_DIR } = {}) {
  if (config.driver === 'memory') {
    const driver = createMemoryDriver({ log });
    // The memory driver cannot run DDL, so models register their shape instead.
    const { registerMemorySchema } = await import('./memory-schema.js');
    await registerMemorySchema(driver, { log });
    return { driver, migrations: { applied: [], skipped: [] } };
  }

  if (config.driver === 'postgres') {
    // Reserved: the portable SQL in lib/db/migrations is written to run on
    // PostgreSQL unchanged. Enabling this driver is a follow-up step.
    throw new UnavailableError('The postgres driver is not enabled yet; use SEVA_DB_DRIVER=sqlite locally.');
  }

  const driver = createSqliteDriver({ file: databaseFile(config), log });
  const migrations = config.autoMigrate === false ? { applied: [], skipped: [] } : await migrate(driver, { dir: migrationsDir, log });
  return { driver, migrations };
}
