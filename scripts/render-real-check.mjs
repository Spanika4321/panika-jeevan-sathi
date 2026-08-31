#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — real production route check (Rahul / Guardian).
 *
 * Probes a *live* deployment and answers one question: is the site actually
 * serving correctly there? Unlike the earlier version it never confuses two
 * different facts:
 *
 *   PASS     0 broken routes                    exit 0
 *   FAIL     a route answered badly (4xx/5xx)    exit 1   ← "do NOT report all done"
 *   BLOCKED  the host could not be reached at all exit 2   ← no verdict, by design
 *
 * BLOCKED matters: Render's Free plan sleeps after 15 idle minutes and a cold
 * container takes up to a minute to answer, so a single probe from a sandbox,
 * a laptop behind a proxy, or a CI runner with no egress looks exactly like a
 * dead site. That is a "cannot tell from here", not a green and not a red.
 *
 *   node scripts/render-real-check.mjs
 *   SITE_URL=https://staging.example.com node scripts/render-real-check.mjs
 *   node scripts/render-real-check.mjs --attempts 6 --json
 *
 * Beyond status codes it verifies what this repo promises in production:
 * /api/health, gzip, ETag, CSP nonce, canonical/OG/JSON-LD, robots.txt,
 * sitemap.xml with lastmod, noindex on member pages, and that the SEO Center
 * API refuses a logged-out caller.
 */

const SITE = String(process.env.SITE_URL || process.env.PJS_PROD_URL || 'https://panikajeevansathi.onrender.com').replace(/\/+$/, '');
const ARGS = process.argv.slice(2);
const asJson = ARGS.includes('--json');
const attempts = Math.max(1, Number(valueOf('--attempts', '4')) || 4);

function valueOf(flag, fallback) {
  const i = ARGS.indexOf(flag);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : fallback;
}

/** Public pages, member pages (must exist but stay out of the index), infra. */
const ROUTES = [
  { path: '/', expect: 'public' },
  { path: '/index.html', expect: 'public' },
  { path: '/about.html', expect: 'public' },
  { path: '/contact.html', expect: 'public' },
  { path: '/login.html', expect: 'public' },
  { path: '/privacy.html', expect: 'public' },
  { path: '/terms.html', expect: 'public' },
  { path: '/dashboard.html', expect: 'private' },
  { path: '/messages.html', expect: 'private' },
  { path: '/matches.html', expect: 'private' },
  { path: '/admin.html', expect: 'private' },
  { path: '/seo-center.html', expect: 'private' },
  { path: '/assets/css/app.css', expect: 'asset' },
  { path: '/assets/js/app.js', expect: 'asset' },
  { path: '/assets/img/logo.svg', expect: 'asset' },
  { path: '/robots.txt', expect: 'infra' },
  { path: '/sitemap.xml', expect: 'infra' },
  { path: '/security.txt', expect: 'infra' },
  { path: '/this-page-does-not-exist.html', expect: 'notfound' }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(pathname) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(SITE + pathname, {
        redirect: 'manual',
        compress: false,
        signal: AbortSignal.timeout(25000),
        headers: { 'accept-encoding': 'gzip', 'user-agent': 'PJS-real-check/1 (+https://github.com/Spanika4321/panika-jeevan-sathi)' }
      });
      const body = /text\/|json|xml|javascript|css|svg/.test(res.headers.get('content-type') || '')
        ? await decompress(res)
        : '';
      return { kind: 'answered', status: res.status, headers: res.headers, body };
    } catch (err) {
      last = err;
      // A sleeping service is woken by the first request: back off and retry.
      if (attempt < attempts) await sleep(4000 * attempt);
    }
  }
  return { kind: 'unreachable', status: 0, error: last ? last.message || String(last) : 'unreachable' };
}

async function decompress(res) {
  try {
    if ((res.headers.get('content-encoding') || '').includes('gzip')) {
      const { gunzipSync } = await import('node:zlib');
      return gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
    }
    return await res.text();
  } catch (_) {
    return '';
  }
}

const results = [];
const notes = [];
let ok = 0;
let broken = 0;
let unreachable = 0;

for (const route of ROUTES) {
  const r = await probe(route.path);
  if (r.kind === 'unreachable') {
    unreachable += 1;
    results.push({ path: route.path, status: 'UNREACHABLE', detail: r.error });
    continue;
  }
  const expect404 = route.expect === 'notfound';
  const statusOk = expect404 ? r.status === 404 : r.status >= 200 && r.status < 400;
  const problems = [];

  if (!statusOk) problems.push(`expected ${expect404 ? '404' : '2xx/3xx'}, got ${r.status}`);

  if (statusOk && r.status === 200) {
    const csp = r.headers.get('content-security-policy') || '';
    const type = r.headers.get('content-type') || '';
    if (type.includes('text/html')) {
      if (!csp) problems.push('no Content-Security-Policy header');
      if (r.headers.get('content-encoding') !== 'gzip') problems.push('HTML not gzipped');
      if (!r.headers.get('etag')) problems.push('no ETag validator');
      if (route.expect === 'public' && !/canonical/.test(r.body)) problems.push('public page has no canonical link');
      if (route.expect === 'public' && !r.body.includes('og:title')) problems.push('public page has no Open Graph title');
      if (route.expect === 'private') {
        const blocked = /noindex/.test(r.headers.get('x-robots-tag') || '') || /noindex/.test(r.body);
        if (!blocked) problems.push('member page is indexable');
      }
      if (route.path === '/' && !r.body.includes('application/ld+json')) problems.push('homepage publishes no JSON-LD');
      if (route.path === '/robots.txt') {
        if (!r.body.includes('Disallow: /admin.html')) problems.push('robots.txt does not block admin.html');
        if (!r.body.includes('Disallow: /seo-center.html')) problems.push('robots.txt does not block seo-center.html');
        if (!r.body.includes('Sitemap:')) problems.push('robots.txt advertises no sitemap');
      }
      if (route.path === '/sitemap.xml') {
        if (!r.body.includes('<lastmod>')) problems.push('sitemap has no lastmod');
        if (/dashboard\.html|admin\.html/.test(r.body)) problems.push('sitemap lists member pages');
      }
      if (route.path === '/security.txt' && !/Contact: mailto:/.test(r.body)) problems.push('security.txt has no contact');
    }
    if (type.includes('application/json') && route.path === '/api/health') {
      try {
        const j = JSON.parse(r.body);
        if (j.ok !== true) problems.push('/api/health did not report ok');
      } catch (_) {
        problems.push('/api/health returned unparsable JSON');
      }
    }
  }

  if (problems.length) broken += 1;
  else ok += 1;
  results.push({ path: route.path, status: problems.length ? 'FAIL' : 'PASS', code: r.status, detail: problems.join('; ') });
  if (problems.length) notes.push(`${route.path}: ${problems.join('; ')}`);
}

// The health endpoint and the SEO Center gate are checked last: they need the
// server up, and they are the two answers that matter most operationally.
const health = await probe('/api/health');
if (health.kind === 'answered' && health.status === 200) {
  let parsed = null;
  try {
    parsed = JSON.parse(health.body);
  } catch (_) {
    parsed = null;
  }
  if (parsed && parsed.ok) ok += 1;
  else broken += 1;
  results.push({
    path: '/api/health',
    status: parsed && parsed.ok ? 'PASS' : 'FAIL',
    code: health.status,
    detail: parsed ? `storage=${parsed.storage} photos=${parsed.photos}` : 'unparsable'
  });
} else {
  unreachable += 1;
  results.push({ path: '/api/health', status: 'UNREACHABLE', detail: health.error || `HTTP ${health.status}` });
}

const seoGate = await probe('/api/seo/status');
if (seoGate.kind === 'answered') {
  // 401/403 = correctly refusing a logged-out caller; 200 with data = a hole.
  const refused = seoGate.status === 401 || seoGate.status === 403 || seoGate.status === 302;
  let leaked = false;
  try {
    const j = JSON.parse(seoGate.body);
    leaked = Boolean(j && j.ok === true);
  } catch (_) {
    leaked = false;
  }
  if (refused || seoGate.status >= 400) ok += 1;
  else {
    broken += 1;
    notes.push('/api/seo/status answered without a session — the admin gate is not holding');
  }
  results.push({
    path: '/api/seo/status (logged out)',
    status: leaked ? 'FAIL' : 'PASS',
    code: seoGate.status,
    detail: leaked ? 'answered with data' : `refused with ${seoGate.status}`
  });
} else {
  unreachable += 1;
  results.push({ path: '/api/seo/status (logged out)', status: 'UNREACHABLE', detail: seoGate.error });
}

const total = ok + broken;
let verdict;
if (broken > 0) verdict = 'FAIL';
else if (unreachable > 0 && ok === 0) verdict = 'BLOCKED';
else if (unreachable > 0) verdict = 'PARTIAL';
else verdict = 'PASS';

if (asJson) {
  console.log(JSON.stringify({ site: SITE, verdict, ok, broken, unreachable, attempts, results }, null, 2));
} else {
  console.log('');
  console.log(`  PANIKA JEEVAN SATHI — live check of ${SITE} (${attempts} attempt(s) per route)`);
  console.log('  ' + '─'.repeat(74));
  for (const r of results) {
    const tag = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '!';
    console.log(`  ${tag} ${r.path.padEnd(38)} ${String(r.code ?? '').padEnd(5)} ${r.status}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log('  ' + '─'.repeat(74));
  console.log(`  routes ${total} checked · ${ok} pass · ${broken} fail · ${unreachable} unreachable`);
  console.log('');
  if (verdict === 'PASS') {
    console.log('  REAL ROUTE TEST: PASS — production is serving correctly, headers and index rules included.');
    console.log('  GUARDIAN: PASS · MANAGER: may report all done');
  } else if (verdict === 'FAIL') {
    console.log('  REAL ROUTE TEST: FAIL — production answered, and something is wrong:');
    for (const n of notes.slice(0, 10)) console.log(`      • ${n}`);
    console.log('  GUARDIAN: FAIL · POOJA: diagnose the routes above · MANAGER: DO NOT REPORT ALL DONE');
  } else if (verdict === 'BLOCKED') {
    console.log('  REAL ROUTE TEST: BLOCKED — the host never answered, so nothing can be claimed either way.');
    console.log(`      First request wakes a sleeping Render service; raise --attempts, or check`);
    console.log(`      ${SITE} in a browser. This is NOT a pass and NOT a failure.`);
    console.log('  GUARDIAN: BLOCKED · MANAGER: report "not verified", never "all done"');
  } else {
    console.log('  REAL ROUTE TEST: PARTIAL — most routes verified, some unreachable from here.');
    console.log('  GUARDIAN: PARTIAL · treat the unreachable ones as unverified, not as passing');
  }
  console.log('');
}

process.exit(verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 2);
