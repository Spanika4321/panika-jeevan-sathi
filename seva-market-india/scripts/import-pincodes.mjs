#!/usr/bin/env node
/**
 * SEVA MARKET INDIA — full location master importer (milestone 4).
 *
 * Bulk-loads the India → State → District → City → Locality → PIN tree from
 * a JSON array of PIN records and reports how many new nodes each level
 * gained. Safe to run repeatedly: `ensureLocation` matches on
 * (kind, parent_id, slug), so a re-run imports nothing new.
 *
 * Usage:
 *   node scripts/import-pincodes.mjs [path/to/pincodes.json]
 *
 * JSON shape:
 *   [
 *     { "pin": "380001", "state": "Gujarat", "district": "Ahmedabad",
 *       "city": "Ahmedabad", "locality": "Lal Darwaja" },
 *     ...
 *   ]
 *
 * Turning a raw Indian-PIN CSV into this shape is left to the operator
 * because no public dataset has one canonical "locality" per row. A starter
 * file lives at scripts/sample-pincodes.json.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const locationModel = require('../src/models/location');
const config = require('../src/config');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, 'sample-pincodes.json');

function clean(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim() || null;
}

const LEVELS = ['state', 'district', 'city', 'locality', 'pincode'];

function totals(db) {
  const stats = locationModel.stats(db);
  return Object.fromEntries(LEVELS.map((level) => [level, stats[level] || 0]));
}

function main() {
  const target = process.argv[2] || DEFAULT_FILE;
  if (!existsSync(target)) {
    console.error(`Data file not found: ${target}`);
    process.exit(1);
  }

  const db = new Database(config.db.file);
  migrate(db, config.db.migrationsDir);

  const records = JSON.parse(readFileSync(target, 'utf8'));
  if (!Array.isArray(records) || !records.length) {
    console.error('Expected a non-empty JSON array of PIN records.');
    db.close();
    process.exit(1);
  }

  const before = totals(db);

  db.transaction(() => {
    const india = locationModel.ensureIndia(db);
    for (const rec of records) {
      const pin = clean(rec.pin);
      const state = clean(rec.state);
      const district = clean(rec.district);
      const city = clean(rec.city) || district;
      const locality = clean(rec.locality) || city;

      if (!pin || !state || !district || !city || !locality) {
        console.warn(`Skipped record with missing fields: ${JSON.stringify(rec)}`);
        continue;
      }

      const stateRow = locationModel.ensureLocation(db, { kind: 'state', parentId: india.id, name: state });
      const districtRow = locationModel.ensureLocation(db, { kind: 'district', parentId: stateRow.id, name: district });
      const cityRow = locationModel.ensureLocation(db, { kind: 'city', parentId: districtRow.id, name: city });
      const localityRow = locationModel.ensureLocation(db, { kind: 'locality', parentId: cityRow.id, name: locality });
      locationModel.ensureLocation(db, { kind: 'pincode', parentId: localityRow.id, name: pin, pinCode: pin });
    }
  });

  const after = totals(db);
  const added = Object.fromEntries(
    LEVELS.map((level) => [level, after[level] - before[level]]),
  );

  console.log(`Imported ${target} (${records.length} records)`);
  console.log({ added, now: after });
  db.close();
}

main();
