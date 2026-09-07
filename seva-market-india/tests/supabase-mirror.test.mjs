/**
 * SEVA MARKET INDIA — seva_mirror packing + PostgREST client tests.
 *
 * No live Supabase: the SQL file is checked as text, documents are packed
 * from an in-memory SQLite database, and upserts go through a fake fetch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDb } from './helpers.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  initSql,
  initStatements,
  documentId,
  isMissingTableError,
  collectDocuments,
  summarise,
  chunk,
  configFromEnv,
  createMirrorClient,
  MirrorError,
  MIRROR_TABLES,
} = require('../src/db/supabase-mirror');

test('init SQL is paste-safe: no file path, no trailing commas, no smart quotes', () => {
  const sql = initSql();
  const statements = initStatements();

  assert.equal(sql.includes('seva-market-india/scripts'), false, 'file path must not appear in SQL');
  assert.equal(sql.includes('WARNING: This schema is for context only'), false);
  assert.equal(/syntax error at or near/.test(statements), false);
  assert.match(statements, /CREATE TABLE IF NOT EXISTS public\.seva_mirror/i);
  assert.match(statements, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(statements, /REVOKE ALL ON TABLE public\.seva_mirror FROM anon/i);
  assert.match(statements, /REVOKE ALL ON TABLE public\.seva_mirror FROM authenticated/i);
  assert.match(statements, /NOTIFY pgrst/i);

  // Trailing comma before a closing paren is what produced ERROR 42601 at ")".
  assert.equal(/,\s*\)/.test(statements), false, 'no trailing comma before )');

  // Chat UIs mangle ASCII quotes; the file uses jsonb_build_object() instead.
  assert.match(statements, /jsonb_build_object\(\)/);
  assert.equal(statements.includes('\u2018') || statements.includes('\u2019'), false);
  assert.equal(statements.includes('\u201c') || statements.includes('\u201d'), false);

  for (const line of statements.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    assert.equal(trimmed.startsWith('seva'), false, `statement line looks like a path: ${trimmed}`);
  }
});

test('init statements are five executable commands', () => {
  const body = initStatements();
  const parts = body.split(';').map((part) => part.trim()).filter(Boolean);
  assert.equal(parts.length, 5);
  assert.match(parts[0], /^CREATE TABLE/i);
  assert.match(parts[1], /^ALTER TABLE/i);
  assert.match(parts[2], /^REVOKE ALL.+FROM anon/i);
  assert.match(parts[3], /^REVOKE ALL.+FROM authenticated/i);
  assert.match(parts[4], /^NOTIFY pgrst/i);
});

test('--sql prints only executable SQL, never a filesystem path', () => {
  const script = path.join(ROOT, 'scripts', 'supabase-setup.mjs');
  const result = spawnSync(process.execPath, [script, '--sql'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const out = result.stdout;
  assert.match(out, /^CREATE TABLE IF NOT EXISTS public\.seva_mirror/m);
  assert.equal(out.includes(path.join('seva-market-india', 'scripts')), false);
  assert.equal(out.includes('supabase-init.sql'), false);
  assert.equal(out.trimStart().startsWith('--'), false, 'comments would tempt a path paste');
});

test('documentId encodes composite keys and rejects empty rows', () => {
  assert.equal(documentId('services', { id: 9 }), '9');
  assert.equal(documentId('service_areas', { provider_id: 4, pin_code: '560001' }), '4:560001');
  assert.equal(documentId('schema_migrations', { version: '0001' }), '0001');
  assert.throws(() => documentId('services', { title: 'x' }), /missing id/);
});

test('collectDocuments packs every seeded domain table', () => {
  const { db } = makeDb({ withSeed: true });
  const docs = collectDocuments(db, new Date('2026-09-07T00:00:00.000Z'));
  const stats = summarise(docs);

  assert.ok(stats.total > 50, `expected a real seed, got ${stats.total}`);
  for (const table of ['locations', 'categories', 'providers', 'services', 'service_areas']) {
    assert.ok(stats.byTable[table] > 0, `missing ${table} documents`);
  }
  assert.equal(stats.byTable.schema_migrations, 1);

  const area = docs.find((doc) => doc.tbl === 'service_areas');
  assert.ok(area);
  assert.match(area.id, /^\d+:[1-9][0-9]{5}$/);
  assert.equal(area.doc.pin_code, area.id.split(':')[1]);
  assert.equal(area.synced_at, '2026-09-07T00:00:00.000Z');

  const service = docs.find((doc) => doc.tbl === 'services');
  assert.equal(typeof service.doc.title, 'string');
  assert.equal(service.id, String(service.doc.id));

  const ids = new Set(docs.map((doc) => `${doc.tbl}\0${doc.id}`));
  assert.equal(ids.size, docs.length, 'tbl+id must be unique');
  db.close();
});

test('chunk splits documents without dropping any', () => {
  const items = Array.from({ length: 5 }, (_, i) => i);
  assert.deepEqual(chunk(items, 2), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(chunk([], 10), []);
});

test('configFromEnv requires both url and key', () => {
  assert.equal(configFromEnv({}), null);
  assert.equal(configFromEnv({ SUPABASE_URL: 'https://x.supabase.co' }), null);
  assert.deepEqual(
    configFromEnv({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'secret' }),
    { url: 'https://x.supabase.co', key: 'secret' },
  );
});

test('isMissingTableError detects PostgREST schema-cache misses', () => {
  assert.equal(isMissingTableError({ status: 404, body: 'not found' }), true);
  assert.equal(
    isMissingTableError({
      status: 404,
      body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.seva_mirror' in the schema cache" }),
    }),
    true,
  );
  assert.equal(isMissingTableError({ status: 401, body: 'unauthorized' }), false);
});

test('createMirrorClient.ping is true when the table exists', async () => {
  const fetchImpl = async (url, init) => {
    assert.match(url, /\/rest\/v1\/seva_mirror\?/);
    assert.equal(init.method, 'GET');
    return {
      ok: true,
      status: 200,
      text: async () => '[]',
    };
  };
  const client = createMirrorClient({ url: 'https://example.supabase.co', key: 'k' }, { fetchImpl });
  assert.equal(await client.ping(), true);
});

test('createMirrorClient.ping is false when the table is missing', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 404,
    text: async () => JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.seva_mirror' in the schema cache" }),
  });
  const client = createMirrorClient({ url: 'https://example.supabase.co', key: 'k' }, { fetchImpl });
  assert.equal(await client.ping(), false);
});

test('createMirrorClient.upsert posts merge-duplicates chunks', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, prefer: init.headers.Prefer, body: JSON.parse(init.body) });
    return { ok: true, status: 201, text: async () => '' };
  };
  const client = createMirrorClient(
    { url: 'https://example.supabase.co', key: 'k' },
    { fetchImpl, chunkSize: 2 },
  );
  const docs = [
    { tbl: 'categories', id: '1', doc: { id: 1 }, synced_at: 't' },
    { tbl: 'categories', id: '2', doc: { id: 2 }, synced_at: 't' },
    { tbl: 'categories', id: '3', doc: { id: 3 }, synced_at: 't' },
  ];
  const result = await client.upsert(docs);
  assert.deepEqual(result, { upserted: 3, chunks: 2 });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /on_conflict=tbl,id/);
  assert.equal(calls[0].prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(calls[0].body.length, 2);
  assert.equal(calls[1].body.length, 1);
});

test('createMirrorClient.upsert surfaces HTTP errors', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => 'unauthorized',
  });
  const client = createMirrorClient({ url: 'https://example.supabase.co', key: 'k' }, { fetchImpl });
  await assert.rejects(
    () => client.upsert([{ tbl: 'x', id: '1', doc: {}, synced_at: 't' }]),
    (err) => {
      assert.equal(err instanceof MirrorError, true);
      assert.equal(err.status, 401);
      return true;
    },
  );
});

test('MIRROR_TABLES covers every foundation domain table', () => {
  for (const name of ['users', 'locations', 'categories', 'providers', 'services', 'service_areas', 'leads', 'audit_logs']) {
    assert.ok(MIRROR_TABLES.includes(name), name);
  }
});
