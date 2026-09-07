'use strict';
/** API: health + readiness. Used by uptime monitors and deploy checks. */

const { tableNames } = require('../../db/migrate');

function register(router, { db, store, config }) {
  router.get('/api/v1/health', () => {
    // A SELECT against the live connection proves the DB is usable, not just open.
    const probe = db.scalar('SELECT 1');
    return {
      status: probe === 1 ? 'ok' : 'degraded',
      app: 'seva-market-india',
      version: '0.1.0',
      env: config.env,
      // Surfaced so "is customer data actually durable?" is answerable from
      // a browser, not by reading the host's environment panel.
      storage: { driver: store.backend, durable: store.durable },
      time: new Date().toISOString(),
    };
  });

  router.get('/api/v1/health/deep', async () => {
    const tables = tableNames(db);
    const storage = await store.health();
    const catalogReady = Number(db.scalar('SELECT COUNT(*) FROM providers') ?? 0) > 0;
    return {
      status: tables.length > 0 && storage.ok && catalogReady ? 'ok' : 'degraded',
      database: db.file === ':memory:' ? 'memory' : 'sqlite',
      catalog: { ready: catalogReady, source: 'seed' },
      storage,
      warnings: store.warnings || [],
      tables,
    };
  });
}

module.exports = { register };
