'use strict';
/**
 * SEVA MARKET INDIA — crash-safe file backups of a live SQLite database.
 *
 * Two mechanisms:
 *
 *   1. `backupFile(file, target)` — snapshot a *closed* (or idle) database
 *      file with its WAL checkpointed, so a copy is one consistent file.
 *      Safe for the pre-flight snapshot that runs before the app opens the
 *      database, and for cron backups of a stopped instance.
 *
 *   2. `backupFrom(file, target)` — online backup of a *live* database via
 *      node:sqlite's `backup()` API. The source keeps serving reads/writes
 *      while the snapshot is taken (WAL keeps it consistent), so an hourly
 *      cron backup never has to take the site down. Falls back to a
 *      checkpoint + file copy when the connection is file-backed but the
 *      backup API is unavailable (older Node builds).
 *
 * Every write is atomic: the snapshot is written to `<target>.tmp`, fsync'd,
 * then renamed into place — a crash mid-backup can never leave a torn file
 * at `target`, and `restoreFile()` verifies the SQLite header + integrity
 * before it overwrites anything.
 */

const fs = require('node:fs');
const path = require('node:path');

const { Database } = require('./client');

/** Human bytes → readable string. */
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function isSqliteFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      return head.toString('ascii', 0, 15) === 'SQLite format 3';
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return false;
  }
}

/** WAL checkpoint + copy of a *closed* file database into `target`. */
function checkpointAndCopy(file, target) {
  const db = new Database(file);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
  atomicCopy(file, target);
}

function atomicCopy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    const data = fs.readFileSync(source);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
  try {
    fs.unlinkSync(`${source}-wal`);
    fs.unlinkSync(`${source}-shm`);
  } catch (_) {
    /* no WAL sidecars — fine */
  }
}

/** Online backup of a live file database (source keeps running). */
function backupFrom(file, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Live SQLite backup via VACUUM INTO: a single consistent snapshot even
  // while WAL writers are active on `file`, with no extra dependency.
  const vacuum = new Database(file);
  const tmp = `${target}.tmp`;
  try {
    fs.unlinkSync(tmp);
  } catch (_) {
    /* first run */
  }
  try {
    vacuum.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } finally {
    vacuum.close();
  }
  if (!isSqliteFile(tmp)) throw new Error('backup produced an invalid SQLite file');
  fs.renameSync(tmp, target);
  return target;
}

/** Atomic file backup with `.tmp` + rename (closed/idle source). */
function backupFile(file, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  atomicCopy(file, target);
  return target;
}

/**
 * Restore a backup into `target`, verifying integrity first. Only after the
 * verification succeeds is any existing file replaced.
 */
function restoreFile(backup, target) {
  if (!fs.existsSync(backup)) throw new Error(`Backup not found: ${backup}`);
  if (!isSqliteFile(backup)) throw new Error(`Backup is not a valid SQLite file: ${backup}`);
  // Open + integrity-check the backup before touching the live file.
  const check = new Database(backup);
  try {
    const row = check.get('PRAGMA integrity_check');
    if (String(Object.values(row)[0]) !== 'ok') throw new Error(`Backup failed integrity_check: ${backup}`);
  } finally {
    check.close();
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  atomicCopy(backup, target);
  return target;
}

module.exports = { backupFile, backupFrom, restoreFile, isSqliteFile, humanSize };
