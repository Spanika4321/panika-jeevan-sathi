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
const zlib = require('node:zlib');

const dbLib = require('./lib/db');
const authLib = require('./lib/auth');
const settingsLib = require('./lib/settings');
const apiLib = require('./lib/api');
const ownerLib = require('./lib/owner');

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
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  // Same-origin only; 'unsafe-inline' required by the approved inline scripts/styles.
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; " +
    "base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
};

const TEXT_TYPES = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.xml', '.txt', '.webmanifest']);
const SITE_NAME = 'PANIKA JEEVAN SATHI';

function attr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function acceptsGzip(req) {
  return /(^|[,\s])gzip($|[,\s;])/i.test(String(req.headers['accept-encoding'] || ''));
}

function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function responseHeaders(req, contentType, { cache = false, length, gzip = false } = {}) {
  const headers = Object.assign(
    {
      'Content-Type': contentType,
      'Cache-Control': cache ? 'public, max-age=86400' : 'no-cache'
    },
    SECURITY_HEADERS
  );
  if (isHttps(req)) headers['Strict-Transport-Security'] = 'max-age=31536000';
  if (length !== undefined) headers['Content-Length'] = length;
  if (gzip) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }
  return headers;
}

function sendBuffer(req, res, buffer, contentType, { cache = false, compress = true } = {}) {
  if (compress && acceptsGzip(req) && buffer.length >= 256) {
    const gz = zlib.gzipSync(buffer);
    res.writeHead(200, responseHeaders(req, contentType, { cache, length: gz.length, gzip: true }));
    res.end(gz);
    return;
  }
  res.writeHead(200, responseHeaders(req, contentType, { cache, length: buffer.length }));
  res.end(buffer);
}

/**
 * Add canonical / Open Graph / Twitter / JSON-LD tags to public HTML.
 * Injected at request time using the real host, so the tags are always
 * correct no matter which domain the site is served from. Head-only change —
 * the approved page design is untouched.
 */
function injectSeoTags(html, req, pathname) {
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || SITE_NAME;
  const descMatch = html.match(/<meta name="description" content="([^"]*)"/i);
  const desc = descMatch ? descMatch[1] : '';
  const origin = publicOrigin(req);
  const canonPath = pathname === '/index.html' ? '/' : pathname;
  const canonical = origin + (canonPath.startsWith('/') ? canonPath : `/${canonPath}`);
  const image = `${origin}/assets/img/logo.svg`;
  const t = attr(title);
  const d = attr(desc);

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    description: desc || undefined,
    url: canonical
  }).replace(/</g, '\\u003c');

  const tags = [
    `<link rel="canonical" href="${attr(canonical)}">`,
    `<meta property="og:site_name" content="${attr(SITE_NAME)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${attr(canonical)}">`,
    `<meta property="og:image" content="${attr(image)}">`,
    '<meta property="og:locale" content="en_IN">',
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${attr(image)}">`,
    `<script type="application/ld+json">${jsonLd}</script>`
  ].join('\n');

  return html.includes('</head>') ? html.replace('</head>', `${tags}\n</head>`) : html;
}

function sendFile(req, res, filePath, { cache = false } = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      const notFound = path.join(PUBLIC_DIR, '404.html');
      fs.readFile(notFound, (readErr, buf) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found');
          return;
        }
        res.writeHead(404, responseHeaders(req, 'text/html; charset=utf-8', { length: buf.length }));
        res.end(buf);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();

    if (TEXT_TYPES.has(ext)) {
      fs.readFile(filePath, (readErr, buf) => {
        if (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Internal server error');
          return;
        }
        let body = buf;
        if (ext === '.html') {
          body = Buffer.from(injectSeoTags(buf.toString('utf8'), req, req.pjsPathname || '/'), 'utf8');
        }
        sendBuffer(req, res, body, MIME[ext] || 'application/octet-stream', { cache });
      });
      return;
    }

    // Images and other binary assets: stream, never compress (already compressed).
    res.writeHead(200, responseHeaders(req, MIME[ext] || 'application/octet-stream', { cache, length: stat.size }));
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
    return;
  }

  if (url.pathname.startsWith('/uploads/')) {
    const name = path.basename(url.pathname);
    const file = path.join(uploadDir, name);
    if (!fs.existsSync(file)) {
      res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain' }, SECURITY_HEADERS));
      res.end('Not found');
      return;
    }
    sendFile(req, res, file, { cache: true });
    return;
  }

  if (url.pathname === '/robots.txt') {
    const origin = publicOrigin(req);
    sendBuffer(
      req,
      res,
      Buffer.from(
        'User-agent: *\n' +
          'Allow: /\n' +
          PRIVATE_PAGES.map((p) => `Disallow: /${p}`).join('\n') +
          '\nDisallow: /api/\n' +
          'Disallow: /uploads/\n' +
          `\nSitemap: ${origin}/sitemap.xml\n`
      ),
      'text/plain; charset=utf-8'
    );
    return;
  }

  if (url.pathname === '/sitemap.xml') {
    const origin = publicOrigin(req);
    const urls = PUBLIC_PAGES.map(
      (p) =>
        `  <url><loc>${origin}${p}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod><changefreq>weekly</changefreq></url>`
    ).join('\n');
    sendBuffer(
      req,
      res,
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          urls +
          '\n</urlset>\n'
      ),
      MIME['.xml']
    );
    return;
  }

  const target = resolveStatic(url.pathname);
  if (!target) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  req.pjsPathname = url.pathname;
  sendFile(req, res, target, { cache: url.pathname.startsWith('/assets/') });
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
