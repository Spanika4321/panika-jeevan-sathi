'use strict';
/**
 * PANIKA JEEVAN SATHI — application server.
 *
 *   node server.js          →  http://localhost:3000
 *
 * Zero npm dependencies: Node.js >= 22.5 (uses the built-in node:sqlite driver).
 * All data lives in ./data (SQLite database + uploaded photos), so the site can
 * be moved to another server by copying that folder.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const dbLib = require('./lib/db');
const authLib = require('./lib/auth');
const settingsLib = require('./lib/settings');
const apiLib = require('./lib/api');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.PJS_DATA_DIR || path.join(ROOT, 'data');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

/* ------------------------------------------------------------------ storage */

const { driver, driverError } = dbLib.open(DATA_DIR);
const secret = authLib.loadSecret(DATA_DIR);
const uploadDir = path.join(DATA_DIR, apiLib.UPLOAD_DIR_NAME);
fs.mkdirSync(uploadDir, { recursive: true });

if (driverError) {
  console.warn(
    `[storage] node:sqlite unavailable (${driverError.message}). Falling back to the JSON store in ${DATA_DIR}.`
  );
}

const api = apiLib.createApi({ db: driver, secret, dataDir: DATA_DIR });

/* ------------------------------------------------------- first-run bootstrap */

function ensureAdmin() {
  const existing = driver.one('users', { role: 'admin' });
  if (existing) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@panikajeevansathi.com').toLowerCase();
  const provided = process.env.ADMIN_PASSWORD;
  let password = provided;
  let generated = false;
  if (!password) {
    password = authLib.randomToken(6) + 'Aa1';
    generated = true;
  }
  const now = Date.now();
  const user = driver.insert('users', {
    email,
    password_hash: authLib.hashPassword(password),
    name: process.env.ADMIN_NAME || 'Site Administrator',
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
  driver.insert('profiles', {
    user_id: user.id,
    updated_at: now,
    visibility: 'hidden',
    searchable: 0,
    hide_photo: 0,
    hide_contact: 1,
    profile_complete: 0
  });

  console.log('');
  console.log('  Administrator account created');
  console.log(`  Email    : ${email}`);
  console.log(`  Password : ${password}${generated ? '   (auto-generated — change it after first login)' : ''}`);
  console.log('  Panel    : /admin.html');
  console.log('');
  if (generated) {
    try {
      fs.writeFileSync(
        path.join(DATA_DIR, 'admin-credentials.txt'),
        `email: ${email}\npassword: ${password}\nChange this password from the admin panel.\n`,
        { mode: 0o600 }
      );
    } catch (_) {
      /* ignore */
    }
  }
}

function ensureDefaultSettings() {
  const rows = driver.all('settings');
  if (rows.length) return;
  settingsLib.setMany(driver, settingsLib.DEFAULTS);
}

ensureAdmin();
ensureDefaultSettings();

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
    return;
  }

  if (url.pathname.startsWith('/uploads/')) {
    const name = path.basename(url.pathname);
    const file = path.join(uploadDir, name);
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    sendFile(res, file, { cache: true });
    return;
  }

  if (url.pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /settings.html\n');
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

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  PANIKA JEEVAN SATHI is running');
  console.log(`  URL     : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Storage : ${driver.kind} (${DATA_DIR})`);
  console.log('  Free forever — no payments, no locked profiles.');
  console.log('');
});

function shutdown() {
  console.log('\n  Shutting down…');
  try {
    driver.close();
  } catch (_) {
    /* ignore */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
