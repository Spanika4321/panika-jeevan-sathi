/**
 * Versioned schema migrations.
 *
 * Migrations are the single source of truth for the database shape:
 *   • one ordered, immutable file per change in lib/db/migrations,
 *   • each file is applied inside a transaction and recorded with its checksum,
 *   • a changed checksum for an applied file is a hard error, so nobody can
 *     silently edit history and drift a production database.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIGRATION_TABLE = 'schema_migrations';

export function listMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort()
    .map((name) => {
      const filePath = path.join(dir, name);
      const sql = fs.readFileSync(filePath, 'utf8');
      return {
        version: name.replace(/\.sql$/i, ''),
        name,
        path: filePath,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16)
      };
    });
}

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

/**
 * Apply every pending migration.
 * @returns {Promise<{applied: string[], skipped: string[]}>}
 */
export async function migrate(driver, { dir, log } = {}) {
  const migrations = listMigrations(dir);

  await driver.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
       version text PRIMARY KEY,
       checksum text NOT NULL,
       applied_at bigint NOT NULL
     )`
  );

  const applied = [];
  const skipped = [];

  for (const migration of migrations) {
    const existing = await driver.one(MIGRATION_TABLE, { version: migration.version });
    if (existing) {
      if (existing.checksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.name} was already applied with checksum ${existing.checksum} but is now ${migration.checksum}. ` +
            'Never edit an applied migration — add a new one instead.'
        );
      }
      skipped.push(migration.version);
      continue;
    }

    await driver.transaction(async (tx) => {
      for (const statement of splitStatements(migration.sql)) {
        await tx.exec(statement);
      }
      await tx.insert(MIGRATION_TABLE, {
        version: migration.version,
        checksum: migration.checksum,
        applied_at: Date.now()
      });
    });

    applied.push(migration.version);
    log?.info(`migration applied: ${migration.name}`);
  }

  return { applied, skipped };
}

export async function migrationState(driver) {
  const rows = await driver.all(MIGRATION_TABLE, { order: 'version' });
  return rows.map((row) => ({ version: row.version, checksum: row.checksum, appliedAt: row.applied_at }));
}
