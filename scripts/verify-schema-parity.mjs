#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — prove lib/schema-map.js matches lib/db.js SCHEMA.
 *
 * Executes the production SQLite DDL in memory and compares every table and
 * column (name, type family, not-null, unique) against schema-map.js — the
 * file that drives Appwrite provisioning. Run it whenever the data model
 * changes (package.json → npm run verify:schema).
 */

import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dbLib = require('../lib/db.js');
const schemaMap = require('../lib/schema-map.js');

const db = new DatabaseSync(':memory:');
db.exec(dbLib.SCHEMA);
for (const sql of dbLib.INDEXES) db.exec(sql);

const INT_TYPES = new Set(['INT', 'INTEGER']);
const STR_TYPES = new Set(['TEXT', 'VARCHAR', 'CHAR']);

let failures = 0;
function problem(message) {
  failures += 1;
  console.log(`  ✗ ${message}`);
}

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);

for (const table of tables) {
  if (!schemaMap.TABLES[table]) {
    problem(`table ${table} is in SQLite DDL but missing from schema-map`);
    continue;
  }
  const info = db.prepare(`PRAGMA table_info("${table}")`).all();
  const map = new Map(schemaMap.TABLES[table].columns.map((c) => [c.name, c]));
  for (const col of info) {
    const want = map.get(col.name);
    if (!want) {
      problem(`${table}.${col.name} is in SQLite DDL but missing from schema-map`);
      continue;
    }
    const upper = String(col.type || '').toUpperCase();
    const wantInt = want.type === 'int';
    const isInt = INT_TYPES.has(upper);
    if (wantInt !== isInt) {
      problem(`${table}.${col.name}: schema-map type ${want.type} vs SQLite ${col.type}`);
    }
    if (want.type === 'str' && !STR_TYPES.has(upper)) {
      problem(`${table}.${col.name}: schema-map type str vs SQLite ${col.type}`);
    }
    if (Boolean(col.notnull) !== Boolean(want.notNull)) {
      problem(`${table}.${col.name}: notNull ${Boolean(want.notNull)} vs SQLite notnull=${Boolean(col.notnull)}`);
    }
  }
  for (const name of map.keys()) {
    if (!info.some((c) => c.name === name)) problem(`${table}.${name} is in schema-map but missing from SQLite DDL`);
  }
}

// UNIQUE constraints: schema-map marks non-primary-key unique columns.
for (const table of Object.keys(schemaMap.TABLES)) {
  const pk = schemaMap.pkOf(table);
  const sql = db.prepare(`PRAGMA index_list("${table}")`).all();
  const uniques = new Set();
  for (const idx of sql) {
    if (!idx.unique) continue;
    const cols = db.prepare(`PRAGMA index_info("${idx.name}")`).all().map((r) => r.name);
    if (cols.length === 1 && cols[0] !== pk) uniques.add(cols[0]);
  }
  for (const col of schemaMap.uniqueColumns(table)) {
    if (!uniques.has(col)) problem(`${table}.${col} marked unique in schema-map but SQLite DDL has no UNIQUE index`);
  }
}

db.close();

if (failures) {
  console.log(`\n${failures} schema mismatch(es). Fix lib/schema-map.js (or lib/db.js if the DDL changed) and re-run.`);
  process.exit(1);
}
console.log('Schema parity OK: lib/schema-map.js matches the SQLite DDL used by db.js.');
