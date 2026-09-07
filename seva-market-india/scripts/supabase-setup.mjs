#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — Supabase bootstrap + one-way sync.
 *
 * Two modes, one file:
 *
 *   node scripts/supabase-setup.mjs --sql
 *       Print scripts/supabase-init.sql *byte for byte* so it can be pasted
 *       into the Supabase SQL editor. Nothing else is printed: any extra
 *       character (a path, a heading, a stray `--` comment) is exactly the
 *       class of paste error that produced the "syntax error near )" report,
 *       so the file is echoed verbatim and never generated inline.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/supabase-setup.mjs
 *       Mirror every local row into public.seva_mirror over PostgREST.
 *
 * Flags: --dry-run (count only, no network), --tables=a,b, --batch=N.
 *
 * Why a single mirror table instead of mirroring the schema 1:1: the launch
 * dataset is read-mostly reference data (locations, categories, providers,
 * services, service_areas). One (tbl, id) -> jsonb table keeps the Postgres
 * side migration-free — a new local column needs no DDL on Supabase — while
 * RLS with zero anon/authenticated grants keeps it server-only.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The file users paste into the Supabase SQL editor. */
export const SQL_FILE = path.join(ROOT, 'scripts', 'supabase-init.sql');

/** Remote table this script owns. */
export const MIRROR_TABLE = 'seva_mirror';

/**
 * Tables mirrored to Supabase, in dependency order, with the local columns
 * that form the remote `id`. Only `service_areas` has a composite primary
 * key; every other table is keyed by `id`.
 */
export const TABLES = [
  { name: 'locations', key: ['id'] },
  { name: 'categories', key: ['id'] },
  { name: 'providers', key: ['id'] },
  { name: 'services', key: ['id'] },
  { name: 'service_areas', key: ['provider_id', 'pin_code'] },
];

/** Read the SQL file verbatim — no interpolation, no wrapping. */
export function readSql(file = SQL_FILE) {
  return fs.readFileSync(file, 'utf8');
}

/**
 * Patterns that must never appear in the paste block. Each one has been the
 * cause of a real "syntax error at or near )" report: a path, a markdown
 * fence or a comment survives the copy and lands in the SQL editor.
 */
const SQL_TABOOS = [
  [/```/, 'markdown code fence'],
  [/^\s*--/m, 'SQL line comment'],
  [/\/\/[^\n]*$/m, 'trailing // comment'],
  [/\/\*/, 'block comment'],
  [/^\/(home|Users|tmp|var|usr|mnt|opt)\//m, 'absolute filesystem path'],
  [/\bseva-market-india\//, 'relative repository path'],
  [/supabase-init\.sql/, 'self-reference to the SQL file'],
  [/^\s*#{1,6}\s/m, 'markdown heading'],
  [/^\s*\$\s/m, 'shell prompt'],
  [/[<>|&]|\bcat\b|\bRun:|Expected:/, 'shell/editor prose'],
  [/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/, 'control character'],
  [/\r/, 'carriage return (CRLF line ending)'],
  [/[\u2018\u2019\u201c\u201d]/, 'curly quote'],
  [/[\u00a0\u2007\u202f]/, 'non-breaking space'],
];

/**
 * Reject anything that is not plain SQL.
 * @returns {string[]} one entry per problem found (empty means clean)
 */
export function lintSql(sql) {
  const problems = [];
  for (const [pattern, label] of SQL_TABOOS) {
    if (pattern.test(sql)) problems.push(label);
  }
  if (!/\n$/.test(sql)) problems.push('file does not end with a newline');
  if (!/PRIMARY KEY \(tbl, id\)/.test(sql)) problems.push('missing PRIMARY KEY (tbl, id)');
  if (!/ENABLE ROW LEVEL SECURITY/.test(sql)) problems.push('missing ENABLE ROW LEVEL SECURITY');
  // Without a lock_timeout a blocked DDL waits forever and the SQL editor
  // just spins at "Running..." with no result and no error.
  if (!/SET\s+lock_timeout/i.test(sql)) problems.push('missing SET lock_timeout (a blocked DDL would hang forever)');
  // Without BEGIN/COMMIT the table exists before the REVOKEs land, leaving a
  // window where anon can read it; a timeout would also leave it half-done.
  if (!/\bBEGIN\b/.test(sql) || !/\bCOMMIT\b/.test(sql)) {
    problems.push('missing BEGIN/COMMIT (RLS and REVOKEs must land atomically)');
  }

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // A line is either a statement opener, an indented column definition,
    // or the `);` that closes the CREATE TABLE. Nothing else.
    if (!/^(CREATE|ALTER|REVOKE|GRANT|NOTIFY|SET|BEGIN|COMMIT|ROLLBACK|PRIMARY\s+KEY\s*\(|\);|[a-z_]+\s+\S)/.test(trimmed)) {
      problems.push(`line does not look like SQL: ${JSON.stringify(trimmed)}`);
    }
  }
  return problems;
}

/**
 * Split SQL into statements, respecting single- and double-quoted literals
 * (`NOTIFY pgrst, 'reload schema'` must not be cut in half).
 * @returns {{statements: string[], trailing: string}}
 */
export function splitStatements(sql) {
  const statements = [];
  let current = '';
  let quote = null;
  for (const ch of sql) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  return { statements, trailing: current.trim() };
}

/** First two words of each statement, upper-cased (CREATE TABLE, REVOKE ALL...). */
export function statementHeads(sql) {
  return splitStatements(sql).statements.map((stmt) =>
    stmt
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 2)
      .join(' ')
      .toUpperCase(),
  );
}

/** Split `--tables=a,b` into known table names, rejecting typos loudly. */
export function selectTables(spec, known = TABLES) {
  if (!spec) return known;
  const wanted = String(spec)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const knownNames = known.map((table) => table.name);
  const unknown = wanted.filter((name) => !knownNames.includes(name));
  if (unknown.length) {
    throw new Error(`Unknown table(s): ${unknown.join(', ')}. Known: ${knownNames.join(', ')}.`);
  }
  return known.filter((table) => wanted.includes(table.name));
}

/**
 * Turn local rows into mirror rows.
 *
 * @returns {{tbl: string, id: string, doc: object}[]}
 */
export function buildRows(db, tables = TABLES) {
  const rows = [];
  for (const table of tables) {
    const orderBy = table.key.map((col) => `${col} ASC`).join(', ');
    const records = db.all(`SELECT * FROM ${table.name} ORDER BY ${orderBy}`);
    for (const record of records) {
      const id = table.key.map((col) => String(record[col])).join(':');
      rows.push({ tbl: table.name, id, doc: record });
    }
  }
  return rows;
}

/** Group rows into POST-sized batches. */
export function batch(rows, size) {
  if (!Number.isInteger(size) || size < 1) throw new Error('Batch size must be a positive integer.');
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Columns left out of the pasted `doc`.
 *
 * `created_at` / `updated_at` are stamped by SQLite at seed time, so they
 * differ on every run. Keeping them would make the emitted SQL
 * non-deterministic — regenerating the files would churn every line, and the
 * "files match the seed data" guard could never be byte-exact. They are also
 * meaningless remotely: `seva_mirror.synced_at` already records when the row
 * arrived. The PostgREST sync path is unaffected and still sends full rows.
 */
const EMIT_SKIP_COLUMNS = /^(created|updated)_at$/;

/** Escape a JS string for a single-quoted SQL literal. */
function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Render mirror rows as paste-ready INSERT statements.
 *
 * This is the no-terminal path: someone on a phone cannot run
 * `npm run supabase:setup`, so the same data is emitted as SQL they can paste
 * straight into the Supabase SQL editor.
 *
 * Shaped for a flaky mobile copy/paste:
 *   - one row per line, so a dropped *middle* line still parses (it just
 *     sends one row fewer) instead of leaving a dangling comma or paren;
 *   - chunks stay small, because a huge paste is what gets truncated;
 *   - upsert on (tbl, id), so re-running any chunk is harmless.
 *
 * @returns {{sql: string, chunks: {rows: number, bytes: number}[]}}
 */
export function emitInsertSql(rows, { maxChunkBytes = 9000 } = {}) {
  if (!rows.length) return { sql: '', chunks: [] };

  const valueLine = (row) => {
    const doc = Object.fromEntries(
      Object.entries(row.doc).filter(([column]) => !EMIT_SKIP_COLUMNS.test(column)),
    );
    return `(${sqlLiteral(row.tbl)},${sqlLiteral(row.id)},${sqlLiteral(JSON.stringify(doc))}::jsonb)`;
  };

  // Group by table first so a chunk never straddles two tables: the header
  // comment stays true and each paste is logically self-contained.
  const byTable = new Map();
  for (const row of rows) {
    if (!byTable.has(row.tbl)) byTable.set(row.tbl, []);
    byTable.get(row.tbl).push(row);
  }

  const chunks = [];
  for (const [table, tableRows] of byTable) {
    let current = [];
    let bytes = 0;
    for (const row of tableRows) {
      const line = valueLine(row);
      if (current.length && bytes + line.length + 1 > maxChunkBytes) {
        chunks.push({ table, lines: current });
        current = [];
        bytes = 0;
      }
      current.push(line);
      bytes += line.length + 1;
    }
    if (current.length) chunks.push({ table, lines: current });
  }

  const parts = chunks.map(({ table, lines }, index) => {
    const label = `${String(index + 1).padStart(2, '0')}-${table}`;
    return {
      label,
      table,
      rows: lines.length,
      text: [
        `-- seva_mirror ${label}: ${lines.length} row(s) of ${table}`,
        "SET lock_timeout = '10s';",
        'BEGIN;',
        'INSERT INTO public.seva_mirror (tbl, id, doc) VALUES',
        lines.join(',\n'),
        'ON CONFLICT (tbl, id) DO UPDATE SET doc = EXCLUDED.doc, synced_at = now();',
        'COMMIT;',
      ].join('\n'),
    };
  });

  return {
    sql: `${parts.map((part) => part.text).join('\n\n')}\n`,
    parts: parts.map(({ label, table, rows: count, text }) => ({
      label,
      table,
      rows: count,
      bytes: Buffer.byteLength(text),
      text: `${text}\n`,
    })),
  };
}

/** Human-readable failure text for a PostgREST/Postgres error response. */
function describeFailure(status, body) {
  if (status === 404) {
    return [
      `Supabase does not know the table "${MIRROR_TABLE}" (HTTP 404).`,
      'Create it first: run `npm run supabase:sql`, paste that output into the',
      'Supabase SQL editor, press Run, then re-run this script.',
    ].join('\n');
  }
  if (status === 401 || status === 403) {
    return `Supabase rejected the credentials (HTTP ${status}). Check SUPABASE_SERVICE_ROLE_KEY — it must be the service-role key, not the anon key.`;
  }
  return `Supabase returned HTTP ${status}.\n${body.slice(0, 600)}`;
}

/**
 * Upsert rows into PostgREST. Idempotent: `resolution=merge-duplicates`
 * makes a re-run update existing (tbl, id) rows instead of failing.
 *
 * @returns {Promise<{upserted: number, batches: number}>}
 */
export async function syncRows(rows, options = {}) {
  const {
    baseUrl,
    apiKey,
    batchSize = 200,
    fetchImpl = globalThis.fetch,
    onBatch,
  } = options;

  if (!baseUrl) throw new Error('Missing SUPABASE_URL (e.g. https://<ref>.supabase.co).');
  if (!apiKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');

  const url = `${String(baseUrl).replace(/\/+$/, '')}/rest/v1/${MIRROR_TABLE}`;
  let upserted = 0;
  const batches = batch(rows, batchSize);

  for (const [index, chunk] of batches.entries()) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });

    if (!response.ok) {
      const body = await safeText(response);
      throw new Error(describeFailure(response.status, body));
    }
    upserted += chunk.length;
    if (onBatch) onBatch({ index, size: chunk.length, upserted });
  }

  return { upserted, batches: batches.length };
}

async function safeText(response) {
  try {
    return await response.text();
  } catch (_) {
    return '';
  }
}

/** Count rows per table without touching the network (dry run). */
export function summarize(db, tables = TABLES) {
  const counts = {};
  for (const table of tables) {
    counts[table.name] = db.scalar(`SELECT COUNT(*) FROM ${table.name}`);
  }
  return { counts, total: Object.values(counts).reduce((sum, n) => sum + n, 0) };
}

/** Parse `--flag` / `--flag=value` argv into an object. */
export function parseArgs(argv) {
  const args = { _: [] };
  for (const token of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(token);
    if (!match) {
      args._.push(token);
      continue;
    }
    args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return args;
}

const USAGE = `
SEVA MARKET INDIA — Supabase setup

  npm run supabase:sql          print scripts/supabase-init.sql (paste into the SQL editor)
  npm run supabase:setup        sync local rows into public.seva_mirror

  --sql            print the SQL file and exit (no network, no database)
  --dry-run        count what would be synced, send nothing
  --tables=a,b     limit the sync (locations,categories,providers,services,service_areas)
  --batch=N        rows per request (default 200)

  Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEVA_DB_FILE
`.trim();

/**
 * Program entry point. `deps` exists so tests can inject an in-memory db and
 * a stub fetch without opening a socket.
 *
 * @returns {Promise<number>} process exit code
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    env = process.env,
    log = console.log,
    error = console.error,
    fetchImpl,
    sqlFile = SQL_FILE,
  } = deps;
  const args = parseArgs(argv);

  if (args.help || args.h) {
    log(USAGE);
    return 0;
  }

  // --sql is deliberately the first branch: it must work with no database
  // and no credentials, because it is the step users run before anything
  // exists on Supabase. It also refuses to print a file that is not clean
  // SQL — better to fail here than to hand the user a broken paste.
  if (args.sql) {
    const sql = readSql(sqlFile);
    const problems = lintSql(sql);
    if (problems.length) {
      error(`${path.relative(ROOT, sqlFile)} is not clean SQL:\n  - ${problems.join('\n  - ')}`);
      error('\nFix the file, then re-run. Only the SQL is safe to paste.');
      return 1;
    }
    log(sql);
    return 0;
  }

  const { Database } = require('../src/db/client');
  const config = require('../src/config');

  const file = env.SEVA_DB_FILE || config.db.file;
  if (!fs.existsSync(file) && file !== ':memory:') {
    error(`No local database at ${file}.\nRun \`npm run seed\` first, then re-run this script.`);
    return 1;
  }

  let db;
  try {
    let tables;
    try {
      tables = selectTables(args.tables);
    } catch (err) {
      error(err.message);
      return 1;
    }

    db = deps.db || new Database(file);
    const { counts, total } = summarize(db, tables);

    log(`Database : ${file}`);
    log('Mirror   :');
    for (const [name, count] of Object.entries(counts)) {
      log(`  ${name.padEnd(14)} ${String(count).padStart(5)} row(s)`);
    }
    log(`  ${'total'.padEnd(14)} ${String(total).padStart(5)} row(s)`);

    if (args['dry-run']) {
      log('\nDry run — nothing was sent.');
      return 0;
    }

    // --emit-insert: the no-terminal path. Prints (or writes) the same rows as
    // paste-ready SQL, for anyone who only has the Supabase SQL editor.
    if (args['emit-insert']) {
      const { sql, parts } = emitInsertSql(buildRows(db, tables));
      const outDir = args['out-dir'];
      if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
        for (const part of parts) {
          fs.writeFileSync(path.join(outDir, `${part.label}.sql`), part.text);
          log(`  ${part.label}.sql  ${String(part.rows).padStart(4)} row(s)  ${String(part.bytes).padStart(6)} bytes`);
        }
        log(`\nWrote ${parts.length} file(s) to ${outDir}. Paste them into the SQL editor in filename order.`);
      } else {
        log(sql);
      }
      return 0;
    }

    const rows = buildRows(db, tables);
    const result = await syncRows(rows, {
      baseUrl: env.SUPABASE_URL,
      apiKey: env.SUPABASE_SERVICE_ROLE_KEY,
      batchSize: args.batch === undefined ? 200 : Number(args.batch),
      fetchImpl,
      onBatch: ({ index, size, upserted }) => log(`  batch ${index + 1}: +${size} (${upserted} total)`),
    });

    log(`\nSynced ${result.upserted} row(s) to ${MIRROR_TABLE} in ${result.batches} request(s).`);
    return 0;
  } catch (err) {
    error(`\n${err.message}`);
    return 1;
  } finally {
    if (db) db.close();
  }
}

// CLI. Skipped when imported by the test suite.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.stack || String(err));
      process.exit(1);
    },
  );
}
