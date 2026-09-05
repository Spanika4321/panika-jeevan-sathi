#!/usr/bin/env node
/**
 * Apply pending schema migrations.
 *   node scripts/migrate.js            # migrate the configured database
 *   node scripts/migrate.js --status   # show applied migrations
 */
import { loadConfig, assertValidConfig } from '../lib/config.js';
import { createLogger } from '../lib/log.js';
import { createSqliteDriver } from '../lib/db/driver-sqlite.js';
import { databaseFile } from '../lib/db/index.js';
import { migrate, migrationState, listMigrations } from '../lib/db/migrate.js';
import { MIGRATIONS_DIR } from '../lib/config.js';

const config = assertValidConfig(loadConfig(process.env, { autoMigrate: false, autoSeed: false }));
const log = createLogger({ level: config.logLevel, json: config.logJson });

if (config.driver === 'memory') {
  console.error('The memory driver has no schema to migrate. Use SEVA_DB_DRIVER=sqlite.');
  process.exit(1);
}

const driver = createSqliteDriver({ file: databaseFile(config), log });

if (process.argv.includes('--status')) {
  const applied = await migrationState(driver);
  const known = listMigrations(MIGRATIONS_DIR);
  console.log('\n  Migration status');
  for (const migration of known) {
    const row = applied.find((entry) => entry.version === migration.version);
    console.log(`  ${row ? 'applied ' : 'pending '} ${migration.name}${row ? ` (${row.checksum})` : ''}`);
  }
  console.log('');
} else {
  const result = await migrate(driver, { dir: MIGRATIONS_DIR, log });
  console.log(
    `\n  Migrations: ${result.applied.length} applied, ${result.skipped.length} already current (${config.driver})\n`
  );
}

await driver.close();
