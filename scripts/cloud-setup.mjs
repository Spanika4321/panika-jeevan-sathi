#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — one-time Cloudflare setup helper.
 *
 * Creates the D1 database the site will use and prints the exact environment
 * variables to paste into Render. R2 buckets and R2 access keys are created in
 * the Cloudflare dashboard (Cloudflare has no API for R2 token minting), so the
 * script prints direct links for those two steps.
 *
 *   node scripts/cloud-setup.mjs --token <Cloudflare API token>
 *   node scripts/cloud-setup.mjs --token <token> --account-id <id> --name panika-jeevan-sathi
 *
 * The token needs "D1:Edit" on the account.
 */

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const token = arg('token', process.env.CF_API_TOKEN || '');
const name = arg('name', 'panika-jeevan-sathi');
let accountId = arg('account-id', process.env.CF_ACCOUNT_ID || '');
const apiBase = 'https://api.cloudflare.com/client/v4';

if (!token) {
  console.error('\n  Usage: node scripts/cloud-setup.mjs --token <Cloudflare API token>\n');
  console.error('  Create the token at https://dash.cloudflare.com/profile/api-tokens');
  console.error('  → "Create Custom Token" → Permissions: Account · D1 · Edit\n');
  process.exit(2);
}

async function cf(pathname, options = {}) {
  const res = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(30000)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || (json && json.success === false)) {
    const errors = (json && json.errors) || [];
    const message = errors.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return json;
}

console.log('\nPANIKA JEEVAN SATHI — Cloudflare setup\n');

/* --------------------------------------------------------------- 1. account */

if (!accountId) {
  const accounts = await cf('/accounts?per_page=50');
  const list = (accounts.result || []).map((a) => ({ id: a.id, name: a.name }));
  if (!list.length) throw new Error('No Cloudflare account is visible to this token.');
  if (list.length === 1) {
    accountId = list[0].id;
  } else {
    console.log('  Several accounts are available — pick one and re-run with --account-id <id>:');
    for (const a of list) console.log(`     ${a.id}   ${a.name}`);
    process.exit(0);
  }
}
console.log(`  Account : ${accountId}`);

/* ------------------------------------------------------- 2. D1 database */

const existing = await cf(`/accounts/${accountId}/d1/database?per_page=100`);
const found = (existing.result || []).find((d) => d.name === name);

let databaseId = found && found.uuid;
if (databaseId) {
  console.log(`  D1      : reusing existing database "${name}" (${databaseId})`);
} else {
  // primary_location_hint "apac" keeps the database close to India. Fall back
  // to a plain create if this account/api version rejects the hint.
  const attempts = [
    { name, primary_location_hint: 'apac' },
    { name, read_replication: { mode: 'auto' } },
    { name }
  ];
  for (const body of attempts) {
    try {
      const created = await cf(`/accounts/${accountId}/d1/database`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      databaseId = created.result && created.result.uuid;
      if (databaseId) break;
    } catch (err) {
      if (body === attempts[attempts.length - 1]) throw err;
    }
  }
  console.log(`  D1      : database "${name}" created (${databaseId})`);
}

/* ------------------------------------------------------------------ output */

console.log('\n  ────────────────────────────────────────────────────────────────');
console.log('  Paste these into Render → your service → Environment:\n');
console.log(`  CF_ACCOUNT_ID        = ${accountId}`);
console.log(`  CF_D1_DATABASE_ID    = ${databaseId}`);
console.log('  CF_D1_API_TOKEN      = <the API token you created>');
console.log('  R2_ACCOUNT_ID        = <same Cloudflare account id>');
console.log('  R2_BUCKET            = <bucket name you create below>');
console.log('  R2_ACCESS_KEY_ID     = <R2 token access key id>');
console.log('  R2_SECRET_ACCESS_KEY = <R2 token secret access key>');
console.log('\n  Still needed in the Cloudflare dashboard (about 2 minutes):');
console.log(`   1. R2 bucket   → https://dash.cloudflare.com/${accountId}/r2/buckets/new`);
console.log(`   2. R2 API token → https://dash.cloudflare.com/${accountId}/r2/api-tokens`);
console.log('      (Object Read & Write, scoped to that bucket)');
console.log('\n  Then check everything with:');
console.log('    node scripts/verify-cloud.mjs --url https://<your-service>.onrender.com');
console.log('  ────────────────────────────────────────────────────────────────\n');
