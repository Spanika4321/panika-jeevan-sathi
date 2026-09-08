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

/**
 * An email sink.
 *
 * Tests must never depend on SMTP being reachable, and must never write into
 * the development outbox: this records what would have been sent so a flow can
 * assert on the recipient, the subject and the link — then click that link.
 */
export function memoryMailer({ delivered = true, mode = 'memory', failWith = null } = {}) {
  const sent = [];
  return {
    configured: true,
    mode,
    sent,
    async send(message) {
      sent.push(message);
      if (failWith) return { delivered: false, mode: 'error', error: failWith };
      return { delivered, mode };
    },
    /** The most recent link mailed to `to`, or null. */
    linkFor(to, path) {
      const message = [...sent].reverse().find((item) => item.to === to);
      if (!message) return null;
      const match = new RegExp(`https?://[^\\s]+${path}\\?token=[A-Za-z0-9_-]+`).exec(`${message.text}\n${message.html || ''}`);
      return match ? match[0] : null;
    },
    tokenFor(to, path) {
      const link = this.linkFor(to, path);
      return link ? new URL(link).searchParams.get('token') : null;
    },
  };
}

/** A full app (router + handlers) bound to a fresh in-memory database. */
export function makeApp({ withSeed = true, siteUrl = config.site.url, mailer = memoryMailer() } = {}) {
  const db = new Database(':memory:');
  migrate(db, config.db.migrationsDir);
  if (withSeed) seed(db);
  // Tests can give crawl documents a real canonical origin without mutating
  // the process-wide configuration object imported by other test files.
  const appConfig = siteUrl === config.site.url ? config : { ...config, site: { ...config.site, url: siteUrl } };
  const app = createApp({ config: appConfig, db, mailer });
  return { ...app, config: appConfig };
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
      const chunk = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
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

/** Build a multipart body without a browser, for upload-route tests. */
export function multipartBody(fields = {}, files = []) {
  const boundary = '----seva-test-boundary-7MA4YWxkTrZu0gW';
  const chunks = [];
  const line = (text) => chunks.push(Buffer.from(`${text}\r\n`, 'utf8'));
  for (const [name, value] of Object.entries(fields)) {
    line(`--${boundary}`);
    line(`Content-Disposition: form-data; name="${name}"`);
    line('');
    line(String(value ?? ''));
  }
  for (const file of files) {
    line(`--${boundary}`);
    line(`Content-Disposition: form-data; name="${file.name}"; filename="${file.filename || 'photo.jpg'}"`);
    line(`Content-Type: ${file.contentType || 'image/jpeg'}`);
    line('');
    chunks.push(Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || ''));
    line('');
  }
  line(`--${boundary}--`);
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export { tableNames };
