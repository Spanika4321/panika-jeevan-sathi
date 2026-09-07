'use strict';
/**
 * SEVA MARKET INDIA — HTTP server entry point.
 *
 *   node server.js            →  http://localhost:3000
 *   PORT=8080 node server.js
 *
 * Zero npm dependencies (Node.js >= 22.5, built-in node:sqlite).
 */

const http = require('node:http');
const fs = require('node:fs');

const config = require('./src/config');
const durability = require('./src/db/durability');
const { createApp } = require('./src/app');

const app = createApp({ config });
const { handle, close, ready } = app;

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('Unhandled request error:', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal server error.\n');
  });
});

// Wait for the durability pre-flight (backup restore / Appwrite recovery)
// before accepting a single request.
ready
  .then(() => {
    server.listen(config.http.port, config.http.host, () => {
      console.log(`${config.site.name} listening on http://${config.http.host}:${config.http.port} (${config.env})`);
      if (config.db.file !== ':memory:') {
        const report = durability.durabilityReport(config);
        const fileInfo = report.fileExists
          ? `ok (${report.fileBytes} bytes)`
          : 'MISSING — the site will re-create an empty database. Set SEVA_BACKUP_DIR / SEVA_APPWRITE_* to keep data safe.';
        console.log(`Database    : ${report.file} — ${fileInfo}`);
        console.log(`Backups     : ${report.backups.length ? `${report.backups.length} snapshot(s) in ${report.backupDir}` : 'none — run `npm run db:backup`'}`);
        console.log(`Appwrite    : ${appwriteConfigured() ? 'mirror enabled (SEVA_APPWRITE_*)' : 'not configured — set SEVA_APPWRITE_* for durable storage'}`);
      }
    });
  })
  .catch((err) => {
    console.error(`\nStartup failed: ${err.message}`);
    process.exit(1);
  });

function appwriteConfigured() {
  return Boolean(require('./src/db/appwrite').configFromEnv(process.env));
}

function shutdown(signal) {
  console.log(`\n${signal} received — shutting down.`);
  server.close(() => {
    // Final remote-mirror drain happens before the database closes.
    Promise.resolve(close()).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
