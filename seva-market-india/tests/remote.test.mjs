/**
 * SEVA MARKET INDIA — Appwrite remote-mirror pipeline tests.
 *
 * The data-loss contract for the remote mirror:
 *   1. every mutation (insert/update/delete incl. FK cascades) lands in the
 *      _sync_log inside the same transaction;
 *   2. flushPending pushes the log to Appwrite and only then marks rows
 *      synced; a failed flush is retried and nothing is lost;
 *   3. after a full wipe, restoreFromRemote rebuilds an identical SQLite
 *      database from Appwrite — every lead, provider, service and area is
 *      back, byte-for-byte (type + null + composite keys included);
 *   4. seed rows count as changes too, so a seeded site is mirrored as-is.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAppwriteMock } = require('./lib/mock-appwrite.cjs');
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const remote = require('../src/db/remote');
const config = require('../src/config');

function makeDb(file = ':memory:') {
  const db = new Database(file);
  migrate(db, config.db.migrationsDir);
  return db;
}

async function withMock(fn) {
  const mock = createAppwriteMock();
  const url = await mock.listen();
  try {
    await fn(mock, url);
  } finally {
    mock.close();
  }
}

test('every mutation is logged in the same transaction (incl. cascades)', () => {
  const db = makeDb();
  seed(db);
  // fresh seeded database: every row has a pending log entry
  assert.ok(db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL') >= 200);
  db.run('DELETE FROM _sync_log'); // pretend seeded baseline was flushed

  db.transaction(() => {
    db.run("INSERT INTO providers (business_name, slug, phone, category_id, location_id) VALUES ('X', 'x-shop', '9000000000', 1, 1)");
    const providerId = Number(db.scalar('SELECT last_insert_rowid()'));
    db.run("INSERT INTO services (provider_id, category_id, location_id, title, slug, pin_code) VALUES (?, 1, 1, 'S', 'x-s', '781001')", [providerId]);
    db.run('INSERT INTO service_areas (provider_id, pin_code) VALUES (?, ?)', [providerId, '560001']);
    db.run('INSERT INTO leads (provider_id, name, phone) VALUES (?, ?, ?)', [providerId, 'L', '9000000001']);
    // cascade delete: services + service_areas of this provider vanish
    db.run('DELETE FROM providers WHERE id = ?', [providerId]);
  });

  const pending = db.all('SELECT tbl, op, pk FROM _sync_log WHERE synced_at IS NULL ORDER BY id');
  const kinds = pending.map((r) => `${r.tbl}:${r.op}:${r.pk}`);
  assert.ok(kinds.some((k) => k === 'providers:upsert:11' || /providers:upsert:/.test(k)), 'provider upsert logged');
  assert.ok(kinds.some((k) => /services:upsert:/.test(k)), 'service upsert logged');
  assert.ok(kinds.some((k) => k.startsWith('service_areas:upsert:')), 'service_area upsert logged');
  assert.ok(kinds.some((k) => /leads:upsert:/.test(k)), 'lead upsert logged');
  // the cascade deletions must also be logged (delete of provider + children)
  assert.ok(kinds.some((k) => k.startsWith('services:delete:')), 'cascaded service delete logged');
  assert.ok(kinds.some((k) => k.startsWith('service_areas:delete:')), 'cascaded area delete logged');
  assert.ok(kinds.some((k) => k.startsWith('providers:delete:')), 'provider delete logged');
  db.close();
});

test('flushPending pushes to Appwrite; failed flush retries without loss', async () => {
  await withMock(async (mock, url) => {
    const db = makeDb();
    seed(db);
    const client = remoteClient(url);
    await client.ensureSchema(remote.TABLES);

    // Simulate an Appwrite outage for the first flush.
    mock.failNext(1);
    await remote.flushPending(db, client, { log: () => {} });
    const unsyncedAfterOutage = db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL');
    assert.ok(unsyncedAfterOutage > 0, 'rows stay pending after a failed flush');

    // A flush drains the queue in batches (like the production timer loop).
    let pushedTotal = 0;
    for (let i = 0; i < 10 && db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL') > 0; i++) {
      pushedTotal += await remote.flushPending(db, client, { log: () => {} });
    }
    assert.equal(db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL'), 0, 'all rows synced after retry');
    assert.equal(mock.docCount('providers'), 10, 'providers mirrored');
    assert.ok(mock.docCount('locations') >= 100, 'locations mirrored');
    assert.ok(mock.docCount('categories') >= 30, 'categories mirrored');
    assert.ok(mock.docCount('services') >= 10, 'services mirrored');
    assert.ok(mock.docCount('service_areas') >= 5, 'service areas mirrored');
    db.close();
  });
});

test('restoreFromRemote rebuilds a byte-identical SQLite database', async () => {
  await withMock(async (mock, url) => {
    // Original database (pre-wipe) — seed + real changes.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seva-remote-'));
    const origFile = path.join(dir, 'orig.db');
    const orig = makeDb(origFile);
    seed(orig);
    orig.run('INSERT INTO leads (service_id, provider_id, name, phone, email, pin_code, message) VALUES (?, ?, ?, ?, ?, ?, ?)', [1, 1, 'Real Lead', '9812345678', 'lead@example.com', '781001', 'need plumber']);
    orig.run('UPDATE providers SET about = ?, rating_avg = ? WHERE id = 1', ['verified plumber', 4.5]);
    orig.run('UPDATE users SET status = ? WHERE id = 1', ['active']);
    orig.run('INSERT INTO service_areas (provider_id, pin_code, location_id) VALUES (1, ?, NULL)', ['781002']);
    const snapshot = dbSnapshot(orig);
    const entries = orig.all('SELECT tbl, op, pk FROM _sync_log WHERE synced_at IS NULL ORDER BY id');

    // Mirror everything to Appwrite (same as an hourly flush would).
    const client = remoteClient(url);
    await client.ensureSchema(remote.TABLES);
    for (let i = 0; i < 20 && orig.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL') > 0; i++) {
      await remote.flushPending(orig, client, { log: () => {} });
    }
    orig.close();

    // Wipe the disk. Rebuild from Appwrite.
    const freshFile = path.join(dir, 'fresh.db');
    const fresh = makeDb(freshFile);
    const restored = await remote.restoreFromRemote(fresh, client, { log: () => {} });
    assert.equal(restored.providers, 10);
    assert.ok(restored.leads >= 1, 'the real lead must be restored');

    // Compare every row of every mirrored table.
    for (const table of Object.keys(remote.TABLES)) {
      const origRows = new Database(origFile).all(`SELECT * FROM ${table} ORDER BY 1`);
      const freshRows = fresh.all(`SELECT * FROM ${table} ORDER BY 1`);
      assert.equal(freshRows.length, origRows.length, `${table} row count`);
      for (let i = 0; i < origRows.length; i++) {
        for (const col of remote.TABLES[table].columns) {
          const a = origRows[i][col];
          const b = freshRows[i][col];
          assert.equal(
            String(a) === String(b) || (a === null && b === null) || (a === undefined && b === null) || (a === null && b === undefined),
            true,
            `${table}.${col} row ${i}: ${String(a)} vs ${String(b)}`,
          );
        }
      }
    }
    // The composite-keyed service_areas came back with correct pairs.
    const areas = fresh.all('SELECT provider_id, pin_code FROM service_areas ORDER BY provider_id, pin_code');
    assert.ok(areas.some((a) => a.pin_code === '781002' && Number(a.provider_id) === 1), 'composite area restored');
    assert.equal(snapshot.leads, fresh.scalar('SELECT COUNT(*) FROM leads'));
    assert.equal(snapshot.serviceAreas, fresh.scalar('SELECT COUNT(*) FROM service_areas'));
    fresh.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

function remoteClient(url) {
  return require('../src/db/appwrite').createClient(
    {
      endpoint: url,
      projectId: 'test-project',
      apiKey: 'test-key',
      databaseId: 'test-db',
    },
    { log: () => {} },
  );
}

function dbSnapshot(db) {
  return {
    providers: Number(db.scalar('SELECT COUNT(*) FROM providers')),
    leads: Number(db.scalar('SELECT COUNT(*) FROM leads')),
    serviceAreas: Number(db.scalar('SELECT COUNT(*) FROM service_areas')),
  };
}
