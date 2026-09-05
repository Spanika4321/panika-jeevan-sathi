/**
 * Test helpers — build a real app instance against a throwaway database.
 *
 * Unit tests use the in-memory driver (fast, no filesystem); HTTP tests boot
 * the real server on an ephemeral port with SQLite, which is the driver used in
 * development, so the SQL is genuinely exercised.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server.js';
import { seedAll } from '../../lib/seed/index.js';

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seva-test-'));
}

export function testConfig(overrides = {}) {
  return {
    env: 'test',
    driver: 'memory',
    autoMigrate: true,
    autoSeed: false,
    logLevel: 'silent',
    sessionSecret: 'test-session-secret-that-is-long-enough-1234',
    ...overrides
  };
}

/** App with an in-memory database, optionally seeded with reference + demo data. */
export async function createTestApp({ seed = true, demo = false, ...overrides } = {}) {
  const app = await createApp(testConfig(overrides));
  if (seed) {
    await seedAll({ db: app.db, services: app.services, log: app.log, demo });
  }
  return app;
}

/** App with a real SQLite file in a temporary directory. */
export async function createSqliteApp({ seed = true, demo = true, ...overrides } = {}) {
  const dir = tempDir();
  const app = await createApp(
    testConfig({ driver: 'sqlite', dataDir: dir, ...overrides })
  );
  if (seed) {
    await seedAll({ db: app.db, services: app.services, log: app.log, demo });
  }
  return { app, dir };
}

/** Start the HTTP server on an ephemeral port and return its base URL. */
export async function listen(app) {
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => app.server.close(resolve));
      await app.db.close().catch(() => {});
    }
  };
}

/** Convenience: boot, listen, run `fn`, always tear down. */
export async function withServer(fn, options = {}) {
  const { app, dir } = await createSqliteApp(options);
  const server = await listen(app);
  try {
    return await fn({ ...server, app, dir });
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function getJson(baseUrl, path) {
  const response = await fetch(new URL(path, baseUrl));
  return { status: response.status, headers: response.headers, body: await response.json() };
}

export async function getText(baseUrl, path) {
  const response = await fetch(new URL(path, baseUrl));
  return { status: response.status, headers: response.headers, body: await response.text() };
}
