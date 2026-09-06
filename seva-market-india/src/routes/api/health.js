'use strict';
/** API: health + readiness. Used by uptime monitors and deploy checks. */

const { tableNames } = require('../../db/migrate');

function register(router, { db, config }) {
  router.get('/api/v1/health', () => {
    // A SELECT against the live connection proves the DB is usable, not just open.
    const probe = db.scalar('SELECT 1');
    return {
      status: probe === 1 ? 'ok' : 'degraded',
      app: 'seva-market-india',
      version: '0.1.0',
      env: config.env,
      time: new Date().toISOString(),
    };
  });

  router.get('/api/v1/health/deep', () => {
    const tables = tableNames(db);
    return {
      status: tables.length > 0 ? 'ok' : 'degraded',
      database: db.file === ':memory:' ? 'memory' : 'sqlite',
      tables,
    };
  });
}

module.exports = { register };
