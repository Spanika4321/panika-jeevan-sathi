/**
 * SEVA MARKET INDIA — createApp boot-durability integration tests.
 *
 * Drives the real application boot path (createApp with a file database and
 * process.env) through the two disaster scenarios that actually delete
 * member data on ephemeral hosts:
 *
 *   1. instance is replaced, backup home survives → data restored, boot ok
 *   2. instance is replaced, nothing survives, SEVA_REQUIRE_REMOTE=1 → boot
 *      refuses loudly instead of serving an empty site
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/app');
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const backup = require('../src/db/backup');
const config = require('../src/config');

function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seva-boot-'));
  return {
    dir,
    dbFile: path.join(dir, 'seva.db'),
    backups: path.join(dir, 'backups'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('boot after instance wipe: the site restores from the surviving backup', () => {
  const t = tempHome();
  const originalEnv = { ...process.env };
  try {
    delete process.env.SEVA_BACKUP_DIR;
    delete process.env.SEVA_DB_FILE;
    delete process.env.SEVA_REQUIRE_REMOTE;
    process.env.NODE_ENV = 'development';

    const first = new Database(t.dbFile);
    migrate(first, config.db.migrationsDir);
    seed(first);
    first.close();

    // WAL data lives in the -wal sidecar until checkpointed: force a
    // checkpoint exactly like scripts/backup.mjs does, then snapshot.
    const checker = new Database(t.dbFile);
    checker.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    checker.close();
    const survivorHome = path.join(t.dir, 'survivor-backups');
    fs.mkdirSync(survivorHome, { recursive: true });
    backup.backupFrom(t.dbFile, path.join(survivorHome, 'seva-market-survivor.db'));
    // Simulate that the backup home was never seen before: no marker.
    assert.equal(fs.existsSync(path.join(survivorHome, '.seva-restored')), false);

    // Instance replaced: the whole app directory is gone with the disk,
    // but the *durable backup home* survives somewhere else. Re-create the
    // app directory on the fresh disk (db file missing again).
    const appFile = path.join(t.dir, 'app', 'seva.db');
    fs.mkdirSync(path.dirname(appFile), { recursive: true });
    fs.rmSync(appFile, { force: true });
    assert.equal(fs.existsSync(appFile), false, 'the new instance starts with an empty disk');

    // Second life boots with the new data dir → guard restores from the
    // surviving backup, migrate runs, and a fresh boot snapshot is written.
    const app = createApp({ config: { ...config, db: { ...config.db, file: appFile, backupDir: survivorHome } } });
    const providers = app.db.scalar('SELECT COUNT(*) FROM providers');
    assert.ok(providers >= 10, 'providers must be back after boot restore');
    app.close();

    // The recovered boot wrote a fresh snapshot next to the survivor.
    const snaps = fs.readdirSync(survivorHome).filter((n) => n.endsWith('.db'));
    assert.ok(snaps.length >= 2, 'the recovered boot must also snapshot');
    assert.ok(fs.existsSync(path.join(survivorHome, '.seva-restored')), 'marker prevents re-restore loops');
  } finally {
    process.env = originalEnv;
    t.cleanup();
  }
});

test('SEVA_REQUIRE_REMOTE=1 on a wiped instance refuses to boot', () => {
  const t = tempHome();
  const originalEnv = { ...process.env };
  try {
    process.env.SEVA_REQUIRE_REMOTE = '1';
    process.env.SEVA_DB_FILE = t.dbFile;
    process.env.NODE_ENV = 'production';
    fs.rmSync(t.dbFile, { force: true }); // wiped

    assert.throws(
      () =>
        createApp({
          config: { ...config, db: { ...config.db, file: t.dbFile, backupDir: '' } },
        }),
      /SEVA_REQUIRE_REMOTE/,
      'production boot with no durable storage must fail closed',
    );
  } finally {
    process.env = originalEnv;
    t.cleanup();
  }
});
