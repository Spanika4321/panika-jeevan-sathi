/**
 * SEVA MARKET INDIA — durable storage tests.
 *
 * These tests exist because of one specific bug class: a deploy that looks
 * healthy while quietly writing customer data to a disk that the host
 * deletes on the next release. Everything below is about making that
 * impossible to do by accident.
 *
 * No network: the Supabase backend is driven through an injected `fetch`
 * that speaks just enough PostgREST to be honest (Content-Range counts,
 * returned representations, error statuses).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { makeDb, request } from './helpers.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { assertStorageSafe, resolveDriver, StorageConfigError } = require('../src/store/guard');
const { buildQuery, describeKey, isPublicKey, parseContentRange, createRemoteClient } = require('../src/db/remote');
const baseConfig = require('../src/config');

const SCHEMA_FILE = path.join(ROOT, 'scripts', 'supabase-storage.sql');

/* ------------------------------------------------------------------ *
 * A tiny in-memory PostgREST. Enough to be a fair test double.        *
 * ------------------------------------------------------------------ */
function fakeSupabase({ tables = ['seva_users', 'seva_leads', 'seva_audit_logs'], failWith = null } = {}) {
  const store = new Map(tables.map((name) => [name, []]));
  const calls = [];
  let nextId = 1;

  function parse(url) {
    const parsed = new URL(url);
    const table = parsed.pathname.split('/rest/v1/')[1];
    return { table, params: parsed.searchParams };
  }

  /** Only the operators the store actually uses. */
  function matches(row, params) {
    for (const [key, raw] of params.entries()) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      const [op, ...rest] = raw.split('.');
      const value = rest.join('.').replace(/^"|"$/g, '');
      const cell = row[key];
      if (op === 'eq' && String(cell) !== value) return false;
      if (op === 'ne' && String(cell) === value) return false;
      if (op === 'gte' && !(String(cell) >= value)) return false;
      if (op === 'lte' && !(String(cell) <= value)) return false;
      if (op === 'is' && value === 'null' && cell !== null && cell !== undefined) return false;
    }
    return true;
  }

  const response = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body ?? '')),
  });

  const fetchImpl = async (url, init = {}) => {
    const { table, params } = parse(url);
    calls.push({ method: init.method || 'GET', table, url, body: init.body ? JSON.parse(init.body) : null });

    if (failWith) return response(failWith, { message: 'boom' });
    if (!store.has(table)) return response(404, { message: `relation "${table}" does not exist` });

    const rows = store.get(table);

    if ((init.method || 'GET') === 'POST') {
      const incoming = [].concat(JSON.parse(init.body));
      const inserted = incoming.map((row) => {
        const full = { id: nextId++, status: row.status ?? (table === 'seva_leads' ? 'new' : 'pending'), created_at: new Date().toISOString(), ...row };
        rows.push(full);
        return full;
      });
      const minimal = String(init.headers?.prefer || '').includes('return=minimal');
      return response(201, minimal ? '' : inserted);
    }

    if ((init.method || 'GET') === 'PATCH') {
      const patch = JSON.parse(init.body);
      const hit = rows.filter((row) => matches(row, params));
      hit.forEach((row) => Object.assign(row, patch));
      return response(200, hit);
    }

    const found = rows.filter((row) => matches(row, params));
    const limit = Number(params.get('limit') || 0);
    const sliced = limit > 0 ? found.slice(0, limit) : found;
    const wantsCount = String(init.headers?.prefer || '').includes('count=exact');
    return response(200, sliced, wantsCount ? { 'content-range': `0-${Math.max(sliced.length - 1, 0)}/${found.length}` } : {});
  };

  return { fetchImpl, store, calls };
}

/** A config whose storage block points at the fake Supabase. */
function supabaseConfig(overrides = {}) {
  return {
    ...baseConfig,
    isProduction: true,
    security: { ...baseConfig.security, sessionSecret: 'test-secret' },
    storage: {
      driver: 'supabase',
      requireRemote: true,
      allowEphemeral: false,
      supabase: { url: 'https://project.supabase.co', key: 'sb_secret_testkey_1234567890' },
      tables: { users: 'seva_users', leads: 'seva_leads', audit: 'seva_audit_logs' },
      ...overrides,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 1. Boot guard — the actual data-loss prevention                      *
 * ------------------------------------------------------------------ */

test('production + SEVA_REQUIRE_REMOTE without Supabase credentials refuses to boot', () => {
  const config = supabaseConfig({ supabase: { url: '', key: '' } });
  assert.throws(
    () => assertStorageSafe(config.storage, { isProduction: true }),
    (err) => err instanceof StorageConfigError && /SUPABASE_URL/.test(err.message),
  );
});

test('SEVA_REQUIRE_REMOTE=1 rejects the sqlite driver outright', () => {
  const storage = { ...supabaseConfig().storage, driver: 'sqlite', requireRemote: true };
  assert.throws(
    () => assertStorageSafe(storage, { isProduction: true }),
    /forbids the "sqlite" driver/,
  );
});

test('the anon key is rejected — it could never write a row', () => {
  const anonJwt = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase' })).toString('base64url'),
    'signature',
  ].join('.');
  assert.equal(isPublicKey(anonJwt), true);
  assert.equal(describeKey(anonJwt).role, 'anon');
  const storage = { ...supabaseConfig().storage, supabase: { url: 'https://p.supabase.co', key: anonJwt } };
  assert.throws(() => assertStorageSafe(storage, { isProduction: true }), /anon\/publishable key/);
});

test('a service_role JWT is accepted', () => {
  const serviceJwt = [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url'),
    'signature',
  ].join('.');
  const storage = { ...supabaseConfig().storage, supabase: { url: 'https://p.supabase.co', key: serviceJwt } };
  const verdict = assertStorageSafe(storage, { isProduction: true });
  assert.equal(verdict.durable, true);
  assert.deepEqual(verdict.warnings, []);
});

test('a non-https SUPABASE_URL is rejected', () => {
  const storage = { ...supabaseConfig().storage, supabase: { url: 'ftp://nope', key: 'sb_secret_x_1234567890' } };
  assert.throws(() => assertStorageSafe(storage, { isProduction: true }), /must be an https:\/\/ URL/);
});

test('production on sqlite boots but warns loudly about ephemeral disks', () => {
  const storage = { ...supabaseConfig().storage, driver: 'sqlite', requireRemote: false };
  const verdict = assertStorageSafe(storage, { isProduction: true });
  assert.equal(verdict.durable, false);
  assert.equal(verdict.warnings.length, 1);
  assert.match(verdict.warnings[0], /lost on the next deploy/);
});

test('SEVA_ALLOW_EPHEMERAL=1 silences the warning for a real persistent disk', () => {
  const storage = { ...supabaseConfig().storage, driver: 'sqlite', requireRemote: false, allowEphemeral: true };
  assert.deepEqual(assertStorageSafe(storage, { isProduction: true }).warnings, []);
});

test('driver resolution: sqlite for dev and tests, supabase for production with credentials', () => {
  assert.equal(resolveDriver({}, { isProduction: false }), 'sqlite');
  assert.equal(resolveDriver({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }, { isProduction: false }), 'sqlite');
  assert.equal(resolveDriver({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }, { isProduction: true }), 'supabase');
  assert.equal(resolveDriver({ SEVA_STORAGE: 'supabase' }, { isProduction: false }), 'supabase');
  assert.equal(resolveDriver({ SEVA_REQUIRE_REMOTE: '1' }, { isProduction: false }), 'supabase');
  assert.throws(() => resolveDriver({ SEVA_STORAGE: 'mysql' }), /Unknown SEVA_STORAGE/);
});

/* ------------------------------------------------------------------ *
 * 2. PostgREST plumbing                                                *
 * ------------------------------------------------------------------ */

test('buildQuery encodes equality, ranges and ordering', () => {
  const query = buildQuery({
    columns: ['id', 'name'],
    where: { provider_id: 7, created_at: { gte: '2026-01-01T00:00:00.000Z' }, status: { ne: 'spam' }, email: null },
    order: 'created_at.desc',
    limit: 20,
  });
  const params = new URLSearchParams(query);
  assert.equal(params.get('select'), 'id,name');
  assert.equal(params.get('provider_id'), 'eq.7');
  assert.equal(params.get('created_at'), 'gte."2026-01-01T00:00:00.000Z"');
  assert.equal(params.get('status'), 'ne.spam');
  assert.equal(params.get('email'), 'is.null');
  assert.equal(params.get('limit'), '20');
});

test('parseContentRange reads the exact count header', () => {
  assert.equal(parseContentRange('0-24/1234'), 1234);
  assert.equal(parseContentRange('*/0'), 0);
  assert.equal(parseContentRange(null), 0);
});

test('a missing table produces an actionable error, not a stack trace', async () => {
  const { fetchImpl } = fakeSupabase({ tables: [] });
  const remote = createRemoteClient({ url: 'https://p.supabase.co', key: 'sb_secret_k_1234567890', fetchImpl });
  await assert.rejects(
    () => remote.count('seva_leads', {}),
    /storage:sql/,
  );
});

test('credentials errors name the service-role key explicitly', async () => {
  const { fetchImpl } = fakeSupabase({ failWith: 401 });
  const remote = createRemoteClient({ url: 'https://p.supabase.co', key: 'sb_secret_k_1234567890', fetchImpl });
  await assert.rejects(() => remote.count('seva_leads', {}), /service-role key, not the anon key/);
});

/* ------------------------------------------------------------------ *
 * 3. Write-through: the row leaves the box before we answer 201        *
 * ------------------------------------------------------------------ */

test('an enquiry is written to Postgres, not to the local file', async () => {
  const { db } = makeDb();
  const { fetchImpl, store: remoteRows } = fakeSupabase();
  const config = supabaseConfig();
  const store = createStore({ config, db, fetchImpl, log: () => {} });
  assert.equal(store.backend, 'supabase');
  assert.equal(store.durable, true);

  const provider = db.get("SELECT id FROM providers WHERE status = 'active' LIMIT 1");
  const lead = await store.leads.create({
    providerId: provider.id,
    name: 'Ritu Das',
    phone: '9864012345',
    email: 'RITU@example.com',
    pinCode: '781001',
    message: 'Need a plumber today.',
    ip: '203.0.113.9',
  });

  assert.ok(lead.id);
  assert.equal(lead.status, 'new');
  assert.equal(remoteRows.get('seva_leads').length, 1, 'the row is in Postgres');
  assert.equal(Number(db.scalar('SELECT COUNT(*) FROM leads')), 0, 'nothing was written to the local file');

  const stored = remoteRows.get('seva_leads')[0];
  assert.equal(stored.email, 'ritu@example.com', 'email is normalised');
  assert.equal(stored.phone, '9864012345');
  assert.ok(stored.ip_hash && stored.ip_hash !== '203.0.113.9', 'the raw IP is never stored');
});

test('POST /api/v1/leads through the whole app reaches Postgres and returns 201', async () => {
  const { db } = makeDb();
  const { fetchImpl, store: remoteRows } = fakeSupabase();
  const config = supabaseConfig();
  const app = createApp({ config, db, store: createStore({ config, db, fetchImpl, log: () => {} }) });
  const provider = db.get("SELECT id FROM providers WHERE status = 'active' LIMIT 1");

  const res = await request(app, {
    method: 'POST',
    url: '/api/v1/leads',
    headers: { 'content-type': 'application/json' },
    body: { name: 'Ankit Sharma', phone: '9864099999', email: 'ankit@example.com', pin_code: '781005', provider_id: provider.id },
  });

  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().data.status, 'received');
  assert.equal(remoteRows.get('seva_leads').length, 1);
});

test('when Supabase is down the API fails instead of pretending the lead was saved', async () => {
  const { db } = makeDb();
  const { fetchImpl } = fakeSupabase({ failWith: 503 });
  const config = supabaseConfig();
  const app = createApp({ config, db, store: createStore({ config, db, fetchImpl, log: () => {} }) });
  const provider = db.get("SELECT id FROM providers WHERE status = 'active' LIMIT 1");

  const res = await request(app, {
    method: 'POST',
    url: '/api/v1/leads',
    headers: { 'content-type': 'application/json' },
    body: { name: 'Meera Roy', phone: '9864088888', email: 'meera@example.com', pin_code: '781001', provider_id: provider.id },
  });

  assert.equal(res.statusCode, 500, 'a lost write must never look like a success');
});

test('signups go to Postgres, hashed, and duplicates are refused', async () => {
  const { db } = makeDb();
  const { fetchImpl, store: remoteRows } = fakeSupabase();
  const config = supabaseConfig();
  const store = createStore({ config, db, fetchImpl, log: () => {} });

  const { user, passwordHash } = await store.users.create({
    email: 'Owner@Example.com',
    fullName: 'Owner One',
    password: 'correct horse battery',
    phone: '9864011111',
  });

  assert.equal(user.email, 'owner@example.com');
  assert.equal(user.password_hash, undefined, 'the hash never leaves the store');
  assert.match(passwordHash, /^scrypt\$/);
  assert.equal(remoteRows.get('seva_users').length, 1);
  assert.equal(Number(db.scalar('SELECT COUNT(*) FROM users')), 0);

  await assert.rejects(
    () => store.users.create({ email: 'owner@example.com', fullName: 'Copy Cat', password: 'another password' }),
    /already exists/,
  );

  const found = await store.users.findByEmail('OWNER@example.com');
  assert.equal(found.id, user.id);
  assert.equal(await store.users.count(), 1);
});

test('the per-IP enquiry throttle counts rows in Postgres', async () => {
  const { db } = makeDb();
  const { fetchImpl } = fakeSupabase();
  const config = supabaseConfig();
  const store = createStore({ config, db, fetchImpl, log: () => {} });
  const provider = db.get("SELECT id FROM providers WHERE status = 'active' LIMIT 1");

  assert.equal(await store.leads.recentCountFromIp('198.51.100.7'), 0);
  for (let i = 0; i < 3; i += 1) {
    await store.leads.create({ providerId: provider.id, name: `Caller ${i}`, phone: '9864077777', ip: '198.51.100.7' });
  }
  assert.equal(await store.leads.recentCountFromIp('198.51.100.7'), 3);
  assert.equal(await store.leads.recentCountFromIp('198.51.100.8'), 0, 'a different IP is not throttled');
});

test('the sqlite backend still behaves identically for the same calls', async () => {
  const { db } = makeDb();
  const config = { ...baseConfig, isProduction: false, storage: { ...supabaseConfig().storage, driver: 'sqlite', requireRemote: false } };
  const store = createStore({ config, db, log: () => {} });
  assert.equal(store.backend, 'sqlite');
  assert.equal(store.durable, false);

  const provider = db.get("SELECT id FROM providers WHERE status = 'active' LIMIT 1");
  const lead = await store.leads.create({ providerId: provider.id, name: 'Local Only', phone: '9864066666', ip: '198.51.100.1' });
  assert.ok(lead.id);
  assert.equal(Number(db.scalar('SELECT COUNT(*) FROM leads')), 1);
  assert.equal(await store.leads.recentCountFromIp('198.51.100.1'), 1);
});

/* ------------------------------------------------------------------ *
 * 4. Health tells the truth about durability                           *
 * ------------------------------------------------------------------ */

test('/api/v1/health reports the storage backend and whether it is durable', async () => {
  const { db } = makeDb();
  const { fetchImpl } = fakeSupabase();
  const config = supabaseConfig();
  const app = createApp({ config, db, store: createStore({ config, db, fetchImpl, log: () => {} }) });

  const shallow = (await request(app, { url: '/api/v1/health' })).json().data;
  assert.deepEqual(shallow.storage, { driver: 'supabase', durable: true });

  const deep = (await request(app, { url: '/api/v1/health/deep' })).json().data;
  assert.equal(deep.status, 'ok');
  assert.equal(deep.storage.ok, true);
  assert.equal(deep.catalog.ready, true);
});

test('/api/v1/health/deep degrades when Supabase cannot be reached', async () => {
  const { db } = makeDb();
  const { fetchImpl } = fakeSupabase({ failWith: 500 });
  const config = supabaseConfig();
  const app = createApp({ config, db, store: createStore({ config, db, fetchImpl, log: () => {} }) });

  const deep = (await request(app, { url: '/api/v1/health/deep' })).json().data;
  assert.equal(deep.status, 'degraded');
  assert.equal(deep.storage.ok, false);
});

/* ------------------------------------------------------------------ *
 * 5. The Postgres schema itself                                        *
 * ------------------------------------------------------------------ */

test('the schema creates exactly the three non-regenerable tables', () => {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  for (const table of ['seva_users', 'seva_leads', 'seva_audit_logs']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`));
  }
  // Catalog tables must NOT be created here: they are seed data.
  for (const table of ['locations', 'categories', 'providers', 'services']) {
    assert.doesNotMatch(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`));
  }
});

test('the schema is idempotent — safe to paste twice', () => {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const creates = sql.match(/CREATE TABLE(?! IF NOT EXISTS)/g) || [];
  assert.deepEqual(creates, [], 'every CREATE TABLE must use IF NOT EXISTS');
  const indexes = sql.match(/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/g) || [];
  assert.deepEqual(indexes, [], 'every CREATE INDEX must use IF NOT EXISTS');
});

test('the schema locks every table down: RLS on, anon and authenticated revoked', () => {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  for (const table of ['seva_users', 'seva_leads', 'seva_audit_logs']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`REVOKE ALL ON TABLE public\\.${table}\\s+FROM anon`));
    assert.match(sql, new RegExp(`REVOKE ALL ON TABLE public\\.${table}\\s+FROM authenticated`));
  }
  assert.doesNotMatch(sql, /CREATE POLICY/i, 'no policy: only the service-role key may touch these rows');
  assert.doesNotMatch(sql, /GRANT .* TO (anon|authenticated|public)/i);
});

test('the schema never drops or truncates anything', () => {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|SCHEMA|DATABASE|INDEX)\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
});

test('the schema enforces case-insensitive email uniqueness', () => {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS seva_users_email_unique[\s\S]*lower\(email\)/);
});

test('the durable tables are prefixed so they cannot collide with Panika Jeevan Sathi', () => {
  // Statements only: the header comment mentions public.users to explain why
  // the prefix exists, and that sentence must not fail the check.
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(sql, /public\.users\b/);
  assert.doesNotMatch(sql, /public\.audit_logs\b/);
  const tables = baseConfig.storage.tables;
  for (const name of Object.values(tables)) assert.match(name, /^seva_/);
});

/* ------------------------------------------------------------------ *
 * 6. The mirror is a catalog copy, never a backup of user data         *
 * ------------------------------------------------------------------ */

test('the read-only mirror never carries accounts, enquiries or audit rows', async () => {
  const { TABLES } = await import('../scripts/supabase-setup.mjs');
  const mirrored = TABLES.map((table) => table.name);
  for (const sensitive of ['users', 'leads', 'audit_logs']) {
    assert.ok(!mirrored.includes(sensitive), `${sensitive} must never be mirrored`);
  }
  assert.deepEqual(mirrored, ['locations', 'categories', 'providers', 'services', 'service_areas']);
});

/* ------------------------------------------------------------------ *
 * 7. The doctor script                                                 *
 * ------------------------------------------------------------------ */

test('storage doctor fails when the host is ephemeral and unconfigured', async () => {
  const { main } = await import('../scripts/storage-doctor.mjs');
  const lines = [];
  const code = await main([], {
    env: { NODE_ENV: 'production', SEVA_REQUIRE_REMOTE: '1' },
    log: (line) => lines.push(String(line)),
    error: (line) => lines.push(String(line)),
    fetchImpl: async () => { throw new Error('doctor must not reach the network here'); },
  });
  assert.equal(code, 1);
  assert.match(lines.join('\n'), /SUPABASE_URL/);
});

test('storage doctor passes and verifies a real write when configured', async () => {
  const { main } = await import('../scripts/storage-doctor.mjs');
  const { fetchImpl, store: remoteRows } = fakeSupabase();
  const lines = [];
  const code = await main(['--write'], {
    env: {
      NODE_ENV: 'production',
      SEVA_REQUIRE_REMOTE: '1',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_testkey_1234567890',
    },
    log: (line) => lines.push(String(line)),
    error: (line) => lines.push(String(line)),
    fetchImpl,
  });
  assert.equal(code, 0, lines.join('\n'));
  assert.match(lines.join('\n'), /Verdict: durable/);
  assert.equal(remoteRows.get('seva_audit_logs').length, 1, 'the canary row really was written');
});

test('storage doctor --sql prints the pasteable schema without touching the network', async () => {
  const { main } = await import('../scripts/storage-doctor.mjs');
  let printed = '';
  const code = await main(['--sql'], {
    env: {},
    log: (line) => { printed += `${line}\n`; },
    fetchImpl: async () => { throw new Error('--sql must not call fetch'); },
  });
  assert.equal(code, 0);
  assert.match(printed, /CREATE TABLE IF NOT EXISTS public\.seva_leads/);
});

/* ------------------------------------------------------------------ *
 * 8. Real PostgreSQL (gated)                                           *
 *                                                                      *
 * Regex assertions prove the file *says* the right things. This proves *
 * PostgreSQL *accepts* them: the parser here is Postgres's own.        *
 * Skipped unless SEVA_PSQL points at a psql binary.                    *
 * ------------------------------------------------------------------ */

const PSQL = process.env.SEVA_PSQL;

test(
  'supabase-storage.sql runs on real PostgreSQL, twice, and locks every table down',
  { skip: PSQL ? false : 'set SEVA_PSQL to a psql binary to run against real PostgreSQL' },
  async () => {
    const { execFileSync } = await import('node:child_process');
    const run = (sql) =>
      execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
    const one = (sql) =>
      execFileSync(PSQL, ['-X', '-q', '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();

    // Supabase ships these roles; a bare cluster does not, and REVOKE against
    // a missing role is an error.
    for (const role of ['anon', 'authenticated']) {
      try {
        run(`CREATE ROLE ${role} NOLOGIN`);
      } catch (_) {
        /* already present */
      }
    }
    for (const table of ['seva_users', 'seva_leads', 'seva_audit_logs']) {
      run(`DROP TABLE IF EXISTS public.${table}`);
    }

    // Idempotency: pasting the same file twice must not error.
    for (let pass = 1; pass <= 2; pass += 1) {
      execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', SCHEMA_FILE], { encoding: 'utf8' });
    }

    for (const table of ['seva_users', 'seva_leads', 'seva_audit_logs']) {
      assert.equal(one(`select to_regclass('public.${table}')`), table);
      assert.equal(one(`select rowsecurity from pg_tables where tablename = '${table}'`), 't');
    }
    assert.equal(one("select count(*) from pg_policies where schemaname = 'public' and tablename like 'seva_%'"), '0');
    assert.equal(
      one("select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'seva_%'"),
      '0',
      'anon and authenticated must hold no grant on any durable table',
    );

    // Defaults and constraints behave the way the app assumes they do.
    assert.equal(
      one("insert into public.seva_leads (provider_id, name, phone) values (1,'Probe','9864012345') returning status"),
      'new',
    );
    assert.equal(
      one("insert into public.seva_users (email, full_name, password_hash) values ('probe@example.com','Probe','scrypt$x') returning role || '/' || status"),
      'customer/pending',
    );
    assert.throws(
      () => run("insert into public.seva_users (email, full_name, password_hash) values ('PROBE@EXAMPLE.COM','Dup','scrypt$y')"),
      /seva_users_email_unique/,
      'email uniqueness must be case-insensitive',
    );
    assert.throws(
      () => run("insert into public.seva_users (email, full_name, password_hash, role) values ('x@y.com','X','h','superadmin')"),
      /role_check/,
    );
  },
);
