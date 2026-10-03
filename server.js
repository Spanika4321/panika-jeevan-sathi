'use strict';
/**
 * TEERNOVA — Application Server
 *
 *   node server.js          →  http://localhost:3000
 *
 * Zero npm dependencies: Node.js >= 22.5 (uses the built-in node:sqlite driver).
 * All data lives in ./data (SQLite database + uploaded files).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const dbLib = require('./lib/db');
const authLib = require('./lib/auth');
const settingsLib = require('./lib/settings');
const apiLib = require('./lib/api');
const photosLib = require('./lib/photos');
const supabaseLib = require('./lib/supabase-driver');
const agentsDbLib = require('./lib/agents-db');

const ROOT = __dirname;
const PUBLIC_DIR = ROOT; // files at repo root (GitHub Pages compatibility)
const DATA_DIR = process.env.PJS_DATA_DIR || path.join(ROOT, 'data');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

/**
 * TEERNOVA — Transformd from PANIKA JEEVAN SATHI
 * Live Teer Results • Smart Statistics • Trusted Information
 */

/* ------------------------------------------------------------------ storage */

let supabaseConfig = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  supabaseConfig = {
    url: process.env.SUPABASE_URL.trim(),
    key: process.env.SUPABASE_KEY.trim(),
    log: (message) => console.log(message)
  };
}

const opened = dbLib.open(DATA_DIR, { log: (message) => console.log(message) });
let driver = opened.driver;
const driverError = opened.driverError;
let remote = opened.remote;
const secret = authLib.loadSecret(DATA_DIR);

let supabaseDriver = null;
if (supabaseConfig) {
  try {
    const { driver: sbDriver, supabase: sbClient } = supabaseLib.createSupabaseDriver(supabaseConfig);
    driver = sbDriver;
    remote = { kind: 'supabase', url: supabaseConfig.url };
    supabaseDriver = { driver: sbDriver, supabase: sbClient };
    console.log(`  Database : Supabase PostgreSQL — ${supabaseConfig.url}`);
  } catch (err) {
    console.error(`  [storage] Supabase driver failed: ${err.message} — falling back to local SQLite.`);
    supabaseDriver = null;
  }
}

const photoSetup = photosLib.createFromEnv({
  dataDir: DATA_DIR,
  dirName: 'uploads',
  log: (message) => console.log(message)
});
const photos = photoSetup.store;

if (driverError) {
  console.warn(`[storage] node:sqlite unavailable (${driverError.message}). Falling back to JSON store.`);
}

const api = apiLib.createApi({
  db: driver,
  secret,
  dataDir: DATA_DIR,
  photos,
  remoteStatus() {
    if (supabaseDriver) {
      return {
        database: { kind: 'supabase', ...supabaseDriver.driver.stats() },
        photos: photos.stats()
      };
    }
    return {
      database: remote ? { kind: 'd1', ...driver.stats() } : { kind: driver.kind },
      photos: photos.stats()
    };
  }
});

async function persist() {
  try {
    if (supabaseDriver) {
      await supabaseDriver.driver.flush();
    } else if (driver.flush) {
      await driver.flush();
    }
    await photos.flush();
  } catch (err) {
    console.error(`[storage] could not save yet: ${err.message} — will retry.`);
  }
}

/* ------------------------------------------------------- first-run bootstrap */

function ensureAdmin() {
  const primary = (process.env.ADMIN_EMAIL || 'admin@teernova.com').trim().toLowerCase();
  const provided = process.env.ADMIN_PASSWORD;
  const password = provided && String(provided).length >= 8 ? String(provided) : authLib.randomToken(8) + 'Aa1';
  const now = Date.now();

  for (const email of [primary]) {
    const existing = driver.one('users', { email });
    if (!existing) continue;
    if (existing.role === 'admin' && existing.status === 'active' && Number(existing.email_verified) === 1) continue;
    driver.update('users', { id: existing.id }, {
      role: 'admin', status: 'active', email_verified: 1, verification_token: null
    });
  }

  if (driver.one('users', { email: primary })) return;

  const user = driver.insert('users', {
    email: primary,
    password_hash: authLib.hashPassword(password),
    name: 'TEERNOVA Administrator',
    role: 'admin',
    status: 'active',
    email_verified: 1,
    verification_token: null,
    reset_token: null,
    reset_expires: 0,
    token_version: 1,
    photo: null,
    last_login: 0,
    created_at: now
  });

  console.log('');
  console.log('  TEERNOVA Administrator account created');
  console.log(`  Email    : ${primary}`);
  console.log(`  Password : ${password}`);
  console.log('  Panel    : /admin.html');
  console.log('');
}

function ensureDefaultSettings() {
  const rows = driver.all('settings');
  if (rows.length) return;
  settingsLib.setMany(driver, settingsLib.DEFAULTS);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadRemoteDatabase() {
  const attempts = Number(process.env.PJS_BOOT_RETRIES || 6);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await opened.ready();
    } catch (err) {
      lastError = err;
      console.error(`[storage] D1 unavailable (attempt ${attempt}/${attempts}): ${err.message}`);
      await sleep(1500 * attempt);
    }
  }
  console.error('');
  console.error('  ⚠  THE DATABASE COULD NOT BE REACHED — THE SITE WILL NOT START');
  console.error(`     ${lastError && lastError.message}`);
  console.error('     Check CF_ACCOUNT_ID, CF_D1_DATABASE_ID and CF_D1_API_TOKEN.');
  console.error('');
  process.exit(1);
}

async function main() {
  if (supabaseDriver) {
    const tables = Object.keys(dbLib.TABLES);
    try {
      const rowsByTable = await supabaseLib.loadSupabaseTables(supabaseDriver.supabase, tables);
      for (const [table, rows] of Object.entries(rowsByTable)) {
        supabaseDriver.driver.state.tables[table] = rows;
      }
      supabaseDriver.driver.state.seq = supabaseLib.computeSequences(rowsByTable);
      console.log(`  Database : Supabase PostgreSQL — ${Object.values(rowsByTable).reduce((n, r) => n + r.length, 0)} rows loaded`);
    } catch (err) {
      console.error('');
      console.error(`  ⚠  SUPABASE COULD NOT BE REACHED — THE SITE WILL NOT START`);
      console.error(`     ${err.message}`);
      console.error('     Check SUPABASE_URL and SUPABASE_KEY, then redeploy.');
      console.error('');
      process.exit(1);
    }
  } else if (opened.ready) {
    const info = await loadRemoteDatabase();
    console.log(`  Database : Cloudflare D1 — ${info.rows} rows loaded`);
  }

  ensureAdmin();
  ensureDefaultSettings();
  await persist();

  if (driver.flush || supabaseDriver) {
    const timer = setInterval(() => {
      persist().catch(() => {});
    }, Number(process.env.PJS_FLUSH_INTERVAL_MS || 5000));
    timer.unref();
  }

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  TEERNOVA is running');
    console.log(`  URL     : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`  Storage : ${supabaseDriver ? 'supabase' : driver.kind} (${DATA_DIR})`);
    console.log(`  Photos  : ${photos.kind}${photos.remote ? ' (mirrored)' : ''}`);
    console.log('  Live Teer Results • Smart Statistics • Trusted Information');
    console.log('');
  });
}

/* ------------------------------------------------------------- static files */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};

function sendFile(res, filePath, { cache = false } = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      const notFound = path.join(PUBLIC_DIR, '404.html');
      if (fs.existsSync(notFound)) {
        res.writeHead(404, Object.assign({ 'Content-Type': MIME['.html'] }, SECURITY_HEADERS));
        fs.createReadStream(notFound).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(
      200,
      Object.assign(
        {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Content-Length': stat.size,
          'Cache-Control': cache ? 'public, max-age=86400' : 'no-cache'
        },
        SECURITY_HEADERS
      )
    );
    fs.createReadStream(filePath).pipe(res);
  });
}

function resolveStatic(pathname) {
  let clean = decodeURIComponent(pathname);
  if (clean.endsWith('/')) clean += 'index.html';
  const target = path.normalize(path.join(PUBLIC_DIR, clean));
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) return null;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory())
    return path.join(target, 'index.html');
  return target;
}

function publicOrigin(req) {
  const pinned = process.env.SITE_URL;
  if (pinned && /^https?:\/\//i.test(pinned)) return pinned.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${String(proto).split(',')[0].trim()}://${String(host).split(',')[0].trim()}`;
}

/* ------------------------------------------------------------------- server */

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, SECURITY_HEADERS);
    res.end();
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    await api.handle(req, res, url);
    await persist();
    return;
  }

  if (url.pathname.startsWith('/uploads/')) {
    const name = path.basename(url.pathname);
    const file = await photos.ensure(name);
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    sendFile(res, file, { cache: true });
    return;
  }

  if (url.pathname === '/robots.txt') {
    const origin = publicOrigin(req);
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS));
    res.end(
      'User-agent: *\n' +
      'Allow: /\n' +
      'Disallow: /admin.html\n' +
      'Disallow: /settings.html\n' +
      'Disallow: /dashboard.html\n' +
      'Disallow: /admin\n' +
      'Disallow: /api/\n' +
      `Sitemap: ${origin}/sitemap.xml\n`
    );
    return;
  }

  if (url.pathname === '/sitemap.xml') {
    const origin = publicOrigin(req);
    const urls = ['/', '/results.html', '/history.html', '/statistics.html', '/sessions.html', '/demo.html', '/about.html'];
    res.writeHead(200, Object.assign({ 'Content-Type': MIME['.xml'] }, SECURITY_HEADERS));
    res.end(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/sitemap/0.9">\n' +
      urls.map((p) => `  <url><loc>${origin}${p}</loc><changefreq>daily</changefreq></url>`).join('\n') +
      '\n</urlset>\n'
    );
    return;
  }

  const target = resolveStatic(url.pathname);
  if (!target) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  sendFile(res, target, { cache: url.pathname.startsWith('/assets/') });
});

main().catch((err) => {
  console.error('\n  Fatal error during start-up:');
  console.error(`  ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});

async function shutdown() {
  console.log('\n  Shutting down…');
  await persist();
  try { await driver.close(); } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
