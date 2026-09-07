#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — restore a backup into the live database path.
 *
 *   node scripts/restore.mjs [path-to-backup]
 *
 * Without an argument the newest snapshot in SEVA_BACKUP_DIR (or
 * ./data/backups) is used. The backup is integrity-checked before anything
 * is replaced. Stop the site before restoring if it is currently running.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../src/config');
const { restoreFile, humanSize } = require('../src/db/backup');

const dbFile = config.db.file;
if (dbFile === ':memory:') {
  console.error('Cannot restore an in-memory database.');
  process.exit(1);
}

const explicit = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const backupDir = explicit
  ? path.dirname(explicit)
  : process.env.SEVA_BACKUP_DIR || path.join(path.dirname(dbFile), 'backups');
const chosen = explicit || (() => {
  if (!fs.existsSync(backupDir)) return null;
  const snaps = fs.readdirSync(backupDir).filter((name) => /\.db$/.test(name)).sort().reverse();
  return snaps[0] ? path.join(backupDir, snaps[0]) : null;
})();

if (!chosen || !fs.existsSync(chosen)) {
  console.error(`No backup found in ${backupDir}`);
  process.exit(1);
}

restoreFile(chosen, dbFile);
console.log(`Restored   : ${dbFile}`);
console.log(`From       : ${chosen} (${humanSize(fs.statSync(chosen).size)})`);
console.log('Restart the site now. Keep the previous database file as a safety copy.');
