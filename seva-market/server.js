#!/usr/bin/env node
/**
 * SEVA MARKET INDIA — application entry point.
 *
 * Boot order is deliberate:
 *   1. build + validate configuration (fail fast, before binding a port),
 *   2. open the database and apply migrations,
 *   3. seed reference data when allowed,
 *   4. build services, mount the API and only then start listening.
 *
 * A deployment that cannot reach a valid configuration never serves a request.
 */
import http from 'node:http';
import { loadConfig, assertValidConfig, PUBLIC_DIR } from './lib/config.js';
import { createLogger } from './lib/log.js';
import { openDatabase, databaseFile } from './lib/db/index.js';
import { createServices } from './lib/services/index.js';
import { createRateLimiter } from './lib/http/rate-limit.js';
import { securityHeaders, isSecure, clientIp } from './lib/http/security.js';
import { createApiV1 } from './lib/api/v1.js';
import { createApiHandler, sendJson } from './lib/api/index.js';
import { createStaticHandler } from './lib/http/static.js';
import { seedAll } from './lib/seed/index.js';

export async function createApp(overrides = {}, env = process.env) {
  const config = assertValidConfig(loadConfig(env, overrides));
  const log = createLogger({ level: config.logLevel, json: config.logJson, base: { app: 'seva-market' } });

  const { driver, migrations } = await openDatabase(config, { log });
  const services = createServices({ db: driver, config, log });
  const rateLimiter = createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax });

  if (config.autoSeed) {
    await seedAll({ db: driver, services, log, demo: !config.isProduction });
  }

  const router = createApiV1({ db: driver, config, services, bootedAt: Date.now() });
  const handleApi = createApiHandler({ router, config, services, rateLimiter, log });
  const handleStatic = createStaticHandler({ publicDir: PUBLIC_DIR, config, log });
  const headers = securityHeaders();

  const server = http.createServer((req, res) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    if (isSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    req.ip = clientIp(req, config.trustProxyHops);

    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (/[\x00-\x1f\x7f]/.test(decodeURIComponent(url.pathname))) throw new Error('Invalid path');
    } catch {
      res.writeHead(400, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...headers, Allow: 'GET, HEAD, POST, OPTIONS' });
      res.end();
      return;
    }

    const done = (error) => {
      if (!error) return;
      log.error('unhandled request error', { method: req.method, path: url.pathname, error: error.message });
      if (res.headersSent) return res.destroy();
      sendJson(res, 500, { ok: false, error: 'Internal server error', code: 'internal_error' });
    };

    if (url.pathname.startsWith('/api/')) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      // /api/health is the platform-friendly alias of /api/v1/health.
      if (url.pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          status: 'ok',
          driver: driver.kind,
          environment: config.env,
          migrations: migrations
        });
        return;
      }
      handleApi(req, res, url).catch(done);
      return;
    }

    handleStatic(req, res, url).catch(done);
  });

  return { config, log, db: driver, services, server, migrations };
}

export async function start(overrides = {}) {
  const app = await createApp(overrides);
  const { config, log, server, db } = app;

  await new Promise((resolve) => server.listen(config.port, config.host, resolve));

  const label = config.host === '0.0.0.0' ? 'localhost' : config.host;
  log.info(`${config.site.name} is running`, {
    url: `http://${label}:${server.address().port}`,
    env: config.env,
    driver: db.kind,
    file: db.kind === 'sqlite' ? databaseFile(config) : undefined
  });

  const shutdown = async (signal) => {
    log.info(`received ${signal} — shutting down`);
    server.close(async () => {
      try {
        await db.close();
      } catch {
        /* best effort */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return app;
}

const isEntrypoint = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntrypoint) {
  start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('\n  Fatal error during start-up:\n');
    // eslint-disable-next-line no-console
    console.error(error?.stack || error);
    process.exit(1);
  });
}
