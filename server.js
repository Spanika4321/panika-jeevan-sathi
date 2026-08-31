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
const seoCenterLib = require('./lib/seo-center');
const hardeningLib = require('./lib/http-hardening');

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

/* Delivery: gzip + ETag validators + CSP/HSTS headers + search-engine tags.
   The HTML files on disk are never rewritten, so the approved design stays
   byte-for-byte identical while the *served* page carries canonical/OG/JSON-LD. */
const delivery = hardeningLib.create({
  publicDir: PUBLIC_DIR,
  log: (message) => console.log(message)
});

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

/**
 * SEO Center (permanent): real Search Console data → Gemini/Router AI →
 * Pooja (research) → Priya (verification) → Manager (plan) → stored report.
 * Admin-only endpoints under /api/seo/*, dashboard at /seo-center.html.
 */
const seoCenter = seoCenterLib.createSeoCenter({
  dataDir: DATA_DIR,
  secret,
  db: driver,
  auth: authLib,
  log: (message) => console.log(message)
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

    // SEO Center cycle scheduler (Check → Search Data → AI → Pooja → Priya →
    // Manager → Report → Verify). Enabled with SEO_SCHEDULER=1.
    delivery.warm();
    const seoSchedule = seoCenter.startScheduler();
    if (seoSchedule.enabled) {
      console.log(`  SEO Center scheduler ON — next cycle: ${seoSchedule.next.next_run_at} (${seoSchedule.next.mode}).`);
    } else {
      console.log('  SEO Center scheduler OFF — enable with SEO_SCHEDULER=1 (or use GitHub Actions / cron).');
    }
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

/** Serve a static file through the delivery layer (gzip, ETag, CSP, head tags). */
function sendFile(req, res, filePath, opts = {}) {
  return delivery.respond(req, res, filePath, opts);
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
  'seo-center.html',
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
  // SITE_URL pins the canonical production origin (robots.txt + sitemap.xml),
  // so search engines always see the public URL even behind a proxy or when
  // the app is also reachable through an internal host.
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
    res.writeHead(204, delivery.headers(req));
    res.end();
    return;
  }

  if (url.pathname.startsWith('/api/seo/')) {
    delivery.wrap(req, res);
    await seoCenter.handle(req, res, url);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    delivery.wrap(req, res);
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
    sendFile(req, res, file, { cache: true, htmlPage: false });
    return;
  }

  if (url.pathname === '/security.txt' || url.pathname === '/.well-known/security.txt') {
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }, delivery.headers(req)));
    res.end(
      'Contact: mailto:' + ownerLib.securityContact() + '\n' +
      'Acknowledgements: We thank reporters and publish a fix within 72 hours of a confirmed report.\n' +
      'Preferred-Languages: en, hi\n' +
      'Canonical: ' + publicOrigin(req) + '/security.txt\n' +
      'Policy: ' + publicOrigin(req) + '/privacy.html\n' +
      'Expires: ' + new Date(Date.now() + 31536000000).toISOString().slice(0, 10) + '\n'
    );
    return;
  }

  if (url.pathname === '/robots.txt') {
    const origin = publicOrigin(req);
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, delivery.headers(req)));
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
    const urls = PUBLIC_PAGES.map((p) => {
      const file = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p);
      let lastmod = new Date().toISOString().slice(0, 10);
      try {
        lastmod = fs.statSync(file).mtime.toISOString().slice(0, 10);
      } catch (_) {
        /* fall back to today */
      }
      return (
        `  <url><loc>${origin}${p}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>${
          p === '/' ? '1.0' : '0.6'
        }</priority></url>`
      );
    }).join('\n');
    res.writeHead(200, Object.assign({ 'Content-Type': MIME['.xml'] }, delivery.headers(req)));
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
    res.writeHead(403, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, delivery.headers(req)));
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    delivery.respondNotFound(req, res);
    return;
  }
  sendFile(req, res, target, { cache: url.pathname.startsWith('/assets/') });
});

main().catch((err) => {
  console.error('\n  Fatal error during start-up:');
  console.error(`  ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});

async function shutdown() {
  console.log('\n  Shutting down…');
  seoCenter.stopScheduler();
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
