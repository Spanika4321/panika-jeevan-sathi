#!/usr/bin/env node
/**
 * Seed the marketplace.
 *   node scripts/seed.js            # reference data (countries → PIN codes, catalogue)
 *   node scripts/seed.js --demo     # + demonstration provider listings
 */
import { loadConfig, assertValidConfig } from '../lib/config.js';
import { createLogger } from '../lib/log.js';
import { openDatabase } from '../lib/db/index.js';
import { createServices } from '../lib/services/index.js';
import { seedAll } from '../lib/seed/index.js';

const config = assertValidConfig(loadConfig(process.env, { autoMigrate: true, autoSeed: false }));
const log = createLogger({ level: config.logLevel, json: config.logJson });
const { driver } = await openDatabase(config, { log });
const services = createServices({ db: driver, config, log });

const result = await seedAll({
  db: driver,
  services,
  log,
  demo: process.argv.includes('--demo')
});

console.log('\n  Seeded:');
for (const [key, value] of Object.entries(result)) {
  console.log(`    ${key.padEnd(16)} ${value}`);
}
console.log('');

await driver.close();
