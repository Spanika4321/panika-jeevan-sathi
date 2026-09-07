/**
 * SEVA MARKET INDIA — boot-level Appwrite mirror tests.
 *
 * These drive the REAL createApp() boot sequence (durability guard →
 * migrate → remote recovery/initial drain → ready), against a real file
 * database and the in-process mock Appwrite server:
 *
 *   1. a seeded file database mirrors its whole baseline to Appwrite at
 *      boot, and every subsequent HTTP write is pushed after the response;
 *   2. after the file is wiped, a second boot rebuilds the database from
 *      Appwrite and the site serves the restored data (no empty site);
 *   3. with Appwrite configured but unreachable and an empty local file,
 *      boot refuses to start (fail closed) instead of serving an empty DB.
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
const { createApp } = require('../src/app');
const config = require('../src/config');
const { request } = require('./helpers.mjs');

const TABLES = Object.keys(remote.TABLES);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seva-boot-remote-'));
}

function cfgFor(file) {
  return { ...config, db: { ...config.db, file } };
}

function tableCounts(db) {
  const counts = {};
  for (const t of TABLES) counts[t] = Number(db.scalar(`SELECT COUNT(*) FROM "${t}"`) || 0);
  return counts;
}

function assertCountsMatch(db, mock, label) {
  for (const t of TABLES) {
    assert.equal(mock.docCount(t), Number(db.scalar(`SELECT COUNT(*) FROM "${t}"`) || 0), `${label}: ${t}`);
  }
}

/** Simulate `npm run seed` on a file database, then close it. */
function seedFile(file) {
  const db = new Database(file);
  migrate(db, config.db.migrationsDir);
  seed(db);
  db.close();
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

const remoteCfgFor = (url) => ({
  endpoint: url,
  projectId: 'test-project', // the mock server only accepts these (see mock-appwrite.cjs)
  apiKey: 'test-key',
  databaseId: 'db-boot-test',
  autoSchema: true,
});

test('boot mirrors the seeded baseline and every HTTP write to Appwrite', async () => {
  await withMock(async (mock, url) => {
    const dir = tmpDir();
    const file = path.join(dir, 'seva.db');
    try {
      seedFile(file);
      const probe = new Database(file);
      const expected = tableCounts(probe);
      probe.close();

      const app = createApp({ config: cfgFor(file), remote: remoteCfgFor(url) });
      await app.ready;

      // Boot drained the seeded change log and mirrored everything.
      assert.equal(Number(app.db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL') || 0), 0);
      for (const t of TABLES) {
        assert.equal(mock.docCount(t), expected[t], `boot mirror of ${t}`);
      }

      // A live write through the HTTP API mirrors after the response.
      const provider = app.db.get('SELECT id FROM providers ORDER BY id LIMIT 1');
      const res = await request(app, {
        method: 'POST',
        url: '/api/v1/leads',
        headers: { 'content-type': 'application/json' },
        body: {
          provider_id: provider.id,
          name: 'Boot Test Lead',
          phone: '9000012345',
          pin_code: '781001',
          message: 'Mirrored from the boot test',
        },
      });
      assert.equal(res.statusCode, 201);
      assert.equal(Number(app.db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL') || 0), 0,
        'the write must be drained before the next request');
      assert.equal(mock.docCount('leads'), expected.leads + 1, 'the lead landed in Appwrite');
      const remoteLead = mock.docs('leads').find((d) => d.name === JSON.stringify('Boot Test Lead'));
      assert.ok(remoteLead, 'lead document is on the mirror');
      assert.equal(JSON.parse(remoteLead.message), 'Mirrored from the boot test');

      await app.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('a wiped disk boots from the Appwrite mirror and serves restored data', async () => {
  await withMock(async (mock, url) => {
    const dir = tmpDir();
    const file = path.join(dir, 'seva.db');
    try {
      // ---- first life: seed, boot, mutate, update, shutdown -----------------
      seedFile(file);
      let app = createApp({ config: cfgFor(file), remote: remoteCfgFor(url) });
      await app.ready;
      assert.equal(mock.docCount('providers'), 10);

      // Update a provider after boot (exercises the update path remotely).
      app.db.run("UPDATE providers SET phone = '9876543210', about = 'updated in life one' WHERE id = 1");
      // Delete a service area (exercises the delete path).
      app.db.run("DELETE FROM service_areas WHERE provider_id = 1 AND pin_code = '781001'");
      // A customer lead via the real HTTP API — the most precious data.
      const lead = await request(app, {
        method: 'POST',
        url: '/api/v1/leads',
        headers: { 'content-type': 'application/json' },
        body: {
          provider_id: 1,
          name: 'Boot Test Lead',
          phone: '9000012345',
          pin_code: '781001',
          message: 'Survive the wipe please',
        },
      });
      assert.equal(lead.statusCode, 201);

      await app.close(); // shutdown drain pushes the update + delete + lead

      const expected = {};
      {
        const probe = new Database(file);
        expected.counts = tableCounts(probe);
        expected.provider1 = probe.get('SELECT business_name, phone, about, rating_avg FROM providers WHERE id = 1');
        probe.close();
      }
      assert.equal(mock.docCount('providers'), 10);
      assert.equal(
        JSON.parse(mock.docs('providers').find((d) => d.$id === '1').phone),
        '9876543210',
        'update reached the mirror before shutdown',
      );

      // ---- wipe: the ephemeral host erased the disk -------------------------
      fs.rmSync(file, { force: true });
      for (const suffix of ['-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
      assert.ok(!fs.existsSync(file), 'database file is gone (simulated wipe)');

      // ---- second life: boot must rebuild from Appwrite --------------------
      app = createApp({ config: cfgFor(file), remote: remoteCfgFor(url) });
      await app.ready;

      const restored = tableCounts(app.db);
      for (const t of TABLES) {
        assert.equal(restored[t], expected.counts[t], `restored ${t} count`);
      }
      const p1 = app.db.get('SELECT business_name, phone, about, rating_avg FROM providers WHERE id = 1');
      assert.equal(p1.phone, '9876543210', 'updated phone survived the wipe');
      assert.equal(p1.about, 'updated in life one', 'updated text survived the wipe');
      assert.equal(p1.business_name, expected.provider1.business_name, 'unchanged columns survived too');
      assert.equal(
        app.db.scalar("SELECT COUNT(*) FROM service_areas WHERE provider_id = 1 AND pin_code = '781001'"),
        0,
        'the deleted area stayed deleted',
      );
      assert.equal(
        Number(app.db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL') || 0), 0,
        'recovery self-healed the change log',
      );

      // The site serves restored rows — not an empty database. Every row the
      // API returns must exist locally with identical values (fresh migrated
      // DBs return zero providers, so non-empty + matching = recovered).
      const api = await request(app, { url: '/api/v1/providers?limit=100' });
      const body = api.json();
      assert.equal(body.ok, true);
      assert.equal(body.data.items.length, 10, 'API serves all recovered providers');
      const apiNames = new Set(body.data.items.map((p) => p.business_name));
      const localNames = new Set(app.db.all('SELECT business_name FROM providers').map((r) => r.business_name));
      assert.equal(apiNames.size, 10);
      for (const name of apiNames) {
        assert.ok(localNames.has(name), `API row "${name}" exists in the recovered database`);
      }
      const storedLead = app.db.get("SELECT name, phone FROM leads WHERE name = 'Boot Test Lead'");
      assert.ok(storedLead, 'the mirrored lead came back with the data');
      assert.equal(storedLead.phone, '9000012345');

      await app.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('boot refuses to start when Appwrite is configured but unreachable and the local DB is empty', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'seva.db');
  try {
    // Point the config at a mock that has already been closed: every request
    // gets ECONNREFUSED, which the client retries and then fails on.
    const mock = createAppwriteMock();
    const url = await mock.listen();
    mock.close();
    fs.writeFileSync(file, ''); // an (empty) file appeared on the fresh disk

    const app = createApp({ config: cfgFor(file), remote: remoteCfgFor(url) });
    await assert.rejects(
      app.ready,
      /Appwrite could not be reached|Refusing to start/,
      'an empty local database with an unreachable mirror must not boot into an empty site',
    );
    await app.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
