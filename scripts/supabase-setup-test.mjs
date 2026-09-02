#!/usr/bin/env node
/**
 * Prove the GitHub↔Supabase connection files are in the shape the dashboard
 * integration actually deploys, and that supabase-setup.mjs can apply them
 * against a local Management API mock (no real account, no secrets).
 *
 *   node scripts/supabase-setup-test.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createManagementMock } from './lib/mock-management.mjs';
import { sqlStatementsFrom } from './supabase-setup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dbLib = require('../lib/db.js');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function tableNames(sql) {
  const names = [];
  const re = /create table if not exists ([a-z_]+)/gi;
  let m;
  while ((m = re.exec(sql))) names.push(m[1]);
  return names;
}

function runSetup(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'supabase-setup.mjs'), ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env, GITHUB_ACTIONS: env.GITHUB_ACTIONS || '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/* ------------------------------------------------------- folder shape */

section('GitHub integration folder (what the dashboard actually deploys)');

const config = read('supabase/config.toml');
check('supabase/config.toml exists', config.length > 0);
check('config.toml has project_id', /project_id\s*=\s*"panika-jeevan-sathi"/.test(config));
check(
  'config.toml declares private uploads bucket',
  /\[storage\.buckets\.uploads\]/.test(config) && /public\s*=\s*false/.test(config)
);
check('uploads bucket allows jpeg/png/webp', /image\/jpeg/.test(config) && /image\/png/.test(config) && /image\/webp/.test(config));
check('uploads file_size_limit is 5MiB (app cap is 4MB)', /file_size_limit\s*=\s*"5MiB"/.test(config));
check(
  'config.toml has no secrets',
  !/\beyJ[A-Za-z0-9_-]{20,}\b/.test(config) && !/\bsbp_[A-Za-z0-9]+/.test(config) && !/\bsb_secret_/.test(config)
);

const migDir = path.join(ROOT, 'supabase', 'migrations');
const migFiles = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
check('supabase/migrations/ has at least one .sql file', migFiles.length >= 1, `files=${migFiles.join(',')}`);
check(
  'init migration uses a timestamp prefix (GitHub applies in order)',
  /^\d{14}_.+\.sql$/.test(migFiles[0] || ''),
  migFiles[0]
);

const migrationSql = read(`supabase/migrations/${migFiles[0]}`);
const schemaSql = read('supabase/schema.sql');
const migTables = tableNames(migrationSql);
const schemaTables = tableNames(schemaSql);
const appTables = Object.keys(dbLib.TABLES);

check(
  'migration creates every app table',
  appTables.every((t) => migTables.includes(t)),
  `missing=${appTables.filter((t) => !migTables.includes(t)).join(',')}`
);
check(
  'schema.sql tables match the migration',
  schemaTables.join(',') === migTables.join(','),
  `schema=${schemaTables.join(',')} mig=${migTables.join(',')}`
);
check(
  'schema.sql and migration have the same statements (comments ignored)',
  sqlStatementsFrom(schemaSql).join('\n') === sqlStatementsFrom(migrationSql).join('\n')
);
check('RLS is enabled on every table (no anon policies)', (migrationSql.match(/enable row level security/g) || []).length === migTables.length);
check('CREATE TABLE is idempotent (IF NOT EXISTS)', /create table if not exists users/i.test(migrationSql));

/* ------------------------------------------------------- setup CLI: no token */

section('supabase-setup.mjs — usage / no token');

const noToken = await runSetup([]);
check('exits 2 without a token', noToken.code === 2);
check('tells you where to create a token', /access tokens/i.test(noToken.stderr));
check('mentions the GitHub connection fallback', /Deploy to production/i.test(noToken.stderr));

/* ------------------------------------------------------- setup CLI: mock API */

section('supabase-setup.mjs — report + apply against Management API mock');

const mock = createManagementMock();
const apiBase = await mock.listen();
const token = mock.token;

const report = await runSetup(['--access-token', token, '--api-base', apiBase, '--json']);
check('report exits 0', report.code === 0, report.stderr);
let reportJson = null;
try {
  reportJson = JSON.parse(report.stdout.trim().split('\n').pop());
} catch (_) {
  reportJson = null;
}
check('report --json lists the mock project', Boolean(reportJson && reportJson.projects && reportJson.projects[0]));
check(
  'report shows SCHEMA=NO before apply',
  reportJson && reportJson.projects && reportJson.projects[0] && reportJson.projects[0].schema === false,
  JSON.stringify(reportJson)
);

const applied = await runSetup([
  '--access-token',
  token,
  '--api-base',
  apiBase,
  '--apply',
  '--mask-keys',
  '--json'
]);
check('apply exits 0 with a single project and no --project-ref', applied.code === 0, applied.stderr);
let applyJson = null;
try {
  applyJson = JSON.parse(applied.stdout.trim().split('\n').pop());
} catch (_) {
  applyJson = null;
}
check('apply reports ok', Boolean(applyJson && applyJson.ok), applied.stdout.slice(-400));
check(
  'apply used the GitHub migrations (not only schema.sql)',
  /migrations\//.test(applied.stdout),
  applied.stdout.slice(0, 400)
);
check(
  'apply sent every statement plus the bucket insert',
  mock.state.get('abcdefghijklmn').queries.length >= sqlStatementsFrom(migrationSql).length + 1
);
check('apply created the uploads bucket', mock.state.get('abcdefghijklmn').buckets.includes('uploads'));
check('apply marked the users table as present', mock.state.get('abcdefghijklmn').applied === true);
check(
  'service_role key is masked when --mask-keys',
  applyJson && applyJson.masked === true && !String(applyJson.service_role_key || '').includes('do-not-leak'),
  JSON.stringify(applyJson)
);
check(
  'full service_role secret never appears in stdout',
  !applied.stdout.includes('service-role-secret-key-do-not-leak')
);

const after = await runSetup(['--access-token', token, '--api-base', apiBase, '--json']);
let afterJson = null;
try {
  afterJson = JSON.parse(after.stdout.trim().split('\n').pop());
} catch (_) {
  afterJson = null;
}
check(
  'report shows SCHEMA=YES after apply',
  afterJson && afterJson.projects && afterJson.projects[0] && afterJson.projects[0].schema === true
);

const badToken = await runSetup(['--access-token', 'wrong', '--api-base', apiBase, '--json']);
check('wrong token fails', badToken.code !== 0);

const two = createManagementMock({
  token,
  projects: [
    { id: 'projonexxxxxxxxxxxx', name: 'one', region: 'ap-south-1', status: 'ACTIVE_HEALTHY' },
    { id: 'projtwoxxxxxxxxxxxx', name: 'two', region: 'ap-south-1', status: 'ACTIVE_HEALTHY' }
  ]
});
const twoBase = await two.listen();
const needRef = await runSetup(['--access-token', token, '--api-base', twoBase, '--apply']);
check(
  '--apply with two projects and no --project-ref exits 2',
  needRef.code === 2,
  needRef.stderr.slice(0, 200)
);
check('asks for --project-ref when there are two projects', /--project-ref/i.test(needRef.stderr));

const picked = await runSetup([
  '--access-token',
  token,
  '--api-base',
  twoBase,
  '--apply',
  '--project-ref',
  'projtwoxxxxxxxxxxxx',
  '--json',
  '--mask-keys'
]);
check('apply --project-ref picks the named project', picked.code === 0 && two.state.get('projtwoxxxxxxxxxxxx').applied, picked.stderr);
check('the other project was left untouched', two.state.get('projonexxxxxxxxxxxx').applied === false);

mock.close();
two.close();

/* ------------------------------------------------------- summary */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
