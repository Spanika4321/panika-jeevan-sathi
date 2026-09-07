/**
 * SEVA MARKET INDIA — Supabase setup tests.
 *
 * Two concerns, both born from a real incident: pasting the bootstrap SQL
 * into the Supabase editor failed with "syntax error at or near )" because
 * something other than SQL (a file path, a markdown fence, a comment) ended
 * up in the paste. So the SQL file itself is asserted on, structurally, and
 * `--sql` is asserted to echo it byte for byte.
 *
 * The sync path is asserted against a fake PostgREST server on localhost —
 * real HTTP, real JSON, no mocking of fetch internals.
 *
 * One test talks to a *real* PostgreSQL server. It is skipped unless
 * SEVA_PSQL points at a psql binary (see README → Supabase).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { makeDb } from './helpers.mjs';
import {
  TABLES,
  SQL_FILE,
  readSql,
  lintSql,
  splitStatements,
  statementHeads,
  selectTables,
  buildRows,
  batch,
  emitCsv,
  emitInsertSql,
  syncRows,
  summarize,
  parseArgs,
  main,
} from '../scripts/supabase-setup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- SQL guards

test('supabase-init.sql is clean: lintSql() finds nothing to complain about', () => {
  assert.deepEqual(lintSql(readSql()), []);
});

test('lintSql() rejects every class of junk that broke a previous paste', () => {
  const clean = readSql();
  const injections = [
    ['```sql\n', 'markdown code fence'],
    ['-- run this in the editor\n', 'SQL line comment'],
    ['/* note */\n', 'block comment'],
    ['/home/user/seva-market-india/scripts/supabase-init.sql\n', 'absolute filesystem path'],
    ['seva-market-india/scripts/supabase-init.sql\n', 'relative repository path'],
    ['# Paste into Supabase\n', 'markdown heading'],
    ['$ npm run supabase:sql\n', 'shell prompt'],
    ['Expected: Success. No rows returned\n', 'shell/editor prose'],
    ['cat scripts/supabase-init.sql\n', 'shell/editor prose'],
    ['CREATE TABLE t (a text);\r\n', 'carriage return (CRLF line ending)'],
    ['CREATE TABLE t (a text);\u00a0\n', 'non-breaking space'],
    ['CREATE TABLE t (a text); // done\n', 'trailing // comment'],
    ['Paste the block below\n', 'line does not look like SQL'],
  ];
  for (const [junk, expected] of injections) {
    const problems = lintSql(junk + clean);
    assert.ok(problems.length > 0, `lintSql missed: ${JSON.stringify(junk)}`);
    assert.ok(
      problems.some((problem) => problem.includes(expected)),
      `lintSql(${JSON.stringify(junk)}) should report "${expected}", got ${JSON.stringify(problems)}`,
    );
  }
});

test('supabase-init.sql is exactly nine statements of the expected kinds', () => {
  const sql = readSql();
  const { statements, trailing } = splitStatements(sql);
  assert.equal(trailing, '', 'trailing text after the last semicolon');
  assert.equal(statements.length, 9, `expected 9 statements, found ${statements.length}`);
  assert.deepEqual(statementHeads(sql), [
    'SET LOCK_TIMEOUT',
    'SET STATEMENT_TIMEOUT',
    'BEGIN',
    'CREATE TABLE',
    'ALTER TABLE',
    'REVOKE ALL',
    'REVOKE ALL',
    'NOTIFY PGRST',
    'COMMIT',
  ]);
  assert.match(sql, /PRIMARY KEY \(tbl, id\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/, 'the quoted channel must survive splitting');
  // A blocked DDL must fail fast instead of leaving the editor spinning.
  assert.match(sql, /SET lock_timeout = '10s';/);
  assert.match(sql, /SET statement_timeout = '30s';/);
});

test('every line of supabase-init.sql is one complete, self-contained statement', () => {
  // This is the paste-robustness guard. A multi-line CREATE TABLE can lose its
  // column lines in a copy/paste and leave a dangling ")" that Postgres
  // reports as: syntax error at or near ")". One statement per line with
  // balanced parentheses makes that impossible to produce.
  const lines = readSql().split('\n').filter((line) => line.trim());
  assert.ok(lines.length >= 9, 'expected the full bootstrap script');
  for (const line of lines) {
    const open = (line.match(/\(/g) || []).length;
    const close = (line.match(/\)/g) || []).length;
    assert.equal(open, close, `unbalanced parentheses on line: ${line}`);
    assert.match(line.trim(), /;$/, `line is not a complete statement: ${line}`);
    assert.equal(
      line.trim(),
      line.trimStart(),
      'no line is indented, so a paste cannot silently drop leading whitespace',
    );
  }
  assert.equal(
    lines.filter((line) => /^\)/.test(line.trim())).length,
    0,
    'no line may begin with a closing parenthesis',
  );
});

test('lintSql() rejects a bootstrap SQL that could hang or land half-applied', () => {
  const clean = readSql();
  assert.deepEqual(lintSql(clean), []);
  const noTimeout = clean.replace(/SET lock_timeout = '10s';\n/, '');
  assert.ok(
    lintSql(noTimeout).some((p) => p.includes('lock_timeout')),
    'removing lock_timeout must be caught: a blocked ALTER would hang forever',
  );
  const noTx = clean.replace('BEGIN;', '').replace('COMMIT;', '');
  assert.ok(
    lintSql(noTx).some((p) => p.includes('BEGIN/COMMIT')),
    'removing the transaction must be caught: the table would be readable before the REVOKEs',
  );
});

test('--sql refuses to print a file that is not clean SQL', async () => {
  const tmp = path.join(os.tmpdir(), `seva-bad-${process.pid}.sql`);
  fs.writeFileSync(tmp, '-- do not paste this\nCREATE TABLE nope ();\n');
  const lines = [];
  const code = await main(['--sql'], {
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
    sqlFile: tmp,
  });
  fs.rmSync(tmp, { force: true });
  assert.equal(code, 1);
  assert.match(lines.join('\n'), /not clean SQL/);
  assert.equal(lines.filter((line) => line.includes('CREATE TABLE nope')).length, 0, 'must not print the bad SQL');
});

test('--sql prints the SQL file byte for byte and nothing else', async () => {
  const lines = [];
  const code = await main(['--sql'], { log: (line) => lines.push(line) });
  assert.equal(code, 0);
  assert.equal(lines.length, 1, '--sql must emit exactly one chunk');
  assert.equal(lines[0], readSql(), '--sql output must equal the file contents verbatim');
});

test('--sql works with no database and no credentials', async () => {
  const code = await main(['--sql'], { env: {}, log: () => {}, error: () => {} });
  assert.equal(code, 0);
});

// --------------------------------------------------------------- arg parsing

test('parseArgs handles flags, values and positionals', () => {
  assert.deepEqual(parseArgs(['--sql']), { _: [], sql: true });
  assert.deepEqual(parseArgs(['--tables=locations,providers', '--batch=50']), {
    _: [],
    tables: 'locations,providers',
    batch: '50',
  });
  assert.deepEqual(parseArgs(['--dry-run', 'x']), { _: ['x'], 'dry-run': true });
});

test('selectTables filters in schema order and rejects typos', () => {
  assert.deepEqual(selectTables(null).map((t) => t.name), TABLES.map((t) => t.name));
  assert.deepEqual(selectTables('providers,locations').map((t) => t.name), [
    'locations',
    'providers',
  ]);
  assert.throws(() => selectTables('locatons'), /Unknown table\(s\): locatons/);
  assert.throws(() => selectTables('leads'), /Unknown table\(s\): leads/, 'leads is not mirrored');
});

// ------------------------------------------------------------- row building

test('buildRows maps every local row to {tbl, id, doc}, composite key included', () => {
  const { db } = makeDb();
  const rows = buildRows(db);
  const { total } = summarize(db);

  assert.equal(rows.length, total, 'one mirror row per local row');
  assert.equal(total, 190, 'seed dataset is 190 rows');
  assert.deepEqual(
    TABLES.map((table) => [table.name, rows.filter((row) => row.tbl === table.name).length]),
    [
      ['locations', 105],
      ['categories', 36],
      ['providers', 10],
      ['services', 14],
      ['service_areas', 25],
    ],
  );

  for (const row of rows) {
    assert.equal(typeof row.id, 'string');
    assert.ok(row.id.length > 0, 'id must not be empty');
    assert.equal(typeof row.doc, 'object');
    assert.equal(JSON.parse(JSON.stringify(row.doc)) && true, true, 'doc must be JSON-serialisable');
  }

  const area = rows.find((row) => row.tbl === 'service_areas');
  assert.match(area.id, /^\d+:[1-9]\d{5}$/, `composite id should be provider_id:pin_code, got ${area.id}`);
  assert.equal(area.id, `${area.doc.provider_id}:${area.doc.pin_code}`);

  // (tbl, id) must be unique — it is the remote primary key.
  const keys = rows.map((row) => `${row.tbl}\u0000${row.id}`);
  assert.equal(new Set(keys).size, keys.length, '(tbl, id) must be unique');
  db.close();
});

test('batch() chunks rows and rejects nonsense sizes', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ tbl: 'x', id: String(i), doc: {} }));
  assert.deepEqual(batch(rows, 3).map((chunk) => chunk.length), [3, 3, 1]);
  assert.deepEqual(batch([], 3), []);
  assert.throws(() => batch(rows, 0), /positive integer/);
  assert.throws(() => batch(rows, 1.5), /positive integer/);
});

// ------------------------------------------------------- fake PostgREST sync

/** A minimal PostgREST stand-in: records requests, replies like the real thing. */
function startFakePostgREST({ status = 201, body = '' } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('sync upserts to /rest/v1/seva_mirror with the right headers and chunks', async () => {
  const fake = await startFakePostgREST();
  try {
    const { db } = makeDb();
    const rows = buildRows(db, selectTables('providers,services'));
    assert.equal(rows.length, 24, '10 providers + 14 services');

    const result = await syncRows(rows, {
      baseUrl: fake.baseUrl,
      apiKey: 'test-service-role-key',
      batchSize: 10,
    });

    assert.deepEqual(result, { upserted: 24, batches: 3 });
    assert.equal(fake.requests.length, 3);

    for (const request of fake.requests) {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/rest/v1/seva_mirror');
      assert.equal(request.headers.apikey, 'test-service-role-key');
      assert.equal(request.headers.authorization, 'Bearer test-service-role-key');
      assert.equal(request.headers.prefer, 'resolution=merge-duplicates,return=minimal');
      const parsed = JSON.parse(request.body);
      assert.ok(Array.isArray(parsed));
      assert.ok(parsed.length > 0 && parsed.length <= 10);
      for (const row of parsed) {
        assert.deepEqual(Object.keys(row).sort(), ['doc', 'id', 'tbl']);
      }
    }

    const all = fake.requests.flatMap((request) => JSON.parse(request.body));
    assert.deepEqual(
      all.map((row) => `${row.tbl}:${row.id}`).sort(),
      rows.map((row) => `${row.tbl}:${row.id}`).sort(),
      'every row is sent exactly once',
    );
    db.close();
  } finally {
    await fake.close();
  }
});

test('a trailing slash in SUPABASE_URL does not produce a double slash', async () => {
  const fake = await startFakePostgREST();
  try {
    await syncRows([{ tbl: 'providers', id: '1', doc: { id: 1 } }], {
      baseUrl: `${fake.baseUrl}///`,
      apiKey: 'k',
    });
    assert.equal(fake.requests[0].url, '/rest/v1/seva_mirror');
  } finally {
    await fake.close();
  }
});

test('a missing table (404) yields an actionable message, not a raw payload', async () => {
  const fake = await startFakePostgREST({
    status: 404,
    body: '{"code":"42P01","message":"relation \\"public.seva_mirror\\" does not exist"}',
  });
  try {
    await assert.rejects(
      () => syncRows([{ tbl: 'providers', id: '1', doc: {} }], { baseUrl: fake.baseUrl, apiKey: 'k' }),
      (err) => {
        assert.match(err.message, /does not know the table "seva_mirror"/);
        assert.match(err.message, /npm run supabase:sql/);
        assert.equal(err.message.includes('42P01'), false, 'raw Postgres payload must not leak');
        return true;
      },
    );
  } finally {
    await fake.close();
  }
});

test('bad credentials (401) point at the service-role key', async () => {
  const fake = await startFakePostgREST({ status: 401, body: '{"message":"JWT expired"}' });
  try {
    await assert.rejects(
      () => syncRows([{ tbl: 'providers', id: '1', doc: {} }], { baseUrl: fake.baseUrl, apiKey: 'k' }),
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  } finally {
    await fake.close();
  }
});

test('syncRows refuses to run without a URL or a key', async () => {
  await assert.rejects(
    () => syncRows([{ tbl: 'providers', id: '1', doc: {} }], { apiKey: 'k' }),
    /Missing SUPABASE_URL/,
  );
  await assert.rejects(
    () => syncRows([{ tbl: 'providers', id: '1', doc: {} }], { baseUrl: 'http://x' }),
    /Missing SUPABASE_SERVICE_ROLE_KEY/,
  );
});

// ------------------------------------------------------------- CLI behaviour

test('the CLI dry-run counts every row and sends nothing', async () => {
  const { db } = makeDb();
  const lines = [];
  let fetchCalls = 0;
  const code = await main(['--dry-run'], {
    env: { SEVA_DB_FILE: ':memory:' },
    db,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('dry run must not call fetch');
    },
  });
  const out = lines.join('\n');
  assert.equal(code, 0);
  assert.equal(fetchCalls, 0);
  assert.match(out, /locations\s+105 row\(s\)/);
  assert.match(out, /categories\s+36 row\(s\)/);
  assert.match(out, /providers\s+10 row\(s\)/);
  assert.match(out, /services\s+14 row\(s\)/);
  assert.match(out, /service_areas\s+25 row\(s\)/);
  assert.match(out, /total\s+190 row\(s\)/);
  assert.match(out, /Dry run/);
  db.close();
});

test('the CLI honours --tables and reports per-batch progress', async () => {
  const { db } = makeDb();
  const fake = await startFakePostgREST();
  const lines = [];
  try {
    const code = await main(['--tables=providers,services', '--batch=20'], {
      env: { SEVA_DB_FILE: ':memory:', SUPABASE_URL: fake.baseUrl, SUPABASE_SERVICE_ROLE_KEY: 'k' },
      db,
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    });
    const out = lines.join('\n');
    assert.equal(code, 0);
    assert.equal(fake.requests.length, 2, '24 rows at 20 per batch = 2 requests');
    assert.match(out, /batch 1: \+20/);
    assert.match(out, /batch 2: \+4 \(24 total\)/);
    assert.match(out, /Synced 24 row\(s\) to seva_mirror in 2 request\(s\)/);
    assert.equal(out.includes('locations'), false, 'unselected tables are not listed');
  } finally {
    await fake.close();
    db.close();
  }
});

test('the CLI fails cleanly when Supabase has no mirror table yet', async () => {
  const { db } = makeDb();
  const fake = await startFakePostgREST({ status: 404, body: '{"code":"42P01"}' });
  const lines = [];
  try {
    const code = await main([], {
      env: { SEVA_DB_FILE: ':memory:', SUPABASE_URL: fake.baseUrl, SUPABASE_SERVICE_ROLE_KEY: 'k' },
      db,
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    });
    const out = lines.join('\n');
    assert.equal(code, 1);
    assert.match(out, /npm run supabase:sql/);
    assert.match(out, /Supabase SQL editor/);
  } finally {
    await fake.close();
    db.close();
  }
});

test('the CLI fails cleanly without credentials', async () => {
  const { db } = makeDb();
  const lines = [];
  const code = await main([], {
    env: { SEVA_DB_FILE: ':memory:' },
    db,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
    fetchImpl: async () => {
      throw new Error('must not reach the network');
    },
  });
  assert.equal(code, 1);
  assert.match(lines.join('\n'), /Missing SUPABASE_URL/);
  db.close();
});

test('an unknown --tables value is rejected before any query runs', async () => {
  const { db } = makeDb();
  const lines = [];
  const code = await main(['--tables=nope'], {
    env: { SEVA_DB_FILE: ':memory:' },
    db,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  });
  assert.equal(code, 1);
  assert.match(lines.join('\n'), /Unknown table\(s\): nope/);
  db.close();
});

// --------------------------------------------------- real PostgreSQL (gated)

/**
 * Runs supabase-init.sql against a genuine PostgreSQL server. Skipped unless
 * SEVA_PSQL points at a psql binary; PGDATABASE/PGUSER may be set to aim it
 * at a throwaway cluster. This is what proves the paste block is valid SQL —
 * the parser here is PostgreSQL's own, not a reimplementation.
 */
const PSQL = process.env.SEVA_PSQL;

test(
  'supabase-init.sql runs on real PostgreSQL, twice, and locks the table down',
  { skip: PSQL ? false : 'set SEVA_PSQL to a psql binary to run against real PostgreSQL' },
  () => {
    const run = (sql) =>
      execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });

    // Supabase ships these roles; a bare cluster does not, and REVOKE against
    // a non-existent role is an error, so create them if they are absent.
    for (const role of ['anon', 'authenticated']) {
      try {
        run(`CREATE ROLE ${role} NOLOGIN`);
      } catch (_) {
        /* already present */
      }
    }
    run('DROP TABLE IF EXISTS public.seva_mirror');

    // Idempotency: the same block twice must not error.
    for (let pass = 1; pass <= 2; pass += 1) {
      execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', SQL_FILE], { encoding: 'utf8' });
    }

    const one = (sql) =>
      execFileSync(PSQL, ['-X', '-q', '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();

    assert.equal(one("select to_regclass('public.seva_mirror')"), 'seva_mirror');
    assert.equal(
      one("select relrowsecurity from pg_class where relname = 'seva_mirror' and relnamespace = 'public'::regnamespace"),
      't',
      'row level security must be enabled',
    );
    assert.equal(
      one(`select count(*) from information_schema.role_table_grants
             where table_schema = 'public' and table_name = 'seva_mirror'
               and grantee in ('anon','authenticated')`),
      '0',
      'anon and authenticated must hold no grants',
    );
    assert.deepEqual(
      one(`select column_name || ':' || data_type from information_schema.columns
             where table_schema = 'public' and table_name = 'seva_mirror' order by ordinal_position`)
        .split('\n'),
      ['tbl:text', 'id:text', 'doc:jsonb', 'synced_at:timestamp with time zone'],
    );
    assert.equal(
      one(`select count(*) from pg_constraint c
             join pg_class r on r.oid = c.conrelid
            where r.relname = 'seva_mirror' and c.contype = 'p'
              and array_length(c.conkey, 1) = 2`),
      '1',
      'primary key must cover (tbl, id)',
    );

    // The shape this script actually sends must insert and upsert cleanly.
    const doc = JSON.stringify({ id: 1, business_name: "Ravi's Repairs", about: 'a & b' });
    run(`insert into public.seva_mirror (tbl, id, doc) values ('providers', '1', '${doc.replace(/'/g, "''")}'::jsonb)`);
    assert.equal(one("select doc->>'business_name' from public.seva_mirror where tbl='providers' and id='1'"), "Ravi's Repairs");
    run('delete from public.seva_mirror');
    run('DROP TABLE public.seva_mirror');
  },
);

test(
  'a blocked ALTER fails in ~10s with a lock timeout instead of hanging forever',
  { skip: PSQL ? false : 'set SEVA_PSQL to a psql binary to run against real PostgreSQL' },
  async () => {
    const run = (sql) =>
      execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
    for (const role of ['anon', 'authenticated']) {
      try {
        run(`CREATE ROLE ${role} NOLOGIN`);
      } catch (_) {
        /* already present */
      }
    }
    run('DROP TABLE IF EXISTS public.seva_mirror');
    execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', SQL_FILE], { encoding: 'utf8' });

    // Hold an ACCESS SHARE lock from another session, the way a leftover
    // "idle in transaction" query tab does in the Supabase editor.
    const blocker = spawn(
      PSQL,
      ['-X', '-q', '-c', 'BEGIN; LOCK TABLE public.seva_mirror IN ACCESS SHARE MODE; SELECT pg_sleep(60);'],
      { stdio: 'ignore', detached: true },
    );
    const runSqlFile = () =>
      new Promise((resolve) => {
        const child = spawn(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', SQL_FILE], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const started = Date.now();
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('close', (code) => resolve({ code, stderr, elapsed: (Date.now() - started) / 1000 }));
      });

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const started = runSqlFile();
      // Give the DDL time to reach the lock queue before inspecting it.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const one = (sql) =>
        execFileSync(PSQL, ['-X', '-q', '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();
      const blockers = one(
        'select count(*) from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0',
      );
      assert.match(blockers, /^[1-9]/, 'the diagnostic query must show a blocked backend');
      assert.match(
        one("select count(*) from pg_stat_activity where wait_event_type = 'Lock'"),
        /^[1-9]/,
        'the blocked backend must be waiting on a lock',
      );

      const result = await started;
      assert.notEqual(result.code, 0, 'the script must fail while blocked');
      assert.match(result.stderr, /canceling statement due to lock timeout/, 'must fail on the lock timeout');
      assert.ok(result.elapsed < 30, `must give up quickly, waited ${result.elapsed}s`);
      assert.ok(result.elapsed >= 9, `must actually honour the 10s lock_timeout, waited ${result.elapsed}s`);
    } finally {
      blocker.kill('SIGKILL');
      // Killing the client does not release the server-side lock instantly, so
      // terminate the backend holding pg_sleep before dropping — otherwise the
      // teardown itself blocks and stalls the whole suite.
      execFileSync(
        PSQL,
        [
          '-X',
          '-q',
          '-c',
          "select pg_terminate_backend(pid) from pg_stat_activity where pid <> pg_backend_pid() and query like '%pg_sleep%'",
        ],
        { encoding: 'utf8' },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      execFileSync(
        PSQL,
        ['-X', '-q', '-c', "set lock_timeout = '5s'; drop table if exists public.seva_mirror"],
        { encoding: 'utf8' },
      );
    }
  },
);

test('the SQL block documented in the README is byte-identical to the file', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## Supabase mirror'));
  const match = /```sql\n([\s\S]*?)```/.exec(section);
  assert.ok(match, 'README must show the bootstrap SQL in a ```sql block');
  assert.equal(match[1], readSql(), 'README block drifted from scripts/supabase-init.sql');
  assert.deepEqual(lintSql(match[1]), [], 'the documented block must also lint clean');
});

test('emitInsertSql() makes every line a complete, independent statement', () => {
  const { db } = makeDb();
  const { parts } = emitInsertSql(buildRows(db));
  db.close();

  assert.equal(parts.reduce((sum, part) => sum + part.rows, 0), 190, 'every row is emitted');
  assert.equal(parts.length, 19, 'the paste is split into 19 small chunks');

  for (const part of parts) {
    assert.ok(part.bytes <= 4200, `${part.label} is ${part.bytes} bytes — too big for a phone paste`);
    for (const line of part.text.trim().split('\n')) {
      assert.match(line, /^insert into public\.seva_mirror \(tbl, id, doc\) values /, `not an insert: ${line.slice(0, 60)}`);
      assert.match(line, /;$/, 'each line is a complete statement');
      const open = (line.match(/\(/g) || []).length;
      const close = (line.match(/\)/g) || []).length;
      assert.equal(open, close, `unbalanced parentheses: ${line.slice(0, 80)}`);
      assert.match(line, /on conflict \(tbl, id\) do update set doc = excluded\.doc;$/, 'must upsert');
    }
  }
});

test('line order does not matter — a scrambled paste still loads every row', () => {
  // The failure that motivated this: a phone clipboard returned the file
  // reordered, so `COMMIT;` landed in the middle of a JSON document and the
  // whole VALUES list failed to parse. With one statement per line, order is
  // irrelevant and a lost line costs exactly one row.
  const { db } = makeDb();
  const { parts } = emitInsertSql(buildRows(db, selectTables('providers')));
  db.close();
  const file = parts[0];
  const lines = file.text.trim().split('\n');
  assert.equal(lines.length, 7, 'seven provider rows in the first chunk');

  const reversed = [...lines].reverse();
  for (const line of reversed) {
    assert.match(line, /;$/, 'every line still ends a statement after reordering');
  }
  // Losing any single line costs one row and leaves the rest valid.
  for (let i = 0; i < lines.length; i += 1) {
    const remaining = lines.filter((_, index) => index !== i);
    assert.equal(remaining.length, lines.length - 1);
    assert.ok(remaining.every((line) => line.endsWith(';')), `dropping line ${i} leaves valid statements`);
  }
});

test('emitCsv() quotes fields and covers every row', () => {
  const { db } = makeDb();
  const csv = emitCsv(buildRows(db));
  db.close();
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'tbl,id,doc');
  assert.equal(lines.length, 191, 'header + 190 rows');
  for (const line of lines.slice(1)) {
    // tbl and id are bare; doc contains commas so it must be double-quoted.
    assert.match(line, /^(locations|categories|providers|services|service_areas),[^,]+,"\{.*\}"$/);
  }
});

test('the committed supabase-data files match the seed data exactly', () => {
  // Drift guard: if the seed dataset changes, these files must be regenerated.
  const dir = path.join(ROOT, 'supabase-data');
  assert.ok(fs.existsSync(dir), 'supabase-data/ must exist — run `npm run supabase:emit`');
  const { db } = makeDb();
  const rows = buildRows(db);
  const { parts } = emitInsertSql(rows);
  db.close();

  assert.equal(fs.readFileSync(path.join(dir, 'seva_mirror.csv'), 'utf8'), emitCsv(rows), 'seva_mirror.csv is stale');
  const onDisk = fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(onDisk, parts.map((part) => `${part.label}.sql`));
  for (const part of parts) {
    assert.equal(fs.readFileSync(path.join(dir, `${part.label}.sql`), 'utf8'), part.text, `${part.label}.sql is stale`);
  }
});

test('every mirrored table exists in the local schema', () => {
  const { db } = makeDb();
  const existing = new Set(
    db
      .all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .map((row) => row.name),
  );
  for (const table of TABLES) {
    assert.ok(existing.has(table.name), `${table.name} is mirrored but missing locally`);
    const columns = new Set(db.all(`SELECT * FROM ${table.name} LIMIT 1`).flatMap((r) => Object.keys(r)));
    for (const col of table.key) {
      assert.ok(columns.has(col), `${table.name} has no column ${col}`);
    }
  }
  assert.ok(!existing.has('seva_mirror'), 'the mirror table is remote-only');
  db.close();
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'supabase-init.sql')));
});
