#!/usr/bin/env node
/**
 * SEVA MARKET INDIA — load the FULL Indian location master.
 *
 * Reads the nationwide India-Codes postal directory CSV (39k+ rows covering
 * all 36 states/UTs, every district, city and post-office area) and inserts
 * the whole India -> State -> District -> City -> Area/Locality -> PIN tree
 * into the database.
 *
 * Usage:
 *   node scripts/load-full-pincodes.mjs /path/to/pincodes.csv
 *
 * CSV columns (as shipped by kishorek/India-Codes):
 *   PostOfficeName, Pincode, DistrictsName, City, State
 *
 * Notes
 *   - Idempotent at the node level (re-running adds nothing new).
 *   - One PIN node is kept per PIN code globally, even when several post
 *     offices share a PIN; each office still gets its own locality so city /
 *     area search stays rich.
 *   - Legacy state names are normalised to their current spellings and a
 *     handful of malformed rows are skipped.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const locationModel = require('../src/models/location');
const config = require('../src/config');
const { slugify } = require('../src/db/values');

// Legacy state names -> modern, official spelling. Keys/values are compared
// case-insensitively.
const STATE_NAMES = {
  'orissa': 'Odisha',
  'uttaranchal': 'Uttarakhand',
  'pondicherry': 'Puducherry',
  'lakshdweep': 'Lakshadweep',
  'andaman nicobar': 'Andaman & Nicobar Islands',
  'dadra & nagar haveli': 'Dadra & Nagar Haveli and Daman & Diu',
  'daman & diu': 'Dadra & Nagar Haveli and Daman & Diu',
  'jammu & kashmir': 'Jammu & Kashmir',
};

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function csvSplit(line) {
  // Minimal CSV parser for quoted fields (this dataset quotes every field).
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function main() {
  const target = process.argv[2];
  if (!target || !existsSync(target)) {
    console.error('Usage: node scripts/load-full-pincodes.mjs <pincodes.csv>');
    process.exit(1);
  }

  const db = new Database(config.db.file);
  migrate(db, config.db.migrationsDir);

  const lines = readFileSync(target, 'utf8').split(/\r?\n/);
  const counts = { state: 0, district: 0, city: 0, locality: 0, pincode: 0 };
  let skipped = 0;
  let records = 0;

  db.transaction(() => {
    const india = locationModel.ensureIndia(db);
    // Keep a running map so we never hit the DB twice for a repeated chain.
    const seen = {
      pin: new Set(),              // pin_code values already added
      nodeByKey: new Map(),        // "kind:parentId:slug" -> id (count once)
    };

    const ensure = (kind, parentId, name, extra = {}) => {
      const slug = kind === 'pincode'
        ? `pin-${name}`
        : slugify(name);
      const key = `${kind}:${parentId || 0}:${slug}`;
      let row = seen.nodeByKey.get(key);
      if (!row) {
        row = locationModel.ensureLocation(db, {
          kind, parentId, name, ...extra,
        });
        seen.nodeByKey.set(key, row);
        counts[kind] += 1;
      }
      return row;
    };

    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = csvSplit(line);
      if (parts.length < 5 || parts[0] === 'PostOfficeName') continue; // header
      const [officeRaw, pinRaw, districtRaw, cityRaw, stateRaw] = parts;
      const pin = clean(pinRaw);
      const stateName = STATE_NAMES[clean(stateRaw).toLowerCase()] || clean(stateRaw);
      const district = clean(districtRaw);
      const city = clean(cityRaw) || district;
      const office = clean(officeRaw) || city;

      if (!/^[1-9][0-9]{5}$/.test(pin) || !stateName || !district || !city) {
        skipped += 1;
        continue;
      }

      records += 1;
      const state = ensure('state', india.id, stateName);
      const districtNode = ensure('district', state.id, district);
      const cityNode = ensure('city', districtNode.id, city);
      const locality = ensure('locality', cityNode.id, office);
      // Keep exactly one PIN node per PIN code, whichever office names it
      // first — duplicates across offices are real but one row is enough.
      if (!seen.pin.has(pin)) {
        seen.pin.add(pin);
        ensure('pincode', locality.id, pin, { pinCode: pin });
      }
    }
  });

  console.log(`Loaded ${target}`);
  console.log(`records read: ${records}, skipped: ${skipped}`);
  console.log('added this run:', counts);

  const stats = locationModel.stats(db);
  console.log('database now:', {
    states: stats.state,
    districts: stats.district,
    cities: stats.city,
    localities: stats.locality,
    pincodes: stats.pincode,
  });
  db.close();
}

main();
