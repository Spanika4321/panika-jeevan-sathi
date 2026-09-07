#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — database durability status.
 *
 *   node scripts/db-status.mjs
 *
 * Prints where the database lives, whether it exists, its journal mode, and
 * every snapshot in the backup home. Exit code 1 when the database is
 * missing entirely.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../src/config');
const { durabilityReport, journalModeOf } = require('../src/db/durability');
const { humanSize } = require('../src/db/backup');

const report = durabilityReport(config);
console.log(`Database      : ${report.file}${report.file === ':memory:' ? ' (in-memory)' : ''}`);
if (report.file !== ':memory:') {
  console.log(`File          : ${report.fileExists ? `${humanSize(report.fileBytes)}` : 'MISSING'}`);
  const mode = journalModeOf(report.file);
  if (mode) console.log(`Journal mode  : ${mode}`);
}
console.log(`Backup dir    : ${report.backupDir || '(none — set SEVA_BACKUP_DIR)'}`);
if (report.backupDir) {
  if (!report.backups.length) console.log('Backups       : (none yet — run `npm run db:backup`)');
  for (const b of report.backups) {
    console.log(`  • ${b.name}  (${humanSize(b.bytes)})`);
  }
}
console.log(`Require remote: ${report.requireRemote ? 'YES (SEVA_REQUIRE_REMOTE=1)' : 'no'}`);
console.log(`Fail closed   : ${report.failClosed ? 'production / SEVA_FAIL_CLOSED' : 'no'}`);

if (report.file !== ':memory:' && !report.fileExists) {
  console.error('\nThe database file is MISSING. Restore it from a backup or seed a fresh one.');
  process.exit(1);
}
