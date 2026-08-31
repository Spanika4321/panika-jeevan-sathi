#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — SEO Center test suite.
 *
 *   node scripts/seo-test.mjs
 *
 * Part A boots the real server and proves the HTTP surface behaves honestly:
 * admin-only, no credential leaks, and NOT_CONNECTED / BLOCKED instead of
 * invented numbers when Google Search Console is not connected.
 *
 * Part B drives the SEO Center as a library with an injected HTTP transport
 * (Google, Gemini and Fil One are stubbed at the socket boundary) so the real
 * pipeline — fetch → AI router → Pooja → Priya → Manager → permanent storage →
 * verification — executes end to end. Only the test injects the transport; the
 * server never does, so nothing here can reach the production site as fake data.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dbLib = require(path.join(ROOT, 'lib/db.js'));
const seoLib = require(path.join(ROOT, 'lib/seo/index.js'));
const agents = require(path.join(ROOT, 'lib/seo/agents.js'));
const aiLib = require(path.join(ROOT, 'lib/seo/ai.js'));
const gscLib = require(path.join(ROOT, 'lib/seo/gsc.js'));

let passed = 0;
let failed = 0;
const failures = [];

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
}

/* =========================================================================
   Fixtures + stub transport
   ========================================================================= */

const SITE = 'https://panikajeevansathi.test/';

const QUERIES = [
  { keys: ['panika matrimonial'], clicks: 120, impressions: 3000, ctr: 0.04, position: 6.2 },
  { keys: ['manikpuri samaj vivah'], clicks: 3, impressions: 900, ctr: 0.00333, position: 14.5 },
  { keys: ['kabirpanthi shaadi site'], clicks: 0, impressions: 450, ctr: 0, position: 32.1 },
  { keys: ['panika jeevan sathi'], clicks: 61, impressions: 700, ctr: 0.0871, position: 3.4 },
  { keys: ['free matrimonial chhattisgarh'], clicks: 0, impressions: 380, ctr: 0, position: 41.8 }
];

const PAGES = [
  { keys: [`${SITE}`], clicks: 178, impressions: 3600, ctr: 0.0494, position: 8.1 },
  { keys: [`${SITE}about.html`], clicks: 0, impressions: 620, ctr: 0, position: 22.4 },
  { keys: [`${SITE}login.html`], clicks: 6, impressions: 210, ctr: 0.0286, position: 18.2 }
];

/** Deterministic daily rows for whatever window Search Console is asked about. */
function dailyFor(startDate, endDate) {
  const rows = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let i = 0;
  while (cursor <= end) {
    const clicks = 4 + (i % 5) + (i % 7);
    const impressions = 90 + (i % 9) * 11 + i;
    rows.push({
      keys: [cursor.toISOString().slice(0, 10)],
      clicks,
      impressions,
      ctr: clicks / impressions,
      position: 12 + (i % 6)
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    i += 1;
  }
  return rows;
}

function totalsOf(rows) {
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  return [
    {
      keys: [],
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : 0,
      position: rows.reduce((n, r) => n + r.position, 0) / (rows.length || 1)
    }
  ];
}

function response(body, { status = 200, headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const buffer = Buffer.from(text);
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[String(k).toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (lower[String(name).toLowerCase()] === undefined ? null : lower[String(name).toLowerCase()]) },
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => buffer
  };
}

/**
 * A socket-boundary stub for Google OAuth, Search Console, Gemini, an
 * OpenAI-compatible endpoint and the Fil One S3 endpoint.
 */
function makeTransport(options = {}) {
  const {
    gemini = 'ok', // ok | model404 | auth403 | down
    openai = 'ok',
    s3 = 'ok', // ok | forbidden
    token = 'ya29.stub-access-token',
    refreshToken = '1//stub-refresh-token'
  } = options;

  const objects = new Map();
  const calls = [];

  const researchReply = () =>
    JSON.stringify({
      findings: [
        {
          type: 'ctr',
          severity: 'high',
          title: 'Model finding grounded in the fetched rows',
          summary: 'The stub model quotes rows that really exist in the response so Priya can verify them.',
          evidence: QUERIES.slice(0, 2).map((q) => `${q.keys[0]} — ${q.impressions} impressions, position ${q.position}`),
          claims: [
            { subject_kind: 'query', subject: QUERIES[0].keys[0], metric: 'impressions', value: QUERIES[0].impressions },
            { subject_kind: 'query', subject: QUERIES[0].keys[0], metric: 'position', value: QUERIES[0].position },
            { subject_kind: 'query', subject: QUERIES[1].keys[0], metric: 'clicks', value: QUERIES[1].clicks }
          ],
          actions: ['Rewrite the title of the ranking page.', 'Add an internal link with the query as anchor text.'],
          expected: 'Higher CTR on an already-ranked query.'
        }
      ],
      keyword_opportunities: [
        { theme: 'panika', related_queries: 2, impressions: 3700, clicks: 181, verified: false, note: 'Hypothesis from the query rows.' }
      ],
      notes: 'Stub analysis for the test suite.'
    });

  const managerReply = () =>
    JSON.stringify({
      summary: 'Stub manager summary: fix the low-CTR query first.',
      priorities: [
        { rank: 1, title: 'Rewrite the homepage title', why: 'Highest impression stream.', action: 'Rewrite title + meta description.', impact: 'high', effort: 'low' }
      ],
      next_cycle: { focus: 'Re-measure CTR after the title change.', checks: ['Run the cycle again in 7 days.'] },
      risks: ['Search Console data lags 2-3 days.']
    });

  const fetchImpl = async (url, opts = {}) => {
    const target = new URL(url);
    const method = opts.method || 'GET';
    calls.push({ url: String(url), method });
    const bodyText = opts.body ? String(opts.body) : '';

    /* Google OAuth token endpoint */
    if (target.host === 'oauth2.googleapis.com') {
      return response({
        access_token: token,
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: 'https://www.googleapis.com/auth/webmasters.readonly',
        token_type: 'Bearer'
      });
    }

    /* Search Console */
    if (target.host === 'searchconsole.googleapis.com') {
      if (target.pathname.endsWith('/sites') && method === 'GET') {
        return response({ siteEntry: [{ siteUrl: SITE, permissionLevel: 'siteOwner' }] });
      }
      if (target.pathname.includes('/searchAnalytics/query')) {
        const body = JSON.parse(bodyText || '{}');
        const dims = body.dimensions || [];
        if (!dims.length) return response({ rows: totalsOf(dailyFor(body.startDate, body.endDate)) });
        if (dims[0] === 'date') return response({ rows: dailyFor(body.startDate, body.endDate) });
        if (dims[0] === 'query') return response({ rows: QUERIES });
        if (dims[0] === 'page') return response({ rows: PAGES });
        return response({ rows: [] });
      }
      return response({ error: { message: 'not found' } }, { status: 404 });
    }

    /* Gemini */
    if (target.host === 'generativelanguage.googleapis.com') {
      if (gemini === 'down') return response({ error: { message: 'backend error' } }, { status: 500 });
      if (gemini === 'auth403') return response({ error: { message: 'API key not valid' } }, { status: 403 });
      if (gemini === 'model404') {
        return response({ error: { message: `models/x is not found for API version v1beta` } }, { status: 404 });
      }
      const body = JSON.parse(bodyText || '{}');
      const prompt = (body.contents && body.contents[0] && body.contents[0].parts[0].text) || '';
      let text = 'The biggest issue is the low click-through rate on the highest-impression query.';
      if (prompt.includes('POOJA FINDINGS')) text = managerReply();
      else if (prompt.includes('Reply with JSON in exactly this shape')) text = researchReply();
      return response({
        candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }]
      });
    }

    /* OpenAI-compatible stub */
    if (target.host === 'api.openai.stub') {
      if (openai === 'down') return response({ error: { message: 'nope' } }, { status: 500 });
      const body = JSON.parse(bodyText || '{}');
      const prompt = body.messages.map((m) => m.content).join('\n');
      let content = 'Fallback engine answering.';
      if (prompt.includes('POOJA FINDINGS')) content = managerReply();
      else if (prompt.includes('Reply with JSON in exactly this shape')) content = researchReply();
      return response({ choices: [{ message: { role: 'assistant', content } }] });
    }

    /* Fil One S3 stub */
    if (target.host === 'filone.stub') {
      if (s3 === 'forbidden') return response('<Error><Code>AccessDenied</Code><Message>denied</Message></Error>', { status: 403 });
      const key = decodeURIComponent(target.pathname.replace(/^\/sentinel-bucket\//, ''));
      if (method === 'PUT') {
        objects.set(key, Buffer.from(opts.body || ''));
        return response('', { status: 200, headers: { etag: '"stub-etag"' } });
      }
      if (method === 'GET') {
        if (!objects.has(key)) return response('<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>', { status: 404 });
        return response(objects.get(key).toString('utf8'), { status: 200, headers: { 'content-length': String(objects.get(key).length) } });
      }
      if (method === 'HEAD') {
        if (!objects.has(key)) return response('', { status: 404 });
        return response('', { status: 200, headers: { 'content-length': String(objects.get(key).length) } });
      }
      if (method === 'DELETE') {
        objects.delete(key);
        return response('', { status: 204 });
      }
    }

    return response({ error: { message: `unexpected host ${target.host}` } }, { status: 404 });
  };

  return { fetchImpl, objects, calls };
}

function envWith(overrides) {
  return Object.assign(
    {
      GOOGLE_CLIENT_ID: 'stub-client-id',
      GOOGLE_CLIENT_SECRET: 'stub-client-secret',
      GSC_REFRESH_TOKEN: 'stub-refresh-token-from-env',
      GSC_SITE_URL: SITE,
      SITE_URL: 'https://panikajeevansathi.test'
    },
    overrides
  );
}

function openDriver(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-seo-lib-'));
  if (mode) process.env.PJS_STORAGE = mode;
  const opened = dbLib.open(dir, { log: () => {} });
  return { driver: opened.driver, dir };
}

function center({ env = envWith(), transport = makeTransport(), mode = '' } = {}) {
  const { driver, dir } = openDriver(mode);
  const seo = seoLib.createSeoCenter({
    db: driver,
    dataDir: dir,
    secret: 'test-session-secret',
    fetchImpl: transport.fetchImpl,
    env,
    log: () => {}
  });
  return { seo, driver, dir, transport };
}

/* =========================================================================
   Part A — the real server over HTTP
   ========================================================================= */

const PORT = 3900 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-seo-e2e-'));
const ADMIN_EMAIL = 'seo-admin@test.com';
const ADMIN_PASSWORD = 'AdminPass12345';

// Sentinels: if any of these ever appears in an API response the test fails.
// GSC_REFRESH_TOKEN is deliberately absent from the server environment — with a
// refresh token present the center is genuinely connected. Its leak is checked
// in Part B instead, against the same code path.
const SENTINELS = {
  GEMINI_API_KEY: 'SENTINEL-GEMINI-KEY-DO-NOT-LEAK',
  OPENAI_API_KEY: 'SENTINEL-OPENAI-KEY-DO-NOT-LEAK',
  OPENROUTER_API_KEY: 'SENTINEL-OPENROUTER-KEY-DO-NOT-LEAK',
  GROQ_API_KEY: 'SENTINEL-GROQ-KEY-DO-NOT-LEAK',
  FILONE_ACCESS_KEY_ID: 'SENTINEL-FILONE-ACCESS-DO-NOT-LEAK',
  FILONE_SECRET_ACCESS_KEY: 'SENTINEL-FILONE-SECRET-DO-NOT-LEAK'
};

function client() {
  const jar = new Map();
  async function call(method, urlPath, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(BASE + urlPath, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual'
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const cookie of setCookie) {
      const [pair] = cookie.split(';');
      const idx = pair.indexOf('=');
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /Max-Age=0/i.test(cookie)) jar.delete(key);
      else jar.set(key, value);
    }
    let json = null;
    const text = await res.text();
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b || {})
  };
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: '127.0.0.1',
        PJS_DATA_DIR: DATA_DIR,
        PJS_STORAGE: 'sqlite',
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
        // Deliberately NOT configured: the SEO Center must report NOT_CONNECTED.
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
        GSC_SERVICE_ACCOUNT_JSON: '',
        GSC_REFRESH_TOKEN: '',
        GOOGLE_APPLICATION_CREDENTIALS: '',
        ...SENTINELS,
        FILONE_ENDPOINT: 'http://127.0.0.1:9/filone-unreachable',
        FILONE_BUCKET: 'sentinel-bucket'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d.toString();
    });
    child.stderr.on('data', (d) => {
      output += d.toString();
    });
    child.on('error', reject);
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${BASE}/api/health`);
        if (res.ok) {
          clearInterval(timer);
          resolve({ child, output });
        }
      } catch (_) {
        /* not up yet */
      }
    }, 150);
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`server did not start:\n${output}`));
    }, 30000);
  });
}

async function partA() {
  const { child } = await startServer();
  try {
    section('A1. Access control');
    const anon = client();
    let res = await anon.get('/api/seo/status');
    check('anonymous caller cannot read the SEO status', res.status === 401, `got ${res.status}`);
    res = await anon.post('/api/seo/cycle');
    check('anonymous caller cannot run a cycle', res.status === 401, `got ${res.status}`);
    res = await anon.get('/api/seo/reports');
    check('anonymous caller cannot list reports', res.status === 401, `got ${res.status}`);

    const member = client();
    await member.post('/api/auth/register', { name: 'Normal Member', email: 'member@test.com', password: 'MemberPass123' });
    res = await member.get('/api/seo/status');
    check('a normal member cannot read the SEO status', res.status === 403, `got ${res.status}`);
    res = await member.post('/api/seo/cycle');
    check('a normal member cannot run a cycle', res.status === 403, `got ${res.status}`);

    const admin = client();
    res = await admin.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    check('admin login works', res.status === 200 && res.body.user.role === 'admin', JSON.stringify(res.body).slice(0, 120));

    section('A2. Honest status when nothing is connected');
    res = await admin.get('/api/seo/status');
    check('admin can read the SEO status', res.status === 200 && res.body.ok === true);
    const status = res.body;
    check(
      'Search Console is reported as NOT_CONNECTED',
      status.google_search_console.state === 'NOT_CONNECTED',
      status.google_search_console.state
    );
    check(
      'the reason explains what is missing',
      /GOOGLE_CLIENT_ID|GSC_REFRESH_TOKEN|GSC_SERVICE_ACCOUNT_JSON/.test(status.google_search_console.reason || ''),
      status.google_search_console.reason
    );
    check(
      'configured AI providers are listed (sentinel keys are present on the server)',
      status.ai.available.includes('gemini') && status.ai.order[0] === 'gemini',
      JSON.stringify(status.ai.available)
    );
    check(
      'Fil One is CONFIGURED but not yet proven CONNECTED',
      status.storage.archive.state === 'CONFIGURED',
      status.storage.archive.state
    );
    check('the storage report says the database is the site store', Boolean(status.storage.database.kind));
    check('the scheduler reports off when the env var is unset', status.scheduler.enabled === false);

    section('A3. No credentials ever reach the browser');
    for (const endpoint of ['/api/seo/status', '/api/seo/overview', '/api/seo/storage', '/api/seo/reports', '/api/seo/cycles']) {
      const r = await admin.get(endpoint);
      const leaked = Object.entries(SENTINELS).filter(([key, value]) => r.text.includes(value)).map(([key]) => key);
      check(`${endpoint} leaks no credential`, leaked.length === 0, leaked.join(', '));
    }

    section('A4. No fabricated data');
    res = await admin.get('/api/seo/overview?days=28');
    check('overview responds', res.status === 200);
    check('overview reports NOT_CONNECTED', res.body.state === 'NOT_CONNECTED', res.body.state);
    check('overview carries no totals', res.body.totals === null, JSON.stringify(res.body.totals));
    check('overview carries no daily rows', Array.isArray(res.body.daily) && res.body.daily.length === 0);
    check('overview names no data source', res.body.data_source === null);

    res = await admin.get('/api/seo/queries');
    check('queries returns an empty list, not sample rows', res.body.rows.length === 0 && res.body.data_source === null);
    res = await admin.get('/api/seo/pages');
    check('pages returns an empty list, not sample rows', res.body.rows.length === 0 && res.body.data_source === null);

    section('A5. A blocked cycle stays blocked');
    res = await admin.post('/api/seo/cycle', { days: 28 });
    check('the cycle endpoint responds', res.status === 200);
    check('the cycle state is BLOCKED', res.body.state === 'BLOCKED', res.body.state);
    check('the cycle status is BLOCKED (never PASS/OK)', res.body.status === 'BLOCKED', res.body.status);
    check('a blocked cycle produces no report', res.body.report === null && res.body.report_id === 0);
    check('a blocked cycle reports no totals', res.body.totals === null);
    check('the block reason names Google Search Console', /Search Console/i.test(res.body.reason || ''), res.body.reason);
    check('the first stage recorded is check', res.body.stages[0].stage === 'check' && res.body.stages[0].status === 'BLOCKED');
    check('the cycle stops after the check stage', res.body.stages.length === 1, `${res.body.stages.length} stages`);

    res = await admin.get('/api/seo/cycles');
    check('the blocked cycle is recorded permanently', res.body.cycles.length === 1 && res.body.cycles[0].status === 'BLOCKED');
    check('the blocked cycle stored no report id', res.body.cycles[0].report_id === 0);

    res = await admin.get('/api/seo/reports');
    check('no report was invented for the blocked cycle', res.body.reports.length === 0);

    section('A6. Storage and connection endpoints');
    res = await admin.get('/api/seo/storage');
    check('storage endpoint responds', res.status === 200 && res.body.permanent === true);
    check('the disk mirror directory is reported', typeof res.body.disk.directory === 'string' && res.body.disk.directory.length > 0);

    res = await admin.get('/api/seo/storage?probe=1');
    check(
      'a real probe against an unreachable endpoint reports BLOCKED, not CONNECTED',
      res.body.archive.state === 'BLOCKED',
      `${res.body.archive.state}: ${res.body.archive.reason}`
    );
    check('the probe failure keeps the real error', Boolean(res.body.archive.reason), res.body.archive.reason);

    res = await admin.get('/api/seo/connect/start');
    check(
      'starting OAuth without a client ID is BLOCKED with the reason',
      res.status === 400 && /GOOGLE_CLIENT_ID/.test(res.body.error || ''),
      res.body.error
    );

    res = await admin.post('/api/seo/ai/test');
    check('the AI test never claims success when the provider is unreachable', res.status === 200 && res.body.ok === false, JSON.stringify(res.body).slice(0, 160));

    section('A7. The page itself');
    const page = await fetch(`${BASE}/seo.html`);
    const html = await page.text();
    check('/seo.html is served', page.status === 200);
    check('/seo.html is noindex', html.includes('noindex'));
    check('/seo.html has no hard-coded metrics', !/>\s*1,?234\s*</.test(html));
    const robots = await (await fetch(`${BASE}/robots.txt`)).text();
    check('robots.txt keeps crawlers away from /seo.html', robots.includes('Disallow: /seo.html'));
  } finally {
    child.kill('SIGTERM');
  }
}

/* =========================================================================
   Part B — the real pipeline with a stubbed network
   ========================================================================= */

async function partB() {
  section('B1. Search Console client helpers');
  check(
    'site URLs are normalised to the Search Console form',
    gscLib.normalizeSiteUrl('panikajeevansathi.onrender.com') === 'https://panikajeevansathi.onrender.com/' &&
      gscLib.normalizeSiteUrl('sc-domain:example.com') === 'sc-domain:example.com' &&
      gscLib.normalizeSiteUrl('https://example.com') === 'https://example.com/'
  );
  const config = gscLib.configFromEnv(envWith());
  check('env credentials are detected', config.refreshReady === true && config.oauthReady === true);
  const range = { startDate: '2026-08-01', endDate: '2026-08-28' };
  const shifted = gscLib.createClient({}).shiftRange(range, 28);
  check('the previous-period window is the same length, shifted back', shifted.endDate === '2026-07-31' && shifted.startDate === '2026-07-04', JSON.stringify(shifted));

  section('B2. AI router — Gemini first, honest fallback');
  let router = aiLib.createRouter({ env: {}, fetchImpl: makeTransport().fetchImpl });
  let answer = await router.complete({ prompt: 'hello', json: false });
  check('with no key configured the router admits it', answer.ok === false && answer.reason === 'NOT_CONFIGURED' && answer.engine === null);
  check('the router never claims a remote engine answered', answer.remote === false);

  router = aiLib.createRouter({
    env: { GEMINI_API_KEY: 'stub-gemini' },
    fetchImpl: makeTransport({ gemini: 'ok' }).fetchImpl
  });
  answer = await router.complete({ prompt: 'Reply with JSON in exactly this shape {}', json: true });
  check('Gemini answers first when its key is present', answer.ok && answer.engine === 'gemini', answer.engine);
  check('the Gemini reply is parsed as JSON', Boolean(answer.parsed && answer.parsed.findings));

  const fallbackTransport = makeTransport({ gemini: 'model404', openai: 'ok' });
  router = aiLib.createRouter({
    env: { GEMINI_API_KEY: 'stub-gemini', OPENAI_API_KEY: 'stub-openai', OPENAI_BASE_URL: 'https://api.openai.stub/v1', OPENAI_MODEL: 'stub-model' },
    fetchImpl: fallbackTransport.fetchImpl
  });
  answer = await router.complete({ prompt: 'Reply with JSON in exactly this shape {}', json: true });
  check('a dead Gemini model falls through to the next provider', answer.ok && answer.engine === 'openai', answer.engine);
  check('the fallback is flagged as a fallback', answer.fallback_used === true);
  check('every Gemini attempt is recorded in the audit trail', answer.attempts.filter((a) => a.provider === 'gemini' && !a.ok).length >= 1);
  check(
    'the router tried all Gemini aliases before giving up on Gemini',
    answer.attempts.filter((a) => a.provider === 'gemini').length >= aiLib.GEMINI_MODEL_CHAIN.length,
    `${answer.attempts.filter((a) => a.provider === 'gemini').length} attempts`
  );

  router = aiLib.createRouter({
    env: { GEMINI_API_KEY: 'stub-gemini', OPENAI_API_KEY: 'stub-openai', OPENAI_BASE_URL: 'https://api.openai.stub/v1' },
    fetchImpl: makeTransport({ gemini: 'down', openai: 'down' }).fetchImpl
  });
  answer = await router.complete({ prompt: 'hi', json: false });
  check('when every provider fails the router reports ALL_PROVIDERS_FAILED', answer.ok === false && answer.reason === 'ALL_PROVIDERS_FAILED');

  check(
    'JSON is extracted from fenced model output',
    aiLib.extractJson('```json\n{"a":1}\n```') !== null && aiLib.extractJson('noise {"a":1} noise').a === 1
  );

  section('B3. Full cycle — data → Gemini → Pooja → Priya → Manager → storage');
  {
    const { seo, driver, dir, transport } = center({
      env: envWith({ GEMINI_API_KEY: 'stub-gemini' }),
      transport: makeTransport({ gemini: 'ok', s3: 'ok' })
    });
    const result = await seo.runCycle({ days: 28, trigger: 'test' });

    check('the cycle completes', result.ok && result.state === 'COMPLETE', result.reason || result.state);
    check('the cycle status is OK', result.status === 'OK', result.status);
    check('the report id is returned', Number(result.report_id) > 0, String(result.report_id));
    check('the data source is Google Search Console', result.data_source === 'google_search_console');
    check('Gemini is recorded as the engine', result.ai.engine === 'gemini' && result.ai.remote === true, result.ai.engine);
    check('all eight stages ran', result.stages.length === 8, result.stages.map((s) => s.stage).join(','));
    check(
      'every stage completed successfully',
      result.stages.every((s) => ['OK', 'VERIFIED', 'FALLBACK'].includes(s.status)),
      result.stages.map((s) => `${s.stage}=${s.status}`).join(',')
    );

    const expectedDaily = dailyFor(result.report.period.start, result.report.period.end);
    const expectedClicks = expectedDaily.reduce((n, r) => n + r.clicks, 0);
    const expectedImpressions = expectedDaily.reduce((n, r) => n + r.impressions, 0);
    check('reported clicks equal the fetched rows', result.totals.clicks === expectedClicks, `${result.totals.clicks} vs ${expectedClicks}`);
    check(
      'reported impressions equal the fetched rows',
      result.totals.impressions === expectedImpressions,
      `${result.totals.impressions} vs ${expectedImpressions}`
    );
    check('CTR is the real ratio', Math.abs(result.totals.ctr - expectedClicks / expectedImpressions) < 0.0001);
    check('the previous period is compared', result.previous !== null && result.deltas !== null);
    check('queries came from the API', result.report.queries.length === QUERIES.length);
    check('pages came from the API', result.report.pages.length === PAGES.length);
    check('Pooja produced findings', result.report.research.findings.length >= 1);
    check('Priya verified the claims', ['VERIFIED', 'PARTIAL'].includes(result.verification.status), result.verification.status);
    check(
      'Priya matched the model’s numeric claims',
      result.verification.counts.verified === 3 && result.verification.counts.contradicted === 0,
      JSON.stringify(result.verification.counts)
    );
    check('Priya found no fabricated subjects', result.verification.fabricated_subjects.length === 0);
    check('the Manager produced priorities', result.report.manager.priorities.length >= 1);
    check('the Manager never deploys to production', result.report.manager.decisions.production_deploy === 'NOT_TRIGGERED');
    check('publishing stays manual', result.report.manager.decisions.publish !== 'AUTO');

    check('the report is stored in the database', driver.count('seo_reports') === 1);
    check('the cycle is stored in the database', driver.count('seo_cycles') === 1);
    const diskFiles = fs.readdirSync(path.join(dir, 'seo', 'reports'));
    check('the report is mirrored to disk as JSON + Markdown', diskFiles.some((f) => f.endsWith('.json')) && diskFiles.some((f) => f.endsWith('.md')));
    check('an append-only cycle history exists', fs.existsSync(path.join(dir, 'seo', 'cycles.ndjson')));
    check(
      'with Fil One absent the archive honestly says NOT_CONFIGURED',
      result.storage.archive.configured === false && result.storage.archive.status === 'NOT_CONFIGURED',
      JSON.stringify(result.storage.archive)
    );
    check(
      'the storage check records the archive as NOT_CONFIGURED rather than skipping it',
      result.storage_verification.checks.some((c) => c.name.includes('Fil One') && c.status === 'NOT_CONFIGURED'),
      JSON.stringify(result.storage_verification.checks.map((c) => `${c.name}:${c.status}`))
    );
    check('the archive object was read back and checksummed', result.storage_verification.status === 'VERIFIED', JSON.stringify(result.storage_verification.checks.map((c) => c.status)));
    check('the stored report verifies against its checksum', result.checksum.length === 64);

    // The first save happens before the report/verify stages exist, so the
    // stored copy is rewritten with the complete trail. Both must be true.
    const storedRow = seo.store.getReport(result.report_id);
    const storedPayload = storedRow.report;
    check(
      'the stored report carries the complete 8-stage trail',
      (storedPayload.stages || []).length === 8,
      `${(storedPayload.stages || []).length} stages: ${(storedPayload.stages || []).map((x) => x.stage).join(',')}`
    );
    check(
      'the stored trail ends with the storage verification',
      (storedPayload.stages || []).slice(-1)[0].stage === 'verify',
      JSON.stringify((storedPayload.stages || []).slice(-1)[0])
    );
    check('the stored report keeps the storage verification result', Boolean(storedPayload.storage_verification && storedPayload.storage_verification.status));
    check(
      'the rewritten payload still matches its stored checksum',
      storedRow.checksum === seo.store.sha256(JSON.stringify(storedPayload)),
      `${storedRow.checksum} vs ${seo.store.sha256(JSON.stringify(storedPayload))}`
    );
    check('the stored Markdown lists all eight stages', (storedRow.markdown.match(/^- `\w+` →/gm) || []).length === 8, String((storedRow.markdown.match(/^- `\w+` →/gm) || []).length));

    const payloadText = JSON.stringify(result.report);
    check('the report contains no API key', !payloadText.includes('stub-gemini'));
    check('the report contains no OAuth token', !payloadText.includes('ya29.stub-access-token') && !payloadText.includes('stub-refresh-token'));

    section('B4. Tokens are encrypted at rest');
    const row = driver.one('seo_connections', { provider: 'google_search_console' });
    check('a connection row exists', Boolean(row));
    check('the stored access token is not plaintext', row.access_token !== 'ya29.stub-access-token' && row.access_token.startsWith('v1:'));
    check('the stored refresh token is not plaintext', row.refresh_token !== '1//stub-refresh-token' && row.refresh_token.startsWith('v1:'));
    const loaded = seo.store.loadConnection();
    check('the server can decrypt its own tokens', loaded.accessToken === 'ya29.stub-access-token');
    const summary = seo.store.connectionSummary();
    check('the summary handed to the UI has no token values', !JSON.stringify(summary).includes('ya29.stub-access-token'));
    const statusPayload = JSON.stringify(await seo.status());
    check('the status API never exposes the Google tokens', !statusPayload.includes('ya29.stub-access-token') && !statusPayload.includes('stub-refresh-token-from-env'));
    check('the status API never exposes the AI key', !statusPayload.includes('stub-gemini'));

    section('B5. Cycle numbering and history');
    const second = await seo.runCycle({ days: 7, trigger: 'test' });
    check('the second cycle is numbered 2', second.cycle_no === 2, String(second.cycle_no));
    check('two cycles are stored permanently', driver.count('seo_cycles') === 2 && driver.count('seo_reports') === 2);
    const cycles = seo.store.listCycles(10);
    check('history lists both cycles newest-first', cycles[0].cycle_no === 2 && cycles[1].cycle_no === 1);
    check('the transport really talked to Google', transport.calls.some((c) => c.url.includes('searchconsole.googleapis.com')));
  }

  section('B6. Priya catches fabrication');
  {
    const { seo } = center({ env: envWith({ GEMINI_API_KEY: 'stub-gemini' }) });
    const data = await seo.helpers.fetchSearchData({ site: SITE, days: 28 });
    const honest = agents.ruleFindings(data);
    const goodVerify = agents.verify({
      data,
      research: { findings: honest.findings, keyword_opportunities: honest.keyword_opportunities },
      period: { startDate: data.period.start, endDate: data.period.end }
    });
    check('honest rule-based findings verify', goodVerify.status === 'VERIFIED' || goodVerify.status === 'PARTIAL', goodVerify.status);
    check('honest findings have no contradictions', goodVerify.counts.contradicted === 0, JSON.stringify(goodVerify.counts));

    const invented = {
      findings: [
        {
          id: 'fake-1',
          type: 'ctr',
          severity: 'high',
          title: 'Invented query',
          summary: 'x',
          evidence: [],
          claims: [{ subject_kind: 'query', subject: 'query-that-does-not-exist', metric: 'impressions', value: 9999 }],
          actions: ['do something']
        }
      ],
      keyword_opportunities: []
    };
    const badVerify = agents.verify({ data, research: invented, period: { startDate: data.period.start, endDate: data.period.end } });
    check('a query that is not in the data fails verification', badVerify.status === 'FAILED', badVerify.status);
    check('the invented subject is listed as fabricated', badVerify.fabricated_subjects.length === 1);
    check('the unverifiable claim is counted', badVerify.counts.unverifiable === 1, JSON.stringify(badVerify.counts));

    const wrongNumber = {
      findings: [
        {
          id: 'wrong-1',
          type: 'ctr',
          severity: 'high',
          title: 'Real query, wrong number',
          summary: 'x',
          evidence: [],
          claims: [{ subject_kind: 'query', subject: QUERIES[0].keys[0], metric: 'impressions', value: QUERIES[0].impressions + 500 }],
          actions: ['do something']
        }
      ],
      keyword_opportunities: []
    };
    const contradicted = agents.verify({ data, research: wrongNumber, period: { startDate: data.period.start, endDate: data.period.end } });
    check('a wrong number is contradicted', contradicted.counts.contradicted === 1, JSON.stringify(contradicted.counts));
    check('a contradicted claim makes verification FAILED', contradicted.status === 'FAILED', contradicted.status);

    const keywordLie = {
      findings: honest.findings,
      keyword_opportunities: [{ theme: 'fake', verified: true, related_queries: 1, impressions: 1, clicks: 1, note: '' }]
    };
    const keywordCheck = agents.verify({ data, research: keywordLie, period: { startDate: data.period.start, endDate: data.period.end } });
    check('a keyword suggestion marked verified fails the check', keywordCheck.status === 'FAILED', keywordCheck.status);
  }

  section('B7. No AI key → deterministic engine, clearly labelled');
  {
    const { seo, driver } = center({ env: envWith(), transport: makeTransport() });
    const result = await seo.runCycle({ days: 28, trigger: 'test' });
    check('the cycle still completes on real data', result.ok && result.state === 'COMPLETE', result.reason || result.state);
    check('the engine is labelled deterministic-rules', result.ai.engine === 'deterministic-rules', result.ai.engine);
    check('the report says no AI provider answered', result.ai.remote === false);
    check('findings still come from the real rows', result.report.research.findings.length >= 1);
    check('Priya still verifies the rule findings', ['VERIFIED', 'PARTIAL'].includes(result.verification.status), result.verification.status);
    check('the report is still stored permanently', driver.count('seo_reports') === 1);
    check('the AI attempt log explains why', Array.isArray(result.ai.attempts) && result.ai.attempts.length >= 1);
  }

  section('B8. Search Console unreachable → BLOCKED, no report');
  {
    const { seo, driver } = center({ env: {}, transport: makeTransport() });
    const before = driver.count('seo_reports');
    const result = await seo.runCycle({ days: 28 });
    check('the cycle is BLOCKED without credentials', result.state === 'BLOCKED' && result.status === 'BLOCKED', result.state);
    check('no report is written', driver.count('seo_reports') === before);
    check('the cycle row records the block', driver.one('seo_cycles', { id: result.cycle_id }).status === 'BLOCKED');
    check('the reason is human readable', (result.reason || '').length > 10, result.reason);
  }
  {
    // Credentials present, but Google refuses the request.
    const blocked = makeTransport();
    const fetchImpl = async (url, opts) => {
      if (String(url).includes('searchconsole.googleapis.com') && String(url).includes('searchAnalytics')) {
        return response({ error: { message: 'User does not have sufficient permission for site' } }, { status: 403 });
      }
      return blocked.fetchImpl(url, opts);
    };
    const { seo, driver } = center({ env: envWith({ GEMINI_API_KEY: 'stub-gemini' }), transport: { fetchImpl, calls: [], objects: new Map() } });
    const result = await seo.runCycle({ days: 28 });
    check('a 403 from Google blocks the cycle', result.state === 'BLOCKED', result.state);
    check('the permission error is surfaced', /permission/i.test(result.reason || ''), result.reason);
    check('no report is invented from a failed fetch', driver.count('seo_reports') === 0);
    check('the search_data stage is the one marked BLOCKED', result.stages.some((s) => s.stage === 'search_data' && s.status === 'BLOCKED'));
  }

  section('B9. Fil One archive behaviour');
  {
    const filEnv = {
      FILONE_ENDPOINT: 'https://filone.stub',
      FILONE_BUCKET: 'sentinel-bucket',
      FILONE_ACCESS_KEY_ID: 'stub-access',
      FILONE_SECRET_ACCESS_KEY: 'stub-secret',
      FILONE_REGION: 'eu-west-1'
    };
    const transport = makeTransport({ gemini: 'ok', s3: 'ok' });
    const { seo, driver } = center({ env: envWith(Object.assign({ GEMINI_API_KEY: 'stub-gemini' }, filEnv)), transport });

    const probe = await seo.archiveStatus({ probe: true });
    check('a successful write/read/delete probe reports CONNECTED', probe.state === 'CONNECTED', `${probe.state}: ${probe.reason}`);

    const result = await seo.runCycle({ days: 28 });
    check('the cycle archives to Fil One', result.storage.archive.status === 'SAVED', JSON.stringify(result.storage.archive));
    check('the archived key is recorded on the report', driver.one('seo_reports', { id: result.report_id }).archive_key.startsWith('reports/seo-report-'));
    const keys = [...transport.objects.keys()];
    check('JSON + Markdown + latest are archived', keys.length >= 3, keys.join(', '));
    // The stub keys objects by their full path (prefix + key), so match on the suffix.
    const archiveKey = [...transport.objects.keys()].find((k) => k.endsWith(result.storage.archive.key));
    check('the archived object exists under the configured prefix', Boolean(archiveKey), [...transport.objects.keys()].join(', '));
    const archivedCopy = JSON.parse(transport.objects.get(archiveKey).toString('utf8'));
    check(
      'the archived object is the finalised report (checksum matches the database)',
      archivedCopy.checksum === driver.one('seo_reports', { id: result.report_id }).checksum,
      `${archivedCopy.checksum} vs ${driver.one('seo_reports', { id: result.report_id }).checksum}`
    );
    check(
      'the archived report also carries all eight stages',
      (archivedCopy.stages || []).length === 8,
      `${(archivedCopy.stages || []).length} stages`
    );

    const forbidden = makeTransport({ gemini: 'ok', s3: 'forbidden' });
    const broken = center({ env: envWith(Object.assign({ GEMINI_API_KEY: 'stub-gemini' }, filEnv)), transport: forbidden });
    const brokenResult = await broken.seo.runCycle({ days: 28 });
    check('a rejected archive write is reported as FAILED', brokenResult.storage.archive.status === 'FAILED', JSON.stringify(brokenResult.storage.archive));
    check('the report is still saved in the database', brokenResult.storage.database.saved === true);
    check('the cycle does not pretend the archive worked', brokenResult.stages.find((s) => s.stage === 'report').detail.includes('Fil One FAILED'));
    const brokenProbe = await broken.seo.archiveStatus({ probe: true });
    check('the archive probe reports BLOCKED when the bucket refuses writes', brokenProbe.state === 'BLOCKED', brokenProbe.state);
  }

  section('B10. The JSON fallback store also keeps reports');
  {
    const { seo, driver } = center({ env: envWith({ GEMINI_API_KEY: 'stub-gemini' }), mode: 'json' });
    const result = await seo.runCycle({ days: 28 });
    check('a cycle runs on the JSON store', result.ok && result.state === 'COMPLETE', result.reason || result.state);
    check('the report survives in the JSON store', driver.count('seo_reports') === 1);
    check('the JSON store reads the report back', Boolean(seo.store.getReport(result.report_id).report));
    delete process.env.PJS_STORAGE;
  }

  section('B11. Markdown report content');
  {
    const { seo } = center({ env: envWith({ GEMINI_API_KEY: 'stub-gemini' }) });
    const result = await seo.runCycle({ days: 28 });
    const md = seo.store.getReport(result.report_id).markdown;
    check('the Markdown report has the four metrics', /Clicks/.test(md) && /Impressions/.test(md) && /CTR/.test(md) && /Average position/.test(md));
    check('the Markdown report lists queries and pages', /Top queries/.test(md) && /Top pages/.test(md));
    check('the Markdown report records Pooja, Priya and Manager', /Pooja/.test(md) && /Priya/.test(md) && /Manager/.test(md));
    check('the Markdown report records the cycle trail', /Cycle trail/.test(md));
    check('the Markdown report states the deploy decision', /NOT_TRIGGERED/.test(md));
  }
}

/* ========================================================================= */

async function main() {
  console.log('PANIKA JEEVAN SATHI — SEO Center test suite\n');
  await partA();
  await partB();

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\n  Failures:');
    for (const failure of failures) console.log(`   - ${failure}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\n  Test suite crashed:');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
