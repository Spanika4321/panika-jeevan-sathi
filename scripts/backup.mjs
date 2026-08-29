#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — make a backup of the whole data folder.
 *
 *   npm run backup                    → backups/pjs-backup-<when>.tar.gz
 *   npm run backup -- --list          → show existing backups
 *   npm run backup -- --keep=7        → override how many to retain
 *   npm run backup -- --verify        → also re-read the archive it just wrote
 *
 * Safe to run while the site is live: SQLite is checkpointed first and the
 * archive is renamed into place only when complete.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dbLib from '../lib/db.js';
import backup from '../lib/backup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');


const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const dataDir = path.resolve(flag('data-dir', process.env.PJS_DATA_DIR || path.join(ROOT, 'data')));
if (has('keep')) process.env.PJS_BACKUP_KEEP = String(flag('keep'));

function human(bytes) {
  const n = Number(bytes) || 0;
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

async function main() {
  if (!fs.existsSync(dataDir)) {
    console.error(`\n  ✗ Data folder not found: ${dataDir}`);
    console.error('    Start the site once (node server.js) or pass --data-dir=/path/to/data\n');
    process.exit(1);
  }

  if (has('list')) {
    const items = backup.list(backup.backupDirFor(dataDir));
    if (!items.length) {
      console.log(`\n  No backups yet in ${backup.backupDirFor(dataDir)}\n`);
      return;
    }
    console.log(`\n  Backups in ${backup.backupDirFor(dataDir)}`);
    for (const item of items) {
      const members = item.counts && item.counts.users !== undefined ? ` · ${item.counts.users} members` : '';
      console.log(
        `   • ${item.file}  ${human(item.bytes)}  ${item.created_at}${members}`
      );
    }
    console.log('');
    return;
  }

  // Open the same store the running site uses, purely for checkpointing + counts.
  let driver = null;
  try {
    driver = dbLib.open(dataDir).driver;
  } catch (err) {
    console.warn(`  ! could not open the database directly (${err.message}) — files are still copied`);
  }

  try {
    const result = await backup.create({ dataDir, driver, label: 'cli' });
    console.log('\n  ✓ Backup written');
    console.log(`    Folder   : ${dataDir}`);
    console.log(`    Archive  : ${result.path}`);
    console.log(`    Size     : ${human(result.bytes)} (uncompressed ${human(result.data_bytes)}, ${result.members} files)`);
    if (result.counts && result.counts.users !== undefined) {
      console.log(
        `    Contains : ${result.counts.users} members · ${result.counts.messages || 0} messages · ${result.counts.interests || 0} interests`
      );
    }
    if (result.skipped && result.skipped.length) {
      console.log(`    Skipped  : ${result.skipped.map((s) => s.file).join(', ')}`);
    }
    if (has('verify')) {
      const v = backup.verifyArchive(result.path);
      console.log(`    Verify   : ${v.ok ? 'database opens cleanly ✓' : 'FAILED ✗'} — ${v.detail}`);
      if (!v.ok) process.exitCode = 1;
    }
    console.log(`\n    Restore on any host:  node scripts/restore.mjs ${result.file}\n`);
  } catch (err) {
    console.error(`\n  ✗ Backup failed: ${err.message}\n`);
    process.exit(1);
  } finally {
    try {
      if (driver && typeof driver.close === 'function') driver.close();
    } catch (_) {
      /* ignore */
    }
  }
}

main();
