/**
 * SEVA MARKET INDIA — shared test helpers.
 *
 * Every test gets a fresh in-memory SQLite database with migrations applied
 * and (optionally) the seed dataset loaded. No test touches the dev database
 * on disk and no test depends on another test's rows.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { Database } = require('../src/db/client');
const { migrate, tableNames } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const { createApp } = require('../src/app');
const config = require('../src/config');

/** A migrated, optionally seeded, in-memory database. */
export function makeDb({ withSeed = true } = {}) {
  const db = new Database(':memory:');
  const result = migrate(db, config.db.migrationsDir);
  if (withSeed) seed(db);
  return { db, migrationResult: result };
}

/** A full app (router + handlers) bound to a fresh in-memory database. */
export function makeApp({ withSeed = true } = {}) {
  const db = new Database(':memory:');
  migrate(db, config.db.migrationsDir);
  if (withSeed) seed(db);
  const app = createApp({ config, db });
  return { ...app, config };
}

/** Minimal IncomingMessage stub, enough for the handlers that read it. */
export function fakeRequest({ method = 'GET', url = '/', body = null, headers = {}, ip = '127.0.0.1' } = {}) {
  const listeners = { data: [], end: [], error: [] };
  const req = {
    method,
    url,
    headers: { host: 'localhost', ...headers },
    socket: { remoteAddress: ip },
    on(event, handler) {
      (listeners[event] || (listeners[event] = [])).push(handler);
      return req;
    },
    destroy() {},
  };
  setImmediate(() => {
    if (body !== null) {
      const chunk = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      for (const handler of listeners.data) handler(chunk);
    }
    for (const handler of listeners.end) handler();
  });
  return req;
}

/** Collect a response written by the app. */
export function captureResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return res.headers[name.toLowerCase()];
    },
    writeHead(status, headers) {
      res.statusCode = status;
      res.headersSent = true;
      Object.entries(headers || {}).forEach(([name, value]) => {
        res.headers[name.toLowerCase()] = value;
      });
      return res;
    },
    end(chunk) {
      res.headersSent = true;
      if (chunk) res.body += chunk.toString();
      if (res.onEnd) res.onEnd();
      return res;
    },
  };
  res.finished = new Promise((resolve) => { res.onEnd = resolve; });
  return res;
}

/** Drive one request through the app without opening a socket. */
export async function request(app, options) {
  const req = fakeRequest(options);
  const res = captureResponse();
  await app.handle(req, res);
  await res.finished;
  res.json = () => JSON.parse(res.body);
  return res;
}

export { tableNames };
