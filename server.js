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
const backupLib = require('./lib/backup');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.PJS_DATA_DIR || path.join(ROOT, 'data');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

/* ------------------------------------------------------------------ storage */

// Recorded before the store is opened, so boot can tell a brand-new install
// apart from a host that came back with an empty (non-persistent) folder.
const STORE_FILES = ['panika-jeevan-sathi.db', 'panika-jeevan-sathi.json'];
const DATA_DIR_WAS_EMPTY = !STORE_FILES.some((f) => fs.existsSync(path.join(DATA_DIR, f)));

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

/* ------------------------------------------------------------ data safety */

const BACKUP_AUTO = backupLib.autoSettings();
const BACKUP_DIR = backupLib.backupDirFor(DATA_DIR);

function memberCount() {
  try {
    return Number(driver.count('users')) || 0;
  } catch (_) {
    return 0;
  }
}

async function runBackup(label) {
  try {
    const result = await backupLib.create({
      dataDir: DATA_DIR,
      driver,
      label: label || 'auto',
      tag: label || 'auto',
      verify: true
    });
    const users = result.counts && result.counts.users !== undefined ? result.counts.users : '?';
    const verified = result.verification ? (result.verification.ok ? 'verified' : 'COULD NOT BE VERIFIED') : 'written';
    console.log(
      `  [backup] ✓ ${result.file} — ${(result.bytes / 1024).toFixed(0)} KB, ${users} members, ${verified}` +
        (result.verification && !result.verification.ok ? ` (${result.verification.detail})` : '')
    );
    backupLib.setState({ nextRunAt: Date.now() + BACKUP_AUTO.intervalHours * 3600000 });
    return result;
  } catch (err) {
    console.error(`  [backup] ✗ backup failed: ${err.message}`);
    backupLib.setState({ lastError: err.message });
    return null;
  }
}

function startBackupSchedule() {
  if (!BACKUP_AUTO.enabled) {
    console.log('  [backup] automatic backups are off (PJS_AUTO_BACKUP=off)');
    return;
  }
  const every = BACKUP_AUTO.intervalHours * 3600000;
  backupLib.setState({ nextRunAt: Date.now() + every });
  const timer = setInterval(() => {
    if (memberCount() > 0) runBackup('auto');
  }, every);
  if (timer.unref) timer.unref();
  // One snapshot soon after boot, whenever there is real data to protect.
  const first = setTimeout(() => {
    if (memberCount() > 0) runBackup('boot');
  }, 45000);
  if (first.unref) first.unref();
  console.log(
    `  [backup] every ${BACKUP_AUTO.intervalHours}h → ${BACKUP_DIR}` +
      (process.env.PJS_BACKUP_MIRROR ? ` (+ mirror ${process.env.PJS_BACKUP_MIRROR})` : '') +
      `, keeping ${BACKUP_AUTO.keep}`
  );
}

/**
 * The single most common way a site like this loses everything: the host was
 * restarted (or redeployed) with no persistent volume attached, so the app
 * quietly boots a fresh empty database while everyone's profiles sit on a disk
 * that is gone. Compare the live database with the newest backup and shout.
 */
function reportDataState() {
  const members = memberCount();
  const backups = backupLib.list(BACKUP_DIR);
  const latest = backups[0] || null;
  const previousMembers = latest && latest.counts && typeof latest.counts.users === 'number' ? latest.counts.users : 0;

  if (DATA_DIR_WAS_EMPTY && previousMembers > Math.max(members, 1)) {
    console.log('');
    console.log('  ' + '!'.repeat(68));
    console.log('  ⚠  DATA LOSS LOOKS LIKE IT JUST HAPPENED — PLEASE READ');
    console.log('');
    console.log(`     The data folder (${DATA_DIR}) was empty at boot, so the site`);
    console.log(`     started with a fresh database (${members} account${members === 1 ? '' : 's'}).`);
    console.log(`     Your newest backup holds ${previousMembers} members: ${latest.file}`);
    console.log('');
    console.log('     This normally means the persistent disk / volume is NOT attached.');
    console.log('     1. STOP answering on the site so nobody registers into the empty database.');
    console.log('     2. Point PJS_DATA_DIR at the mounted volume (Render: Disks, Railway: Volumes).');
    console.log('     3. node scripts/restore.mjs ' + latest.file + ' --yes');
    console.log('     4. Start the site again and check the member count.');
    console.log('  ' + '!'.repeat(68));
    console.log('');
  }

  if (latest) {
    const mins = Math.max(0, Math.round((Date.now() - latest.created_ms) / 60000));
    console.log(
      `  Members : ${members} · last backup ${mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`} (${latest.file})`
    );
  } else if (BACKUP_AUTO.enabled) {
    console.log(`  Members : ${members} · no backup yet — the first one runs automatically within ${BACKUP_AUTO.intervalHours}h`);
  }
}

startBackupSchedule();
reportDataState();

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

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  PANIKA JEEVAN SATHI is running');
  console.log(`  URL     : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Storage : ${driver.kind} (${DATA_DIR})`);
  console.log('  Free forever — no payments, no locked profiles.');
  console.log('');
});

/**
 * Hosts without a disk throw the filesystem away between deploys. When the
 * backups are outside the data folder (a mirror, or PJS_BACKUP_DIR on other
 * storage) one last snapshot before exit still saves the day.
 */
function backupsLeaveTheDataFolder() {
  if (process.env.PJS_BACKUP_MIRROR) return true;
  const dir = path.resolve(BACKUP_DIR);
  const data = path.resolve(DATA_DIR);
  return dir !== data && !dir.startsWith(data + path.sep);
}

async function shutdown() {
  console.log('\n  Shutting down…');
  if (BACKUP_AUTO.enabled && backupsLeaveTheDataFolder() && memberCount() > 0) {
    // Best effort, never long enough for the host to SIGKILL us mid-exit.
    await Promise.race([runBackup('shutdown'), new Promise((r) => setTimeout(r, 5000))]);
  }
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
