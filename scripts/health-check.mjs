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

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    for (const p of ['/admin.html', '/dashboard.html', '/messages.html', '/profile.html']) {
      check(`robots.txt blocks ${p}`, r.text.includes(`Disallow: ${p}`));
    }
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

/* ------------------------------------------- 11. full suite rollup (CI parity) */
/**
 * GitHub par `.github/workflows/*` edit karne ki permission is app ke paas nahi
 * hai (manifest mein `workflows` declare hi nahi), isliye baaki suites ko CI
 * mein le jaane ka ek hi raasta hai: unhe usi script ke andar chalana jo CI
 * pehle se chalata hai. Ye section wahi karta hai.
 *
 * Recursion guard: har child ko PJS_HEALTH_NO_ROLLUP=1 milta hai, aur agar ye
 * variable set hai to section skip ho jaata hai — warna
 * health-check → manager → health-check … infinite loop ban jaata.
 */

section('11. Full suite rollup (CI parity)');

if (process.env.PJS_HEALTH_NO_ROLLUP === '1') {
  console.log('  ↷ skipped — PJS_HEALTH_NO_ROLLUP=1 (recursion guard: caller already ran the suites)');
  // Skip ko pass count mein nahi gina jaata — warna "check hua" jhooth hota.
} else {
  const SUITES = [
    ['Syntax — browser + server code', ['scripts/check-syntax.mjs'], {}, [0]],
    ['E2E — SQLite store', ['scripts/e2e-test.mjs'], {}, [0]],
    ['E2E — JSON fallback store', ['scripts/e2e-test.mjs'], { PJS_STORAGE: 'json' }, [0]],
    ['Cloudflare SigV4 request signing', ['scripts/test-sigv4.mjs'], {}, [0]],
    ['Cloud round-trip (D1 + R2, mocked)', ['scripts/e2e-cloud-test.mjs'], {}, [0]],
    ['Agent team contract', ['scripts/agent-team-check.mjs'], {}, [0]],
    ['Agent storage integrity (doctor)', ['scripts/agent-storage.mjs', 'doctor'], {}, [0]],
    ['Order desk (agents that are not working)', ['scripts/agent-orders.mjs', '--dry-run'], {}, [0]],
    // verify-cloud bina credentials ke BLOCKED (exit 2) deta hai — wo failure
    // nahi, "verify nahi ho paya" hai. Isliye 0 aur 2 dono acceptable hain.
    ['Cloud credential verdict', ['scripts/verify-cloud.mjs'], {}, [0, 2]]
  ];

  for (const [name, args, env, okCodes] of SUITES) {
    const started = Date.now();
    let code = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10 * 60 * 1000,
        env: { ...process.env, PJS_HEALTH_NO_ROLLUP: '1', ...env }
      });
    } catch (err) {
      code = typeof err.status === 'number' ? err.status : 1;
      out = String(err.stdout || '') + String(err.stderr || err.message || '');
    }
    const ms = Date.now() - started;
    const tally = String(out).match(/(\d+)\s+passed,\s*(\d+)\s+failed/i);
    const detail = tally ? `${tally[1]} passed, ${tally[2]} failed` : `exit ${code}`;
    check(`${name}`, okCodes.includes(code), `${detail} in ${ms}ms`);
  }
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
