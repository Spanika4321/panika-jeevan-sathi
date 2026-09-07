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

const config = require('./src/config');
const { createApp } = require('./src/app');
const { StorageConfigError } = require('./src/store');

/**
 * Boot the app, turning a storage misconfiguration into a short, readable
 * failure instead of a stack trace. Exit code 1 so the host marks the deploy
 * as failed — a crashed deploy is visible, silent data loss is not.
 */
function boot() {
  try {
    return createApp({ config });
  } catch (err) {
    if (err instanceof StorageConfigError) {
      console.error(`\n${config.site.name} refused to start — storage is not safe.\n`);
      console.error(err.message);
      console.error('\nSee seva-market-india/DEPLOY.md, or run: npm run storage:doctor\n');
      process.exit(1);
    }
    throw err;
  }
}

const { handle, close } = boot();

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('Unhandled request error:', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal server error.\n');
  });
});

server.listen(config.http.port, config.http.host, () => {
  console.log(`${config.site.name} listening on http://${config.http.host}:${config.http.port} (${config.env})`);
});

function shutdown(signal) {
  console.log(`\n${signal} received — shutting down.`);
  server.close(() => {
    close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
