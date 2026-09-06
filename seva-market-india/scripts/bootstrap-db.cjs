'use strict';
/**
 * SEVA MARKET INDIA — durable-database bootstrap.
 *
 * Deploy hosts that give a *persistent* disk (Render with a mounted disk,
 * Railway with a volume, a VPS, Docker -v, ...) keep the SQLite database on
 * that disk. On the very first boot the disk is empty, so we seed it from the
 * committed snapshot in `db-bootstrap/seva-market.db` (full geography +
 * categories + demo providers). Every later boot reuses the on-disk database,
 * so signups / providers / leads / reviews survive sleeps and redeploys.
 *
 * The snapshot approach mirrors why PANIKA JEEVAN SATHI needs Supabase: hosts
 * with an *ephemeral* filesystem (Render Free, no disk) wipe `./data` on
 * sleep/redeploy. This app therefore requires a persistent volume (see
 * DEPLOY.md) and refuses nothing silently — data lives where you mount it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const config = require('../src/config');

function bootstrap() {
  const SNAPSHOT = path.join(config.root, 'db-bootstrap', 'seva-market.db');
  const target = process.env.SEVA_DB_FILE || config.db.file;

  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(SNAPSHOT, target);
    console.log(`[bootstrap] durable database initialised from snapshot -> ${target}`);
  } else {
    console.log(`[bootstrap] durable database already present -> ${target}`);
  }

  // Keep schema current (idempotent) and fill in base data only if absent.
  const db = new Database(target);
  migrate(db, config.db.migrationsDir);
  const cats = Number(db.scalar('SELECT COUNT(*) FROM categories') || 0);
  const providers = Number(db.scalar('SELECT COUNT(*) FROM providers') || 0);
  if (cats === 0 || providers === 0) {
    seed(db);
    console.log('[bootstrap] base seed applied (empty dataset detected).');
  }
  db.close();
}

module.exports = bootstrap;

if (require.main === module) {
  bootstrap();
}
