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
    // The canonical origin is reported next to storage: a stale SITE_URL is
    // invisible on the rendered site (every page still returns 200) while
    // robots.txt, sitemap.xml and every canonical link quietly advertise a
    // host that does not serve it. This makes that checkable from a browser.
    const originWarnings = config.siteWarnings || [];
    return {
      status: tables.length > 0 && storage.ok && catalogReady ? 'ok' : 'degraded',
      database: db.file === ':memory:' ? 'memory' : 'sqlite',
      catalog: { ready: catalogReady, source: 'seed' },
      site: { url: config.site.url || null, warnings: originWarnings },
      storage,
      warnings: [...originWarnings, ...(store.warnings || [])],
      tables,
    };
  });
}

module.exports = { register };
