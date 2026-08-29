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
const ownerLib = require('./lib/owner');
const photosLib = require('./lib/photos');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.PJS_DATA_DIR || path.join(ROOT, 'data');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

/* ------------------------------------------------------------------ storage */

const opened = dbLib.open(DATA_DIR, { log: (message) => console.log(message) });
const driver = opened.driver;
const driverError = opened.driverError;
const remote = opened.remote;
const secret = authLib.loadSecret(DATA_DIR);

/* Photos: local folder, mirrored to Cloudflare R2 when R2 is configured. */
const photoSetup = photosLib.createFromEnv({
  dataDir: DATA_DIR,
  dirName: apiLib.UPLOAD_DIR_NAME,
  log: (message) => console.log(message)
});
const photos = photoSetup.store;

if (driverError) {
  console.warn(
    `[storage] node:sqlite unavailable (${driverError.message}). Falling back to the JSON store in ${DATA_DIR}.`
  );
}
if (photoSetup.config && driver.kind !== 'd1') {
  console.warn('[storage] R2 is configured but the database is local — check PJS_STORAGE / CF_* variables.');
}
if (!photoSetup.config && driver.kind === 'd1') {
  console.warn('[storage] The database is remote but R2 is not configured: uploaded photos will be lost when the host restarts.');
}

const api = apiLib.createApi({
  db: driver,
  secret,
  dataDir: DATA_DIR,
  photos,
  remoteStatus() {
    return {
      database: remote ? { kind: 'd1', ...driver.stats() } : { kind: driver.kind },
      photos: photos.stats()
    };
  }
});

/** Write queued changes (database + photos) to the remote services. */
async function persist() {
  try {
    if (driver.flush) await driver.flush();
    await photos.flush();
  } catch (err) {
    // The queue is kept, so the next request, the timer or shutdown retries.
    console.error(`[storage] could not save yet: ${err.message} — will retry.`);
  }
}

/* ------------------------------------------------------- first-run bootstrap */

function ensureAdmin() {
  const primary = (process.env.ADMIN_EMAIL || ownerLib.DEFAULT_OWNER_EMAIL).trim().toLowerCase();
  const provided = process.env.ADMIN_PASSWORD;
  const password = provided && String(provided).length >= 8 ? String(provided) : authLib.randomToken(8) + 'Aa1';
  const now = Date.now();

  for (const email of ownerLib.ownerEmails()) {
    const existing = driver.one('users', { email });
    if (!existing) continue;
    if (existing.role === 'admin' && existing.status === 'active' && Number(existing.email_verified) === 1) continue;
    driver.update(
      'users',
      { id: existing.id },
      { role: 'admin', status: 'active', email_verified: 1, verification_token: null }
    );
    console.log('');
    console.log(`  Promoted existing member to administrator: ${email}`);
    console.log('  Log in at /admin.html with this account’s existing password — it is no longer a normal user.');
    console.log('');
  }

  if (driver.one('users', { email: primary })) return;

  const user = driver.insert('users', {
    email: primary,
    password_hash: authLib.hashPassword(password),
    name: ownerLib.defaultOwnerName(),
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
  console.log(`  Email    : ${primary}`);
  console.log(`  Password : ${password}`);
  console.log('  Panel    : /admin.html');
  console.log('  This is the site-owner account — not a normal member.');
  console.log('');
  try {
    fs.writeFileSync(
      path.join(DATA_DIR, 'admin-credentials.txt'),
      `email: ${primary}\npassword: ${password}\nLog in at /admin.html\nChange this password from Settings after first login.\n`,
      { mode: 0o600 }
    );
  } catch (_) {
    /* ignore */
  }
}

function ensureDefaultSettings() {
  const rows = driver.all('settings');
  if (rows.length) return;
  settingsLib.setMany(driver, settingsLib.DEFAULTS);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load the remote database (Cloudflare D1) before the site accepts traffic.
 * Serving an empty site because D1 could not be reached would look exactly
 * like total data loss, so we retry and then exit loudly instead.
 */
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
  console.error('     Check CF_ACCOUNT_ID, CF_D1_DATABASE_ID and CF_D1_API_TOKEN on this service,');
  console.error('     then redeploy. Starting anyway would wipe the site back to zero members.');
  console.error('');
  process.exit(1);
}

async function main() {
  if (opened.ready) {
    const info = await loadRemoteDatabase();
    console.log(`  Database : Cloudflare D1 — ${info.rows} rows loaded from ${info.tables} tables`);
  }

  ensureAdmin();
  ensureDefaultSettings();
  await persist();

  // Safety net: anything the request path could not save is retried here.
  if (driver.flush) {
    const timer = setInterval(() => {
      persist().catch(() => {});
    }, Number(process.env.PJS_FLUSH_INTERVAL_MS || 5000));
    timer.unref();
  }

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  PANIKA JEEVAN SATHI is running');
    console.log(`  URL     : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`  Storage : ${driver.kind} (${DATA_DIR})`);
    console.log(`  Photos  : ${photos.kind}${photos.remote ? ' (mirrored to R2)' : ''}`);
    console.log('  Free forever — no payments, no locked profiles.');
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

/* ----------------------------------------------------------- robots/sitemap */

// Pages meant for search engines (public marketing/legal pages only).
const PUBLIC_PAGES = ['/', '/about.html', '/contact.html', '/login.html', '/privacy.html', '/terms.html'];

// Members-only or account pages — crawlers should stay out.
const PRIVATE_PAGES = [
  'admin.html',
  'settings.html',
  'dashboard.html',
  'matches.html',
  'messages.html',
  'notifications.html',
  'interests.html',
  'shortlist.html',
  'edit-profile.html',
  'profile.html',
  'search.html',
  'reset-password.html',
  'verify-email.html'
];

function publicOrigin(req) {
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
    // On hosts without a disk the photo is fetched from R2 and cached.
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
        PRIVATE_PAGES.map((p) => `Disallow: /${p}`).join('\n') +
        '\nDisallow: /api/\n' +
        'Disallow: /uploads/\n' +
        `\nSitemap: ${origin}/sitemap.xml\n`
    );
    return;
  }

  if (url.pathname === '/sitemap.xml') {
    const origin = publicOrigin(req);
    const urls = PUBLIC_PAGES.map(
      (p) => `  <url><loc>${origin}${p}</loc><changefreq>weekly</changefreq></url>`
    ).join('\n');
    res.writeHead(200, Object.assign({ 'Content-Type': MIME['.xml'] }, SECURITY_HEADERS));
    res.end(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls +
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
  // Give queued writes their last chance to reach the remote services.
  await persist();
  try {
    await driver.close();
  } catch (_) {
    /* ignore */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
