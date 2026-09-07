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
    const mirrored = Boolean(db.remote && db.remote.kind === 'appwrite');
    return {
      status: tables.length > 0 ? 'ok' : 'degraded',
      database: db.file === ':memory:' ? 'memory' : 'sqlite',
      durable: mirrored,
      mirror: mirrored
        ? {
            kind: 'appwrite',
            databaseId: db.remote.databaseId,
            pendingTables: db.dirty ? db.dirty.size : 0,
            lastError: db.lastError ? String(db.lastError.message).slice(0, 200) : null,
          }
        : null,
      tables,
    };
  });
}

module.exports = { register };
