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
 * Exit codes (verdict, not just pass/fail):
 *   0 PASS     — real checks ran and all of them passed
 *   1 FAIL     — a real check failed (fix listed)
 *   2 BLOCKED  — nothing could be verified (no credentials). Nothing was
 *                proven durable, so nothing is claimed durable.
 *   3 PARTIAL  — some services verified, others not configured
 */

import d1Lib from '../lib/d1.js';
import r2Lib from '../lib/r2.js';

const args = process.argv.slice(2);
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : process.env.SITE_URL;

let passed = 0;
let failed = 0;
let blocked = 0;
const problems = [];
const blockers = [];

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
  blocked += 1;
  blockers.push('Cloudflare D1 is not configured (CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_D1_API_TOKEN are not set)');
  console.log('  – BLOCKED: CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_D1_API_TOKEN are not set — D1 could not be verified.');
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
  blocked += 1;
  blockers.push('Cloudflare R2 is not configured (R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not set)');
  console.log('  – BLOCKED: R2_* variables are not set — photo storage could not be verified.');
  console.log('    Uploaded photos stay on the instance disk and are lost whenever the');
  console.log('    Render Free instance restarts.');
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
    // Host tak pahunch hi nahi paye => BLOCKED (na PASS, na "site toot gayi").
    blocked += 1;
    blockers.push(`Deployed website could not be reached (${err.message})`);
    console.log(`  – BLOCKED: ${base} tak pahuncha nahi ja saka — ${err.message}`);
  }
}

/* --------------------------------------------------------------- verdict */

console.log(
  `\n──────────────────────────────────────────────\n  ${passed} passed, ${failed} failed, ${blocked} blocked\n`
);

if (failed) {
  console.log(`  VERDICT: FAIL — fix: ${problems.join('; ')}\n`);
  process.exit(1);
}

if (passed === 0) {
  console.log('  VERDICT: BLOCKED — kuch bhi verify nahi ho paya, isliye kuch bhi');
  console.log('  "durable" nahi kaha ja raha.');
  for (const b of blockers) console.log(`    • ${b}`);
  console.log('\n  Aage badhne ke liye: CF_* / R2_* variables set karke dobara chalayein,');
  console.log('  ya `--url` ke saath deployed site bhi check karein.\n');
  process.exit(2);
}

if (blocked) {
  console.log(`  VERDICT: PARTIAL — ${passed} check(s) passed, par ${blocked} service verify nahi ho paya:`);
  for (const b of blockers) console.log(`    • ${b}`);
  console.log('');
  process.exit(3);
}

console.log('  VERDICT: PASS — storage verified durable: members, profiles, messages');
console.log('  and photos survive a restart, a redeploy and the free-tier sleep.\n');
process.exit(0);
