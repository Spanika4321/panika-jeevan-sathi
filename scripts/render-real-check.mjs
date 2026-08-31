#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Real live-site check (deployed URL, honest verdicts)
 * ==========================================================================
 *
 *   node scripts/render-real-check.mjs
 *   node scripts/render-real-check.mjs --url http://127.0.0.1:3000
 *   node scripts/render-real-check.mjs --attempts 5 --json
 *   SITE_URL=https://panikajeevansathi.onrender.com node scripts/render-real-check.mjs
 *
 * Purana version sirf HTTP status dekhta tha, prod URL hardcoded tha, aur
 * "host pahuncha nahi" ko FAIL maan leta tha — matlab Render ke cold start
 * (free plan 15 min idle ke baad sota hai) par jhoota red, aur host hi galat
 * ho to bhi "ALL DONE" jaisa green.
 *
 * Ab:
 *   • Har public/private page + asset + robots/sitemap/404 check hota hai.
 *   • Sirf status code nahi — *content* bhi verify hota hai (title, noindex,
 *     security headers, robots Disallow, sitemap entries).
 *   • Cold start ke liye retries + backoff (pehli request 60s le sakti hai).
 *   • 4-way verdict:
 *       PASS    (0) — sab routes + content theek
 *       FAIL    (1) — site respond kar rahi hai par kuch toota hua hai
 *       BLOCKED (2) — host tak pahunch hi nahi hui (kuch prove nahi hua)
 *       PARTIAL (3) — kuch routes theek, kuch nahi (retry ke baad bhi)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = String(value('--url', process.env.SITE_URL || 'https://panikajeevansathi.onrender.com')).replace(/\/+$/, '');
const ATTEMPTS = Math.max(1, Number(value('--attempts', 3)) || 3);
const TIMEOUT_MS = Number(value('--timeout', 60000)) || 60000;
const asJSON = argv.includes('--json');

const PUBLIC_PAGES = ['/', '/about.html', '/contact.html', '/login.html', '/privacy.html', '/terms.html'];
const PRIVATE_PAGES = [
  '/admin.html', '/settings.html', '/dashboard.html', '/matches.html', '/messages.html',
  '/notifications.html', '/interests.html', '/shortlist.html', '/edit-profile.html',
  '/profile.html', '/search.html', '/reset-password.html', '/verify-email.html'
];
const ASSETS = [
  '/assets/css/app.css', '/assets/js/app.js', '/assets/js/cards.js',
  '/assets/img/logo.svg', '/assets/img/favicon.svg'
];
const SECURITY_HEADERS = ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'];

const results = [];
let passed = 0;
let failed = 0;
let blocked = 0;
let unreachable = 0;

async function fetchWithRetry(url, tries) {
  let lastError = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      return { ok: true, status: res.status, headers: res.headers, text, attempts: attempt };
    } catch (err) {
      lastError = err;
      // Render free cold start: pehli request bahut slow ho sakti hai.
      if (attempt < tries) await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  return { ok: false, error: String((lastError && lastError.message) || lastError), attempts: tries };
}

function record(name, verdict, detail = '') {
  results.push({ name, verdict, detail });
  if (verdict === 'PASS') passed += 1;
  else if (verdict === 'FAIL') failed += 1;
  else if (verdict === 'BLOCKED') blocked += 1;
  else unreachable += 1;
  if (!asJSON) {
    const mark = { PASS: '✓', FAIL: '✗', BLOCKED: '⚠', UNREACHABLE: '—' }[verdict] || '?';
    console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ------------------------------------------------- 0. can we reach it at all? */

if (!asJSON) {
  console.log('==============================================');
  console.log(' PANIKA JEEVAN SATHI — REAL LIVE ROUTE CHECK');
  console.log(` target  : ${BASE}`);
  console.log(` attempts: ${ATTEMPTS} (timeout ${TIMEOUT_MS}ms each)`);
  console.log('==============================================');
}

const probe = await fetchWithRetry(`${BASE}/api/health`, ATTEMPTS);

if (!probe.ok) {
  const doc = {
    target: BASE,
    generated_at: new Date().toISOString(),
    verdict: 'BLOCKED',
    reason: `host tak pahuncha nahi ja saka (${probe.error}) — koi route verify nahi hua, isliye FAIL bhi nahi kaha ja raha`,
    attempts: probe.attempts,
    results: [],
    totals: { passed: 0, failed: 0, blocked: 1 }
  };
  if (asJSON) console.log(JSON.stringify(doc, null, 2));
  else {
    console.log('');
    console.log(`  ⚠ BLOCKED — ${BASE} respond hi nahi kar raha: ${probe.error}`);
    console.log('    Ye "site toot gayi" nahi hai — ye "verify nahi ho paya" hai.');
    console.log('    Jaanch: Render service sleep/redeploy mein ho sakta hai, ya is network se');
    console.log('    us host tak route nahi hai. Thodi der baad dobara chalayein.');
    console.log('==============================================');
  }
  process.exit(2);
}

/* ------------------------------------------------------------ 1. api health */

let healthBody = null;
try {
  healthBody = JSON.parse(probe.text);
} catch {
  healthBody = null;
}
record('/api/health responds ok', probe.status === 200 && healthBody && healthBody.ok ? 'PASS' : 'FAIL', `HTTP ${probe.status}, storage=${healthBody && healthBody.storage}`);

/* ------------------------------------------------------------- 2. pages */

async function checkPage(route, { expectNoindex = false, expectIndexable = false } = {}) {
  const res = await fetchWithRetry(BASE + route, ATTEMPTS);
  if (!res.ok) {
    record(`${route} reachable`, 'UNREACHABLE', res.error);
    return;
  }
  if (res.status !== 200) {
    record(`${route} → 200`, 'FAIL', `got HTTP ${res.status}`);
    return;
  }

  const problems = [];
  const title = /<title>\s*\S[\s\S]*?<\/title>/i.test(res.text);
  if (!title) problems.push('no <title>');
  const noindex = /<meta\s+name=["']robots["'][^>]*noindex/i.test(res.text);
  if (expectNoindex && !noindex) problems.push('missing noindex');
  if (expectIndexable && noindex) problems.push('unexpected noindex');
  for (const h of SECURITY_HEADERS) {
    if (!res.headers.get(h)) problems.push(`missing header ${h}`);
  }

  record(
    `${route} → 200 + ${expectNoindex ? 'noindex' : expectIndexable ? 'indexable' : 'content'}`,
    problems.length ? 'FAIL' : 'PASS',
    problems.join(', ') || `HTTP 200${res.attempts > 1 ? ` (after ${res.attempts} attempts)` : ''}`
  );
}

if (!asJSON) console.log('\n1. Public pages (search engines ke liye)');
for (const p of PUBLIC_PAGES) await checkPage(p, { expectIndexable: true });

if (!asJSON) console.log('\n2. Member pages (noindex hone chahiye)');
for (const p of PRIVATE_PAGES) await checkPage(p, { expectNoindex: true });

if (!asJSON) console.log('\n3. Assets');
for (const a of ASSETS) {
  const res = await fetchWithRetry(BASE + a, ATTEMPTS);
  if (!res.ok) {
    record(`${a} reachable`, 'UNREACHABLE', res.error);
    continue;
  }
  const type = res.headers.get('content-type') || '';
  const okType =
    (a.endsWith('.css') && type.includes('text/css')) ||
    (a.endsWith('.js') && type.includes('javascript')) ||
    (a.endsWith('.svg') && type.includes('svg'));
  record(`${a} → 200 + correct content-type`, res.status === 200 && okType && res.text.length > 0 ? 'PASS' : 'FAIL', `HTTP ${res.status}, ${type || 'no content-type'}`);
}

/* --------------------------------------------------- 4. robots.txt + sitemap */

if (!asJSON) console.log('\n4. robots.txt & sitemap.xml');
{
  const res = await fetchWithRetry(`${BASE}/robots.txt`, ATTEMPTS);
  if (!res.ok) record('/robots.txt reachable', 'UNREACHABLE', res.error);
  else if (res.status !== 200) record('/robots.txt → 200', 'FAIL', `HTTP ${res.status}`);
  else {
    const problems = [];
    if (!/Sitemap:\s*\S+\/sitemap\.xml/i.test(res.text)) problems.push('no Sitemap line');
    if (!/Disallow:\s*\/api\//i.test(res.text)) problems.push('/api/ not disallowed');
    if (!/Disallow:\s*\/uploads\//i.test(res.text)) problems.push('/uploads/ not disallowed');
    const missingDisallow = PRIVATE_PAGES.filter((p) => !new RegExp(`Disallow:\\s*${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'i').test(res.text));
    if (missingDisallow.length) problems.push(`private pages not disallowed: ${missingDisallow.join(', ')}`);
    record('/robots.txt complete', problems.length ? 'FAIL' : 'PASS', problems.join('; ') || `${PRIVATE_PAGES.length} private routes disallowed + sitemap advertised`);
  }
}

{
  const res = await fetchWithRetry(`${BASE}/sitemap.xml`, ATTEMPTS);
  if (!res.ok) record('/sitemap.xml reachable', 'UNREACHABLE', res.error);
  else if (res.status !== 200) record('/sitemap.xml → 200', 'FAIL', `HTTP ${res.status}`);
  else {
    const missing = PUBLIC_PAGES.filter((p) => !res.text.includes(`<loc>${BASE}${p}</loc>`));
    const extra = (res.text.match(/<loc>/g) || []).length !== PUBLIC_PAGES.length;
    const problems = [];
    if (missing.length) problems.push(`missing: ${missing.join(', ')}`);
    if (extra) problems.push('unexpected <loc> count');
    record('/sitemap.xml lists the public pages', problems.length ? 'FAIL' : 'PASS', problems.join('; ') || `${PUBLIC_PAGES.length} URLs`);
  }
}

/* ----------------------------------------------------------- 5. error handling */

if (!asJSON) console.log('\n5. Error handling');
{
  const res = await fetchWithRetry(`${BASE}/this-page-does-not-exist-${Date.now()}`, ATTEMPTS);
  if (!res.ok) record('unknown page → 404', 'UNREACHABLE', res.error);
  else record('unknown page → 404', res.status === 404 ? 'PASS' : 'FAIL', `HTTP ${res.status}`);
}
{
  const res = await fetchWithRetry(`${BASE}/../server.js`, 1);
  if (!res.ok) record('path traversal blocked', 'UNREACHABLE', res.error);
  else {
    const leaked = res.status === 200 && /createServer|require\('node:http'\)/.test(res.text);
    const safe = res.status === 404 || res.status === 403;
    record(
      'path traversal blocked (no source leak)',
      safe && !leaked ? 'PASS' : 'FAIL',
      `HTTP ${res.status}${leaked ? ' — source code leaked!' : ''}`
    );
  }
}
{
  const res = await fetchWithRetry(`${BASE}/uploads/`, 1);
  if (!res.ok) record('/uploads/ listing not exposed', 'UNREACHABLE', res.error);
  else record('/uploads/ listing not exposed', res.status === 404 ? 'PASS' : 'FAIL', `HTTP ${res.status}`);
}

/* ------------------------------------------------------------------ verdict */

const totals = { passed, failed, blocked, unreachable };
let verdict = 'PASS';
if (failed > 0) verdict = 'FAIL';
else if (unreachable > 0 && passed > 0) verdict = 'PARTIAL';
else if (unreachable > 0 && passed === 0) verdict = 'BLOCKED';

const doc = {
  target: BASE,
  generated_at: new Date().toISOString(),
  verdict,
  totals,
  attempts: ATTEMPTS,
  results
};

if (asJSON) {
  console.log(JSON.stringify(doc, null, 2));
} else {
  console.log('\n──────────────────────────────────────────────');
  console.log(`  ${passed} passed, ${failed} failed, ${unreachable} unreachable`);
  console.log(`  VERDICT: ${verdict}`);
  if (verdict === 'FAIL') {
    console.log('  toota hua:');
    for (const r of results.filter((r) => r.verdict === 'FAIL')) console.log(`    • ${r.name} — ${r.detail}`);
  }
  if (verdict === 'PARTIAL') {
    console.log('  pahunch se bahar:');
    for (const r of results.filter((r) => r.verdict === 'UNREACHABLE')) console.log(`    • ${r.name} — ${r.detail}`);
  }
  console.log('──────────────────────────────────────────────');
}

try {
  fs.mkdirSync(path.join(ROOT, 'reports', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports', 'agents', 'live-check-latest.json'), JSON.stringify(doc, null, 2) + '\n');
} catch {
  /* report optional hai — verdict se zyada zaroori nahi */
}

process.exit({ PASS: 0, FAIL: 1, BLOCKED: 2, PARTIAL: 3 }[verdict]);
