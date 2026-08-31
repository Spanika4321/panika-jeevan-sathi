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

import { spawn, spawnSync } from 'node:child_process';
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


/* ------------------------------------------------------- low-level helpers */

/** Raw request so the delivery headers can be inspected, not just the text. */
async function raw(pathname, headers = {}) {
  return fetch(BASE + pathname, { headers, redirect: 'manual' });
}

function ldBlocksValid(html) {
  const blocks = [...html.matchAll(/type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!blocks.length) return false;
  try {
    return blocks.every((b) => {
      const parsed = JSON.parse(b);
      return Boolean(parsed && parsed['@context'] && parsed['@type']);
    });
  } catch (_) {
    return false;
  }
}

/**
 * Section 16 runs other suites, and one of them (agent-team-check → Manager)
 * runs the Guardian again. That flag is what stops the recursion, and it is
 * inherited by every child so no nested run can re-enter the rollup.
 */
const NO_ROLLUP = process.env.PJS_HEALTH_NO_ROLLUP === '1';

function runNode(script, args = [], { timeout = 300000, env = {} } = {}) {
  const res = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout,
    env: Object.assign({}, process.env, { PJS_HEALTH_NO_ROLLUP: '1' }, env)
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  return { status: res.status, tail: out.split('\n').filter((l) => l.includes('✗') || l.includes('FAIL')).join(' | ').slice(0, 160) };
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

  section('11. Delivery layer (gzip, validators, CSP)');
  {
    const gz = await raw('/', { 'accept-encoding': 'gzip' });
    check('/ is gzip-compressed', gz.headers.get('content-encoding') === 'gzip', `got ${gz.headers.get('content-encoding')}`);
    check('/ advertises Vary: Accept-Encoding', /accept-encoding/i.test(gz.headers.get('vary') || ''));
    const etag = gz.headers.get('etag');
    check('/ publishes an ETag validator', Boolean(etag));
    const reval = await fetch(BASE + '/', { headers: { 'If-None-Match': etag || '' } });
    check('repeat visitors get 304 Not Modified', reval.status === 304, `got ${reval.status}`);
    const css = await raw('/assets/css/app.css', { 'accept-encoding': 'gzip' });
    check('/assets/css/app.css is compressed and cacheable', css.headers.get('content-encoding') === 'gzip' && /max-age=/.test(css.headers.get('cache-control') || ''));
    const api = await raw('/api/site', { 'accept-encoding': 'gzip' });
    check('large API responses are compressed', api.headers.get('content-encoding') === 'gzip');
    const small = await raw('/api/health', { 'accept-encoding': 'gzip' });
    check('a small API answer is not wastefully compressed', small.headers.get('content-encoding') !== 'gzip');
  }

  section('12. Content-Security-Policy and transport security');
  {
    const html = await raw('/', { 'accept-encoding': 'identity' });
    const csp = html.headers.get('content-security-policy') || '';
    check('CSP is present on every page', Boolean(csp));
    check("CSP forbids object-src and external framing", /object-src 'none'/.test(csp) && /frame-ancestors 'self'/.test(csp));
    check('CSP uses a per-response nonce for scripts', /script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/.test(csp));
    const body = await html.text();
    const nonce = (csp.match(/'nonce-([^']+)'/) || [])[1];
    check('the page scripts carry that nonce', Boolean(nonce) && body.includes(`<script nonce="${nonce}">`));
    const leaked = (body.match(/<script(?![^>]*nonce=)(?![^>]*src=)/g) || []).length;
    check('no inline script is left uncovered by the CSP', leaked === 0, `${leaked} bare inline <script> tag(s)`);
    const plain = await raw('/about.html');
    check('HSTS is not sent over plain HTTP (dev machines stay usable)', !plain.headers.get('strict-transport-security'));
    const https = await raw('/', { 'x-forwarded-proto': 'https' });
    check('HSTS is sent when the request arrived over HTTPS', /max-age=31536000/.test(https.headers.get('strict-transport-security') || ''), https.headers.get('strict-transport-security'));
    const private1 = await raw('/admin.html');
    const private2 = await raw('/seo-center.html');
    check('admin.html is noindex by header too', /noindex/.test(private1.headers.get('x-robots-tag') || ''));
    check('seo-center.html is noindex by header too', /noindex/.test(private2.headers.get('x-robots-tag') || ''));
    const sec = await raw('/.well-known/security.txt');
    check('/.well-known/security.txt is published', sec.status === 200 && /Contact: mailto:/.test(await sec.text()));
  }

  section('13. Search-engine presentation');
  {
    for (const page of ['/', '/about.html', '/contact.html', '/privacy.html', '/terms.html']) {
      const r = await raw(page, { 'accept-encoding': 'identity' });
      const text = await r.text();
      const expect = page === '/' ? BASE + '/' : BASE + page;
      check(`${page} has a canonical link`, text.includes('rel="canonical"'), 'missing');
      check(`${page} has Open Graph title + url`, text.includes('property="og:title"') && text.includes('property="og:url"'));
      check(`${page} has a Twitter card`, text.includes('name="twitter:card"'));
      if (page === '/') check('/ publishes JSON-LD the crawlers can parse', ldBlocksValid(text));
    }
    const sitemap = await raw('/sitemap.xml', { 'accept-encoding': 'identity' });
    const sitemapText = await sitemap.text();
    check('sitemap.xml carries lastmod dates', sitemapText.includes('<lastmod>'));
    check('sitemap.xml does not list member pages', !/dashboard\.html|admin\.html|seo-center\.html/.test(sitemapText));
  }

  section('14. Member data safety (backup round trip)');
  {
    const backup = runNode('scripts/backup.mjs', ['--selftest']);
    check('a snapshot can be backed up, verified and restored', backup.status === 0, backup.tail);
    const tamper = runNode('scripts/backup.mjs', ['--list']);
    check('backup listing works', tamper.status === 0, tamper.tail);
  }

  section('15. Agent job queue has a consumer');
  {
    // A queue nobody drains is a polite way of forgetting a task, so the
    // Guardian checks that every pending job type has a real handler.
    const queueFile = path.join(ROOT, 'storage', 'shared', 'queue', 'jobs.json');
    const drainFile = path.join(ROOT, 'scripts', 'queue-drain.mjs');
    let pending = [];
    let running = 0;
    let handlers = [];
    try {
      const q = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
      pending = q.pending || [];
      running = (q.running || []).length;
    } catch (err) {
      check('queue file is readable', false, err.message);
    }
    try {
      const src = fs.readFileSync(drainFile, 'utf8');
      handlers = [...src.matchAll(/^\s{2}'([a-z0-9._-]+)':/gm)].map((m) => m[1]);
    } catch (err) {
      check('queue runner exists', false, err.message);
    }
    const types = [...new Set(pending.map((j) => j.type))];
    const unhandled = types.filter((t) => !handlers.includes(t));
    check(`queue runner exists (${handlers.length} handler(s))`, handlers.length > 0);
    check(
      `every pending job type has a handler (${pending.length} pending)`,
      unhandled.length === 0,
      unhandled.length ? `no handler for: ${unhandled.join(', ')}` : ''
    );
    check('no job is stuck in running', running === 0, `${running} job(s) claimed and never settled`);
    // Per-agent to-do lists must not grow forever either.
    const tasksRoot = path.join(ROOT, 'storage', 'agents');
    let worst = { id: '-', pending: 0 };
    let stuckTasks = 0;
    try {
      for (const id of fs.readdirSync(tasksRoot)) {
        const file = path.join(tasksRoot, id, 'tasks.json');
        if (!fs.existsSync(file)) continue;
        const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
        if ((doc.pending || []).length > worst.pending) worst = { id, pending: (doc.pending || []).length };
        stuckTasks += (doc.running || []).length;
      }
    } catch (_) {
      /* storage tree is created by npm run storage:init */
    }
    check(
      `no agent task list is growing unbounded (largest: ${worst.id} ${worst.pending})`,
      worst.pending <= 40,
      `${worst.id} has ${worst.pending} pending tasks — run: npm run tasks:work`
    );
    check('no agent task is stuck in running', stuckTasks === 0, `${stuckTasks} stuck task(s)`);
  }

  section('16b. Scheduler honesty');
  {
    // A reboot must never look like a completed SEO cycle. scheduleNextRun()
    // arms the timer; only appendCycle() (a real run) may stamp last_run_at.
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'seo-center.js'), 'utf8');
    // Slice the function body exactly: the next `  function ` line ends it, so
    // this cannot be fooled (or make a false accusation) by its neighbours.
    const bodyOf = (name) => {
      const at = src.indexOf(`function ${name}(`);
      if (at === -1) return '';
      const next = src.indexOf('\n  function ', at + 1);
      const body = src.slice(at, next === -1 ? src.length : next);
      // Drop comment lines: this guard is about what the code writes, and a
      // comment may legitimately *explain* the rule it must not break.
      return body
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');
    };
    const fn = bodyOf('scheduleNextRun');
    check(
      'arming the scheduler does not stamp a fake "last run"',
      fn.length > 0 && !/last_run_at/.test(fn),
      fn.includes('last_run_at') ? 'scheduleNextRun writes last_run_at' : 'scheduleNextRun not found'
    );
    const append = bodyOf('appendCycle');
    check('a real cycle records last_run_at with its status', append.includes('last_run_at') && append.includes('last_status'));
  }

  if (!NO_ROLLUP) {
    /*
     * The installed GitHub workflow is allowed to run exactly four commands,
     * and `.github/workflows/` cannot be changed from here — so the other test
     * suites are folded into the one entry point CI does run. A green Guardian
     * board therefore really means: SEO anti-fake, browser render contract,
     * SigV4 signing, the mocked cloud round trip and the agent-team wiring all
     * passed too, not just the HTTP checks.
     */
    section('16. Cross-suite rollup (everything CI cannot be told to run)');
    const suites = [
      ['SEO anti-fake self-test', 'scripts/seo-selftest.mjs', []],
      ['render contract + browser pass', 'scripts/browser-e2e.mjs', []],
      ['AWS SigV4 signing vectors', 'scripts/test-sigv4.mjs', []],
      ['D1 + R2 round trip (mocked cloud)', 'scripts/e2e-cloud-test.mjs', []],
      ['agent team wiring', 'scripts/agent-team-check.mjs', []],
      ['zero-survival manager round', 'scripts/zero-survival-manager.mjs', []],
      // The live-route matrix, run against the very server this check booted:
      // it verifies the whole site through the outside HTTP path (headers,
      // noindex, canonical, the admin gate) instead of trusting internal state.
      ['live route matrix (this boot)', 'scripts/render-real-check.mjs', ['--attempts', '2']]
    ];
    for (const [label, script, args] of suites) {
      if (!fs.existsSync(path.join(ROOT, script))) {
        check(`${label}`, false, `${script} is missing`);
        continue;
      }
      const r = runNode(script, args, {
        timeout: 420000,
        env: script.endsWith('render-real-check.mjs') ? { SITE_URL: BASE } : {}
      });
      check(label, r.status === 0, r.status === 0 ? '' : r.tail || `exit ${r.status}`);
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
