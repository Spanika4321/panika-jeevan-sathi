#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — apply migrations to the configured database.
 *
 *   node scripts/migrate.mjs
 *   SEVA_DB_FILE=/tmp/seva.db node scripts/migrate.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../src/config');
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');

const db = new Database(config.db.file);
const result = migrate(db, config.db.migrationsDir);

console.log(`Database : ${config.db.file}`);
console.log(`Applied  : ${result.applied.length ? result.applied.join(', ') : '(nothing — already up to date)'}`);
console.log(`Skipped  : ${result.skipped.length ? result.skipped.join(', ') : '(none)'}`);
db.close();
