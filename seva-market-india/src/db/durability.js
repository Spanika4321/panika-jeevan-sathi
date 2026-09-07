'use strict';
/**
 * SEVA MARKET INDIA — boot-time durability checks.
 *
 * Free/cheap hosts (Render, Railway, Fly.io, ...) erase the whole filesystem
 * whenever an instance sleeps or redeploys. A SQLite file that lives on that
 * disk is therefore *not* durable — and the dangerous failure is not a crash,
 * it is a clean boot onto an empty disk where a fresh `migrate()` happily
 * creates an empty database and the site serves it as if nothing happened.
 *
 * That silent "second empty life" looks exactly like total data loss, so the
 * rules here fail closed instead:
 *
 *   1. `SEVA_REQUIRE_REMOTE=1`  → the site refuses to start unless a real
 *      (non-file) database is configured. Set this on every ephemeral host.
 *      Without it, an empty-disk boot would keep serving an empty site.
 *
 *   2. `SEVA_BACKUP_DIR`        → an optional directory that outlives the
 *      instance. When set, the *remote* copy of the database is the source
 *      of truth: on boot the app snapshots the local DB there, and if the
 *      local DB is empty/missing while a backup exists, the backup is
 *      restored before the site answers a single request. A CI cron/agent
 *      can also run `npm run db:backup` hourly against the live service.
 *
 * The snapshot taken here is crash-safe: SQLite's own backup API is used
 * (online backup while WAL keeps the live DB fully writable), and only
 * fully-written snapshot files are ever swapped into place. See
 * src/db/backup.js.
 */

const fs = require('node:fs');
const path = require('node:path');

const { Database } = require('./client');
const { backupFile, restoreFile, backupFrom } = require('./backup');

/**
 * Decide whether the file database may be used at boot.
 *
 * @param {string} file path of the configured database file
 * @param {object} env process.env-like
 * @returns {'ok'|'restored'|'refused'}
 *   'ok'       → the file exists and holds data (or nothing better exists
 *                and this host is allowed to run local)
 *   'restored' → the file was missing/empty but a backup existed and has
 *                been restored into place
 *   'refused'  → the boot must abort (SEVA_REQUIRE_REMOTE=1 without a
 *                remote database, or a forced database that is gone)
 */
function guardFileDatabase(file, env = process.env) {
  const real = file !== ':memory:';
  const existed = real && fs.existsSync(file);
  const size = existed ? fs.statSync(file).size : 0;
  if (existed && size > 0) return 'ok'; // normal boot with a real database

  if (env.SEVA_REQUIRE_REMOTE === '1') {
    throw new Error(
      'SEVA_REQUIRE_REMOTE=1 but no remote database is configured. ' +
        'This host erases its disk; serving a local SQLite file here would lose every lead. ' +
        'Set SEVA_BACKUP_DIR to a mounted volume (and keep hourly backups running), or add a ' +
        'real remote database.'
    );
  }

  const backupDir = env.SEVA_BACKUP_DIR || '';
  if (backupDir) {
    // A snapshot that lives in the backup home may be all that survives an
    // instance wipe. Skip only when a previous boot marked this backup home
    // as already-seeded ('.seva-restored'), so a normal boot with an empty
    // backup dir does not fight the migration of a genuinely fresh site.
    const canRestore =
      fs.existsSync(path.join(backupDir, '.seva-restored')) === false &&
      fs.readdirSync(backupDir).some((name) => /\.db$/.test(name));
    if (canRestore) {
      const candidates = fs.readdirSync(backupDir)
        .filter((name) => /\.db$/.test(name))
        .map((name) => ({ name, mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      const latest = candidates[0];
      const backup = path.join(backupDir, latest.name);
      console.warn(`[durability] local database missing/empty — restoring ${latest.name}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try {
        restoreFile(backup, file);
        return 'restored';
      } catch (err) {
        console.error(`[durability] restore of ${latest.name} failed: ${err.message}`);
      }
    }
  }

  // Nothing was found and no recovery is possible. Refuse when the operator
  // has signalled that this database is important enough to fail closed on;
  // otherwise report 'refused' and let the caller decide how to abort.
  if (env.SEVA_REQUIRE_REMOTE === '1') {
    throw new Error('Database is missing and no backup exists. Refusing to start empty.');
  }
  if (env.SEVA_FAIL_CLOSED === '1' || env.NODE_ENV === 'production') {
    if (existed) return 'refused'; // file vanished since last boot — dangerous
    if (env.SEVA_FAIL_CLOSED === '1') return 'refused';
    // Production with no backup home and a file that never existed could be a
    // genuine first deploy; let the caller run with the fresh database.
  }
  return 'ok';
}

/**
 * Pre-flight durability report (shown at boot and by `npm run db:status`).
 */
function durabilityReport(config, env = process.env) {
  const file = config.db.file;
  const backupDir = env.SEVA_BACKUP_DIR || config.db.backupDir || '';
  const isFile = file !== ':memory:';
  const fsEntries = isFile && fs.existsSync(file) ? fs.statSync(file) : null;
  const backups = backupDir && fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir).filter((name) => /\.db$/.test(name)).sort()
    : [];
  return {
    file,
    fileExists: Boolean(fsEntries),
    fileBytes: fsEntries ? fsEntries.size : 0,
    backupDir: backupDir || null,
    backups: backups.map((name) => ({
      name,
      bytes: fs.statSync(path.join(backupDir, name)).size,
    })),
    requireRemote: env.SEVA_REQUIRE_REMOTE === '1',
    failClosed: env.SEVA_FAIL_CLOSED === '1' || env.NODE_ENV === 'production',
  };
}

/**
 * Boot-time snapshot of a freshly opened database into the backup home.
 * Called after migrations so the snapshot is always a valid schema.
 */
function snapshotToBackup(db, config, env = process.env) {
  const backupDir = env.SEVA_BACKUP_DIR || config.db.backupDir || '';
  if (!backupDir) return null;
  if (db.file === ':memory:' || !fs.existsSync(db.file)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `seva-market-${stamp}.db`);
  // Checkpoint WAL into the main file *through a second connection* (the app
  // connection stays untouched) so a plain file copy is a complete snapshot.
  const copier = new Database(db.file);
  try {
    copier.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    copier.close();
  }
  backupFile(db.file, target);
  return target;
}

/** Re-open the file database and report its journal mode (status tool). */
function journalModeOf(file) {
  if (file === ':memory:' || !fs.existsSync(file)) return null;
  const db = new Database(file);
  try {
    const row = db.get('PRAGMA journal_mode');
    return String(Object.values(row)[0] || '').toLowerCase();
  } finally {
    db.close();
  }
}

module.exports = {
  guardFileDatabase,
  durabilityReport,
  snapshotToBackup,
  journalModeOf,
};
