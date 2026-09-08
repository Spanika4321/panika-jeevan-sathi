/**
 * SEVA MARKET INDIA — file-backed database tests.
 *
 * The rest of the suite runs against `:memory:`, which cannot exercise WAL,
 * durability or PRAGMA ordering. These tests use a real temporary file, so
 * they catch the class of bug that only appears once a database is on disk
 * (for example, `PRAGMA journal_mode` failing inside a transaction).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const config = require('../src/config');
const locations = require('../src/models/location');
const services = require('../src/models/service');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seva-test-'));
  return { dir, file: path.join(dir, 'seva.db') };
}

test('a file-backed database migrates and runs in WAL mode', () => {
  const { dir, file } = tempFile();
  const db = new Database(file);
  const result = migrate(db, config.db.migrationsDir);
  assert.deepEqual(result.applied, ['0001', '0002', '0003', '0004']);

  const mode = db.get('PRAGMA journal_mode');
  assert.equal(String(Object.values(mode)[0]).toLowerCase(), 'wal', 'file databases must use WAL');
  const fk = db.get('PRAGMA foreign_keys');
  assert.equal(Number(Object.values(fk)[0]), 1, 'foreign keys must be enabled on the connection');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('data survives closing and reopening the file', () => {
  const { dir, file } = tempFile();
  const first = new Database(file);
  migrate(first, config.db.migrationsDir);
  const counters = seed(first);
  assert.ok(counters.providers >= 10);
  first.close();

  const second = new Database(file);
  migrate(second, config.db.migrationsDir); // must be a no-op the second time
  assert.equal(second.scalar("SELECT COUNT(*) FROM providers WHERE status = 'active'"), counters.providers);

  const result = services.searchServices(second, { pin: '781001' });
  assert.ok(result.total >= 2, 'search must work against the persisted database');

  const resolved = locations.findByPin(second, '781001');
  assert.equal(resolved.chain.length, 6, 'the full hierarchy must persist');

  second.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the migration file contains no connection-level PRAGMAs', () => {
  const sql = fs.readFileSync(path.join(config.db.migrationsDir, '0001_foundation.sql'), 'utf8');
  assert.ok(!/^\s*PRAGMA\s+journal_mode/im.test(sql), 'journal_mode must be set on the connection, not in a migration');
  assert.ok(!/^\s*PRAGMA\s+foreign_keys/im.test(sql), 'foreign_keys must be set on the connection, not in a migration');
});
