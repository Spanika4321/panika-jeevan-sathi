#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — one-command Supabase setup (zero dependencies).
 *
 * Backup path for when the GitHub integration is not applying migrations.
 * The preferred path is: Dashboard → Integrations → GitHub →
 * "Deploy to production" ON, then merge to main. This script is for listing
 * projects, applying the same SQL over the Management API, and printing the
 * Render env values.
 *
 *   1. REPORT mode (default — never writes anything):
 *      Lists every project on the account and, for each one, shows whether
 *      the app schema is already applied and how many members it holds.
 *
 *   2. APPLY mode (--apply):
 *      Runs supabase/migrations/*.sql (fallback: schema.sql) on one project
 *      (idempotent), creates the `uploads` photo bucket, then prints
 *      SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to paste into Render.
 *      If the account has exactly one project, --project-ref can be omitted.
 *
 * Usage:
 *   node scripts/supabase-setup.mjs --access-token sbp_xxx
 *   node scripts/supabase-setup.mjs --access-token sbp_xxx --apply
 *   node scripts/supabase-setup.mjs --access-token sbp_xxx \
 *       --project-ref abcdefghijkl --apply
 *
 * Token: Supabase → Account → Access Tokens. Never printed or written to disk.
 * In GitHub Actions the service_role key is masked (--mask-keys is implied).
 *
 *   --api-base <url>   override for tests (default https://api.supabase.com)
 *   --json             machine-readable output
 *   --mask-keys        never print the full service_role key
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_FILE = path.join(ROOT, 'supabase', 'schema.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const has = (name) => args.includes(`--${name}`);

const accessToken = arg('access-token', process.env.SUPABASE_ACCESS_TOKEN || '');
const apiBase = String(arg('api-base', 'https://api.supabase.com')).replace(/\/+$/, '');
const projectRefInput = arg(
  'project-ref',
  process.env.SUPABASE_PROJECT_ID || process.env.SUPABASE_PROJECT_REF || ''
).trim();
const apply = has('apply');
const jsonMode = has('json');
const maskKeys = has('mask-keys') || Boolean(process.env.GITHUB_ACTIONS);

function requireToken() {
  if (accessToken) return;
  console.error('\n  Usage: node scripts/supabase-setup.mjs --access-token <Supabase access token>');
  console.error('\n  Create the token at https://supabase.com/dashboard/account/tokens');
  console.error('  (Supabase dashboard → Account → Access Tokens → Generate new token).');
  console.error('  The token is only used for these API calls and is never saved or printed.');
  console.error('\n  If GitHub is already connected in the Supabase dashboard, you usually');
  console.error('  do not need this: enable "Deploy to production" and merge to main.');
  console.error('  See supabase/README.md.\n');
  process.exit(2);
}

const headers = {
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
};

async function api(method, pathname, body) {
  const res = await fetch(`${apiBase}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }
  if (!res.ok) {
    const detail =
      (json && (json.message || json.error_description || json.error)) || `HTTP ${res.status}`;
    const err = new Error(`${method} ${pathname} → ${detail}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function stripSqlComments(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/** Split a SQL file into statements (comments stripped). */
export function sqlStatementsFrom(sql) {
  return stripSqlComments(sql)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

/** GitHub integration applies migrations/*.sql; fall back to schema.sql. */
export function schemaStatements() {
  const files = migrationFiles();
  if (files.length) {
    return files.flatMap((file) => sqlStatementsFrom(fs.readFileSync(file, 'utf8')));
  }
  return sqlStatementsFrom(fs.readFileSync(SCHEMA_FILE, 'utf8'));
}

async function runQuery(ref, query) {
  return api('POST', `/v1/projects/${encodeURIComponent(ref)}/database/query`, {
    query
  });
}

async function listProjects() {
  return api('GET', '/v1/projects');
}

async function projectApiKeys(ref) {
  return api('GET', `/v1/projects/${encodeURIComponent(ref)}/api-keys`);
}

/** True when the `users` table exists (schema applied). Never throws. */
async function schemaApplied(ref) {
  try {
    await runQuery(ref, 'select count(*) from users');
    return true;
  } catch (_) {
    return false;
  }
}

/** Row count for a table, or null when the table does not exist. */
async function rowCount(ref, table) {
  try {
    const out = await runQuery(ref, `select count(*) as c from ${table}`);
    const row = Array.isArray(out) ? out[0] : out && (out[0] || out.rows || out);
    const list = Array.isArray(row) ? row : [row];
    const first = list[0];
    if (first && first.c !== undefined) return Number(first.c);
    return 0;
  } catch (_) {
    return null;
  }
}

function maskKey(key) {
  if (!key) return '(none)';
  const s = String(key);
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function resolveProject(projects, ref) {
  if (ref) {
    const project = Array.isArray(projects) && projects.find((p) => p.id === ref);
    if (!project) return null;
    return project;
  }
  if (Array.isArray(projects) && projects.length === 1) return projects[0];
  return undefined;
}

/* ------------------------------------------------------------------ REPORT */

async function report() {
  const projects = await listProjects();
  if (!Array.isArray(projects) || !projects.length) {
    if (jsonMode) {
      console.log(JSON.stringify({ projects: [] }));
      return;
    }
    console.log('\n  No Supabase project is visible to this token.\n');
    return;
  }

  const rows = [];
  for (const p of projects) {
    const ref = p.id;
    const hasSchema = await schemaApplied(ref);
    const users = hasSchema ? await rowCount(ref, 'users') : null;
    rows.push({
      name: String(p.name || '(unnamed)'),
      id: ref,
      region: String(p.region || '?'),
      status: String(p.status || '?').toLowerCase(),
      schema: hasSchema,
      users
    });
  }

  if (jsonMode) {
    console.log(JSON.stringify({ projects: rows }));
    return;
  }

  console.log('\nPANIKA JEEVAN SATHI — Supabase projects on this account\n');
  console.log(
    '  ' +
      'PROJECT'.padEnd(24) +
      'REF'.padEnd(24) +
      'REGION'.padEnd(12) +
      'STATUS'.padEnd(14) +
      'SCHEMA'.padEnd(10) +
      'USERS'
  );

  for (const r of rows) {
    console.log(
      '  ' +
        r.name.slice(0, 23).padEnd(24) +
        String(r.id).slice(0, 23).padEnd(24) +
        r.region.padEnd(12) +
        r.status.padEnd(14) +
        (r.schema ? 'YES'.padEnd(10) : 'NO'.padEnd(10)) +
        (r.users === null ? '—' : r.users)
    );
  }

  console.log('\n  Reading: "SCHEMA=YES" means migrations (or schema.sql) are applied there.');
  console.log('  "USERS" = how many member accounts already live in that project.');
  if (rows.length === 1) {
    console.log('\n  Only one project — apply without --project-ref:');
    console.log('      node scripts/supabase-setup.mjs --access-token <token> --apply\n');
  } else {
    console.log('\n  → Pick the project, then:');
    console.log('      node scripts/supabase-setup.mjs --access-token <token> \\');
    console.log('          --project-ref <ref> --apply\n');
  }
}

/* ------------------------------------------------------------------- APPLY */

async function applyToProject() {
  const projects = await listProjects();
  const project = resolveProject(projects, projectRefInput);
  if (project === null) {
    console.error(`\n  No project with ref "${projectRefInput}" is visible to this token.\n`);
    console.error('  Run without --apply to list the project refs on this account.\n');
    process.exit(2);
  }
  if (project === undefined) {
    const n = Array.isArray(projects) ? projects.length : 0;
    console.error(
      `\n  --apply needs --project-ref <ref> (${n} project(s) on this account; pick one).\n`
    );
    process.exit(2);
  }

  const projectRef = project.id;
  console.log(`\nApplying PANIKA JEEVAN SATHI to project "${project.name}" (${projectRef})…`);

  const files = migrationFiles();
  const source = files.length
    ? files.map((f) => path.relative(ROOT, f)).join(', ')
    : 'supabase/schema.sql';
  console.log(`  sql…… ${source}`);

  const statements = schemaStatements();
  for (let i = 0; i < statements.length; i += 1) {
    await runQuery(projectRef, statements[i]);
    if ((i + 1) % 5 === 0 || i + 1 === statements.length) {
      console.log(`  schema… ${i + 1}/${statements.length} statements ok`);
    }
  }

  // Storage bucket (config.toml also declares it for the GitHub integration;
  // creating it here means the first photo upload never depends on a race).
  await runQuery(
    projectRef,
    `insert into storage.buckets (id, name, public) ` +
      `values ('${BUCKET}', '${BUCKET}', false) on conflict (id) do nothing`
  );
  console.log(`  bucket… "${BUCKET}" ready (private)`);

  const keys = await projectApiKeys(projectRef);
  const service = Array.isArray(keys) && keys.find((k) => k && k.name === 'service_role');
  const serviceKey = service && (service.api_key || service.value || service.apiKey);

  const url = `https://${projectRef}.supabase.co`;
  const printedKey = !serviceKey
    ? '<copy from dashboard → API → service_role>'
    : maskKeys
      ? maskKey(serviceKey)
      : serviceKey;

  if (jsonMode) {
    console.log(
      JSON.stringify({
        ok: true,
        project: { name: project.name, id: projectRef },
        url,
        bucket: BUCKET,
        statements: statements.length,
        service_role_key: maskKeys ? maskKey(serviceKey) : serviceKey || null,
        masked: maskKeys
      })
    );
    return;
  }

  console.log('\n  ────────────────────────────────────────────────────────────────');
  console.log('  Supabase is ready. Paste these into Render → panikajeevansathi');
  console.log('  → Environment (Settings → Environment):\n');
  console.log(`  SUPABASE_URL                 = ${url}`);
  console.log(`  SUPABASE_SERVICE_ROLE_KEY    = ${printedKey}`);
  console.log(`  SUPABASE_STORAGE_BUCKET      = ${BUCKET}`);
  if (maskKeys && serviceKey) {
    console.log('\n  (service_role key masked here — copy the full value from');
    console.log('   Supabase → Project Settings → API → service_role.)');
  }
  console.log('\n  Keep PJS_STORAGE=supabase and PJS_REQUIRE_REMOTE=1 (already in render.yaml).');
  console.log('\n  Then redeploy and confirm durability:');
  console.log('    curl -s https://panikajeevansathi.onrender.com/api/health');
  console.log('    …must show "storage":"supabase", "photos":"supabase+cache", "durable":true');
  console.log('  ────────────────────────────────────────────────────────────────\n');

  if (!serviceKey) {
    console.warn('  Note: could not read the service_role key from the API — copy it from');
    console.warn('  the dashboard (Project Settings → API → service_role). The schema and');
    console.warn('  bucket were still applied successfully above.\n');
  }
}

/* --------------------------------------------------------------------- main */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  requireToken();
  console.log('PANIKA JEEVAN SATHI — Supabase setup (zero dependencies)');

  try {
    if (apply) await applyToProject();
    else await report();
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exit(1);
  }
}
