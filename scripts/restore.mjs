#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — restore the site from a backup archive.
 *
 *   npm run restore -- pjs-backup-2026-08-29T03-30-00Z.tar.gz --yes
 *   npm run restore -- /tmp/pjs-backup-….tar.gz --data-dir=/var/data/pjs --yes
 *
 * The site must be stopped (Render/Railway: pause the service, or run this
 * before starting the app). The data folder that is being overwritten is first
 * copied to `pjs-data-before-restore-<when>` next to it, so a restore is
 * reversible.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import backup from '../lib/backup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');


const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const dataDir = path.resolve(flag('data-dir', process.env.PJS_DATA_DIR || path.join(ROOT, 'data')));
// Where the archive lives, when it is not the default <data-dir>/backups folder
// (e.g. you downloaded it and want to restore onto a fresh install).
const fromDir = flag('from', '') ? path.resolve(flag('from', '')) : backup.backupDirFor(dataDir);
const file = argv.find((a) => !a.startsWith('--'));

function listAvailable() {
  const items = backup.list(backup.backupDirFor(dataDir));
  if (!items.length) {
    console.log(`\n  No backups found in ${backup.backupDirFor(dataDir)}\n`);
    return;
  }
  console.log(`\n  Available backups (restore the one you want by name):`);
  for (const item of items) console.log(`   • ${item.file}   ${item.created_at}`);
  console.log('');
}

function main() {
  if (!file) {
    console.error('\n  Usage: node scripts/restore.mjs <backup-file.tar.gz> --yes');
    listAvailable();
    process.exit(1);
  }
  if (!argv.includes('--yes') && !argv.includes('--dry-run')) {
    console.error(`\n  This replaces everything in ${dataDir}.`);
    console.error('  Re-run with --yes to continue, or --dry-run to only inspect the archive.\n');
    process.exit(1);
  }

  const backupDir = fromDir;
  const given = path.resolve(file);
  const archive = fs.existsSync(given) ? given : path.join(backupDir, path.basename(file));
  if (!fs.existsSync(archive)) {
    console.error(`\n  ✗ Not found: ${archive}\n`);
    listAvailable();
    process.exit(1);
  }

  const members = backup.readArchive(backup.loadArchive(archive));
  const manifestMember = members.find((m) => m.rel === 'manifest.json');
  const manifest = manifestMember ? JSON.parse(manifestMember.content.toString('utf8')) : null;
  const dbMember = members.find((m) => m.rel.endsWith('.db') || m.rel.endsWith('.json') && m.rel.startsWith('panika'));
  const files = members.filter((m) => m.type === 'file' && m.rel !== 'manifest.json');

  console.log(`\n  Archive : ${path.basename(file)}`);
  if (manifest) {
    console.log(`  Taken   : ${manifest.created_at} · store ${manifest.store} · ${manifest.members} files`);
    if (manifest.counts) {
      console.log(
        `  In it   : ${manifest.counts.users || 0} members · ${manifest.counts.messages || 0} messages · ${manifest.counts.interests || 0} interests`
      );
    }
  }
  console.log(`  Members : ${files.length} files${dbMember ? ' (database found ✓)' : ' — ⚠ no database file inside!'}`);

  if (argv.includes('--dry-run')) {
    console.log('\n  Dry run only — nothing was written.\n');
    return;
  }
  if (!dbMember) {
    console.error('\n  ✗ Refusing to restore an archive that contains no database.\n');
    process.exit(1);
  }

  const result = backup.restore({ targetDir: dataDir, file: path.basename(archive), backupDir: path.dirname(archive), snapshot: true });
  console.log(`\n  ✓ Restored ${result.restored} files into ${dataDir}`);
  if (result.previous_data_dir) console.log(`  Old data kept at: ${result.previous_data_dir}`);
  console.log('  Now start the site: node server.js\n');
}

main();
