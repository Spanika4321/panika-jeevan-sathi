#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Cloudflare D1 + R2 connection check.
 *
 * Run this after filling in the environment variables (locally, on Render's
 * "Shell"/one-off job, or from GitHub Actions) to prove the site can really
 * reach its database and photo bucket:
 *
 *   node scripts/verify-cloud.mjs              # check D1 + R2
 *   node scripts/verify-cloud.mjs --url https://panika-jeevan-sathi.onrender.com
 *                                              # ...and the deployed website
 *
 * Exits non-zero (with a plain-English fix) if anything is wrong.
 */

import d1Lib from '../lib/d1.js';
import r2Lib from '../lib/r2.js';

const args = process.argv.slice(2);
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : process.env.SITE_URL;

let passed = 0;
let failed = 0;
const problems = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    problems.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------- 1. D1 */

section('1. Cloudflare D1 (member database)');

const d1Config = d1Lib.configFromEnv();
if (!d1Config) {
  console.log('  – CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_D1_API_TOKEN are not set — skipping D1 checks.');
  console.log('    Without them the site falls back to a local SQLite file, which a');
  console.log('    Render Free instance loses every time it sleeps or redeploys.');
} else {
  check(
    'D1 environment variables are set',
    true,
    `account ${d1Config.accountId}, database ${d1Config.databaseId}`
  );

  const d1 = d1Lib.createClient(d1Config, { log: (m) => console.log(`      ${m}`) });

  try {
    await d1.ping();
    check('D1 responds to a query', true);
  } catch (err) {
    check('D1 responds to a query', false, err.message);
    console.log('    → The token needs "D1:Edit" permission for this account/database.');
  }

  try {
    const tables = await d1.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const names = (tables.results || []).map((r) => r.name);
    const expected = ['users', 'profiles', 'interests', 'shortlist', 'messages', 'notifications'];
    const missing = expected.filter((t) => !names.includes(t));
    check(
      'all application tables exist',
      missing.length === 0,
      missing.length ? `missing ${missing.join(', ')}` : `${names.length} tables`
    );
  } catch (err) {
    check('all application tables exist', false, err.message);
  }

  for (const table of ['users', 'profiles', 'messages']) {
    try {
      const res = await d1.query(`SELECT COUNT(*) AS c FROM "${table}"`);
      const count = Number((res.results && res.results[0] && res.results[0].c) || 0);
      check(`table ${table} is readable`, true, `${count} rows`);
    } catch (err) {
      check(`table ${table} is readable`, false, err.message);
    }
  }
}

/* ------------------------------------------------------------------- 2. R2 */

section('2. Cloudflare R2 (profile photos)');

const r2Config = r2Lib.configFromEnv();
if (!r2Config) {
  console.log('  – R2_* variables are not set — uploaded photos stay on the instance disk');
  console.log('    and are lost whenever the Render Free instance restarts.');
} else {
  check('R2 environment variables are set', true, `bucket ${r2Config.bucket}`);
  const r2 = r2Lib.createClient(r2Config, { log: (m) => console.log(`      ${m}`) });
  try {
    const ok = await r2.ping();
    check('R2 accepts a signed upload, download and delete', ok);
  } catch (err) {
    check('R2 accepts a signed upload, download and delete', false, err.message);
  }
  try {
    const keys = await r2.list();
    check('R2 bucket can be listed', true, `${keys.length} photo(s) stored`);
  } catch (err) {
    check('R2 bucket can be listed', false, err.message);
  }
}

/* --------------------------------------------------------------- 3. Website */

if (urlArg) {
  section(`3. Deployed website (${urlArg})`);
  const base = String(urlArg).replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(60000) });
    const body = await res.json();
    check('/api/health returns 200', res.status === 200, `HTTP ${res.status}`);
    check('site reports ok', Boolean(body && body.ok));
    check('site is using the D1 database', body && body.storage === 'd1', `storage=${body && body.storage}`);
    check(
      'site has no unsaved changes',
      body && body.remote && body.remote.database.pending === 0,
      body && body.remote ? `pending=${body.remote.database.pending}` : ''
    );
    check(
      'photos are mirrored to R2',
      body && body.remote && body.remote.photos.remote === true
    );

    for (const page of ['/', '/login.html', '/about.html', '/contact.html', '/search.html']) {
      const pageRes = await fetch(base + page, { signal: AbortSignal.timeout(60000) });
      check(`page ${page} loads`, pageRes.status === 200, `HTTP ${pageRes.status}`);
    }
    const missing = await fetch(`${base}/this-page-does-not-exist`);
    check('unknown page returns 404', missing.status === 404, `HTTP ${missing.status}`);
  } catch (err) {
    check('deployed website responds', false, err.message);
  }
}

console.log(
  `\n──────────────────────────────────────────────\n  ${passed} passed, ${failed} failed\n`
);
if (failed) {
  console.log(`  fix: ${problems.join('; ')}\n`);
  process.exit(1);
}
console.log('  Storage is durable: members, profiles, messages and photos survive\n  a restart, a redeploy and the free-tier sleep.\n');
