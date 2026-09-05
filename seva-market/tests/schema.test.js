import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSqliteApp, tempDir } from './helpers/app.js';
import { TABLES, TABLE_NAMES } from '../lib/db/schema.js';
import { MODELS } from '../lib/domain/index.js';
import { MIGRATIONS_DIR } from '../lib/config.js';
import { createSqliteDriver } from '../lib/db/driver-sqlite.js';
import { migrate, migrationState, listMigrations } from '../lib/db/migrate.js';

/**
 * Drift guard: the SQL migrations and the domain models must describe the same
 * database. If someone adds a column to a model but forgets the migration (or
 * vice versa) this suite fails instead of production.
 */
describe('schema migrations', () => {
  test('there is at least one migration and they are ordered', () => {
    const migrations = listMigrations(MIGRATIONS_DIR);
    assert.ok(migrations.length >= 4, 'the foundation ships several migrations');
    const versions = migrations.map((m) => m.version);
    assert.deepEqual(versions, [...versions].sort(), 'migrations are applied in filename order');
  });

  test('every model table exists in the migrated database with exactly the same columns', async () => {
    const { app, dir } = await createSqliteApp({ seed: false });
    try {
      for (const table of Object.keys(TABLES)) {
        const columns = (await app.db.columns(table)).sort();
        assert.deepEqual(columns, [...TABLES[table].columns].sort(), `column mismatch on "${table}"`);
      }
    } finally {
      await app.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the database contains no tables the models do not know about', async () => {
    const { app, dir } = await createSqliteApp({ seed: false });
    try {
      const rows = await app.db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
      const found = rows.map((row) => row.name).sort();
      const expected = [...TABLE_NAMES, 'schema_migrations'].sort();
      assert.deepEqual(found, expected);
    } finally {
      await app.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('migrations are idempotent', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'seva.db');
    try {
      const first = createSqliteDriver({ file });
      const firstRun = await migrate(first, { dir: MIGRATIONS_DIR });
      assert.ok(firstRun.applied.length >= 4);
      await first.close();

      const second = createSqliteDriver({ file });
      const secondRun = await migrate(second, { dir: MIGRATIONS_DIR });
      assert.deepEqual(secondRun.applied, [], 'nothing is applied twice');
      assert.equal(secondRun.skipped.length, firstRun.applied.length);
      await second.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('editing an applied migration is rejected (checksum drift)', async () => {
    const dir = tempDir();
    const migrations = tempDir();
    try {
      for (const file of fs.readdirSync(MIGRATIONS_DIR)) {
        fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(migrations, file));
      }
      const driver = createSqliteDriver({ file: path.join(dir, 'seva.db') });
      await migrate(driver, { dir: migrations });
      await driver.close();

      const target = path.join(migrations, '001_locations.sql');
      fs.appendFileSync(target, '\n-- tampered after being applied\n');

      const reopened = createSqliteDriver({ file: path.join(dir, 'seva.db') });
      await assert.rejects(
        () => migrate(reopened, { dir: migrations }),
        /Never edit an applied migration/
      );
      await reopened.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(migrations, { recursive: true, force: true });
    }
  });

  test('applied migrations are recorded with a checksum and timestamp', async () => {
    const { app, dir } = await createSqliteApp({ seed: false });
    try {
      const state = await migrationState(app.db);
      assert.equal(state.length, listMigrations(MIGRATIONS_DIR).length);
      for (const entry of state) {
        assert.match(entry.version, /^\d{3}_[a-z0-9_]+$/);
        assert.match(entry.checksum, /^[0-9a-f]{16}$/);
        assert.ok(entry.appliedAt > 0);
      }
    } finally {
      await app.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('every model declares the columns, unique constraints and row builders the app relies on', () => {
    for (const [name, model] of Object.entries(MODELS)) {
      assert.ok(model.table, `${name} has a table`);
      assert.ok(Array.isArray(model.columns) && model.columns.length, `${name} has columns`);
      assert.ok(model.columns.includes('id'), `${name} uses a UUID primary key called "id"`);
      assert.equal(typeof model.toRow, 'function', `${name} can build a row`);
      assert.equal(typeof model.rules, 'object', `${name} declares validation rules`);
    }
  });

  test('the core marketplace entities are all modelled', () => {
    assert.deepEqual(
      ['users', 'providers', 'categories', 'services', 'countries', 'states', 'districts', 'cities', 'localities', 'pincodes'].filter(
        (table) => TABLE_NAMES.includes(table)
      ),
      ['users', 'providers', 'categories', 'services', 'countries', 'states', 'districts', 'cities', 'localities', 'pincodes']
    );
  });

  test('location tables form the India → State → District → City → Locality → PIN chain', () => {
    assert.ok(TABLES.states.columns.includes('country_id'));
    assert.ok(TABLES.districts.columns.includes('state_id'));
    assert.ok(TABLES.cities.columns.includes('district_id'));
    assert.ok(TABLES.localities.columns.includes('city_id'));
    assert.ok(TABLES.localities.columns.includes('pincode_id'));
    assert.ok(TABLES.pincodes.columns.includes('city_id'));
  });
});
