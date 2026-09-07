/**
 * SEVA MARKET INDIA — Supabase mirror setup tests.
 *
 * Guards two things that bit us in production:
 *   1. scripts/supabase-init.sql must be pure SQL — no file paths, markdown
 *      fences or prose glued to it (that is what produced the editor errors).
 *   2. The sync script must speak PostgREST correctly (upsert on (tbl,id))
 *      and refuse to run against a project where the table does not exist.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { makeDb } from './helpers.mjs';
import { syncAll, mirrorRows, rowId, toDocument, configFromEnv } from '../scripts/supabase-setup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_FILE = path.join(ROOT, 'scripts', 'supabase-init.sql');
const SCRIPT = path.join(ROOT, 'scripts', 'supabase-setup.mjs');

test('supabase-init.sql is clean, paste-ready SQL', () => {
  const sql = fs.readFileSync(SQL_FILE, 'utf8');

  assert.ok(sql.startsWith('CREATE TABLE IF NOT EXISTS public.seva_mirror ('), 'must start with the CREATE TABLE');
  assert.ok(sql.trimEnd().endsWith(';'), 'must end with a terminated statement');
  assert.match(sql, /PRIMARY KEY \(tbl, id\)/, 'composite primary key is what the upsert relies on');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/, 'RLS must stay on');
  assert.match(sql, /REVOKE ALL ON TABLE public\.seva_mirror FROM anon;/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.seva_mirror FROM authenticated;/);

  // The two things that broke the SQL editor: glued file paths and markdown.
  assert.doesNotMatch(sql, /seva-market-india\//, 'no repository paths inside the SQL');
  assert.doesNotMatch(sql, /\.(sql|mjs|js)\b/, 'no file names inside the SQL');
  assert.doesNotMatch(sql, /```/, 'no markdown fences');
  assert.doesNotMatch(sql, /^--/m, 'no comment lines (keeps the paste minimal and unambiguous)');
  assert.doesNotMatch(sql, /[^\x09\x0A\x20-\x7E]/, 'ASCII only — no smart quotes, NBSP or BOM');
  assert.doesNotMatch(sql, /,\s*\)/, 'no trailing comma before a closing parenthesis');

  const opens = (sql.match(/\(/g) || []).length;
  const closes = (sql.match(/\)/g) || []).length;
  assert.equal(opens, closes, 'parentheses must balance');
});

test('--sql prints exactly the file contents and nothing else', () => {
  const stdout = execFileSync(process.execPath, [SCRIPT, '--sql'], { encoding: 'utf8' });
  assert.equal(stdout, fs.readFileSync(SQL_FILE, 'utf8'));
});

test('sync without credentials exits 2 with a clear message', () => {
  const env = { ...process.env };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  delete env.SUPABASE_KEY;
  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', env, stdio: 'pipe' }),
    (err) => err.status === 2 && /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/.test(err.stderr)
  );
});

test('configFromEnv trims trailing slashes and requires both values', () => {
  assert.equal(configFromEnv({}), null);
  assert.equal(configFromEnv({ SUPABASE_URL: 'https://x.supabase.co' }), null);
  assert.deepEqual(configFromEnv({ SUPABASE_URL: 'https://x.supabase.co///', SUPABASE_SERVICE_ROLE_KEY: ' k ' }), {
    url: 'https://x.supabase.co',
    key: 'k',
  });
});

test('rows become JSON documents keyed by table + primary key', () => {
  assert.equal(rowId({ id: 7 }, ['id']), '7');
  assert.equal(rowId({ provider_id: 3, pin_code: '781001' }, ['provider_id', 'pin_code']), '3:781001');
  assert.deepEqual(toDocument({ id: 1n, blob: new Uint8Array([104, 105]), name: 'x', nothing: null }), {
    id: 1,
    blob: 'aGk=',
    name: 'x',
    nothing: null,
  });
  const rows = mirrorRows('services', [{ id: 2, title: 'Plumber' }], ['id']);
  assert.deepEqual(rows, [{ tbl: 'services', id: '2', doc: { id: 2, title: 'Plumber' } }]);
});

/** Minimal PostgREST stand-in: records upserts into a Map keyed by (tbl,id). */
function fakePostgrest({ tableExists = true } = {}) {
  const store = new Map();
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (!req.url.startsWith('/rest/v1/seva_mirror')) {
        res.writeHead(404).end('{"message":"Could not find the table"}');
        return;
      }
      if (!tableExists) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.seva_mirror' in the schema cache" }));
        return;
      }
      if (req.headers.apikey !== 'service-key' || req.headers.authorization !== 'Bearer service-key') {
        res.writeHead(401).end('{"message":"Invalid API key"}');
        return;
      }
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('[]');
        return;
      }
      if (req.method === 'POST') {
        if (!/merge-duplicates/.test(req.headers.prefer || '') || !/on_conflict=tbl,id/.test(req.url)) {
          res.writeHead(409).end('{"message":"duplicate key value violates unique constraint"}');
          return;
        }
        for (const row of JSON.parse(body)) store.set(`${row.tbl}\u0000${row.id}`, row);
        res.writeHead(201).end();
        return;
      }
      res.writeHead(405).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ url, store, requests, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

test('syncAll upserts every seeded row into the mirror through PostgREST', async () => {
  const { db } = makeDb();
  const remote = await fakePostgrest();
  try {
    const counts = await syncAll({
      db,
      config: { url: remote.url, key: 'service-key' },
      log: () => {},
    });
    const local = Object.fromEntries(
      Object.keys(counts).map((tbl) => [tbl, Number(db.scalar(`SELECT COUNT(*) FROM ${tbl}`))])
    );
    assert.deepEqual(counts, local, 'reported counts must match the local tables');
    assert.equal(remote.store.size, Object.values(local).reduce((a, b) => a + b, 0), 'every row lands exactly once');

    // Composite key table and a document spot-check.
    const area = db.get('SELECT * FROM service_areas LIMIT 1');
    assert.ok(remote.store.has(`service_areas\u0000${area.provider_id}:${area.pin_code}`));
    const service = db.get('SELECT * FROM services ORDER BY id LIMIT 1');
    assert.equal(remote.store.get(`services\u0000${service.id}`).doc.slug, service.slug);

    // Running again is idempotent (merge-duplicates), not a duplicate.
    await syncAll({ db, config: { url: remote.url, key: 'service-key' }, log: () => {} });
    assert.equal(remote.store.size, Object.values(local).reduce((a, b) => a + b, 0));
  } finally {
    db.close();
    await remote.close();
  }
});

test('syncAll explains how to create the table when it is missing', async () => {
  const { db } = makeDb({ withSeed: false });
  const remote = await fakePostgrest({ tableExists: false });
  try {
    await assert.rejects(
      syncAll({ db, config: { url: remote.url, key: 'service-key' }, log: () => {} }),
      /seva_mirror not found in Supabase.*supabase-init\.sql/s
    );
    assert.equal(remote.requests.filter((r) => r.method === 'POST').length, 0, 'no writes attempted');
  } finally {
    db.close();
    await remote.close();
  }
});

test('syncAll rejects unknown table names before touching the network', async () => {
  const { db } = makeDb({ withSeed: false });
  try {
    await assert.rejects(
      syncAll({ db, config: { url: 'http://127.0.0.1:9', key: 'k' }, tables: ['nope'], dryRun: true, log: () => {} }),
      /Unknown table "nope"/
    );
  } finally {
    db.close();
  }
});
