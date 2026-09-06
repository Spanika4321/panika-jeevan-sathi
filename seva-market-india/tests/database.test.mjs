/**
 * SEVA MARKET INDIA — schema + migration tests.
 *
 * These run against a real SQLite database (in-memory) and assert the
 * constraints the marketplace relies on: the six-level location tree,
 * per-parent slug uniqueness and the enum CHECKs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeDb } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { migrate } = require('../src/db/migrate');
const config = require('../src/config');

function tableList(db) {
  return db
    .all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => row.name);
}

test('migration 0001 creates every foundation table', () => {
  const { db, migrationResult } = makeDb({ withSeed: false });
  const tables = tableList(db);

  for (const expected of [
    'audit_logs', 'categories', 'leads', 'locations', 'providers',
    'schema_migrations', 'service_areas', 'services', 'users',
  ]) {
    assert.ok(tables.includes(expected), `missing table: ${expected}`);
  }
  assert.deepEqual(migrationResult.applied, ['0001', '0002']);
  db.close();
});

test('migration 0002 adds the auth session and review tables', () => {
  const { db } = makeDb({ withSeed: false });
  const tables = tableList(db);
  for (const expected of ['sessions', 'reviews']) {
    assert.ok(tables.includes(expected), `missing table: ${expected}`);
  }
  db.close();
});

test('running migrations twice applies nothing the second time', () => {
  const { db } = makeDb({ withSeed: false });
  const second = migrate(db, config.db.migrationsDir);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.skipped, ['0001', '0002']);
  db.close();
});

test('foreign keys are enforced', () => {
  const { db } = makeDb({ withSeed: false });
  assert.throws(
    () => db.run(
      'INSERT INTO services (provider_id, category_id, location_id, title, slug) VALUES (999, 999, 999, ?, ?)',
      ['x', 'x'],
    ),
    /FOREIGN KEY/i,
  );
  db.close();
});

test('CHECK constraints reject unknown enum values', () => {
  const { db } = makeDb({ withSeed: false });
  assert.throws(
    () => db.run("INSERT INTO locations (kind, name, slug) VALUES ('continent', 'Asia', 'asia')"),
    /CHECK/i,
    'locations.kind must be limited to the six known levels',
  );
  assert.throws(
    () => db.run("INSERT INTO users (email, full_name, password_hash, role) VALUES ('a@b.co', 'A', 'x', 'wizard')"),
    /CHECK/i,
  );
  assert.throws(
    () => db.run("INSERT INTO services (provider_id, category_id, location_id, title, slug, price_unit) VALUES (1,1,1,'t','t','fortnight')"),
    /CHECK/i,
  );
  db.close();
});

test('negative prices are rejected by CHECK', () => {
  const { db } = makeDb({ withSeed: true });
  assert.throws(
    () => db.run(
      'INSERT INTO services (provider_id, category_id, location_id, title, slug, price_min) VALUES (1, 1, 1, ?, ?, ?)',
      ['Bad price', 'bad-price', -100],
    ),
    /CHECK/i,
  );
  db.close();
});

test('location slugs are unique per parent, so district names can repeat', () => {
  const { db } = makeDb({ withSeed: false });
  const india = db.run("INSERT INTO locations (kind, name, slug) VALUES ('country','India','india')");
  const s1 = db.run('INSERT INTO locations (kind, parent_id, name, slug) VALUES (?,?,?,?)', ['state', Number(india.lastInsertRowid), 'Assam', 'assam']);
  const s2 = db.run('INSERT INTO locations (kind, parent_id, name, slug) VALUES (?,?,?,?)', ['state', Number(india.lastInsertRowid), 'Bihar', 'bihar']);
  db.run('INSERT INTO locations (kind, parent_id, name, slug) VALUES (?,?,?,?)', ['district', Number(s2.lastInsertRowid), 'Patna', 'patna']);
  // The same slug under a different parent must be allowed.
  db.run('INSERT INTO locations (kind, parent_id, name, slug) VALUES (?,?,?,?)', ['district', Number(s1.lastInsertRowid), 'Patna', 'patna']);
  // India + 2 states + the same district slug under each parent = 5 rows.
  assert.equal(db.scalar('SELECT COUNT(*) FROM locations'), 5);
  db.close();
});

test('duplicate (kind, parent_id, slug) is rejected', () => {
  const { db } = makeDb({ withSeed: false });
  const india = db.run("INSERT INTO locations (kind, name, slug) VALUES ('country','India','india')");
  db.run('INSERT INTO locations (kind, parent_id, name, slug) VALUES (?,?,?,?)', ['state', Number(india.lastInsertRowid), 'Assam', 'assam']);
  assert.throws(
    () => db.run('INSERT INTO locations (kind, parent_id, name, slug) VALUES (?,?,?,?)', ['state', Number(india.lastInsertRowid), 'Assam', 'assam']),
    /UNIQUE/i,
  );
  db.close();
});

test('the seed dataset populates every level of the hierarchy', () => {
  const { db } = makeDb({ withSeed: true });
  const totals = db.all('SELECT kind, COUNT(*) AS total FROM locations GROUP BY kind');
  const byKind = Object.fromEntries(totals.map((row) => [row.kind, row.total]));

  assert.equal(byKind.country, 1, 'exactly one India row');
  assert.ok(byKind.state >= 8, `expected >=8 states, got ${byKind.state}`);
  assert.ok(byKind.district >= 12, `expected >=12 districts, got ${byKind.district}`);
  assert.ok(byKind.city >= 12, `expected >=12 cities, got ${byKind.city}`);
  assert.equal(byKind.locality, byKind.pincode, 'every locality carries a PIN');
  db.close();
});

test('seeding twice does not duplicate rows', () => {
  const { db } = makeDb({ withSeed: true });
  const before = {
    locations: db.scalar('SELECT COUNT(*) FROM locations'),
    providers: db.scalar('SELECT COUNT(*) FROM providers'),
    services: db.scalar('SELECT COUNT(*) FROM services'),
    categories: db.scalar('SELECT COUNT(*) FROM categories'),
  };
  require('../src/db/seed').seed(db);
  assert.equal(db.scalar('SELECT COUNT(*) FROM locations'), before.locations);
  assert.equal(db.scalar('SELECT COUNT(*) FROM providers'), before.providers);
  assert.equal(db.scalar('SELECT COUNT(*) FROM services'), before.services);
  assert.equal(db.scalar('SELECT COUNT(*) FROM categories'), before.categories);
  db.close();
});

test('every seeded PIN code is 6 digits and never starts with 0', () => {
  const { db } = makeDb({ withSeed: true });
  const pins = db.all("SELECT pin_code FROM locations WHERE kind = 'pincode'").map((row) => row.pin_code);
  assert.ok(pins.length > 20, 'seed should cover a meaningful set of PIN codes');
  for (const pin of pins) assert.match(pin, /^[1-9][0-9]{5}$/, `bad PIN: ${pin}`);
  db.close();
});

test('every location has a breadcrumb ending in India', () => {
  const { db } = makeDb({ withSeed: true });
  const rows = db.all("SELECT search_text FROM locations WHERE kind = 'pincode'");
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.match(row.search_text, /India$/, `breadcrumb missing country: ${row.search_text}`);
  }
  db.close();
});

test('no orphaned rows in the domain tables', () => {
  const { db } = makeDb({ withSeed: true });
  assert.equal(
    db.scalar('SELECT COUNT(*) FROM services s LEFT JOIN providers p ON p.id = s.provider_id WHERE p.id IS NULL'),
    0,
  );
  assert.equal(
    db.scalar('SELECT COUNT(*) FROM providers p LEFT JOIN locations l ON l.id = p.location_id WHERE l.id IS NULL'),
    0,
  );
  db.close();
});
