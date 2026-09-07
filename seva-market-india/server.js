'use strict';
/**
 * SEVA MARKET INDIA — HTTP server entry point.
 *
 *   node server.js            →  http://localhost:3000
 *   PORT=8080 node server.js
 *
 * Zero npm dependencies (Node.js >= 22.5, built-in node:sqlite).
 *
 * Durability: when APPWRITE_PROJECT_ID + APPWRITE_API_KEY are set, the
 * SQLite database becomes a local query engine mirrored to Appwrite —
 * every row is restored from Appwrite at boot and every write is pushed
 * back, so a free host wiping its disk loses nothing. Without those env
 * vars the server runs on plain local SQLite (fine for development;
 * refused in production unless SEVA_ALLOW_EPHEMERAL=1).
 */

const http = require('node:http');

const config = require('./src/config');
const { createApp } = require('./src/app');
const { Database } = require('./src/db/client');
const { migrate } = require('./src/db/migrate');
const { attachMirror } = require('./src/db/mirror');

async function boot() {
  const local = new Database(config.db.file);
  migrate(local, config.db.migrationsDir);

  // Reach Appwrite BEFORE accepting traffic: restore rows, adopt local data.
  let db = local;
  const mirror = await attachMirror(local, { env: process.env });
  if (mirror) {
    db = mirror;
  } else if (config.isProduction && process.env.SEVA_ALLOW_EPHEMERAL !== '1') {
    console.error('FATAL: production without a durable store.');
    console.error('  This host has an ephemeral disk — every provider, service and');
    console.error('  customer lead would be DELETED on the next sleep or redeploy.');
    console.error('  Set APPWRITE_PROJECT_ID and APPWRITE_API_KEY (see README), or');
    console.error('  set SEVA_ALLOW_EPHEMERAL=1 to accept the data loss knowingly.');
    process.exit(1);
  } else if (config.isProduction) {
    console.warn('[storage] WARNING: running on ephemeral local SQLite — data will not survive a redeploy.');
  }

  const { handle } = createApp({ config, db });

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('Unhandled request error:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal server error.\n');
    });
  });

  server.listen(config.http.port, config.http.host, () => {
    const storage = mirror ? `appwrite-mirrored sqlite (${mirror.remote.endpoint})` : 'local sqlite';
    console.log(`${config.site.name} listening on http://${config.http.host}:${config.http.port} (${config.env})`);
    console.log(`Storage: ${storage}`);
  });

  function shutdown(signal) {
    console.log(`\n${signal} received — shutting down.`);
    server.close(async () => {
      try {
        if (mirror) await mirror.flushNow(); // last writes must reach Appwrite
      } catch (err) {
        console.error('Final mirror flush failed:', err.message);
      }
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

const ready = boot().catch((err) => {
  console.error('FATAL: server failed to start:', err && err.stack ? err.stack : err);
  console.error('  If this is an Appwrite error, check APPWRITE_ENDPOINT /');
  console.error('  APPWRITE_PROJECT_ID / APPWRITE_API_KEY and the key scopes');
  console.error('  (databases.read + databases.write, collections, documents).');
  process.exit(1);
});

module.exports = ready;
