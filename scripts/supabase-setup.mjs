#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — one-command Supabase setup (zero dependencies).
 *
 * Does the Supabase half of the data-loss fix that previously had to be done
 * by hand in the dashboard:
 *
 *   1. REPORT mode (default — never writes anything):
 *      Lists every project on the account and, for each one, shows whether
 *      the app schema is already applied and how many members/rows it holds.
 *      This answers "do project ho gaya hai — kaunsa asli hai?".
 *
 *   2. APPLY mode (--apply --project-ref <id>):
 *      Runs supabase/schema.sql on that one project (idempotent), creates the
 *      `uploads` photo bucket, then prints SUPABASE_URL +
 *      SUPABASE_SERVICE_ROLE_KEY to paste into Render.
 *
 * Usage:
 *   node scripts/supabase-setup.mjs --access-token sbp_xxx
 *       # report: which project has the schema / the data
 *   node scripts/supabase-setup.mjs --access-token sbp_xxx \
 *       --project-ref abcdefghijkl --apply
 *       # wire that project up: schema + bucket + Render env values
 *
 * The token is created in Supabase → Account → Access Tokens. It is never
 * printed or written to disk. Revoke it afterwards if you like.
 *
 *   --api-base <url>   override for tests (default https://api.supabase.com)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_FILE = path.join(ROOT, 'supabase', 'schema.sql');
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const has = (name) => args.includes(`--${name}`);

const accessToken = arg('access-token', process.env.SUPABASE_ACCESS_TOKEN || '');
const apiBase = String(arg('api-base', 'https://api.supabase.com')).replace(/\/+$/, '');
const projectRef = arg('project-ref', '').trim();
const apply = has('apply');

if (!accessToken) {
  console.error('\n  Usage: node scripts/supabase-setup.mjs --access-token <Supabase access token>');
  console.error('\n  Create the token at https://supabase.com/dashboard/account/tokens');
  console.error('  (Supabase dashboard → Account → Access Tokens → Generate new token).');
  console.error('  The token is only used for these API calls and is never saved or printed.\n');
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

/** Split schema.sql into one statement per array item (comments stripped). */
function schemaStatements() {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
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

/* ------------------------------------------------------------------ REPORT */

async function report() {
  const projects = await listProjects();
  if (!Array.isArray(projects) || !projects.length) {
    console.log('\n  No Supabase project is visible to this token.\n');
    return;
  }

  console.log('\nPANIKA JEEVAN SATHI — Supabase projects on this account\n');
  console.log(
    '  ' + 'PROJECT'.padEnd(24) + 'REF'.padEnd(24) + 'REGION'.padEnd(12) + 'STATUS'.padEnd(14) + 'SCHEMA'.padEnd(10) + 'USERS'
  );

  for (const p of projects) {
    const ref = p.id;
    const hasSchema = await schemaApplied(ref);
    const users = hasSchema ? await rowCount(ref, 'users') : null;
    const status = String(p.status || '?').toLowerCase();
    const region = String(p.region || '?');
    const name = String(p.name || '(unnamed)');
    console.log(
      '  ' +
        name.slice(0, 23).padEnd(24) +
        ref.slice(0, 23).padEnd(24) +
        region.padEnd(12) +
        status.padEnd(14) +
        (hasSchema ? 'YES'.padEnd(10) : 'NO'.padEnd(10)) +
        (users === null ? '—' : users)
    );
  }

  console.log('\n  Reading: "SCHEMA=YES" means supabase/schema.sql is applied there.');
  console.log('  "USERS" = how many member accounts already live in that project.');
  console.log('\n  → Pick the project that should hold the real data (usually the one');
  console.log('    with SCHEMA=YES and the members you recognise, or a fresh one).');
  console.log('  → Then run:');
  console.log('      node scripts/supabase-setup.mjs --access-token <token> \\');
  console.log('          --project-ref <ref> --apply\n');
}

/* ------------------------------------------------------------------- APPLY */

async function applyToProject() {
  if (!projectRef) {
    console.error('\n  --apply needs --project-ref <ref> (the project id from the report).\n');
    process.exit(2);
  }

  const projects = await listProjects();
  const project = Array.isArray(projects) && projects.find((p) => p.id === projectRef);
  if (!project) {
    console.error(`\n  No project with ref "${projectRef}" is visible to this token.\n`);
    console.error('  Run without --apply to list the project refs on this account.\n');
    process.exit(2);
  }

  console.log(`\nApplying PANIKA JEEVAN SATHI to project "${project.name}" (${projectRef})…`);

  const statements = schemaStatements();
  for (let i = 0; i < statements.length; i += 1) {
    await runQuery(projectRef, statements[i]);
    if ((i + 1) % 5 === 0 || i + 1 === statements.length) {
      console.log(`  schema… ${i + 1}/${statements.length} statements ok`);
    }
  }

  // Storage bucket (the app also creates it lazily; creating it now means the
  // first photo upload never depends on a race).
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

  console.log('\n  ────────────────────────────────────────────────────────────────');
  console.log('  Supabase is ready. Paste these into Render → panikajeevansathi');
  console.log('  → Environment (Settings → Environment):\n');
  console.log(`  SUPABASE_URL                 = ${url}`);
  console.log(
    `  SUPABASE_SERVICE_ROLE_KEY    = ${serviceKey ? serviceKey : '<copy from dashboard → API → service_role>'}`,
  );
  console.log(`  SUPABASE_STORAGE_BUCKET      = ${BUCKET}`);
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

console.log('PANIKA JEEVAN SATHI — Supabase setup (zero dependencies)');

try {
  if (apply) await applyToProject();
  else await report();
} catch (err) {
  console.error(`\n  ✗ ${err.message}\n`);
  process.exit(1);
}
