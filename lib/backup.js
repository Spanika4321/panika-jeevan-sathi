'use strict';
/**
 * PANIKA JEEVAN SATHI — backup & restore of the whole data directory.
 *
 * Everything the site knows lives in one folder (PJS_DATA_DIR): the SQLite
 * database, the uploaded photos, the mail outbox, the session secret and the
 * settings table. A backup is therefore simply a gzipped tar of that folder —
 * portable, human-checkable with `tar tzf`, and restorable on any host.
 *
 * Zero npm dependencies (node:fs + node:zlib only).
 *
 *   Backup contents : panika-jeevan-sathi.db (+ -wal), .json store, uploads/*,
 *                     outbox/*, .session-secret, manifest.json
 *   Never included  : the backups folder itself (no recursion), *-shm, symlinks
 *
 *   create({dataDir, driver, label}) → { file, bytes, members, … }
 *   restore({dataDir, file})         → writes the archive back into a folder
 *   list(backupDir)                  → newest first, with manifest metadata
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { once } = require('node:events');
const { finished } = require('node:stream/promises');

const BACKUP_SUBDIR = 'backups';
const BACKUP_FILE_PREFIX = 'pjs-backup-';
const MANIFEST_NAME = 'manifest.json';
const NAME_RE = /^pjs-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(-[a-z0-9]+)*\.tar\.gz$/;
const BLOCK = 512;
const ZERO_BLOCK = Buffer.alloc(BLOCK);

/** Files above this size are skipped (and reported) instead of hanging a host. */
const MAX_MEMBER_BYTES = Number(process.env.PJS_BACKUP_MAX_FILE_MB || 256) * 1024 * 1024;

/**
 * The database, its WAL, the JSON store, the session secret and the owner
 * credentials are read fully into memory in one synchronous pass, so a live
 * site cannot half-write them into the archive. Everything else (photos, mail)
 * is streamed and is append-only, so streaming is safe.
 */
const CRITICAL_RE = /(\.db|\.db-wal|\.json|\.session-secret|admin-credentials\.txt)$/;
const MAX_INLINE_BYTES = 64 * 1024 * 1024;

/* ------------------------------------------------------------------ config */

function backupDirFor(dataDir) {
  const custom = process.env.PJS_BACKUP_DIR;
  if (custom && String(custom).trim()) return path.resolve(String(custom).trim());
  return path.join(dataDir, BACKUP_SUBDIR);
}

function keepCount() {
  const n = Number.parseInt(process.env.PJS_BACKUP_KEEP, 10);
  if (!Number.isFinite(n) || n < 1) return 14;
  return Math.min(n, 500);
}

/** Automatic backup schedule, read from the environment. */
function autoSettings() {
  const off = process.env.PJS_AUTO_BACKUP === 'off' || process.env.PJS_AUTO_BACKUP === '0';
  const hours = Number(process.env.PJS_BACKUP_INTERVAL_HOURS);
  return {
    enabled: !off,
    intervalHours: Number.isFinite(hours) && hours >= 1 ? Math.min(Math.floor(hours), 8760) : 12,
    keep: keepCount()
  };
}

/* --------------------------------------------------------- runtime state */

const state = { lastRunAt: 0, lastFile: null, lastBytes: 0, lastError: null, nextRunAt: 0, runs: 0 };

function getState() {
  return Object.assign({}, state);
}

function setState(patch) {
  Object.assign(state, patch);
  return state;
}

/* ------------------------------------------------------------ tar helpers */

function octal(value, fieldLength) {
  const s = Math.max(0, Math.floor(Number(value) || 0)).toString(8);
  return s.padStart(fieldLength - 1, '0').slice(-(fieldLength - 1)) + '\0';
}

/**
 * USTAR splits a path into `name` (100 bytes) + `prefix` (156 bytes). Long
 * member names (deep upload folders) are split at a '/' boundary.
 */
function splitEntryName(name) {
  if (Buffer.byteLength(name, 'utf8') <= 100) return { name, prefix: '' };
  const parts = name.split('/');
  let best = null;
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    const rest = parts.slice(i).join('/');
    if (Buffer.byteLength(rest, 'utf8') <= 100 && Buffer.byteLength(prefix, 'utf8') <= 155) {
      best = { name: rest, prefix };
      break;
    }
  }
  if (!best) {
    // Extremely unlikely: a single path component longer than 100 bytes.
    best = { name: name.slice(0, 99), prefix: '' };
  }
  return best;
}

function tarHeader(entry) {
  const { name, prefix } = splitEntryName(entry.rel.replace(/\\/g, '/'));
  const buf = Buffer.alloc(BLOCK);
  buf.write(name, 0, 100, 'utf8');
  buf.write(octal(entry.mode || 0o600, 8), 100, 8, 'utf8');
  buf.write(octal(0, 8), 108, 8, 'utf8'); // uid
  buf.write(octal(0, 8), 116, 8, 'utf8'); // gid
  buf.write(octal(entry.size, 12), 124, 12, 'utf8');
  buf.write(octal(Math.floor(entry.mtime / 1000), 12), 136, 12, 'utf8');
  buf.write(' '.repeat(8), 148, 8, 'utf8'); // checksum placeholder
  buf.write(entry.type === 'dir' ? '5' : '0', 156, 1, 'utf8');
  buf.write('ustar\0', 257, 6, 'utf8');
  buf.write('00', 263, 2, 'utf8');
  buf.write('pjs', 265, 32, 'utf8');
  if (prefix) buf.write(prefix, 345, 155, 'utf8');

  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
  return buf;
}

async function push(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

/* ------------------------------------------------------------- collection */

function shouldSkip(rel) {
  const base = path.basename(rel);
  if (base.endsWith('-shm')) return true;
  return false;
}

/** Walk the data directory and return the members that belong in a backup. */
function collectEntries(dataDir, backupDir) {
  const out = [];
  const skipped = [];
  const dataRoot = path.resolve(dataDir);
  const excludeRoot = path.resolve(backupDir);

  function walk(relDir) {
    const absDir = path.join(dataRoot, relDir);
    let names = [];
    try {
      names = fs.readdirSync(absDir);
    } catch (_) {
      return;
    }
    for (const name of names.sort()) {
      const rel = relDir ? `${relDir}/${name}` : name;
      const abs = path.join(absDir, name);
      let stat;
      try {
        stat = fs.lstatSync(abs);
      } catch (_) {
        continue;
      }
      if (stat.isSymbolicLink()) continue; // never follow links into the backup
      if (path.resolve(abs) === excludeRoot || path.resolve(abs + path.sep).startsWith(excludeRoot + path.sep)) {
        continue; // never archive the backups folder itself
      }
      if (stat.isDirectory()) {
        walk(rel);
        continue;
      }
      if (!stat.isFile()) continue;
      if (shouldSkip(rel)) continue;
      if (stat.size > MAX_MEMBER_BYTES) {
        skipped.push({ file: rel, bytes: stat.size, reason: 'too large' });
        continue;
      }
      out.push({
        rel,
        abs,
        size: stat.size,
        mtime: stat.mtimeMs,
        mode: 0o600,
        type: 'file',
        critical: CRITICAL_RE.test(name) && stat.size <= MAX_INLINE_BYTES
      });
    }
  }

  walk('');
  return { entries: out, skipped };
}

function tableCounts(driver) {
  const counts = {};
  if (!driver || typeof driver.count !== 'function') return counts;
  const tables = ['users', 'profiles', 'interests', 'shortlist', 'messages', 'notifications', 'reports', 'stories', 'contact_messages', 'settings', 'audit_logs'];
  for (const t of tables) {
    try {
      counts[t] = driver.count(t);
    } catch (_) {
      /* table may not exist in an older store — not a backup failure */
    }
  }
  return counts;
}

function checkpoint(driver) {
  if (!driver || driver.kind !== 'sqlite' || typeof driver.exec !== 'function') return false;
  try {
    driver.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    return true;
  } catch (_) {
    return false;
  }
}

/* -------------------------------------------------------------- timestamp */

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, (m) => (m === ':' ? '-' : m)).replace(/\.\d{3}Z$/, 'Z');
}

/* ------------------------------------------------------------------ create */

/**
 * Write a timestamped, gzipped tar of `dataDir` into the backup folder.
 * The file is written as `*.partial` and renamed at the end, so an interrupted
 * run can never masquerade as a good backup.
 */
async function create(options) {
  const opts = options || {};
  const dataDir = path.resolve(opts.dataDir || process.env.PJS_DATA_DIR || path.join(__dirname, '..', 'data'));
  const backupDir = backupDirFor(dataDir);
  fs.mkdirSync(backupDir, { recursive: true });

  const checkpointed = checkpoint(opts.driver);
  const { entries, skipped } = collectEntries(dataDir, backupDir);

  // Synchronous snapshot of the critical files — no await between reads.
  for (const entry of entries) {
    if (!entry.critical) continue;
    try {
      entry.buffer = fs.readFileSync(entry.abs);
      entry.size = entry.buffer.length;
    } catch (_) {
      entry.buffer = null;
    }
  }

  const record = {
    app: 'panika-jeevan-sathi',
    created_at: new Date().toISOString(),
    created_ms: Date.now(),
    store: opts.driver && opts.driver.kind ? opts.driver.kind : 'unknown',
    data_dir: dataDir,
    label: String(opts.label || 'manual').slice(0, 40),
    node: process.version,
    wal_checkpointed: checkpointed,
    members: entries.length,
    bytes: entries.reduce((n, e) => n + e.size, 0),
    counts: tableCounts(opts.driver),
    files: entries.map((e) => ({ file: e.rel, bytes: e.size })),
    skipped
  };
  const manifest = Buffer.from(JSON.stringify(record, null, 2) + '\n', 'utf8');

  const tag = String(opts.tag || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);
  const stem = `${BACKUP_FILE_PREFIX}${stamp()}${tag ? `-${tag}` : ''}`;
  // Timestamps only have second resolution: two clicks in the same second must
  // not overwrite each other.
  let file = `${stem}.tar.gz`;
  for (let n = 2; fs.existsSync(path.join(backupDir, file)); n++) file = `${stem}-${n}.tar.gz`;
  const finalPath = path.join(backupDir, file);
  const tmpPath = finalPath + '.partial';

  const out = fs.createWriteStream(tmpPath, { mode: 0o600 });
  const gz = zlib.createGzip({ level: 6 });
  gz.pipe(out);

  await push(gz, tarHeader({ rel: MANIFEST_NAME, size: manifest.length, mtime: Date.now(), mode: 0o600 }));
  await push(gz, manifest);
  const pad = manifest.length % BLOCK === 0 ? 0 : BLOCK - (manifest.length % BLOCK);
  if (pad) await push(gz, Buffer.alloc(pad));

  for (const entry of entries) {
    if (entry.critical && entry.buffer) {
      const size = entry.buffer.length;
      await push(gz, tarHeader(Object.assign({}, entry, { size })));
      if (size) await push(gz, entry.buffer);
      const padBytes = size % BLOCK === 0 ? 0 : BLOCK - (size % BLOCK);
      if (padBytes) await push(gz, Buffer.alloc(padBytes));
      entry.buffer = null; // release before the next file
      continue;
    }
    await push(gz, tarHeader(entry));
    const stream = fs.createReadStream(entry.abs);
    for await (const chunk of stream) await push(gz, chunk);
    await finished(stream);
    const padding = entry.size % BLOCK === 0 ? 0 : BLOCK - (entry.size % BLOCK);
    if (padding) await push(gz, Buffer.alloc(padding));
  }

  await push(gz, ZERO_BLOCK);
  await push(gz, ZERO_BLOCK);
  gz.end();
  await finished(out);
  fs.renameSync(tmpPath, finalPath);

  const stat = fs.statSync(finalPath);
  const result = {
    file,
    path: finalPath,
    bytes: stat.size,
    created_ms: record.created_ms,
    created_at: record.created_at,
    members: record.members,
    data_bytes: record.bytes,
    counts: record.counts,
    store: record.store,
    label: record.label,
    skipped
  };

  if (opts.verify) {
    const verification = verifyArchive(finalPath);
    result.verification = verification;
    if (!verification.ok) console.error(`[backup] ✗ verification failed for ${file}: ${verification.detail}`);
  }

  writeSidecar(backupDir, file, result);
  mirror(finalPath, file, backupDir);
  prune(backupDir, keepCount());

  setState({
    lastRunAt: Date.now(),
    lastFile: file,
    lastBytes: stat.size,
    lastError: result.verification && !result.verification.ok ? result.verification.detail : null,
    runs: state.runs + 1
  });
  return result;
}


function writeSidecar(backupDir, file, result) {
  try {
    fs.writeFileSync(path.join(backupDir, file + '.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  } catch (_) {
    /* the archive is the deliverable — a missing sidecar is cosmetic */
  }
}

/** Optionally copy each finished backup to a second location (mount/网盘/S3-fuse). */
function mirror(finalPath, file, backupDir) {
  const target = process.env.PJS_BACKUP_MIRROR;
  if (!target || !String(target).trim()) return false;
  const dir = path.resolve(String(target).trim());
  if (dir === path.resolve(backupDir)) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(finalPath, path.join(dir, file));
    const sidecar = finalPath + '.json';
    if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, path.join(dir, file + '.json'));
    return true;
  } catch (err) {
    console.warn('[backup] mirror copy failed:', err.message);
    return false;
  }
}

function prune(backupDir, keep) {
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => NAME_RE.test(f))
      .sort(); // ISO-8601 names sort chronologically
    const extra = files.length - Math.max(1, keep);
    if (extra <= 0) return 0;
    for (const old of files.slice(0, extra)) {
      try {
        fs.unlinkSync(path.join(backupDir, old));
      } catch (_) {
        /* ignore */
      }
      const sidecar = path.join(backupDir, old + '.json');
      try {
        if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
      } catch (_) {
        /* ignore */
      }
    }
    return extra;
  } catch (_) {
    return 0;
  }
}

/* -------------------------------------------------------------------- list */

function list(backupDir) {
  let names = [];
  try {
    names = fs.readdirSync(backupDir);
  } catch (_) {
    return [];
  }
  return names
    .filter((f) => NAME_RE.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const abs = path.join(backupDir, f);
      let stat = null;
      try {
        stat = fs.statSync(abs);
      } catch (_) {
        return null;
      }
      let meta = null;
      try {
        meta = JSON.parse(fs.readFileSync(abs + '.json', 'utf8'));
      } catch (_) {
        meta = null;
      }
      return {
        file: f,
        bytes: stat.size,
        created_ms: meta && meta.created_ms ? meta.created_ms : Math.floor(stat.mtimeMs),
        created_at: meta && meta.created_at ? meta.created_at : new Date(stat.mtimeMs).toISOString(),
        members: meta ? meta.members : null,
        counts: meta ? meta.counts : null,
        label: meta ? meta.label : null,
        store: meta ? meta.store : null
      };
    })
    .filter(Boolean);
}

function status(options) {
  const opts = options || {};
  const dataDir = path.resolve(opts.dataDir || process.env.PJS_DATA_DIR || path.join(__dirname, '..', 'data'));
  const backupDir = backupDirFor(dataDir);
  const backups = list(backupDir);
  let dataBytes = 0;
  try {
    const { entries } = collectEntries(dataDir, backupDir);
    dataBytes = entries.reduce((n, e) => n + e.size, 0);
  } catch (_) {
    dataBytes = 0;
  }
  const auto = autoSettings();
  return {
    data_dir: dataDir,
    backup_dir: backupDir,
    mirror: process.env.PJS_BACKUP_MIRROR ? path.resolve(String(process.env.PJS_BACKUP_MIRROR).trim()) : null,
    data_bytes: dataBytes,
    keep: auto.keep,
    auto,
    count: backups.length,
    latest: backups[0] || null,
    backups: backups.slice(0, 10),
    schedule: getState()
  };
}

/* -------------------------------------------------------------- integrity */

/**
 * Prove a backup is actually usable: open the archived database on a scratch
 * copy and ask SQLite for an integrity check (or JSON-parse the JSON store).
 * Returns { ok, detail }.
 */
function verifyArchive(absPath) {
  let members;
  try {
    members = readArchive(loadArchive(absPath));
  } catch (err) {
    return { ok: false, detail: `archive unreadable: ${err.message}` };
  }
  const db = members.find((m) => m.rel.endsWith('.db'));
  const json = members.find((m) => m.rel.endsWith('panika-jeevan-sathi.json'));
  const manifest = members.find((m) => m.rel === MANIFEST_NAME);
  if (!manifest) return { ok: false, detail: 'manifest.json missing from the archive' };
  if (json) {
    try {
      const parsed = JSON.parse(json.content.toString('utf8'));
      const users = parsed && parsed.users ? parsed.users.length : 0;
      return { ok: true, detail: `JSON store parses cleanly (${users} member rows)` };
    } catch (err) {
      return { ok: false, detail: `JSON store is corrupt: ${err.message}` };
    }
  }
  if (!db) return { ok: false, detail: 'no database file inside the archive' };
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pjs-verify-'));
  const tmpDb = path.join(tmpDir, 'verify.db');
  try {
    fs.writeFileSync(tmpDb, db.content, { mode: 0o600 });
    const wal = members.find((m) => m.rel.endsWith('.db-wal'));
    if (wal && wal.content.length) fs.writeFileSync(tmpDb + '-wal', wal.content, { mode: 0o600 });
    const { DatabaseSync } = require('node:sqlite');
    const check = new DatabaseSync(tmpDb, { readOnly: true });
    try {
      const row = check.prepare('PRAGMA integrity_check;').get();
      const verdict = row ? Object.values(row)[0] : 'unknown';
      const count = (() => {
        try {
          const r = check.prepare('SELECT COUNT(*) AS n FROM users').get();
          return r ? Number(r.n) : 0;
        } catch (_) {
          return 0;
        }
      })();
      return { ok: String(verdict) === 'ok', detail: `integrity_check=${verdict}, users=${count}` };
    } finally {
      try {
        check.close();
      } catch (_) {
        /* ignore */
      }
    }
  } catch (err) {
    return { ok: false, detail: `could not open archived database: ${err.message}` };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }
}

/* ----------------------------------------------------------------- restore */

function safeTarget(rootDir, rel) {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').includes('..')) return null;
  const target = path.resolve(rootDir, clean);
  if (target !== path.resolve(rootDir) && !target.startsWith(path.resolve(rootDir) + path.sep)) return null;
  return target;
}

/** Read a `.tar.gz` backup and return its members (without writing anything). */
function readArchive(tarBuffer) {
  const members = [];
  let offset = 0;
  const buf = tarBuffer;
  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const type = header.subarray(156, 157).toString('utf8');
    const rel = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(sizeField || '0', 8) || 0;
    if (type === '5' || type === 'd') {
      members.push({ rel, size: 0, type: 'dir' });
      continue;
    }
    if (type !== '0' && type !== '\0' && type !== '') {
      offset += size + (size % BLOCK === 0 ? 0 : BLOCK - (size % BLOCK)); // unsupported member type: skip
      continue;
    }
    const content = Buffer.from(buf.subarray(offset, offset + size));
    offset += size + (size % BLOCK === 0 ? 0 : BLOCK - (size % BLOCK));
    members.push({ rel, size, type: 'file', content });
  }
  return members;
}

function loadArchive(absPath) {
  const raw = fs.readFileSync(absPath);
  return zlib.gunzipSync(raw);
}

/**
 * Restore a backup into `targetDir`.
 *
 * `targetDir` defaults to the live data directory; the current contents are
 * first copied to `<dataDir>/../pjs-data-before-restore-<stamp>` so a restore is
 * always reversible.
 */
function restore(options) {
  const opts = options || {};
  const targetDir = path.resolve(opts.targetDir || opts.dataDir || process.env.PJS_DATA_DIR || '');
  if (!targetDir) throw Object.assign(new Error('Target directory is required.'), { status: 400 });
  const backupDir = opts.backupDir ? path.resolve(opts.backupDir) : backupDirFor(targetDir);
  const file = path.basename(String(opts.file || ''));
  if (!NAME_RE.test(file)) throw Object.assign(new Error('Not a valid backup file name.'), { status: 400 });

  let archive = path.join(backupDir, file);
  if (!fs.existsSync(archive)) {
    const mirrored = process.env.PJS_BACKUP_MIRROR;
    const alt = mirrored ? path.resolve(String(mirrored).trim(), file) : '';
    if (!alt || !fs.existsSync(alt)) throw Object.assign(new Error('Backup file not found.'), { status: 404 });
    archive = alt;
  }

  const members = readArchive(loadArchive(archive));
  if (!members.length) throw Object.assign(new Error('That backup is empty — nothing was restored.'), { status: 400 });

  let savedTo = null;
  if (opts.snapshot !== false && fs.existsSync(targetDir) && fs.readdirSync(targetDir).length) {
    savedTo = path.join(path.dirname(targetDir), `pjs-data-before-restore-${stamp()}`);
    fs.cpSync(targetDir, savedTo, { recursive: true });
  }

  fs.mkdirSync(targetDir, { recursive: true });
  let written = 0;
  let bytes = 0;
  for (const member of members) {
    if (member.type === 'dir') continue;
    if (member.rel === MANIFEST_NAME) continue;
    const target = safeTarget(targetDir, member.rel);
    if (!target) continue; // path traversal attempt — ignored
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, member.content, { mode: 0o600 });
    written++;
    bytes += member.size;
  }

  const manifest = members.find((m) => m.rel === MANIFEST_NAME);
  return {
    file,
    restored: written,
    bytes,
    previous_data_dir: savedTo,
    manifest: manifest ? JSON.parse(manifest.content.toString('utf8')) : null
  };
}

module.exports = {
  BACKUP_SUBDIR,
  BACKUP_FILE_PREFIX,
  NAME_RE,
  backupDirFor,
  autoSettings,
  create,
  list,
  prune,
  readArchive,
  loadArchive,
  verifyArchive,
  restore,
  status,
  getState,
  setState
};
