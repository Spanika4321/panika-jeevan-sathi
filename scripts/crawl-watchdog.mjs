#!/usr/bin/env node
'use strict';
/**
 * Crawlability watchdog for the Render-hosted services (read-only).
 *
 * WHY THIS EXISTS
 * Search Console reported "New reason preventing your pages from being
 * indexed → Blocked by robots.txt". There are two independent ways this site
 * can serve a blocking robots.txt, and only one of them is in our code:
 *
 *   1. Our own file disallowing a page that renders HTML. A `Disallow` hides
 *      the page's `noindex` meta tag from Google, so the URL comes back as a
 *      blocked discovery instead of an intentional exclusion.
 *      (Fixed in seva-market-india/src/routes/seo.js.)
 *
 *   2. **Render's free plan sleeps after ~15 idle minutes, and while a service
 *      is asleep Render's own "Application loading" interstitial answers every
 *      path — including /robots.txt — with `User-agent: * / Disallow: /`.**
 *      Googlebot that arrives during a sleep window is told the entire site is
 *      off limits, and that is reported exactly like case 1. No code change can
 *      prevent it; only keeping the service awake (or paying for an instance
 *      that never sleeps) can.
 *
 * This script distinguishes the two, because the fix is different: an
 * application bug is a commit, a sleeping host is an owner decision (an
 * external pinger every ≤10 minutes, or Render's paid plan).
 *
 * WHAT IT DOES
 *   • GET /api/v1/health (seva) or /api/health (PJS) first — that is also the
 *     wake-up request, so the robots.txt fetch that follows sees the real app
 *     whenever the service can be woken at all.
 *   • GET /robots.txt and fail if it is Render's interstitial, if it blocks the
 *     whole site, or if it disallows a path that should stay crawlable.
 *   • GET /sitemap.xml and fail if it is not our XML.
 *
 * Zero dependencies (global fetch, Node >= 22.5).
 *
 *   node scripts/crawl-watchdog.mjs                       # both services
 *   node scripts/crawl-watchdog.mjs --url https://a --url https://b
 *   node scripts/crawl-watchdog.mjs --wake-budget 120000  # ms to wait for a cold start
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVICES = [
  { name: 'SEVA MARKET INDIA', url: 'https://seva-market-india-tast.onrender.com', health: '/api/v1/health', robotsMustNotDisallow: ['/login', '/register', '/providers/new', '/verify-email', '/forgot-password', '/reset-password', '/search', '/categories', '/locations', '/about', '/contact', '/privacy', '/terms'] },
  { name: 'PANIKA JEEVAN SATHI', url: 'https://panikajeevansathi.onrender.com', health: '/api/health', robotsMustNotDisallow: ['/admin.html', '/dashboard.html', '/messages.html', '/profile.html'] },
];

/** Render's sleeping-service interstitial: it answers /robots.txt with Disallow: /. */
const RENDER_LOADING_MARKERS = ['Render - Application loading', 'application loading', 'render.com/loading'];

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function optionAll(name) {
  const values = [];
  process.argv.forEach((arg, index) => {
    if (arg === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1]);
  });
  return values;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function get(url, { timeout = 25_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'user-agent': 'crawl-watchdog/1 (+https://github.com/Spanika4321/panika-jeevan-sathi)' } });
    const text = await response.text();
    return { status: response.status, text, contentType: response.headers.get('content-type') || '' };
  } catch (err) {
    return { status: 0, text: '', contentType: '', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Poll the health endpoint until the app (not the interstitial) answers. */
async function wake(base, healthPath, { budget, poll, log }) {
  const deadline = Date.now() + budget;
  for (let attempt = 1; ; attempt += 1) {
    const res = await get(`${base}${healthPath}`);
    const loading = RENDER_LOADING_MARKERS.some((marker) => res.text.includes(marker)) || /<svg/i.test(res.text) && res.contentType.includes('text/html');
    if (res.status === 200 && !loading) return { awake: true, attempts: attempt, ms: budget - (deadline - Date.now()) };
    if (Date.now() >= deadline) return { awake: false, attempts: attempt, status: res.status, loading };
    log(`  wake probe ${attempt}: ${loading ? 'Render loading interstitial' : `HTTP ${res.status}`} — waiting…`);
    await sleep(poll);
  }
}

function check(lines, failures, label, passed, detail = '') {
  lines.push(`${passed ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

async function auditService(service, { wakeBudget, wakePoll, log }) {
  const base = service.url.replace(/\/+$/, '');
  const lines = [];
  const failures = [];
  log(`\n── ${service.name} (${base})`);

  // Two kinds of failure, two different owners:
  //   hostFaults — the platform is answering (free-plan sleep, deploy in
  //                progress). No commit fixes this; it is an owner decision.
  //   appFaults  — our own robots.txt/sitemap is wrong. That is a regression
  //                and must fail the build.
  const hostFaults = [];
  const appFaults = [];
  const into = (bucket) => (label, passed, detail = '') => {
    check(lines, bucket, label, passed, detail);
    if (!passed) failures.push(label);
  };
  const hostCheck = into(hostFaults);
  const appCheck = into(appFaults);

  const woke = await wake(base, service.health, { budget: wakeBudget, poll: wakePoll, log });
  hostCheck('service is awake and answering its own health endpoint', woke.awake,
    woke.awake ? `${woke.attempts} probe(s)` : `still serving Render's loading page after ${woke.attempts} probe(s)`);
  if (!woke.awake) {
    lines.push('⚠️  While it sleeps, Render answers /robots.txt with `Disallow: /`, so Google sees the *whole site* as blocked.');
    lines.push('⚠️  Free-plan sleep cannot be fixed in code: ping this origin every ≤10 minutes from an external uptime service, or move to a paid instance.');
  }

  const robots = await get(`${base}/robots.txt`);
  const isInterstitial = RENDER_LOADING_MARKERS.some((marker) => robots.text.includes(marker)) || (robots.contentType.includes('text/html') && /<svg/i.test(robots.text));
  hostCheck('/robots.txt is served by the app, not by Render\'s loading page', robots.status === 200 && !isInterstitial,
    isInterstitial ? 'got the interstitial (service asleep or deploy in progress)' : `HTTP ${robots.status}, ${robots.contentType || 'no content type'}`);

  if (!isInterstitial && robots.status === 200) {
    // A blanket `Disallow: /` with no `Sitemap:` line is Render's interstitial
    // text (host), not our file; our own blanket block would be a code fault.
    const blanket = /^Disallow:\s*\/\s*$/m.test(robots.text);
    const looksLikeRenderFile = blanket && !/^Sitemap:/m.test(robots.text);
    // Who owns this file? If the app never woke up, or the body is Render's
    // blanket block with no Sitemap line, we are reading the platform's
    // interstitial — not ours — so the finding belongs to the host.
    const hostFile = looksLikeRenderFile || !woke.awake;
    const owner = hostFile ? hostCheck : appCheck;
    owner('robots.txt does not block the whole site', !blanket,
      blanket ? `\`Disallow: /\` — every URL on this origin is off limits to Google${looksLikeRenderFile ? ' (Render interstitial, not our file)' : ''}` : '');
    owner('robots.txt advertises a sitemap', /^Sitemap:\s*\S+/m.test(robots.text), hostFile ? 'not our file to fix' : '');
    const disallowed = [...robots.text.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((match) => match[1]);
    if (blanket) {
      // One finding, not one line per path: a blanket block already covers them.
      lines.push(`⚠️  A blanket Disallow blocks all ${service.robotsMustNotDisallow.length} paths that must stay crawlable; not listed individually.`);
    }
    for (const mustBeCrawlable of blanket ? [] : service.robotsMustNotDisallow) {
      const blocker = disallowed.find((prefix) => mustBeCrawlable.startsWith(prefix));
      owner(`robots.txt keeps ${mustBeCrawlable} crawlable`, !blocker,
        blocker ? `blocked by "Disallow: ${blocker}" — Google cannot read that page's noindex` : '');
    }
    // A sitemap URL that robots.txt blocks is a self-inflicted exclusion.
    const sitemapUrl = (robots.text.match(/^Sitemap:\s*(\S+)/m) || [])[1];
    if (sitemapUrl) {
      owner('the advertised sitemap is on this same origin', sitemapUrl.startsWith(`${base}/`), sitemapUrl);
    }
  }

  const sitemap = await get(`${base}/sitemap.xml`);
  (woke.awake ? appCheck : hostCheck)('/sitemap.xml is our XML document', sitemap.status === 200 && sitemap.text.includes('<urlset'),
    `HTTP ${sitemap.status}${sitemap.contentType ? `, ${sitemap.contentType}` : ''}`);

  for (const line of lines) log(line);
  return { name: service.name, base, failures, lines, hostFaults, appFaults, awake: woke.awake };
}

async function main() {
  const requested = optionAll('url');
  const services = requested.length
    ? requested.map((url) => ({ ...SERVICES.find((known) => known.url.startsWith(url.replace(/\/+$/, ''))) || SERVICES[0], url }))
    : SERVICES;
  const wakeBudget = Number(option('wake-budget', 120_000));
  const wakePoll = Number(option('wake-poll', 15_000));
  const log = (...args) => console.log(...args);

  log('Crawlability watchdog — read-only (GET health, robots.txt, sitemap.xml).');
  const results = [];
  for (const service of services) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await auditService(service, { wakeBudget, wakePoll, log }));
  }

  const failures = results.flatMap((result) => result.failures.map((line) => `${result.name}: ${line}`));
  const appFaults = results.flatMap((result) => result.appFaults.map((line) => `${result.name}: ${line}`));
  const asleep = results.filter((result) => !result.awake).map((result) => result.name);

  log('\n────────────────────────────────────────');
  if (failures.length === 0) {
    log(`VERDICT: PASS — ${results.length} service(s) crawlable, robots.txt serves the app's own file.`);
    log('CRAWL-VERDICT: PASS');
    return 0;
  }
  log(`VERDICT: FAIL — ${failures.length} problem(s):`);
  for (const line of failures) log(`  • ${line}`);

  // The machine-readable line CI acts on. APP-BLOCKED means our own file is
  // wrong (a regression — the build must fail). HOST-ASLEEP means the platform
  // answered instead of the app (free-plan sleep or a deploy in progress): no
  // commit can fix that, so it is reported as an owner warning instead of
  // turning the watchdog permanently red.
  if (appFaults.length > 0) {
    log(`CRAWL-VERDICT: APP-BLOCKED — ${appFaults.length} fault(s) in our own robots.txt/sitemap; fix the code.`);
    for (const line of appFaults) log(`  • ${line}`);
  } else {
    log(`CRAWL-VERDICT: HOST-ASLEEP — ${asleep.join(', ') || 'a service'} was not serving its own files.`);
    log('Keep the origin awake (an external pinger every ≤10 minutes) or move it off Render\'s free plan; then re-run.');
  }
  log('\nEither way this is what Search Console reports as "Blocked by robots.txt".');
  return 1;
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 1; });
}

export { main, auditService, RENDER_LOADING_MARKERS, SERVICES };
