/**
 * SEVA MARKET INDIA — durability & recovery tests.
 *
 * The data-loss contract these tests enforce:
 *   1. a file-backed boot snapshots its database into the backup home;
 *   2. a boot whose database is missing but which has a backup restores it —
 *      the site never silently starts empty;
 *   3. SEVA_REQUIRE_REMOTE=1 refuses to boot on a local file database
 *      (ephemeral hosts must fail closed, not serve an empty site);
 *   4. restores verify SQLite integrity before overwriting anything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const durability = require('../src/db/durability');
const backup = require('../src/db/backup');
const config = require('../src/config');

function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seva-dura-'));
  return {
    dir,
    file: path.join(dir, 'seva.db'),
    backups: path.join(dir, 'backups'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function migratedSeeded(file) {
  const db = new Database(file);
  migrate(db, config.db.migrationsDir);
  seed(db);
  db.close();
}

test('boot snapshot: a file database is snapshotted into the backup home', () => {
  const t = tempHome();
  try {
    const db = new Database(t.file);
    migrate(db, config.db.migrationsDir);
    seed(db);
    const target = durability.snapshotToBackup(db, { db: { backupDir: t.backups } }, {});
    assert.ok(target && fs.existsSync(target), 'a snapshot file must be written');
    assert.ok(backup.isSqliteFile(target), 'snapshot must be a valid SQLite file');
    // The snapshot contains the seed data.
    const copy = new Database(target);
    try {
      assert.ok(Number(copy.scalar('SELECT COUNT(*) FROM providers')) >= 10, 'seed rows must be in the snapshot');
    } finally {
      copy.close();
    }
    db.close();
  } finally {
    t.cleanup();
  }
});

test('missing database + existing backup → restored before boot', () => {
  const t = tempHome();
  try {
    migratedSeeded(t.file);
    const db = new Database(t.file);
    const before = db.scalar('SELECT COUNT(*) FROM providers');
    db.close();
    // The "backup home" lives on a durable volume — copy the file there,
    // then simulate the instance disk being wiped (delete the local file).
    fs.mkdirSync(t.backups, { recursive: true });
    fs.copyFileSync(t.file, path.join(t.backups, 'seva-market-crash-snapshot.db'));
    fs.rmSync(t.file);
    assert.equal(fs.existsSync(t.file), false, 'the wiped instance has no database');

    const outcome = durability.guardFileDatabase(t.file, { SEVA_BACKUP_DIR: t.backups });
    assert.equal(outcome, 'restored');
    assert.ok(fs.existsSync(t.file), 'guard must restore the file before the app opens it');

    const reopened = new Database(t.file);
    try {
      assert.equal(reopened.scalar('SELECT COUNT(*) FROM providers'), before, 'data must be back');
    } finally {
      reopened.close();
    }
  } finally {
    t.cleanup();
  }
});

test('SEVA_REQUIRE_REMOTE refuses to boot on a local file database', () => {
  const t = tempHome();
  try {
    migratedSeeded(t.file);
    // Simulate the ephemeral host: no durable backup home at all.
    assert.throws(
      () => durability.guardFileDatabase(path.join(t.dir, 'missing.db'), { SEVA_REQUIRE_REMOTE: '1' }),
      /SEVA_REQUIRE_REMOTE/,
      'an ephemeral host with no remote storage must refuse to start',
    );
  } finally {
    t.cleanup();
  }
});

test('restoreFile verifies integrity before overwriting', () => {
  const t = tempHome();
  try {
    migratedSeeded(t.file);
    const db = new Database(t.file);
    const providers = db.scalar('SELECT COUNT(*) FROM providers');
    db.close();

    const backupFile = path.join(t.backups, 'good.db');
    fs.mkdirSync(t.backups, { recursive: true });
    fs.copyFileSync(t.file, backupFile);
    const torn = path.join(t.backups, 'torn.db');
    fs.writeFileSync(torn, Buffer.alloc(64)); // garbage, not SQLite

    // A torn backup is refused and the live database is untouched.
    assert.throws(() => backup.restoreFile(torn, t.file), /not a valid SQLite file/);
    assert.equal(fs.existsSync(t.file), true, 'live file must still exist');
    const check = new Database(t.file);
    try {
      assert.equal(check.scalar('SELECT COUNT(*) FROM providers'), providers, 'live data must be untouched');
    } finally {
      check.close();
    }

    // A real backup restores fine.
    backup.restoreFile(backupFile, t.file);
    const after = new Database(t.file);
    try {
      assert.equal(after.scalar('SELECT COUNT(*) FROM providers'), providers);
    } finally {
      after.close();
    }
  } finally {
    t.cleanup();
  }
});

test('online backup (backupFrom) of a live file produces a usable snapshot', () => {
  const t = tempHome();
  try {
    migratedSeeded(t.file);
    const live = new Database(t.file);
    try {
      // Write while the backup is taken — VACUUM INTO is an online backup.
      live.run("UPDATE providers SET about = about || ' +updated' WHERE id = (SELECT MIN(id) FROM providers)");
      const target = path.join(t.backups, 'live.db');
      fs.mkdirSync(t.backups, { recursive: true });
      backup.backupFrom(t.file, target);
      assert.ok(fs.existsSync(target));
      assert.ok(backup.isSqliteFile(target));
      const copy = new Database(target);
      try {
        assert.ok(Number(copy.scalar('SELECT COUNT(*) FROM providers')) >= 10);
      } finally {
        copy.close();
      }
    } finally {
      live.close();
    }
  } finally {
    t.cleanup();
  }
});
