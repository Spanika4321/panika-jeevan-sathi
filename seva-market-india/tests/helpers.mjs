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

/** Read one cookie out of a captured response's Set-Cookie header. */
export function cookieValue(res, name) {
  const header = res.getHeader ? res.getHeader('Set-Cookie') : undefined;
  const list = header ? (Array.isArray(header) ? header : [header]) : [];
  for (const entry of list) {
    const pair = String(entry).split(';')[0];
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() === name) return decodeURIComponent(pair.slice(index + 1));
  }
  return null;
}

/** The attributes of a Set-Cookie entry, as a string for assertions. */
export function cookieRaw(res, name) {
  const header = res.getHeader ? res.getHeader('Set-Cookie') : undefined;
  const list = header ? (Array.isArray(header) ? header : [header]) : [];
  return list.find((entry) => String(entry).startsWith(`${name}=`)) || '';
}

/**
 * A tiny browser: it keeps the session cookie and the CSRF proof, and posts
 * forms the way the rendered pages do. Tests that exercise login, the
 * dashboard or the review queue all speak through this, so they stay honest
 * about cookies and CSRF.
 */
export function makeAgent(app) {
  const state = { cookie: '', csrf: '', ip: '127.0.0.1' };

  async function send(method, url, { body = null, headers = {}, form = null, ip = null } = {}) {
    const finalHeaders = { ...headers };
    if (state.cookie) finalHeaders.cookie = state.cookie;
    const options = { method, url, headers: finalHeaders, ip: ip || state.ip };
    if (form) {
      finalHeaders['content-type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(form)) {
        if (value === null || value === undefined) continue;
        params.set(key, String(value));
      }
      options.body = params.toString();
    } else if (body !== null) {
      finalHeaders['content-type'] = finalHeaders['content-type'] || 'application/json';
      options.body = body;
    }
    const res = await request(app, options);
    const setCookie = res.getHeader ? res.getHeader('Set-Cookie') : undefined;
    if (setCookie) {
      const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((entry) => String(entry).split(';')[0]);
      const jar = Object.assign(Object.create(null), ...state.cookie.split(';').filter(Boolean).map((pair) => {
        const i = pair.indexOf('=');
        return { [pair.slice(0, i).trim()]: pair.slice(i + 1).trim() };
      }));
      for (const entry of cookies) {
        const i = entry.indexOf('=');
        const name = entry.slice(0, i);
        const value = entry.slice(i + 1);
        if (value === '') delete jar[name];
        else jar[name] = value;
      }
      state.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    }
    return res;
  }

  return {
    state,
    get: (url, options) => send('GET', url, options),
    post: (url, body, options = {}) => send('POST', url, { ...options, body }),
    postForm: (url, form) => send('POST', url, { form }),
    patch: (url, body) => send('PATCH', url, { body }),
    put: (url, body) => send('PUT', url, { body }),
    /** Signed JSON write: the CSRF header is what the browser would send. */
    api: (method, url, body) => send(method, url, {
      body,
      headers: state.csrf ? { 'x-csrf-token': state.csrf } : {},
    }),
    formWithCsrf: (fields) => ({ ...fields, _csrf: state.csrf }),
    /** Sign in through the form endpoint and remember cookie + CSRF proof. */
    async signIn(email, password) {
      const res = await send('POST', '/api/v1/auth/login', { body: { email, password } });
      const token = cookieValue(res, 'seva_session');
      if (token) {
        state.csrf = (res.json().data && res.json().data.csrf_token) || '';
      }
      return res;
    },
    csrf: () => state.csrf,
  };
}

export { tableNames };
