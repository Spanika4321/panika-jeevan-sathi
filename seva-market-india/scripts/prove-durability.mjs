#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — prove that a filesystem wipe cannot lose customer data.
 *
 *   npm run storage:prove
 *
 * What it does, with no external services and no network:
 *
 *   1. Starts a local stand-in for Supabase PostgREST (a real HTTP server
 *      on 127.0.0.1 backed by an in-process table).
 *   2. Boots the app in production mode against it, on a temp SQLite file.
 *   3. Creates an account and submits a customer enquiry through the real
 *      HTTP handler.
 *   4. Deletes the SQLite file and every WAL sidecar — exactly what Render's
 *      free plan does on each deploy and each wake-from-sleep.
 *   5. Boots a second, completely fresh app instance on the wiped path.
 *   6. Reads the account and the enquiry back.
 *
 * Exit 0 means: the catalog rebuilt itself and the customer data survived.
 * Exit 1 means: something would have been lost — do not deploy.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { Database } = require('../src/db/client');
const { migrate } = require('../src/db/migrate');
const baseConfig = require('../src/config');

/* ---------------------------------------------------------------- *
 * A minimal PostgREST stand-in. Rows live in this process only.      *
 * ---------------------------------------------------------------- */
function startFakePostgrest() {
  const tables = new Map([
    ['seva_users', []],
    ['seva_leads', []],
    ['seva_audit_logs', []],
  ]);
  let nextId = 1;

  const matches = (row, params) => {
    for (const [key, raw] of params.entries()) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      const [op, ...rest] = raw.split('.');
      const value = rest.join('.').replace(/^"|"$/g, '');
      if (op === 'eq' && String(row[key]) !== value) return false;
      if (op === 'ne' && String(row[key]) === value) return false;
      if (op === 'gte' && !(String(row[key]) >= value)) return false;
    }
    return true;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const table = url.pathname.replace('/rest/v1/', '');
    const rows = tables.get(table);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body ?? ''));
    };
    if (!rows) return send(404, { message: `relation "${table}" does not exist` });

    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (req.method === 'POST') {
        const inserted = [].concat(JSON.parse(raw || '[]')).map((row) => {
          const full = {
            id: nextId++,
            status: row.status ?? (table === 'seva_leads' ? 'new' : 'pending'),
            created_at: new Date().toISOString(),
            ...row,
          };
          rows.push(full);
          return full;
        });
        return send(201, inserted);
      }
      const found = rows.filter((row) => matches(row, url.searchParams));
      const limit = Number(url.searchParams.get('limit') || 0);
      const body = limit > 0 ? found.slice(0, limit) : found;
      return send(200, body, { 'content-range': `0-${Math.max(body.length - 1, 0)}/${found.length}` });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, tables, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

/** Drive one request through the app without opening a socket. */
function call(app, { method = 'GET', url = '/', body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const listeners = {};
    const req = {
      method,
      url,
      headers: { host: 'localhost', ...headers },
      socket: { remoteAddress: '203.0.113.42' },
      on(event, handler) { (listeners[event] ||= []).push(handler); return req; },
      destroy() {},
    };
    setImmediate(() => {
      if (body !== null) {
        for (const handler of listeners.data || []) handler(Buffer.from(JSON.stringify(body)));
      }
      for (const handler of listeners.end || []) handler();
    });
    let payload = '';
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader() {},
      getHeader() { return undefined; },
      writeHead(status) { res.statusCode = status; res.headersSent = true; return res; },
      end(chunk) {
        if (chunk) payload += chunk.toString();
        resolve({ status: res.statusCode, body: payload ? JSON.parse(payload) : null });
        return res;
      },
    };
    app.handle(req, res).catch(reject);
  });
}

function productionConfig(dbFile, supabaseUrl) {
  return {
    ...baseConfig,
    env: 'production',
    isProduction: true,
    db: { ...baseConfig.db, file: dbFile, seedOnBoot: true },
    security: { ...baseConfig.security, sessionSecret: 'prove-durability-secret' },
    storage: {
      driver: 'supabase',
      requireRemote: true,
      allowEphemeral: false,
      supabase: { url: supabaseUrl, key: 'sb_secret_local_proof_key' },
      tables: { users: 'seva_users', leads: 'seva_leads', audit: 'seva_audit_logs' },
    },
  };
}

/** Boot a real app instance on `dbFile`, exactly as server.js would. */
function boot(dbFile, supabaseUrl) {
  const config = productionConfig(dbFile, supabaseUrl);
  const db = new Database(config.db.file);
  migrate(db, config.db.migrationsDir);
  const store = createStore({ config, db, log: () => {} });
  const app = createApp({ config, db, store });
  const { ensureCatalog } = require('../src/app');
  const seeded = ensureCatalog(db);
  return { app, db, store, config, seeded };
}

/** Delete the SQLite file and its WAL sidecars — a Render-style wipe. */
function wipe(dbFile) {
  const removed = [];
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const target = `${dbFile}${suffix}`;
    if (fs.existsSync(target)) {
      fs.rmSync(target);
      removed.push(path.basename(target));
    }
  }
  return removed;
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seva-prove-'));
  const dbFile = path.join(dir, 'seva-market.db');
  const fake = await startFakePostgrest();
  const failures = [];
  const check = (label, condition, detail = '') => {
    console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!condition) failures.push(label);
  };

  try {
    console.log('SEVA MARKET INDIA — durability proof\n');
    console.log(`Local Postgres stand-in : ${fake.url}`);
    console.log(`Ephemeral SQLite file   : ${dbFile}\n`);

    /* ---------------------------------------------- boot #1 */
    console.log('1. First boot (a fresh, empty host)');
    const first = boot(dbFile, fake.url);
    check('storage driver is supabase', first.store.backend === 'supabase');
    check('storage reports durable', first.store.durable === true);
    check('catalog rebuilt from seed', first.seeded.seeded === true,
      `${first.seeded.providers} providers, ${first.seeded.services} services`);

    /* ------------------------------------------ real traffic */
    console.log('\n2. Real traffic through the HTTP handler');
    const providerId = Number(first.db.scalar("SELECT id FROM providers WHERE status = 'active' LIMIT 1"));
    const enquiry = await call(first.app, {
      method: 'POST',
      url: '/api/v1/leads',
      headers: { 'content-type': 'application/json' },
      body: {
        name: 'Durability Test',
        phone: '9864012345',
        email: 'durability@example.com',
        pin_code: '781001',
        provider_id: providerId,
        message: 'Does this survive a redeploy?',
      },
    });
    check('POST /api/v1/leads returned 201', enquiry.status === 201, JSON.stringify(enquiry.body));

    const account = await first.store.users.create({
      email: 'owner@example.com',
      fullName: 'Owner Account',
      password: 'a strong enough password',
      phone: '9864099999',
    });
    check('account created', Boolean(account.user?.id), `id ${account.user?.id}`);
    check('enquiry is in Postgres', fake.tables.get('seva_leads').length === 1);
    check(
      'nothing customer-facing is in the SQLite file',
      Number(first.db.scalar('SELECT COUNT(*) FROM leads')) === 0
      && Number(first.db.scalar('SELECT COUNT(*) FROM users')) === 0,
    );
    first.db.close();

    /* ------------------------------------------------- wipe */
    console.log('\n3. Wiping the filesystem (what a Render deploy does)');
    const removed = wipe(dbFile);
    check('SQLite file deleted', !fs.existsSync(dbFile), removed.join(', ') || 'nothing left');

    /* ---------------------------------------------- boot #2 */
    console.log('\n4. Second boot on the wiped host');
    const second = boot(dbFile, fake.url);
    check('catalog rebuilt automatically', second.seeded.seeded === true,
      `${second.seeded.providers} providers`);

    const leads = await second.store.leads.byProvider(providerId);
    check('the enquiry survived', leads.length === 1, leads[0] ? `"${leads[0].name}" <${leads[0].email}>` : 'gone');
    check('phone number intact', leads[0]?.phone === '9864012345');
    const user = await second.store.users.findByEmail('owner@example.com');
    check('the account survived', Boolean(user?.id), user ? user.email : 'gone');
    check('password hash still verifies',
      require('../src/models/user').verifyPassword('a strong enough password', user?.password_hash || ''));

    const health = await call(second.app, { url: '/api/v1/health' });
    check('health reports durable storage', health.body?.data?.storage?.durable === true);
    second.db.close();

    console.log('');
    if (failures.length) {
      console.error(`${failures.length} check(s) failed: ${failures.join('; ')}`);
      console.error('Customer data would be at risk. Do not deploy.');
      return 1;
    }
    console.log('All checks passed.');
    console.log('A filesystem wipe costs one second of re-seeding and zero customer rows.');
    return 0;
  } finally {
    fake.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().then((code) => { process.exitCode = code; }).catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
