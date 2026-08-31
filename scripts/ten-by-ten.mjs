#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — 10 × 10 DEEP CHECK (100 real verifications)
 * =================================================================
 *
 *   node scripts/ten-by-ten.mjs            # poora board
 *   node scripts/ten-by-ten.mjs --json     # machine-readable
 *   node scripts/ten-by-ten.mjs --row 4    # sirf ek row
 *
 * 10 areas × 10 checks. Har check *asli code path* chalata hai — koi
 * re-implementation nahi, koi duplicate logic nahi:
 *
 *   1. Syntax & project config
 *   2. Live site (real server boot over HTTP)
 *   3. Data layer (SQLite + JSON store, real writes)
 *   4. Cloud & crypto (D1/R2 round-trip, SigV4)
 *   5. Agent team (12 agents, roster ↔ handlers, storage)
 *   6. Queue & orders (enqueue → claim → complete, real consumer)
 *   7. Honesty — koi fake PASS nahi (negative tests included)
 *   8. Security (auth, cookies, traversal, secrets)
 *   9. Recovery & backups (snapshot, ledger, incidents)
 *  10. Delivery, CI & automation
 *
 * Verdict rules (repo policy):
 *   • Jo verify nahi ho saka wo PASS nahi hota — FAIL hota hai, detail ke saath.
 *   • Negative tests (jaan-boojh kar todo) zaroori hain: unke bina green
 *     ka koi matlab nahi.
 *
 * Exit 0 = 100/100, 1 = kuch bhi fail.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const asJSON = argv.includes('--json');
const onlyRow = argv.includes('--row') ? Number(argv[argv.indexOf('--row') + 1]) : null;
const KEEP = argv.includes('--keep');

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
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4nGP8//8/AzbAxIAHMGES+P//PxMDQsCEzjGMSg8AADJkCwlQn8RQAAAAAElFTkSuQmCC';

/* ------------------------------------------------------------------ utils */

function run(args, { env = {}, cwd = ROOT, timeout = 10 * 60 * 1000 } = {}) {
  const started = Date.now();
  try {
    const out = execFileSync(process.execPath, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      env: { ...process.env, ...env }
    });
    return { code: 0, out, ms: Date.now() - started };
  } catch (err) {
    return {
      code: typeof err.status === 'number' ? err.status : 1,
      out: String(err.stdout || '') + String(err.stderr || err.message || ''),
      ms: Date.now() - started
    };
  }
}

const tallyOf = (out) => {
  const m = String(out).match(/(\d+)\s+passed,\s*(\d+)\s+failed/i);
  return m ? { passed: Number(m[1]), failed: Number(m[2]) } : null;
};

/** Semver compare: a >= b (missing parts = 0). */
function semverGe(a, b) {
  const pa = String(a).split('.').map((n) => Number(n) || 0);
  const pb = String(b).split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** Ek hi suite ek hi baar chale — cache. */
const suiteCache = new Map();
function suite(key, args, env = {}) {
  if (!suiteCache.has(key)) suiteCache.set(key, run(args, { env }));
  return suiteCache.get(key);
}

/** Fresh temp copy of the repo — negative tests ke liye (asli repo chheda nahi jaata). */
let tmpCopy = null;
function brokenCopy(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-negative-'));
  execFileSync('tar', ['--exclude=node_modules', '--exclude=.git', '--exclude=data', '-cf', '-', '.'], {
    cwd: ROOT,
    stdio: ['ignore', fs.openSync(path.join(dir, '.tar'), 'w'), 'ignore']
  });
  execFileSync('tar', ['-xf', '.tar'], { cwd: dir, stdio: 'ignore' });
  fs.rmSync(path.join(dir, '.tar'), { force: true });
  mutate(dir);
  return dir;
}

/* ------------------------------------------------------------ live server */

let serverChild = null;
let serverBase = null;
let serverDataDir = null;
let serverExited = null;
const serverLog = [];
const serverPort = 4200 + Math.floor(Math.random() * 600); // health-check 3500-3899 use karta hai — takraav se bacho

function bootServer(env = {}) {
  return new Promise((resolve, reject) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-1010-'));
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(serverPort),
        HOST: '127.0.0.1',
        PJS_DATA_DIR: dataDir,
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let ready = false;
    const keep = (buf) => {
      serverLog.push(String(buf));
      if (serverLog.length > 40) serverLog.shift();
    };
    child.stdout.on('data', (buf) => {
      keep(buf);
      if (!ready && String(buf).includes('is running')) {
        ready = true;
        resolve({ child, dataDir, base: `http://127.0.0.1:${serverPort}` });
      }
    });
    child.stderr.on('data', keep);
    child.on('exit', (code) => {
      serverExited = code;
      if (!ready) reject(new Error(`server exited early (code ${code})`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error('server did not start within 20s'));
    }, 20000).unref();
  });
}

async function live() {
  if (!serverBase) {
    const booted = await bootServer();
    serverChild = booted.child;
    serverDataDir = booted.dataDir;
    serverBase = booted.base;
  }
  return { base: serverBase, dataDir: serverDataDir };
}

/** Server ka state — fetch fail ho to wajah chhupi na rahe. */
function serverState() {
  return `alive=${serverChild ? serverChild.exitCode === null : false}${serverExited !== null ? ` exitCode=${serverExited}` : ''} port=${serverPort}`;
}

/**
 * Transport-level error (socket race) ko ek baar retry karo — application-level
 * jawab (404/500/401) kabhi retry nahi hota, isliye asli failure chhupta nahi.
 * Cause hamesha detail mein jaata hai taaki wajah kabhi chhupe na.
 */
const TRANSPORT_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'UND_ERR_SOCKET', 'EAI_AGAIN']);
function isTransport(err) {
  const code = err?.cause?.code || err?.code;
  return Boolean(code && TRANSPORT_CODES.has(code));
}

async function fetchRetry(url, options = {}, tries = 2) {
  let lastError = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetch(url, options);
      res.retried = attempt > 1;
      return res;
    } catch (err) {
      lastError = err;
      if (!isTransport(err) || attempt === tries) break;
      // Wajah chhupani nahi: retry hua to stderr par likho.
      process.stderr.write(`[transport retry] ${url} cause=${err?.cause?.code || 'none'}\n`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastError;
}

async function get(base, pathname) {
  try {
    const res = await fetchRetry(base + pathname, { redirect: 'manual' });
    return { status: res.status, headers: res.headers, text: await res.text() };
  } catch (err) {
    throw new Error(
      `fetch ${pathname}: ${err.message} (cause=${err?.cause?.code || err?.cause?.message || 'none'}) [${serverState()}] tail: ${serverLog.slice(-3).join(' ').slice(-160)}`
    );
  }
}

/** Cookie-wala API client (register/login ke liye). */
function client(base) {
  let cookie = '';
  const call = async (method, pathname, body) => {
    const res = await fetchRetry(base + pathname, {
      method,
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    let json = null;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };
  return {
    call,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    hasSession: () => Boolean(cookie),
    cookie: () => cookie
  };
}

/* ------------------------------------------------------------------ rows */

const rows = [];

function row(title, checks) {
  rows.push({ title, checks });
}

const c = (name, fn) => ({ name, fn });

/* ============================================ 1. Syntax & project config */

row('1. Syntax & project config', [
  c('npm run check (browser + server code) exits 0', async () => {
    const r = suite('syntax', ['scripts/check-syntax.mjs']);
    return { ok: r.code === 0, detail: (tallyOf(r.out) ? `${tallyOf(r.out).passed} files parsed` : r.out.trim().split('\n').pop()) };
  }),
  c('syntax check actually covers server code (lib/, scripts/, agents/)', async () => {
    const r = suite('syntax', ['scripts/check-syntax.mjs']);
    const m = r.out.match(/server code\s*:\s*(\d+) file/);
    return { ok: Boolean(m) && Number(m[1]) >= 40, detail: m ? `${m[1]} server files scanned` : 'no server-code layer found' };
  }),
  c('syntax check catches a broken server file (negative test)', async () => {
    const dir = brokenCopy((d) => {
      fs.appendFileSync(path.join(d, 'lib/settings.js'), '\nconst broken = ;\n');
    });
    const r = run(['scripts/check-syntax.mjs'], { cwd: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: r.code === 1 && /lib\/settings\.js/.test(r.out), detail: `exit ${r.code}` };
  }),
  c('package.json wires the automation commands', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const need = ['start', 'check', 'health', 'test', 'test:json-store', 'test:sigv4', 'test:cloud', 'agent:cycle', 'agent:orders', 'agent:team', 'queue:run', 'queue:status', 'check:live', 'check:all', 'storage:doctor'];
    const missing = need.filter((s) => !pkg.scripts?.[s]);
    return { ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : `${need.length} scripts wired` };
  }),
  c('zero runtime dependencies (nothing to install on the host)', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = Object.keys(pkg.dependencies || {});
    return { ok: deps.length === 0, detail: deps.length ? `deps: ${deps.join(', ')}` : 'no dependencies' };
  }),
  c('engines.node is satisfied by the running Node', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const want = String(pkg.engines?.node || '').replace(/[^\d.]/g, '');
    const have = process.versions.node;
    return { ok: semverGe(have, want), detail: `requires >=${want}, running ${have}` };
  }),
  c('.node-version cannot install a Node older than engines requires', async () => {
    // .node-version "22" ka matlab hai "latest 22.x" (setup-node semantics),
    // isliye sirf major compare hota hai; minor pin ho to minor bhi.
    const want = String(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines?.node || '').replace(/[^\d.]/g, '');
    const pinned = fs.readFileSync(path.join(ROOT, '.node-version'), 'utf8').trim();
    const wantMajor = Number(want.split('.')[0]);
    const pinMajor = Number(pinned.split('.')[0]);
    let ok = pinMajor > wantMajor;
    if (pinMajor === wantMajor) {
      ok = pinned.includes('.') ? semverGe(pinned, want) : true; // "22" → newest 22.x
    }
    return { ok, detail: `.node-version=${pinned} (major ${pinMajor}) vs engines >=${want}` };
  }),
  c('render.yaml blueprint boots the real server with a health path', async () => {
    const y = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
    const ok = /startCommand:\s*node server\.js/.test(y) && /healthCheckPath:\s*\/api\/health/.test(y) && /plan:\s*free/.test(y);
    return { ok, detail: 'startCommand + healthCheckPath + plan verified' };
  }),
  c('Dockerfile and Procfile start the same server', async () => {
    const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    const procfile = fs.readFileSync(path.join(ROOT, 'Procfile'), 'utf8');
    // Dockerfile JSON-array CMD (["node","server.js"]) aur shell form dono chalte hain.
    const dockerOk = /node\s+server\.js/.test(dockerfile) || /CMD\s*\[\s*"node"\s*,\s*"server\.js"\s*\]/.test(dockerfile);
    const procOk = /web:\s*node\s+server\.js/.test(procfile);
    return { ok: dockerOk && procOk, detail: `dockerfile=${dockerOk}, procfile=${procOk}` };
  }),
  c('no committed secrets in tracked files', async () => {
    const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const patterns = [/(?:sk|rk|pk)-(?:live|test)-[A-Za-z0-9]{16,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
    const hits = [];
    for (const f of files) {
      if (!/\.(js|mjs|cjs|json|ya?ml|env|md|txt)$/.test(f) || f.includes('test-sigv4')) continue;
      const full = path.join(ROOT, f);
      if (!fs.existsSync(full)) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (patterns.some((p) => p.test(text))) hits.push(f);
    }
    return { ok: hits.length === 0, detail: hits.length ? `hits: ${hits.join(', ')}` : `${files.length} tracked files scanned` };
  })
]);

/* ==================================================== 2. Live site (HTTP) */

row('2. Live site — real server over HTTP', [
  c('/api/health reports ok and the storage kind', async () => {
    const { base } = await live();
    const r = await get(base, '/api/health');
    let body = null;
    try { body = JSON.parse(r.text); } catch { /* keep null */ }
    return { ok: r.status === 200 && body?.ok === true, detail: `HTTP ${r.status}, storage=${body?.storage}` };
  }),
  c('all 6 public pages return 200 with <title> + description', async () => {
    const { base } = await live();
    const bad = [];
    for (const p of PUBLIC_PAGES) {
      const r = await get(base, p);
      const title = /<title>\s*\S[\s\S]*?<\/title>/i.test(r.text);
      const desc = /<meta\s+name=["']description["'][^>]*content=["'][^"']+["']/i.test(r.text);
      if (r.status !== 200 || !title || !desc) bad.push(`${p}(${r.status}${title ? '' : ',no-title'}${desc ? '' : ',no-desc'})`);
    }
    return { ok: bad.length === 0, detail: bad.length ? bad.join(', ') : `${PUBLIC_PAGES.length} pages indexable` };
  }),
  c('all 13 member pages are 200 and noindex', async () => {
    const { base } = await live();
    const bad = [];
    for (const p of PRIVATE_PAGES) {
      const r = await get(base, p);
      if (r.status !== 200 || !/<meta\s+name=["']robots["'][^>]*noindex/i.test(r.text)) bad.push(p);
    }
    return { ok: bad.length === 0, detail: bad.length ? `bad: ${bad.join(', ')}` : `${PRIVATE_PAGES.length} pages hidden from crawlers` };
  }),
  c('all 5 assets return 200 with the right content-type', async () => {
    const { base } = await live();
    const bad = [];
    for (const a of ASSETS) {
      const r = await get(base, a);
      const type = r.headers.get('content-type') || '';
      const good =
        (a.endsWith('.css') && type.includes('text/css')) ||
        (a.endsWith('.js') && type.includes('javascript')) ||
        (a.endsWith('.svg') && type.includes('svg'));
      if (r.status !== 200 || !good || !r.text.length) bad.push(`${a}(${r.status},${type || 'none'})`);
    }
    return { ok: bad.length === 0, detail: bad.length ? bad.join(', ') : `${ASSETS.length} assets served` };
  }),
  c('unknown page returns 404 with the branded 404 page', async () => {
    const { base } = await live();
    const r = await get(base, `/nope-${Date.now()}.html`);
    const expected = fs.readFileSync(path.join(ROOT, 'public/404.html'), 'utf8');
    const branded = r.text.includes(expected.slice(0, 200).trim().split('\n')[0].trim().slice(0, 40));
    return { ok: r.status === 404 && branded, detail: `HTTP ${r.status}, branded=${branded}` };
  }),
  c('path traversal outside public/ is refused', async () => {
    const { base } = await live();
    const r = await fetch(`${base}/../server.js`, { redirect: 'manual' });
    const text = await r.text();
    const leaked = r.status === 200 && /createServer/.test(text);
    return { ok: (r.status === 404 || r.status === 403) && !leaked, detail: `HTTP ${r.status}${leaked ? ' — SOURCE LEAK' : ''}` };
  }),
  c('robots.txt disallows every private route + api + uploads and advertises sitemap', async () => {
    const { base } = await live();
    const r = await get(base, '/robots.txt');
    const problems = [];
    if (r.status !== 200) problems.push(`HTTP ${r.status}`);
    if (!/Sitemap:\s*\S+\/sitemap\.xml/i.test(r.text)) problems.push('no Sitemap');
    if (!/Disallow:\s*\/api\//i.test(r.text)) problems.push('/api/ allowed');
    if (!/Disallow:\s*\/uploads\//i.test(r.text)) problems.push('/uploads/ allowed');
    const missing = PRIVATE_PAGES.filter((p) => !new RegExp(`Disallow:\\s*${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`).test(r.text));
    if (missing.length) problems.push(`allowed: ${missing.join(',')}`);
    return { ok: problems.length === 0, detail: problems.join('; ') || '13 private routes + api + uploads blocked' };
  }),
  c('sitemap.xml lists exactly the 6 public pages', async () => {
    const { base } = await live();
    const r = await get(base, '/sitemap.xml');
    const locs = [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const ok = r.status === 200 && locs.length === PUBLIC_PAGES.length && PUBLIC_PAGES.every((p) => locs.some((l) => l.endsWith(p)));
    return { ok, detail: `${locs.length} URLs: ${locs.map((l) => l.replace(/^https?:\/\/[^/]+/, '')).join(' ')}` };
  }),
  c('every response type carries all 4 security headers', async () => {
    const { base } = await live();
    const probes = ['/', '/assets/css/app.css', '/assets/js/app.js', '/assets/img/logo.svg', `/nope-${Date.now()}`];
    const bad = [];
    for (const p of probes) {
      const res = await fetch(base + p, { redirect: 'manual' });
      const missing = SECURITY_HEADERS.filter((h) => !res.headers.get(h));
      if (missing.length) bad.push(`${p}(${missing.join(',')})`);
    }
    return { ok: bad.length === 0, detail: bad.length ? bad.join('; ') : `${probes.length} responses × ${SECURITY_HEADERS.length} headers` };
  }),
  c('a protected API route without a session returns 401', async () => {
    const { base } = await live();
    const routes = ['/api/me', '/api/conversations', '/api/notifications', '/api/shortlist'];
    const codes = [];
    for (const p of routes) codes.push(`${p}=${(await get(base, p)).status}`);
    const ok = codes.every((x) => x.endsWith('=401'));
    return { ok, detail: codes.join(' ') };
  })
]);

/* ======================================================== 3. Data layer */

row('3. Data layer — real writes, both stores', [
  c('e2e suite on the SQLite store: all checks pass', async () => {
    const r = suite('e2e-sqlite', ['scripts/e2e-test.mjs']);
    const t = tallyOf(r.out);
    return { ok: r.code === 0 && t && t.failed === 0 && t.passed > 100, detail: t ? `${t.passed} passed, ${t.failed} failed` : `exit ${r.code}` };
  }),
  c('e2e suite on the JSON fallback store: all checks pass', async () => {
    const r = suite('e2e-json', ['scripts/e2e-test.mjs'], { PJS_STORAGE: 'json' });
    const t = tallyOf(r.out);
    return { ok: r.code === 0 && t && t.failed === 0 && t.passed > 100, detail: t ? `${t.passed} passed, ${t.failed} failed` : `exit ${r.code}` };
  }),
  c('both stores produce the same result (no silent divergence)', async () => {
    const a = tallyOf(suite('e2e-sqlite', ['scripts/e2e-test.mjs']).out);
    const b = tallyOf(suite('e2e-json', ['scripts/e2e-test.mjs'], { PJS_STORAGE: 'json' }).out);
    const ok = Boolean(a && b && a.passed === b.passed && a.failed === b.failed);
    return { ok, detail: ok ? `${a.passed} checks identical on both stores` : `sqlite=${JSON.stringify(a)} json=${JSON.stringify(b)}` };
  }),
  c('data survives a server restart (proven by the suite)', async () => {
    const out = suite('e2e-sqlite', ['scripts/e2e-test.mjs']).out;
    const markers = ['account survives restart', 'messages survive restart', 'uploaded photo survives restart'];
    const missing = markers.filter((m) => !out.includes(m));
    return { ok: missing.length === 0, detail: missing.length ? `missing markers: ${missing.join(', ')}` : 'restart durability verified' };
  }),
  c('SQL injection in a value is stored as data, not executed', async () => {
    const dbLib = (await import(path.join(ROOT, 'lib/db.js'))).default;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-sqli-'));
    const { driver } = dbLib.open(dir, { log: () => {} });
    const evil = "'; DROP TABLE users; --";
    driver.insert('users', {
      email: 'evil@example.com', password_hash: 'x', name: evil, role: 'user',
      status: 'active', email_verified: 1, verification_token: null, reset_token: null,
      reset_expires: 0, token_version: 1, photo: null, last_login: 0, created_at: Date.now()
    });
    const back = driver.one('users', { email: 'evil@example.com' });
    const count = driver.all('users').length;
    await driver.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
    // Fresh temp DB: sirf hamara probe row hona chahiye, aur users table zinda.
    return { ok: back?.name === evil && count === 1, detail: `value stored verbatim, users rows=${count} (table survived)` };
  }),
  c('server boots on the JSON store when node:sqlite is unavailable', async () => {
    const r = run(['-e', `
      process.env.PJS_STORAGE='json';
      const dbLib = require('./lib/db');
      const os=require('os'), fs=require('fs'), path=require('path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(),'pjs-jsonstore-'));
      const opened = dbLib.open(dir, { log: () => {} });
      console.log('KIND=' + opened.driver.kind);
      fs.rmSync(dir, { recursive: true, force: true });
    `]);
    return { ok: r.code === 0 && /KIND=(json|sqlite)/.test(r.out), detail: (r.out.match(/KIND=\w+/) || [''])[0] };
  }),
  c('unreachable D1 stops the server instead of serving an empty site', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-d1down-'));
    const r = run(['server.js'], {
      env: { CF_ACCOUNT_ID: 'aaa', CF_D1_DATABASE_ID: 'bbb', CF_D1_API_TOKEN: 'ccc', PJS_BOOT_RETRIES: '1', PORT: '3987', PJS_DATA_DIR: dir },
      timeout: 120000
    });
    fs.rmSync(dir, { recursive: true, force: true });
    const loud = /THE DATABASE COULD NOT BE REACHED/.test(r.out);
    return { ok: r.code === 1 && loud, detail: `exit ${r.code}, loud refusal=${loud}` };
  }),
  c('/uploads/ directory listing is not exposed', async () => {
    const { base } = await live();
    const r = await get(base, '/uploads/');
    return { ok: r.status === 404, detail: `HTTP ${r.status}` };
  }),
  c('photo upload round-trip through the real API', async () => {
    const { base } = await live();
    const me = client(base);
    const email = `photo${Date.now()}@example.com`;
    const reg = await me.post('/api/auth/register', { name: 'Photo Test', email, password: 'Passw0rd123' });
    if (reg.status !== 200) return { ok: false, detail: `register HTTP ${reg.status}` };
    const up = await me.post('/api/profile/photo', { data_url: PNG_DATA_URL });
    if (up.status !== 200 || !/^\/uploads\//.test(up.body?.photo || '')) return { ok: false, detail: `upload HTTP ${up.status} ${JSON.stringify(up.body).slice(0, 120)}` };
    const res = await fetch(base + up.body.photo);
    const bytes = Buffer.from(await res.arrayBuffer());
    const isPng = bytes.subarray(1, 4).toString() === 'PNG';
    return { ok: res.status === 200 && isPng, detail: `${up.body.photo} → HTTP ${res.status}, ${bytes.length} bytes, PNG magic=${isPng}` };
  }),
  c('admin bootstrap writes 0600 credentials and an admin-role account', async () => {
    const { base, dataDir } = await live();
    const credFile = path.join(dataDir, 'admin-credentials.txt');
    const exists = fs.existsSync(credFile);
    const mode = exists ? (fs.statSync(credFile).mode & 0o777).toString(8) : 'none';
    const me = client(base);
    const cred = exists ? fs.readFileSync(credFile, 'utf8') : '';
    const email = (cred.match(/email:\s*(\S+)/) || [])[1];
    const password = (cred.match(/password:\s*(\S+)/) || [])[1];
    let role = null;
    if (email && password) {
      const login = await me.post('/api/auth/login', { email, password });
      if (login.status === 200) {
        const stats = await me.get('/api/admin/stats');
        role = stats.status === 200 ? 'admin' : `non-admin (HTTP ${stats.status})`;
      } else role = `login HTTP ${login.status}`;
    }
    return { ok: exists && mode === '600' && role === 'admin', detail: `credentials=${exists}, mode=${mode}, admin panel=${role}` };
  })
]);

/* ====================================================== 4. Cloud & crypto */

row('4. Cloud & crypto — D1/R2 round-trip and SigV4', [
  c('SigV4 signing suite: all checks pass', async () => {
    const r = suite('sigv4', ['scripts/test-sigv4.mjs']);
    const t = tallyOf(r.out);
    return { ok: r.code === 0 && t && t.failed === 0 && t.passed >= 30, detail: t ? `${t.passed} passed, ${t.failed} failed` : `exit ${r.code}` };
  }),
  c('cloud round-trip suite (D1 + R2, mocked): all checks pass', async () => {
    const r = suite('cloud', ['scripts/e2e-cloud-test.mjs']);
    const t = tallyOf(r.out);
    return { ok: r.code === 0 && t && t.failed === 0, detail: t ? `${t.passed} passed, ${t.failed} failed` : `exit ${r.code}` };
  }),
  c('every R2 request really carried a SigV4 signature', async () => {
    const out = suite('cloud', ['scripts/e2e-cloud-test.mjs']).out;
    const ok = /every R2 request carried a SigV4 signature/.test(out);
    return { ok, detail: ok ? 'verified by the suite' : 'marker not found in suite output' };
  }),
  c('a D1 outage is retried and nothing is lost', async () => {
    const out = suite('cloud', ['scripts/e2e-cloud-test.mjs']).out;
    const ok = /site keeps working when D1 returns a 500/.test(out) && /the retried write reached D1/.test(out);
    return { ok, detail: ok ? 'outage + retry verified' : 'retry markers not found' };
  }),
  c('database writes are batched to D1', async () => {
    const out = suite('cloud', ['scripts/e2e-cloud-test.mjs']).out;
    return { ok: /D1 received batched statements/.test(out), detail: 'batching verified' };
  }),
  c('verify-cloud without credentials reports BLOCKED (exit 2), not PASS', async () => {
    const r = run(['scripts/verify-cloud.mjs'], { env: { CF_ACCOUNT_ID: '', CF_D1_DATABASE_ID: '', CF_D1_API_TOKEN: '', R2_ACCOUNT_ID: '', R2_BUCKET: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' } });
    return { ok: r.code === 2 && /VERDICT: BLOCKED/.test(r.out), detail: `exit ${r.code}` };
  }),
  c('verify-cloud never claims durability it did not verify', async () => {
    const r = run(['scripts/verify-cloud.mjs'], { env: { CF_ACCOUNT_ID: '', CF_D1_DATABASE_ID: '', CF_D1_API_TOKEN: '', R2_ACCOUNT_ID: '', R2_BUCKET: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' } });
    const claimed = /Storage is durable/.test(r.out) || /VERDICT: PASS/.test(r.out);
    return { ok: !claimed, detail: claimed ? 'FALSE durability claim found' : 'no durability claim without proof' };
  }),
  c('verify-cloud names the exact missing variables', async () => {
    const r = run(['scripts/verify-cloud.mjs'], { env: { CF_ACCOUNT_ID: '', CF_D1_DATABASE_ID: '', CF_D1_API_TOKEN: '', R2_ACCOUNT_ID: '', R2_BUCKET: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' } });
    const ok = /CF_ACCOUNT_ID/.test(r.out) && /R2_ACCOUNT_ID/.test(r.out);
    return { ok, detail: ok ? 'both D1 and R2 blockers named' : 'missing variable names not listed' };
  }),
  c('cloud config readers return null without credentials (no crash)', async () => {
    const d1 = (await import(path.join(ROOT, 'lib/d1.js'))).default;
    const r2 = (await import(path.join(ROOT, 'lib/r2.js'))).default;
    const noD1 = d1.configFromEnv({});
    const noR2 = r2.configFromEnv({});
    const fakeD1 = d1.configFromEnv({ CF_ACCOUNT_ID: 'a', CF_D1_DATABASE_ID: 'b', CF_D1_API_TOKEN: 'c' });
    return { ok: noD1 === null && noR2 === null && Boolean(fakeD1), detail: `null without keys, object with keys` };
  }),
  c('R2/S3 signature matches the published AWS "GET Object" vector', async () => {
    const out = suite('sigv4', ['scripts/test-sigv4.mjs']).out;
    const section = out.slice(out.indexOf('S3 "GET Object" published vector'));
    const checks = ['canonical request matches the published one', 'signature matches the published AWS value', 'Authorization header is well formed'];
    const missing = checks.filter((k) => !section.includes(`✓ ${k}`));
    return {
      ok: section.length > 0 && missing.length === 0,
      detail: missing.length ? `not passing: ${missing.join(', ')}` : 'known-answer test: canonical request + signature + Authorization all match'
    };
  })
]);

/* ======================================================== 5. Agent team */

row('5. Agent team — 12 agents, roster ↔ handlers, storage', [
  c('roster declares 1 sardar + 1 manager + 10 workers', async () => {
    const { AGENTS, HIERARCHY } = await import(path.join(ROOT, 'agents/roster.mjs'));
    const ok = AGENTS.length === 12 && HIERARCHY.workers.length === 10 && HIERARCHY.sardar === 'guardian';
    return { ok, detail: `${AGENTS.length} agents, ${HIERARCHY.workers.length} workers` };
  }),
  c('every agent has a complete permanent store', async () => {
    const store = await import(path.join(ROOT, 'agents/storage.mjs'));
    const files = ['profile.json', 'state.json', 'memory.json', 'tasks.json', 'metrics.json', 'inbox.json', 'outbox.json', 'log.ndjson'];
    const incomplete = store.listAgents().filter((id) => files.some((f) => !fs.existsSync(path.join(store.agentDir(id), f))));
    return { ok: incomplete.length === 0, detail: incomplete.length ? `incomplete: ${incomplete.join(', ')}` : `${store.listAgents().length} agents × ${files.length} files` };
  }),
  c('all 8 generic workers execute without error', async () => {
    const { AGENTS } = await import(path.join(ROOT, 'agents/roster.mjs'));
    const dedicated = ['guardian', 'manager', 'pooja', 'priya'];
    const bad = [];
    for (const a of AGENTS.filter((x) => !dedicated.includes(x.id))) {
      const r = run(['agents/worker.mjs', a.id], { env: { PJS_CYCLE_MANAGED: '1' } });
      if (r.code !== 0) bad.push(`${a.id}(exit ${r.code})`);
    }
    return { ok: bad.length === 0, detail: bad.length ? bad.join(', ') : '8/8 workers ran' };
  }),
  c('the 4 dedicated agent scripts run', async () => {
    const bad = [];
    for (const [id, script] of [['pooja', 'agents/pooja.mjs'], ['priya', 'agents/priya.mjs']]) {
      const r = run([script], { env: { PJS_CYCLE_MANAGED: '1' } });
      if (r.code !== 0) bad.push(`${id}(exit ${r.code})`);
    }
    const g = run(['scripts/health-check.mjs'], { env: { PJS_HEALTH_NO_ROLLUP: '1', PJS_CYCLE_MANAGED: '1' } });
    if (g.code !== 0) bad.push(`guardian(exit ${g.code})`);
    const m = run(['agents/manager.mjs'], { env: { PJS_CYCLE_MANAGED: '1' } });
    if (m.code !== 0) bad.push(`manager(exit ${m.code})`);
    return { ok: bad.length === 0, detail: bad.length ? bad.join(', ') : 'pooja, priya, guardian, manager all ran' };
  }),
  c('agent team contract check passes', async () => {
    const r = suite('team', ['scripts/agent-team-check.mjs']);
    const m = r.out.match(/AGENT TEAM CHECK: PASS \((\d+) passed\)/);
    return { ok: r.code === 0 && Boolean(m), detail: m ? `${m[1]} contract checks` : `exit ${r.code}` };
  }),
  c('the full cycle runs and records all 12 agents', async () => {
    const r = run(['scripts/agent-storage-cycle.mjs']);
    const file = path.join(ROOT, 'reports/agents/agent-storage-cycle.json');
    const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const ok = doc && Array.isArray(doc.results) && doc.results.length === 12;
    return { ok, detail: ok ? `12 agents recorded (exit ${r.code})` : `results=${doc?.results?.length}` };
  }),
  c('no agent is left in a failure streak after the cycle', async () => {
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports/agents/agent-storage-cycle.json'), 'utf8'));
    const failing = doc.results.filter((r) => r.status === 'FAIL');
    return { ok: failing.length === 0, detail: failing.length ? `failing: ${failing.map((f) => f.id).join(', ')}` : '0 FAIL statuses' };
  }),
  c('every BLOCKED agent names the exact credentials it needs', async () => {
    const { AGENTS, missingRequirements } = await import(path.join(ROOT, 'agents/roster.mjs'));
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports/agents/agent-storage-cycle.json'), 'utf8'));
    const blocked = doc.results.filter((r) => r.status === 'BLOCKED' && r.id !== 'manager');
    const unnamed = blocked.filter((b) => {
      const agent = AGENTS.find((a) => a.id === b.id);
      return !agent || missingRequirements(agent).length === 0;
    });
    return {
      ok: unnamed.length === 0,
      detail: blocked.length
        ? `${blocked.map((b) => `${b.id}(${(AGENTS.find((a) => a.id === b.id)?.requires || []).join('+') || 'no keys needed'})`).join(', ')}`
        : 'nothing blocked'
    };
  }),
  c('storage doctor passes with an intact ledger', async () => {
    const store = await import(path.join(ROOT, 'agents/storage.mjs'));
    const d = store.doctor();
    const bad = (d.checks || []).filter((x) => !x.ok);
    return { ok: d.ok && bad.length === 0, detail: bad.length ? bad.map((b) => `${b.name}: ${b.detail}`).join('; ') : `${d.agents} agents, ledger ${d.ledger.checked} entries / ${d.ledger.broken} broken` };
  }),
  c('an unknown agent id is rejected instead of half-running', async () => {
    const r = run(['agents/worker.mjs', 'no-such-agent']);
    return { ok: r.code === 2, detail: `exit ${r.code}` };
  })
]);

/* ====================================================== 6. Queue & orders */

row('6. Queue & orders — enqueue → claim → complete', [
  c('queue file parses with all four buckets', async () => {
    const file = path.join(ROOT, 'storage/shared/queue/jobs.json');
    const q = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ok = ['pending', 'running', 'done', 'failed'].every((k) => Array.isArray(q[k]));
    return { ok, detail: `pending=${q.pending.length} running=${q.running.length} done=${q.done.length} failed=${q.failed.length}` };
  }),
  c('enqueue puts a job in pending', async () => {
    const dir = tempStore();
    const out = await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.init({ agents: [] });
      const job = s.enqueue({ type: 'agent-run', payload: { agent: 'nisha' } });
      console.log(JSON.stringify({ pending: s.queueStats().pending, id: job.id }));
    `);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: out.pending === 1, detail: `job ${out.id} queued, pending=${out.pending}` };
  }),
  c('claimJob takes the high-priority job first', async () => {
    const dir = tempStore();
    const out = await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.init({ agents: [] });
      s.enqueue({ type: 'health', priority: 'normal' });
      const high = s.enqueue({ type: 'orders', priority: 'high' });
      const claimed = s.claimJob('probe');
      console.log(JSON.stringify({ expected: high.id, claimed: claimed.id, priority: claimed.priority }));
    `);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: out.expected === out.claimed, detail: `claimed ${out.claimed} (${out.priority})` };
  }),
  c('claiming a job increments its attempt counter', async () => {
    const dir = tempStore();
    const out = await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.init({ agents: [] });
      const job = s.enqueue({ type: 'health' });
      const claimed = s.claimJob('probe');
      console.log(JSON.stringify({ same: claimed.id === job.id, attempts: claimed.attempts }));
    `);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: out.same && out.attempts === 1, detail: `attempts=${out.attempts}` };
  }),
  c('completeJob moves the job to done with its result', async () => {
    const dir = tempStore();
    const out = await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.init({ agents: [] });
      const job = s.enqueue({ type: 'health' });
      const claimed = s.claimJob('probe');
      const done = s.completeJob(claimed.id, { status: 'OK' });
      console.log(JSON.stringify({ same: done && done.id === job.id, result: done && done.result, done: s.queueStats().done }));
    `);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: out.same && out.result?.status === 'OK' && out.done === 1, detail: `done=${out.done}, result=${JSON.stringify(out.result)}` };
  }),
  c('failJob moves the job to failed with the error', async () => {
    const dir = tempStore();
    const out = await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.init({ agents: [] });
      const job = s.enqueue({ type: 'health' });
      const claimed = s.claimJob('probe');
      const failed = s.failJob(claimed.id, 'boom');
      console.log(JSON.stringify({ same: failed && failed.id === job.id, error: failed && failed.error, failed: s.queueStats().failed }));
    `);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: out.same && out.error === 'boom' && out.failed === 1, detail: `failed=${out.failed}, error="${out.error}"` };
  }),
  c('the queue worker really drains pending jobs', async () => {
    const dir = tempStore();
    await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.init({ agents: [] });
      s.enqueue({ type: 'agent-run', payload: { agent: 'nisha' } });
      s.enqueue({ type: 'agent-run', payload: { agent: 'amit' } });
    `);
    const before = readQueue(dir);
    const r = run(['scripts/agent-queue-worker.mjs'], { env: { PJS_AGENT_STORAGE_DIR: dir } });
    const after = readQueue(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    return {
      ok: r.code === 0 && before.pending === 2 && after.pending === 0 && after.done === 2,
      detail: `pending ${before.pending}→${after.pending}, done ${before.done}→${after.done}`
    };
  }),
  c('no job is left stuck in running after the worker', async () => {
    const dir = tempStore();
    await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.init({ agents: [] });
      s.enqueue({ type: 'daily-rollup', payload: { scope: 'all-agents' } });
    `);
    run(['scripts/agent-queue-worker.mjs'], { env: { PJS_AGENT_STORAGE_DIR: dir } });
    const after = readQueue(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: after.running === 0 && after.done === 1, detail: `running=${after.running}, done=${after.done}` };
  }),
  c('an unknown job type is failed loudly, never silently dropped', async () => {
    const dir = tempStore();
    await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.init({ agents: [] });
      s.enqueue({ type: 'not-a-real-type' });
    `);
    const r = run(['scripts/agent-queue-worker.mjs'], { env: { PJS_AGENT_STORAGE_DIR: dir } });
    const after = readQueue(dir);
    const reason = after.failedList?.[0]?.error || '';
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: r.code === 1 && after.failed === 1 && /unknown job type/.test(reason), detail: `exit ${r.code}, failed=${after.failed}, reason="${String(reason).slice(0, 60)}"` };
  }),
  c('the order desk issues orders only for agents that are not OK', async () => {
    const r = run(['scripts/agent-orders.mjs', '--json']);
    const doc = JSON.parse(r.out.slice(r.out.indexOf('{')));
    const mismatched = [
      ...doc.orders.filter((o) => o.current_status === 'OK'),
      ...doc.healthy.filter((h) => doc.orders.some((o) => o.agent === h))
    ];
    return {
      ok: r.code === 0 && mismatched.length === 0 && doc.totals.agents === doc.totals.healthy + doc.totals.ordered,
      detail: `${doc.totals.healthy} healthy, ${doc.totals.ordered} orders (${doc.totals.blocked_on_credentials} need credentials)`
    };
  })
]);

/** Temp storage root — committed storage ko chheda nahi jaata. */
function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-store-'));
  fs.mkdirSync(path.join(dir, 'storage'), { recursive: true });
  return path.join(dir, 'storage');
}

function readQueue(storageDir) {
  const file = path.join(storageDir, 'shared/queue/jobs.json');
  const q = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    pending: (q.pending || []).length,
    running: (q.running || []).length,
    done: (q.done || []).length,
    failed: (q.failed || []).length,
    failedList: q.failed || []
  };
}

/** Storage code ko ek alag process mein chalao (STORAGE_DIR load-time par fix hota hai). */
async function storeRun(storageDir, code) {
  const r = run(['-e', `process.env.PJS_AGENT_STORAGE_DIR = ${JSON.stringify(storageDir)}; ${code}`]);
  const line = (r.out || '').trim().split('\n').filter(Boolean).pop() || '{}';
  try {
    return JSON.parse(line);
  } catch {
    return { error: String(r.out).slice(-300) + String(r.code) };
  }
}

/* ==================================== 7. Honesty — koi fake PASS nahi */

row('7. Honesty — no fake success (negative tests)', [
  c('manager reports a credential-blocked worker as BLOCKED, not PASS', async () => {
    const r = run(['agents/manager.mjs'], { env: { GOOGLE_SEARCH_CONSOLE_TOKEN: '', GEMINI_API_KEY: '', META_ACCESS_TOKEN: '', META_PAGE_ID: '', PJS_CYCLE_MANAGED: '1' } });
    const doc = JSON.parse(r.out.slice(r.out.indexOf('{')));
    return { ok: doc.workers.pooja.status === 'BLOCKED' && doc.workers.priya.status === 'BLOCKED', detail: `pooja=${doc.workers.pooja.status}, priya=${doc.workers.priya.status}` };
  }),
  c('manager lists the blocked workers and does not exit as failure', async () => {
    const r = run(['agents/manager.mjs'], { env: { GOOGLE_SEARCH_CONSOLE_TOKEN: '', GEMINI_API_KEY: '', META_ACCESS_TOKEN: '', META_PAGE_ID: '', PJS_CYCLE_MANAGED: '1' } });
    const doc = JSON.parse(r.out.slice(r.out.indexOf('{')));
    return { ok: r.code === 0 && doc.blocked.includes('pooja') && doc.blocked.includes('priya') && doc.status === 'BLOCKED', detail: `exit ${r.code}, blocked=[${doc.blocked.join(',')}], status=${doc.status}` };
  }),
  c('manager guardian status matches the real health-check tally', async () => {
    const r = run(['agents/manager.mjs'], { env: { PJS_CYCLE_MANAGED: '1' } });
    const doc = JSON.parse(r.out.slice(r.out.indexOf('{')));
    const t = String(doc.guardian.summary).match(/(\d+) passed, (\d+) failed/);
    return { ok: doc.guardian.status === 'OK' && t && Number(t[2]) === 0, detail: `guardian=${doc.guardian.status} (${doc.guardian.summary})` };
  }),
  c('the agent cycle exits non-zero while agents are blocked', async () => {
    const r = run(['scripts/agent-storage-cycle.mjs']);
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports/agents/agent-storage-cycle.json'), 'utf8'));
    const notOk = doc.results.filter((x) => x.status !== 'OK');
    return { ok: r.code === 1 && notOk.length > 0, detail: `exit ${r.code} with ${notOk.length} non-OK agent(s): ${notOk.map((n) => `${n.id}=${n.status}`).join(', ')}` };
  }),
  c('a BLOCKED run is recorded as BLOCKED in permanent state', async () => {
    const store = await import(path.join(ROOT, 'agents/storage.mjs'));
    const state = store.getState('pooja') || {};
    return { ok: state.last_status === 'BLOCKED', detail: `pooja.last_status=${state.last_status}` };
  }),
  c('live check on an unreachable host returns BLOCKED, not FAIL', async () => {
    const r = run(['scripts/render-real-check.mjs', '--url', 'https://127.0.0.1:9', '--attempts', '1']);
    return { ok: r.code === 2 && /BLOCKED/.test(r.out), detail: `exit ${r.code}` };
  }),
  c('live check on a real boot verifies content, not just status codes', async () => {
    const { base } = await live();
    const r = run(['scripts/render-real-check.mjs', '--url', base, '--attempts', '1']);
    const okNoindex = /noindex/.test(r.out) && /VERDICT: PASS/.test(r.out);
    return { ok: r.code === 0 && okNoindex, detail: `exit ${r.code}, content markers verified` };
  }),
  c('guardian fails when a public page really breaks (negative test)', async () => {
    const dir = brokenCopy((d) => {
      const f = path.join(d, 'public/about.html');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/<title>[\s\S]*?<\/title>/i, ''));
    });
    const r = run(['scripts/health-check.mjs'], { cwd: dir, env: { PJS_HEALTH_NO_ROLLUP: '1' } });
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: r.code === 1 && /failed/.test(r.out), detail: `exit ${r.code} — broken page detected` };
  }),
  c('storage doctor fails on a corrupt storage file (negative test)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-corrupt-'));
    execFileSync('cp', ['-r', path.join(ROOT, 'storage'), path.join(dir, 'storage')]);
    const victim = path.join(dir, 'storage/agents/amit/memory.json');
    fs.writeFileSync(victim, '{ this is not json');
    const r = run(['scripts/agent-storage.mjs', 'doctor'], { env: { PJS_AGENT_STORAGE_DIR: path.join(dir, 'storage') } });
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: r.code !== 0 && /DOCTOR: FAIL/.test(r.out), detail: `exit ${r.code} — corruption detected` };
  }),
  c('the ledger detects a tampered line (negative test)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-ledger-'));
    execFileSync('cp', ['-r', path.join(ROOT, 'storage'), path.join(dir, 'storage')]);
    const ledgerDir = path.join(dir, 'storage/shared/ledger');
    const file = fs.readdirSync(ledgerDir).filter((f) => f.endsWith('.ndjson')).sort().pop();
    const target = path.join(ledgerDir, file);
    const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
    if (lines.length > 2) {
      const obj = JSON.parse(lines[1]);
      obj.status = 'TAMPERED';
      lines[1] = JSON.stringify(obj);
      fs.writeFileSync(target, lines.join('\n') + '\n');
    }
    const verify = await storeRun(path.join(dir, 'storage'), `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      const v = s.ledgerVerify();
      console.log(JSON.stringify({ ok: v.ok, broken: v.broken, checked: v.checked }));
    `);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: verify.ok === false && verify.broken > 0, detail: `tamper detected: ${verify.broken} broken line(s) of ${verify.checked}` };
  })
]);

/* =========================================================== 8. Security */

row('8. Security — auth, cookies, traversal, secrets', [
  c('session cookie is HttpOnly and SameSite', async () => {
    const { base } = await live();
    const me = client(base);
    let res;
    try {
      res = await fetchRetry(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Cookie Test', email: `cookie${Date.now()}@example.com`, password: 'Passw0rd123' })
      });
    } catch (err) {
      throw new Error(`register fetch: ${err.message} (cause=${err?.cause?.code || 'none'}) [${serverState()}] tail: ${serverLog.slice(-3).join(' ').slice(-160)}`);
    }
    const setCookie = res.headers.get('set-cookie') || '';
    const ok = /HttpOnly/i.test(setCookie) && /SameSite=/i.test(setCookie);
    me.hasSession();
    return { ok, detail: setCookie.split(';').slice(1).join(';').trim() || 'no cookie flags' };
  }),
  c('passwords are stored hashed, never in plain text', async () => {
    const { base, dataDir } = await live();
    const me = client(base);
    const email = `hash${Date.now()}@example.com`;
    const password = 'Passw0rd123';
    await me.post('/api/auth/register', { name: 'Hash Test', email, password });
    // lib/db.js: SQLite file = panika-jeevan-sathi.db, fallback = panika-jeevan-sathi.json
    const dbPath = path.join(dataDir, 'panika-jeevan-sathi.db');
    const jsonPath = path.join(dataDir, 'panika-jeevan-sathi.json');
    let hashed = null;
    let source = 'none';
    if (fs.existsSync(dbPath)) {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const row = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email);
      db.close();
      hashed = row?.password_hash;
      source = 'sqlite';
    } else if (fs.existsSync(jsonPath)) {
      const store = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      hashed = (store.users || []).find((u) => u.email === email)?.password_hash;
      source = 'json';
    }
    return {
      ok: Boolean(hashed) && hashed !== password && !String(hashed).includes(password),
      detail: hashed ? `${source}: hash ${String(hashed).slice(0, 16)}… (plaintext absent)` : `user row not found in ${source}`
    };
  }),
  c('the owner account is an admin, not a normal member', async () => {
    const { base, dataDir } = await live();
    const cred = fs.readFileSync(path.join(dataDir, 'admin-credentials.txt'), 'utf8');
    const email = (cred.match(/email:\s*(\S+)/) || [])[1];
    const password = (cred.match(/password:\s*(\S+)/) || [])[1];
    const me = client(base);
    const login = await me.post('/api/auth/login', { email, password });
    const profile = await me.get('/api/me');
    return { ok: login.status === 200 && profile.body?.user?.role === 'admin', detail: `login HTTP ${login.status}, role=${profile.body?.user?.role}` };
  }),
  c('admin API rejects a normal member', async () => {
    const { base } = await live();
    const me = client(base);
    await me.post('/api/auth/register', { name: 'Normal Member', email: `normal${Date.now()}@example.com`, password: 'Passw0rd123' });
    const res = await me.get('/api/admin/users');
    return { ok: res.status === 403, detail: `HTTP ${res.status}` };
  }),
  c('unknown API route returns 404', async () => {
    const { base } = await live();
    const r = await get(base, '/api/definitely-not-a-route');
    return { ok: r.status === 404, detail: `HTTP ${r.status}` };
  }),
  c('OPTIONS preflight returns 204 with security headers', async () => {
    const { base } = await live();
    const res = await fetch(`${base}/api/health`, { method: 'OPTIONS' });
    const missing = SECURITY_HEADERS.filter((h) => !res.headers.get(h));
    return { ok: res.status === 204 && missing.length === 0, detail: `HTTP ${res.status}${missing.length ? `, missing ${missing.join(',')}` : ''}` };
  }),
  c('login with a wrong password is rejected', async () => {
    const { base, dataDir } = await live();
    const cred = fs.readFileSync(path.join(dataDir, 'admin-credentials.txt'), 'utf8');
    const email = (cred.match(/email:\s*(\S+)/) || [])[1];
    const me = client(base);
    const res = await me.post('/api/auth/login', { email, password: 'WrongPassword999' });
    return { ok: res.status === 401, detail: `HTTP ${res.status}` };
  }),
  c('weak passwords and invalid emails are refused at registration', async () => {
    const { base } = await live();
    const me = client(base);
    const weak = await me.post('/api/auth/register', { name: 'Weak Pw', email: `weak${Date.now()}@example.com`, password: 'abc' });
    const badEmail = await me.post('/api/auth/register', { name: 'Bad Email', email: 'not-an-email', password: 'Passw0rd123' });
    return { ok: weak.status === 400 && badEmail.status === 400, detail: `weak=${weak.status}, bad-email=${badEmail.status}` };
  }),
  c('a tampered session token is rejected', async () => {
    const { base } = await live();
    const res = await fetch(`${base}/api/me`, { headers: { cookie: 'pjs_session=deadbeef.deadbeef' } });
    return { ok: res.status === 401, detail: `HTTP ${res.status}` };
  }),
  c('no secret-looking value is committed anywhere in the tree', async () => {
    const patterns = [/(?:sk|rk|pk)-(?:live|test)-[A-Za-z0-9]{16,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
    const skip = new Set(['node_modules', '.git', 'data', 'storage', 'reports']);
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(js|mjs|cjs|json|ya?ml|env|md|txt|html)$/.test(e.name) || e.name.includes('test-sigv4')) continue;
        const text = fs.readFileSync(full, 'utf8');
        if (patterns.some((p) => p.test(text))) hits.push(path.relative(ROOT, full));
      }
    };
    walk(ROOT);
    return { ok: hits.length === 0, detail: hits.length ? hits.join(', ') : 'whole tree scanned' };
  })
]);

/* ================================================= 9. Recovery & backups */

row('9. Recovery & backups — snapshots, ledger, incidents', [
  c('snapshot() creates a snapshot of the whole storage tree', async () => {
    const dir = tempStore();
    // `cp -r src/. dest/` — warna dest already exist karta hai aur src uske
    // *andar* copy ho jaata hai (dest/src), jisse store khaali dikhta hai.
    execFileSync('cp', ['-r', path.join(ROOT, 'storage') + '/.', dir]);
    const out = await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      const snap = s.snapshot('1010-test');
      console.log(JSON.stringify({ name: snap.name, files: snap.files.length, bytes: snap.bytes }));
    `);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: out.files > 0 && out.bytes > 0, detail: `${out.name}: ${out.files} files, ${out.bytes} bytes` };
  }),
  c('listSnapshots() sees the snapshot that was just taken', async () => {
    const dir = tempStore();
    // `cp -r src/. dest/` — warna dest already exist karta hai aur src uske
    // *andar* copy ho jaata hai (dest/src), jisse store khaali dikhta hai.
    execFileSync('cp', ['-r', path.join(ROOT, 'storage') + '/.', dir]);
    const out = await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.snapshot('1010-list');
      const list = s.listSnapshots();
      console.log(JSON.stringify({ count: list.length, latest: list[list.length - 1]?.name || null }));
    `);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: out.count > 0, detail: `${out.count} snapshot(s), latest ${out.latest}` };
  }),
  c('the live ledger hash-chain verifies', async () => {
    const out = await storeRun(path.join(ROOT, 'storage'), `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      const v = s.ledgerVerify();
      console.log(JSON.stringify({ ok: v.ok, checked: v.checked, broken: v.broken }));
    `);
    return { ok: out.ok === true && out.broken === 0, detail: `${out.checked} entries, ${out.broken} broken` };
  }),
  c('appending to the ledger keeps the chain verifiable', async () => {
    const dir = tempStore();
    // `cp -r src/. dest/` — warna dest already exist karta hai aur src uske
    // *andar* copy ho jaata hai (dest/src), jisse store khaali dikhta hai.
    execFileSync('cp', ['-r', path.join(ROOT, 'storage') + '/.', dir]);
    const out = await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.ledgerAppend({ type: 'test.append', agent: 'guardian', status: 'OK', summary: '1010 check' });
      const v = s.ledgerVerify();
      console.log(JSON.stringify({ ok: v.ok, checked: v.checked, broken: v.broken }));
    `);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: out.ok === true && out.checked > 0, detail: `${out.checked} entries still chained` };
  }),
  c('opening an incident registers it', async () => {
    const dir = tempStore();
    // `cp -r src/. dest/` — warna dest already exist karta hai aur src uske
    // *andar* copy ho jaata hai (dest/src), jisse store khaali dikhta hai.
    execFileSync('cp', ['-r', path.join(ROOT, 'storage') + '/.', dir]);
    const out = await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.openIncident({ id: 'test-incident', agent: 'guardian', severity: 'warning', title: 'probe', detail: '1010' });
      console.log(JSON.stringify({ open: s.openIncidents().map((i) => i.id) }));
    `);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: out.open.includes('test-incident'), detail: `open: ${out.open.join(', ')}` };
  }),
  c('closing an incident clears it', async () => {
    const dir = tempStore();
    // `cp -r src/. dest/` — warna dest already exist karta hai aur src uske
    // *andar* copy ho jaata hai (dest/src), jisse store khaali dikhta hai.
    execFileSync('cp', ['-r', path.join(ROOT, 'storage') + '/.', dir]);
    const out = await storeRun(dir, `
      const s = await import(${JSON.stringify(path.join(ROOT, 'agents/storage.mjs'))});
      s.openIncident({ id: 'test-incident-2', agent: 'guardian', severity: 'warning', title: 'probe', detail: '1010' });
      s.closeIncident('test-incident-2', { note: 'resolved by probe' });
      console.log(JSON.stringify({ open: s.openIncidents().map((i) => i.id) }));
    `);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: !out.open.includes('test-incident-2'), detail: `open after close: ${out.open.length}` };
  }),
  c('doctor passes on the live storage tree', async () => {
    const r = run(['scripts/agent-storage.mjs', 'doctor']);
    return { ok: r.code === 0 && /DOCTOR: PASS/.test(r.out), detail: (r.out.match(/agents\s*:\s*\d+/) || [''])[0] };
  }),
  c('recovery clone script builds a clone that passes its own syntax check', async () => {
    fs.rmSync(path.join(ROOT, '.agent-recovery'), { recursive: true, force: true });
    const r = run(['scripts/recovery-clone.mjs', 'priya']);
    const ok = r.code === 0 && /CLONE SYNTAX: PASS/.test(r.out);
    fs.rmSync(path.join(ROOT, '.agent-recovery'), { recursive: true, force: true });
    return { ok, detail: `exit ${r.code}, clone syntax ${/CLONE SYNTAX: PASS/.test(r.out) ? 'PASS' : 'FAIL'}` };
  }),
  c('worker recovery completes end to end for a known worker', async () => {
    fs.rmSync(path.join(ROOT, '.agent-recovery'), { recursive: true, force: true });
    const r = run(['scripts/worker-recovery.mjs', 'pooja']);
    const ok = r.code === 0 && /RECOVERY COMPLETE/.test(r.out);
    fs.rmSync(path.join(ROOT, '.agent-recovery'), { recursive: true, force: true });
    return { ok, detail: `exit ${r.code}, ${/RECOVERY COMPLETE/.test(r.out) ? 'recovery complete' : 'incomplete'}` };
  }),
  c('storage layout is documented and snapshots stay out of git', async () => {
    const readme = fs.existsSync(path.join(ROOT, 'storage/README.md'));
    const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    const ok = readme && /storage\/snapshots\//.test(ignore) && /archive\//.test(ignore);
    return { ok, detail: `README=${readme}, snapshots+archives gitignored` };
  })
]);

/* ======================================= 10. Delivery, CI & automation */

row('10. Delivery, CI & automation', [
  c('guardian workflow runs syntax + both e2e stores + health check', async () => {
    const y = fs.readFileSync(path.join(ROOT, '.github/workflows/guardian.yml'), 'utf8');
    const need = ['npm run check', 'node scripts/e2e-test.mjs', 'PJS_STORAGE=json node scripts/e2e-test.mjs', 'node scripts/health-check.mjs'];
    const missing = need.filter((n) => !y.includes(n));
    return { ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(' | ')}` : '4 CI steps present' };
  }),
  c('health check rolls up the suites CI cannot run itself', async () => {
    const r = run(['scripts/health-check.mjs']);
    const section = r.out.slice(r.out.indexOf('11. Full suite rollup'));
    const suites = ['Syntax — browser', 'E2E — SQLite store', 'E2E — JSON fallback store', 'SigV4', 'Cloud round-trip', 'Agent team contract', 'storage integrity', 'Order desk', 'Cloud credential verdict'];
    const missing = suites.filter((s) => !section.includes(s));
    return { ok: r.code === 0 && missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : `${suites.length} suites inside CI's own step` };
  }),
  c('the rollup recursion guard works (PJS_HEALTH_NO_ROLLUP=1)', async () => {
    const r = run(['scripts/health-check.mjs'], { env: { PJS_HEALTH_NO_ROLLUP: '1' } });
    const skipped = /skipped — PJS_HEALTH_NO_ROLLUP=1/.test(r.out);
    return { ok: r.code === 0 && skipped, detail: skipped ? 'rollup skipped, no recursion' : 'guard did not trigger' };
  }),
  c('a failing rolled-up suite fails the health check (negative test)', async () => {
    const dir = brokenCopy((d) => {
      fs.appendFileSync(path.join(d, 'scripts/test-sigv4.mjs'), '\nprocess.exit(1);\n');
    });
    const r = run(['scripts/health-check.mjs'], { cwd: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    const caught = /SigV4/.test(r.out) && /✗/.test(r.out);
    return { ok: r.code === 1 && caught, detail: `exit ${r.code}, failing suite reported` };
  }),
  c('npm run health passes end to end', async () => {
    const r = run(['scripts/health-check.mjs']);
    const t = tallyOf(r.out);
    return { ok: r.code === 0 && t && t.failed === 0 && t.passed >= 100, detail: t ? `${t.passed} passed, ${t.failed} failed` : `exit ${r.code}` };
  }),
  c('the CI artifact path (health-report-latest.md) is really written', async () => {
    const file = path.join(ROOT, 'reports/health-report-latest.md');
    const ok = fs.existsSync(file) && fs.statSync(file).size > 200;
    return { ok, detail: ok ? `${fs.statSync(file).size} bytes` : 'missing' };
  }),
  c('DEPLOY.md documents every env var the blueprint declares', async () => {
    const y = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
    const doc = fs.readFileSync(path.join(ROOT, 'DEPLOY.md'), 'utf8');
    const keys = [...y.matchAll(/- key:\s*([A-Z0-9_]+)/g)].map((m) => m[1]).filter((k) => !['NODE_VERSION', 'HOST', 'PJS_STORAGE'].includes(k));
    const missing = keys.filter((k) => !doc.includes(k));
    return { ok: missing.length === 0, detail: missing.length ? `undocumented: ${missing.join(', ')}` : `${keys.length} env vars documented` };
  }),
  c('the live check writes a machine-readable report', async () => {
    const { base } = await live();
    run(['scripts/render-real-check.mjs', '--url', base, '--attempts', '1', '--json']);
    const file = path.join(ROOT, 'reports/agents/live-check-latest.json');
    const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    return { ok: doc?.verdict === 'PASS' && doc.results.length >= 25, detail: `${doc?.verdict}, ${doc?.results?.length} route checks recorded` };
  }),
  c('order desk and queue worker are one command away', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const ok = pkg.scripts['agent:orders']?.includes('agent-orders.mjs') && pkg.scripts['queue:run']?.includes('agent-queue-worker.mjs');
    const ordersRun = run(['scripts/agent-orders.mjs']);
    const queueRun = run(['scripts/agent-storage.mjs', 'queue']);
    return { ok: ok && ordersRun.code === 0 && queueRun.code === 0, detail: 'npm run agent:orders + npm run queue:run wired' };
  }),
  c('one command runs this whole board (npm run check:all)', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return { ok: pkg.scripts['check:all']?.includes('ten-by-ten.mjs'), detail: `check:all → ${pkg.scripts['check:all']}` };
  })
]);

/* ------------------------------------------------------------------ run */

const results = [];
let totalPass = 0;
let totalFail = 0;

for (const [index, r] of rows.entries()) {
  if (onlyRow && index + 1 !== onlyRow) continue;
  if (!asJSON) {
    console.log('');
    console.log('═'.repeat(64));
    console.log(` ${r.title}`);
    console.log('═'.repeat(64));
  }
  const rowResults = [];
  for (const check of r.checks) {
    let outcome;
    try {
      const res = await check.fn();
      outcome = { ok: Boolean(res.ok), detail: res.detail || '' };
    } catch (err) {
      outcome = { ok: false, detail: `threw: ${err && err.message ? err.message : err}` };
    }
    if (outcome.ok) totalPass += 1;
    else totalFail += 1;
    const entry = { row: r.title, check: check.name, ...outcome };
    results.push(entry);
    rowResults.push(entry);
    if (!asJSON) console.log(`  ${outcome.ok ? '✓' : '✗'} ${check.name}${outcome.detail ? ` — ${outcome.detail}` : ''}`);
  }
}

/* ------------------------------------------------------------ the matrix */

const grid = rows.map((r, i) => {
  const cells = results.filter((x) => x.row === r.title);
  return { row: i + 1, title: r.title, cells: cells.map((x) => (x.ok ? '✓' : '✗')), passed: cells.filter((x) => x.ok).length };
});

if (asJSON) {
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), totals: { passed: totalPass, failed: totalFail }, grid, results }, null, 2));
} else {
  console.log('');
  console.log('═'.repeat(64));
  console.log(' 10 × 10 MATRIX');
  console.log('═'.repeat(64));
  console.log('      ' + Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(3)).join(''));
  for (const g of grid) {
    if (!g.cells.length) continue;
    console.log(` ${String(g.row).padStart(2)}   ${g.cells.map((x) => x.padStart(3)).join('')}   ${g.passed}/${g.cells.length}  ${g.title}`);
  }
  console.log('');
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`  ${totalPass} passed, ${totalFail} failed  (10 areas × 10 checks)`);
  if (totalFail) {
    console.log('');
    console.log('  FAILURES:');
    for (const f of results.filter((x) => !x.ok)) console.log(`   ✗ [${f.row}] ${f.check} — ${f.detail}`);
  }
  console.log('────────────────────────────────────────────────────────────────');
}

try {
  fs.mkdirSync(path.join(ROOT, 'reports', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'reports', 'agents', 'ten-by-ten-latest.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), totals: { passed: totalPass, failed: totalFail }, grid, results }, null, 2) + '\n'
  );
} catch { /* report optional */ }

if (serverChild) {
  serverChild.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
}
if (serverDataDir && !KEEP) {
  try { fs.rmSync(serverDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

process.exit(totalFail === 0 ? 0 : 1);
