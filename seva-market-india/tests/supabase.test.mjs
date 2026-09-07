/**
 * SEVA MARKET INDIA — Supabase remote-mirror pipeline tests.
 *
 * Same contract as tests/remote.test.mjs but through the PostgREST client
 * (src/db/supabase.js) against an in-process PostgREST mock:
 *   1. every seeded row + live mutation drains into the single seva_mirror
 *      table (rows keyed tbl+id, values JSON-encoded, nulls preserved);
 *   2. an outage (mock table flap / network fail) leaves rows pending and a
 *      retry drains to zero without loss;
 *   3. after a full local wipe, restoreFromRemote rebuilds identical rows
 *      (per-column equality, composite service_areas keys, NULL columns);
 *   4. boot with a missing mirror table reports the provisioning step
 *      instead of silently swallowing data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgrestMock } = require('./lib/mock-postgrest.cjs');
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const supabase = require('../src/db/supabase');
const remote = require('../src/db/remote');
const config = require('../src/config');

const TABLES = Object.keys(remote.TABLES);

function makeDb(file = ':memory:') {
  const db = new Database(file);
  migrate(db, config.db.migrationsDir);
  return db;
}

async function withMock(fn, opts) {
  const mock = createPostgrestMock(opts);
  const url = await mock.listen();
  try {
    await fn(mock, url);
  } finally {
    mock.close();
  }
}

const cfgFor = (url) => ({ provider: 'supabase', config: { url, key: 'service-role-key', table: 'seva_mirror' } });

function mockRows(mock, table) {
  const out = [];
  for (const r of mock.rows.values()) if (r.tbl === table) out.push(Object.assign({ $id: r.id }, r.doc));
  return out;
}

test('supabase: seeded baseline + live mutations mirror into seva_mirror', async () => {
  await withMock(async (mock, url) => {
    const db = makeDb();
    seed(db);
    const client = supabase.createClient(cfgFor(url).config);
    await client.ensureSchema();
    const pushed = await remote.drainPending(db, client, { log: () => {}, chunk: 200 });
    assert.ok(pushed >= 189, `expected the whole seeded baseline, pushed=${pushed}`);
    assert.equal(db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL'), 0);

    // Live mutation after a clean baseline.
    db.run("INSERT INTO leads (provider_id, name, phone, pin_code, message) VALUES (1, 'Supabase Lead', '9000000002', '781001', 'hi')");
    db.run("UPDATE providers SET phone = '9811111111' WHERE id = 2");
    db.run("DELETE FROM service_areas WHERE provider_id = 1 AND pin_code = '781001'");
    await remote.drainPending(db, client, { log: () => {} });

    assert.equal(mock.rows.size, db.scalar('SELECT COUNT(*) FROM providers') +
      db.scalar('SELECT COUNT(*) FROM locations') + db.scalar('SELECT COUNT(*) FROM categories') +
      db.scalar('SELECT COUNT(*) FROM services') + db.scalar('SELECT COUNT(*) FROM service_areas') +
      db.scalar('SELECT COUNT(*) FROM leads'), 'mirror holds exactly the local rows');

    const docs = mockRows(mock, 'leads');
    const lead = docs.find((d) => d.name === JSON.stringify('Supabase Lead'));
    assert.ok(lead, 'new lead mirrored');
    assert.equal(JSON.parse(lead.phone), '9000000002');
    const prov = mockRows(mock, 'providers').find((d) => d.$id === '2');
    assert.equal(JSON.parse(prov.phone), '9811111111', 'update mirrored');
    assert.ok(!mockRows(mock, 'service_areas').some((d) => d.$id === '1-781001'), 'delete mirrored');
    db.close();
  });
});

test('supabase: outage leaves rows pending, retry drains without loss', async () => {
  await withMock(async (mock, url) => {
    const db = makeDb();
    seed(db);
    const client = supabase.createClient(cfgFor(url).config);
    await client.ensureSchema();
    await remote.drainPending(db, client, { log: () => {}, chunk: 200 });
    db.run("INSERT INTO leads (provider_id, name, phone, pin_code, message) VALUES (1, 'Retry Lead', '9000000003', '781001', 'x')");

    // "Network outage": mirror table disappears → every call 404s (PGRST205).
    mock.setTableExists(false);
    const failed = await remote.drainPending(db, client, { log: () => {} });
    assert.equal(failed, 0);
    assert.equal(db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL'), 1, 'lead stays pending');

    mock.setTableExists(true);
    const retried = await remote.drainPending(db, client, { log: () => {}, chunk: 50 });
    assert.equal(retried, 1);
    assert.equal(db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL'), 0);
    assert.ok(mockRows(mock, 'leads').some((d) => d.name === JSON.stringify('Retry Lead')));
    db.close();
  });
});

test('supabase: after a full wipe, restoreFromRemote rebuilds identical rows', async () => {
  await withMock(async (mock, url) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seva-supa-'));
    const file = path.join(dir, 'seva.db');
    try {
      // ---- origin life ---------------------------------------------------
      const orig = new Database(file);
      migrate(orig, config.db.migrationsDir);
      seed(orig);
      orig.run("INSERT INTO service_areas (provider_id, pin_code, location_id) VALUES (1, '781002', NULL)");
      orig.run("UPDATE providers SET rating_avg = 4.75, about = 'verified hero' WHERE id = 1");
      orig.run("INSERT INTO leads (provider_id, name, phone, pin_code, message) VALUES (1, 'Real Lead', '9000000004', '781001', 'pls call')");
      const client = supabase.createClient(cfgFor(url).config);
      await client.ensureSchema();
      await remote.drainPending(orig, client, { log: () => {}, chunk: 200 });
      const expectedCounts = {};
      for (const t of TABLES) expectedCounts[t] = orig.scalar(`SELECT COUNT(*) FROM "${t}"`);
      orig.close();

      // ---- wipe ----------------------------------------------------------
      fs.rmSync(file, { force: true });

      // ---- restore into a fresh db ---------------------------------------
      const fresh = new Database(file);
      migrate(fresh, config.db.migrationsDir);
      const inserted = await remote.restoreFromRemote(fresh, client, { log: () => {} });

      for (const t of TABLES) {
        assert.equal(inserted[t], expectedCounts[t], `restored ${t} count`);
      }
      // per-column equality on a real row incl. composite key + NULL column
      const area = fresh.get("SELECT * FROM service_areas WHERE provider_id = 1 AND pin_code = '781002'");
      assert.ok(area, 'composite-key area restored');
      assert.equal(area.location_id, null, 'NULL column survived as NULL');
      const lead = fresh.get("SELECT name, phone, message FROM leads WHERE name = 'Real Lead'");
      assert.ok(lead);
      assert.equal(lead.phone, '9000000004');
      const p1 = fresh.get("SELECT business_name, rating_avg, about FROM providers WHERE id = 1");
      assert.equal(p1.rating_avg, 4.75, 'float survived exactly');
      assert.equal(p1.about, 'verified hero');
      fresh.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('supabase: missing mirror table surfaces the one-time SQL step', async () => {
  await withMock(async (mock, url) => {
    mock.setTableExists(false);
    const db = makeDb();
    seed(db);
    const client = supabase.createClient(cfgFor(url).config);
    await assert.rejects(
      client.ensureSchema(),
      (err) => err && err.provisionRequired === true && /supabase-init\.sql/.test(err.message),
      'provisioning error names the SQL file',
    );
    db.close();
  });
});
