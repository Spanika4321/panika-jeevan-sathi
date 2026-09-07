#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — manual / cron database backup.
 *
 *   node scripts/backup.mjs             → SEVA_BACKUP_DIR (or ./data/backups)
 *   node scripts/backup.mjs --to DIR
 *
 * The site may be running: the snapshot is taken with SQLite's online backup
 * (VACUUM INTO on the live file) so no request is blocked. Prints the backup
 * path and size. Exit code 1 if the database does not exist yet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../src/config');
const { backupFrom, humanSize } = require('../src/db/backup');

function arg(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1];
}

const dbFile = config.db.file;
if (dbFile === ':memory:') {
  console.error('Cannot back up an in-memory database.');
  process.exit(1);
}
if (!fs.existsSync(dbFile)) {
  console.error(`Database file not found: ${dbFile}`);
  console.error('Nothing to back up yet — run `node scripts/migrate.mjs` and `node scripts/seed.mjs` first.');
  process.exit(1);
}

const to = arg('--to') || process.env.SEVA_BACKUP_DIR || path.join(path.dirname(dbFile), 'backups');
fs.mkdirSync(to, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(to, `seva-market-${stamp}.db`);

backupFrom(dbFile, target);
const bytes = fs.statSync(target).size;
console.log(`Backup     : ${target}`);
console.log(`Size       : ${humanSize(bytes)}`);
console.log(`Source     : ${dbFile}`);
console.log(`Keep       : prune old snapshots manually or set a retention cron.`);
