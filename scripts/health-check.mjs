#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — automated website health check (guardian agent).
 *
 * Boots a real server on a temporary data folder and verifies, WITHOUT
 * touching any real data:
 *
 *   1. Every public page and asset responds 200
 *   2. Unknown pages return 404 (with the branded 404 page)
 *   3. robots.txt is complete (private pages blocked, sitemap advertised)
 *   4. sitemap.xml is valid and lists the public pages
 *   5. Private pages carry <meta name="robots" content="noindex...">
 *   6. Public pages have <title> + meta description + viewport + lang
 *   7. Security headers are present on every response
 *   8. API health endpoint responds ok
 *   9. UI baseline: page bodies / CSS / JS / images are unchanged
 *      (guards the approved design against accidental changes)
 *
 * Exits 0 when healthy, 1 when anything fails.
 * Writes a plain-language report to reports/health-report-<date>.md
 *
 *   node scripts/health-check.mjs
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TEMP LIVE CHECK (removed after use): confirm deployed HTML carries the
// Google Search Console verification tag.
try {
  const res = await fetch('https://panikajeevansathi.onrender.com/', {
    signal: AbortSignal.timeout(90000),
  });
  const html = await res.text();
  const present = /KUEY7A/.test(html);
  console.log(`[LIVE-TAG-CHECK] status=${res.status} bytes=${html.length} tag_present=${present}`);
  const m = html.match(/<meta name="google-site-verification"[^>]*>/i);
  if (m) console.log(`[LIVE-TAG-CHECK] ${m[0]}`);
} catch (e) {
  console.log(`[LIVE-TAG-CHECK] ERROR ${e.message}`);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const REPORT_DIR = path.join(ROOT, 'reports');
const BASELINE_FILE = path.join(REPORT_DIR, 'ui-baseline-body.md5');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-health-'));
const PORT = 3500 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;

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

let passed = 0;
let failed = 0;
const failures = [];
const sections = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
  sections.push(title);
}

/* --------------------------------------------------------------- server */

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), PJS_DATA_DIR: DATA_DIR, HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let ready = false;
    const onData = (buf) => {
      if (!ready && String(buf).includes('is running')) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', () => {});
    child.on('exit', (code) => {
      if (!ready) reject(new Error(`server exited early with code ${code}`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error('server did not start within 15s'));
    }, 15000).unref();
  });
}

async function get(pathname) {
  const res = await fetch(BASE + pathname, { redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

/* ------------------------------------------------------------ the checks */

const child = await startServer();

try {
  section('1. Availability — public pages');
  for (const p of PUBLIC_PAGES) {
    const r = await get(p);
    check(`${p} → 200`, r.status === 200, `got ${r.status}`);
  }

  section('2. Availability — member pages & assets');
  for (const p of [...PRIVATE_PAGES, ...ASSETS, '/404.html']) {
    const r = await get(p);
    check(`${p} → 200`, r.status === 200, `got ${r.status}`);
  }

  section('3. Error handling');
  {
    const r = await get('/this-page-does-not-exist.html');
    check('unknown page returns 404', r.status === 404, `got ${r.status}`);
    check('404 page is branded', r.text.includes('PANIKA'), 'plain 404 body');
    const t = await get('/..%2fserver.js');
    check('path traversal blocked', t.status === 403 || t.status === 404, `got ${t.status}`);
  }

  section('4. robots.txt');
  {
    const r = await get('/robots.txt');
    check('robots.txt → 200', r.status === 200, `got ${r.status}`);
    check('robots.txt allows public crawl', r.text.includes('Allow: /'));
    // Google rule: a page that is Disallow-ed can never be read, so its
    // noindex is invisible and the URL may still be indexed. Member pages must
    // therefore stay crawlable and rely on their noindex meta tag.
    for (const p of ['/admin.html', '/dashboard.html', '/messages.html', '/profile.html']) {
      check(
        `robots.txt does NOT disallow ${p} (so Google can read its noindex)`,
        !r.text.includes(`Disallow: ${p}`)
      );
    }
    check('robots.txt uses only Google-supported directives', !/^\s*(host|crawl-delay)\s*:/im.test(r.text));
    check('robots.txt blocks /api/', r.text.includes('Disallow: /api/'));
    check('robots.txt blocks /uploads/ (member photos)', r.text.includes('Disallow: /uploads/'));
    check('robots.txt advertises sitemap', r.text.includes('Sitemap:'));
  }

  section('5. sitemap.xml');
  {
    const r = await get('/sitemap.xml');
    check('sitemap.xml → 200', r.status === 200, `got ${r.status}`);
    check('sitemap is valid XML urlset', r.text.includes('<urlset') && r.text.includes('</urlset>'));
    for (const p of PUBLIC_PAGES) {
      check(`sitemap lists ${p}`, r.text.includes(`${p}</loc>`));
    }
    check('sitemap does NOT list private pages', !r.text.includes('dashboard.html') && !r.text.includes('admin.html'));
    check('sitemap uses absolute URLs', /<loc>https?:\/\//.test(r.text));
    check('sitemap has valid <lastmod> dates', /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(r.text));
    check('sitemap omits changefreq/priority (Google ignores them)',
      !r.text.includes('<changefreq>') && !r.text.includes('<priority>'));
    check('sitemap is served as XML',
      (r.headers.get('content-type') || '').includes('xml'),
      r.headers.get('content-type') || 'no content-type');
  }

  section('5b. Canonical URLs & duplicate consolidation');
  {
    const home = await get('/');
    check('/ declares a canonical URL', /<link rel="canonical" href="https?:\/\/[^"]+"/.test(home.text));
    for (const p of PUBLIC_PAGES) {
      const r = await get(p);
      const name = p === '/' ? '/index.html' : p;
      check(`${name} canonical is absolute`, /<link rel="canonical" href="https?:\/\//.test(r.text));
      check(`${name} has Open Graph title+url`,
        r.text.includes('property="og:title"') && r.text.includes('property="og:url"'));
    }
    const dupe = await get('/index.html', { redirect: 'manual' });
    check('/index.html 301-redirects to / (no duplicate home URL)',
      dupe.status === 301, `got ${dupe.status}`);
  }

  section('5c. Structured data');
  {
    const home = await get('/');
    const m = home.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    check('/ has JSON-LD structured data', Boolean(m));
    if (m) {
      let parsed = null;
      try { parsed = JSON.parse(m[1]); } catch (_) { /* invalid */ }
      check('JSON-LD is valid JSON', Boolean(parsed));
      check('JSON-LD declares schema.org context',
        Boolean(parsed) && String(parsed['@context']).includes('schema.org'));
    }
  }

  section('5d. Member photos are not indexable');
  {
    const r = await get('/uploads/does-not-exist.jpg');
    const tag = (r.headers.get('x-robots-tag') || '').toLowerCase();
    check('/uploads/ sends X-Robots-Tag: noindex', tag.includes('noindex'), tag || 'header missing');
  }

  section('6. SEO tags on public pages');
  for (const p of PUBLIC_PAGES) {
    const r = await get(p);
    const name = p === '/' ? '/index.html' : p;
    check(`${name} has <title>`, /<title>[^<]{5,}<\/title>/.test(r.text));
    check(`${name} has meta description`, r.text.includes('name="description"'));
    check(`${name} has viewport`, r.text.includes('name="viewport"'));
    check(`${name} has lang attribute`, r.text.includes('<html lang='));
    check(`${name} is indexable (no noindex)`, !r.text.includes('noindex'));
  }

  section('7. Private pages are noindex');
  for (const p of PRIVATE_PAGES) {
    const r = await get(p);
    check(`${p} has noindex`, r.text.includes('noindex'));
  }

  section('8. Security headers');
  {
    const r = await get('/');
    for (const h of SECURITY_HEADERS) {
      check(`header ${h}`, r.headers.get(h) !== null);
    }
  }

  section('9. API health');
  {
    const r = await get('/api/health');
    let ok = false;
    try { ok = JSON.parse(r.text).ok === true; } catch (_) { /* ignore */ }
    check('/api/health responds ok', r.status === 200 && ok, r.text.slice(0, 120));
  }

  section('10. UI baseline (design lock)');
  {
    const lines = [];
    for (const f of fs.readdirSync(PUBLIC_DIR).filter((n) => n.endsWith('.html')).sort()) {
      const raw = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
      const bodyStart = raw.indexOf('<body>');
      const body = bodyStart === -1 ? raw : raw.slice(bodyStart);
      const hash = crypto.createHash('md5').update(body).digest('hex');
      lines.push(`${hash}  public/${f}`);
    }
    const assetFiles = [
      'assets/css/app.css', 'assets/js/app.js', 'assets/js/cards.js',
      'assets/img/favicon.svg', 'assets/img/logo.svg'
    ];
    for (const f of assetFiles.sort()) {
      const hash = crypto.createHash('md5').update(fs.readFileSync(path.join(PUBLIC_DIR, f))).digest('hex');
      lines.push(`${hash}  public/${f}`);
    }
    const current = lines.join('\n') + '\n';

    if (fs.existsSync(BASELINE_FILE)) {
      const baseline = fs.readFileSync(BASELINE_FILE, 'utf8');
      const baseMap = new Map(
        baseline.trim().split('\n').map((l) => {
          const m = l.trim().match(/^([0-9a-f]{32})\s+(.+)$/);
          return m ? [m[2].trim(), m[1]] : null;
        }).filter(Boolean)
      );
      const changedFiles = [];
      for (const l of lines) {
        const m = l.match(/^([0-9a-f]{32})\s+(.+)$/);
        if (!m) continue;
        const known = baseMap.get(m[2].trim());
        if (known && known !== m[1]) changedFiles.push(m[2].trim());
      }
      check(
        'approved design unchanged (bodies, CSS, JS, images match baseline)',
        changedFiles.length === 0,
        changedFiles.length ? `changed: ${changedFiles.join(', ')} — if intentional, run: node scripts/health-check.mjs --update-baseline` : ''
      );
    } else {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      fs.writeFileSync(BASELINE_FILE, current);
      check('baseline created (first run)', true);
    }

    if (process.argv.includes('--update-baseline')) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      fs.writeFileSync(BASELINE_FILE, current);
      console.log('  ↺ baseline updated on request');
    }
  }
} finally {
  child.kill('SIGTERM');
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

/* ---------------------------------------------------------------- report */

const today = new Date().toISOString().slice(0, 10);
const status = failed === 0 ? 'Healthy ✅' : 'WARNING ⚠️';
const report = `# PANIKA JEEVAN SATHI — Automated Health Report

**Date:** ${today} · **Generated by:** guardian health check (\`scripts/health-check.mjs\`)

## STATUS: ${status}

- Checks passed: **${passed}**
- Checks failed: **${failed}**

${failed === 0
  ? 'Everything is working: all pages load, error handling is correct, robots.txt & sitemap.xml are healthy, SEO tags are in place, private pages are hidden from search engines, security headers are on, the API is responding, and the approved public design is unchanged.'
  : `## Problems found\n\n${failures.map((f) => `- ${f}`).join('\n')}\n\nPlease review the failures above. No automatic risky fixes were made.`}

## What was checked

${sections.map((s) => `- ${s}`).join('\n')}
`;

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(path.join(REPORT_DIR, `health-report-${today}.md`), report);
fs.writeFileSync(path.join(REPORT_DIR, 'health-report-latest.md'), report);

console.log('\n──────────────────────────────────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed — report: reports/health-report-${today}.md`);
console.log('──────────────────────────────────────────────────────────');

process.exit(failed === 0 ? 0 : 1);
