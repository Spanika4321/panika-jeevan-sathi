'use strict';
/**
 * SEVA MARKET INDIA — forward-only SQL migrations.
 *
 * Files in src/db/migrations are named NNNN_name.sql and applied in
 * lexicographic order, each exactly once, tracked in `schema_migrations`.
 * Forward-only on purpose: destructive rollbacks are the wrong tool for a
 * marketplace holding customer leads; fix-forward with a new migration.
 */

const fs = require('node:fs');
const path = require('node:path');

const TRACK_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`;

/** List migration files on disk, ordered by version prefix. */
function listMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({ version: name.slice(0, 4), filename: name, file: path.join(dir, name) }));
}

/**
 * Apply every pending migration. Safe to call on every boot.
 * @param {import('./client').Database} db
 * @param {string} [dir]
 * @returns {{applied: string[], skipped: string[]}}
 */
function migrate(db, dir) {
  db.exec(TRACK_TABLE);
  const migrations = listMigrations(dir);
  const applied = [];
  const skipped = [];

  for (const migration of migrations) {
    const done = db.get('SELECT version FROM schema_migrations WHERE version = ?', [migration.version]);
    if (done) {
      skipped.push(migration.version);
      continue;
    }
    const sql = fs.readFileSync(migration.file, 'utf8');
    // Rebuilding a parent table that has live child rows is safe only with
    // SQLite FK enforcement paused. A named marker keeps that exceptional,
    // audited path out of ordinary migrations — it is needed for the legacy
    // provider-owner FK upgrade, where account ids now come from Supabase.
    const pauseForeignKeys = /^\s*--\s*@requires-foreign-keys-off\b/m.test(sql);
    if (pauseForeignKeys) db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.transaction(() => {
        db.exec(sql);
        db.run('INSERT INTO schema_migrations (version, filename) VALUES (?, ?)', [
          migration.version,
          migration.filename,
        ]);
      });
    } finally {
      if (pauseForeignKeys) db.exec('PRAGMA foreign_keys = ON;');
    }
    if (pauseForeignKeys && db.scalar('PRAGMA foreign_keys') !== 1) {
      throw new Error(`Migration ${migration.filename} did not restore SQLite foreign-key enforcement.`);
    }
    applied.push(migration.version);
  }

  return { applied, skipped };
}

/** Every table currently in the database (test assertion helper). */
function tableNames(db) {
  return db
    .all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => row.name);
}

module.exports = { migrate, listMigrations, tableNames, TRACK_TABLE };
