/**
 * SEVA MARKET INDIA — Appwrite durability mirror tests.
 *
 * The mirror is exercised against an in-memory fake of the Appwrite client
 * (same surface as src/db/appwrite.js createClient). This proves the whole
 * durability loop — write → mirror → wipe → restore — without a network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const { attachMirror, tablesTouchedBy, TABLE_NAMES } = require('../src/db/mirror');
const config = require('../src/config');
const providerModel = require('../src/models/provider');
const categoryModel = require('../src/models/category');
const locationModel = require('../src/models/location');
const leadModel = require('../src/models/lead');

/** In-memory stand-in for the Appwrite Databases API. */
function fakeAppwrite() {
  const store = new Map(); // collection → Map(docId → {json})
  return {
    kind: 'appwrite',
    endpoint: 'https://fake.appwrite.local/v1',
    databaseId: 'seva-market',
    store,
    async ensureSchema(tables) {
      for (const t of tables) if (!store.has(t)) store.set(t, new Map());
    },
    async listAllDocuments(collectionId) {
      const docs = store.get(collectionId) || new Map();
      return [...docs.entries()].map(([$id, data]) => ({ $id, ...data }));
    },
    async upsertDocument(collectionId, documentId, data) {
      if (!store.has(collectionId)) store.set(collectionId, new Map());
      store.get(collectionId).set(documentId, { ...data });
      return { $id: documentId, ...data };
    },
    async deleteDocument(collectionId, documentId) {
      store.get(collectionId)?.delete(documentId);
      return null;
    },
    async ping() {
      return true;
    },
  };
}

function freshLocal() {
  const db = new Database(':memory:');
  migrate(db, config.db.migrationsDir);
  return db;
}

test('tablesTouchedBy finds mirrored tables in write statements', () => {
  assert.deepEqual([...tablesTouchedBy('INSERT INTO providers (a) VALUES (?)')], ['providers']);
  assert.deepEqual([...tablesTouchedBy('UPDATE users SET status = ? WHERE id = ?')], ['users']);
  assert.deepEqual([...tablesTouchedBy('DELETE FROM service_areas WHERE provider_id = ?')], ['service_areas']);
  assert.deepEqual([...tablesTouchedBy('SELECT * FROM providers')], []);
  assert.deepEqual([...tablesTouchedBy('insert into leads (x) values (1)')], ['leads']);
});

test('writes are mirrored to Appwrite as one document per row', async () => {
  const client = fakeAppwrite();
  const db = freshLocal();
  const mirror = await attachMirror(db, { client, log: () => {} });
  assert.ok(mirror, 'mirror must attach when a client is supplied');

  seed(mirror);
  await mirror.flushNow();

  const providers = client.store.get('providers');
  assert.ok(providers.size >= 10, `providers mirrored (got ${providers.size})`);
  const anyDoc = [...providers.values()][0];
  const row = JSON.parse(anyDoc.json);
  assert.ok(row.business_name, 'mirrored document holds the full row');

  const localCount = mirror.scalar('SELECT COUNT(*) FROM providers');
  assert.equal(providers.size, localCount, 'remote document count equals local row count');
});

test('a wiped disk restores everything from Appwrite at boot', async () => {
  const client = fakeAppwrite();

  // Boot 1: seed + a customer lead, everything mirrored.
  const first = freshLocal();
  const mirror1 = await attachMirror(first, { client, log: () => {} });
  seed(mirror1);
  await mirror1.flushNow();

  const provider = mirror1.get("SELECT id FROM providers WHERE status = 'active' LIMIT 1");
  const lead = leadModel.createLead(mirror1, {
    providerId: provider.id,
    name: 'Ravi Das',
    phone: '9864012345',
    message: 'Need help this week',
    ip: '10.0.0.1',
  });
  await mirror1.flushNow();
  mirror1.close();

  // Boot 2: brand-new empty database — the "disk was wiped" scenario.
  const second = freshLocal();
  const mirror2 = await attachMirror(second, { client, log: () => {} });

  assert.equal(
    mirror2.scalar('SELECT COUNT(*) FROM providers'),
    client.store.get('providers').size,
    'all providers must come back'
  );
  const restoredLead = leadModel.findById(mirror2, lead.id);
  assert.ok(restoredLead, 'the customer lead survived the wipe');
  assert.equal(restoredLead.name, 'Ravi Das');
  assert.equal(restoredLead.phone, '9864012345');

  // Search still works against restored data (joins + breadcrumbs intact).
  const { total } = providerModel.searchProviders(mirror2, {});
  assert.ok(total >= 10, 'provider search works on restored rows');
  const pin = locationModel.findByPin(mirror2, '781001');
  assert.equal(pin.chain.length, 6, 'location hierarchy fully restored');
  mirror2.close();
});

test('an existing local database is adopted upward when the remote is empty', async () => {
  const db = freshLocal();
  seed(db); // rows exist BEFORE the mirror attaches (first deploy with old data)

  const client = fakeAppwrite();
  const mirror = await attachMirror(db, { client, log: () => {} });
  await mirror.flushNow();

  assert.ok(client.store.get('providers').size >= 10, 'local providers pushed to empty remote');
  assert.ok(client.store.get('categories').size > 0, 'local categories pushed too');
  mirror.close();
});

test('updates and deletes propagate to the mirror', async () => {
  const client = fakeAppwrite();
  const db = freshLocal();
  const mirror = await attachMirror(db, { client, log: () => {} });
  seed(mirror);
  await mirror.flushNow();

  const provider = mirror.get("SELECT id, slug FROM providers WHERE status = 'active' LIMIT 1");

  // Update: suspend the provider.
  providerModel.setStatus(mirror, provider.id, 'suspended');
  await mirror.flushNow();
  const doc = client.store.get('providers').get(String(provider.id));
  assert.equal(JSON.parse(doc.json).status, 'suspended', 'status change reached the mirror');

  // Delete: replacing service areas deletes old rows remotely too.
  providerModel.setServiceAreas(mirror, provider.id, ['781005']);
  await mirror.flushNow();
  const areas = [...client.store.get('service_areas').keys()].filter((k) =>
    k.startsWith(`${provider.id}_`)
  );
  assert.deepEqual(areas, [`${provider.id}_781005`], 'old service areas were deleted remotely');
  mirror.close();
});

test('every mirrored table has a collection after ensureSchema', async () => {
  const client = fakeAppwrite();
  const db = freshLocal();
  const mirror = await attachMirror(db, { client, log: () => {} });
  for (const table of TABLE_NAMES) {
    assert.ok(client.store.has(table), `collection ${table} exists`);
  }
  mirror.close();
});

test('categories ensured through the mirror keep working (transactions intact)', async () => {
  const client = fakeAppwrite();
  const db = freshLocal();
  const mirror = await attachMirror(db, { client, log: () => {} });

  const cat = categoryModel.ensureCategory(mirror, { name: 'Solar Install' });
  assert.ok(cat.id, 'insert through the mirror returns the row');
  const again = categoryModel.ensureCategory(mirror, { name: 'Solar Install' });
  assert.equal(again.id, cat.id, 'idempotent ensure still works');

  await mirror.flushNow();
  const doc = client.store.get('categories').get(String(cat.id));
  assert.equal(JSON.parse(doc.json).slug, 'solar-install');
  mirror.close();
});
