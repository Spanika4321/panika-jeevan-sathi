#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Google Sheets bridge end-to-end test.
 *
 * Runs the real Apps Script code (apps-script/Code.gs) inside Node with small
 * stand-ins for the Google services, serves it over HTTP exactly like the Apps
 * Script web app does, then boots the real website against it:
 *
 *   1. set up the bridge (?action=setup&token=…) and let it create its Sheet
 *   2. start server.js with PJS_STORAGE=sheets
 *   3. register → log in → save a profile → read it back
 *   4. restart the server and log in again (everything must come from the Sheet)
 *   5. repeat a short run with PJS_STORAGE=mirror (local database + live copy)
 *
 *   node scripts/apps-script-bridge-test.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_SOURCE = path.join(ROOT, 'apps-script', 'Code.gs');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------- fake Google services */

function createProperties() {
  const store = new Map();
  return {
    getProperty(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setProperty(key, value) {
      store.set(key, String(value));
    },
    deleteProperty(key) {
      store.delete(key);
    }
  };
}

function createSheet(spreadsheet, name) {
  return {
    name,
    values: [],
    frozen: 0,
    getName() {
      return this.name;
    },
    getDataRange() {
      const self = this;
      return {
        getValues() {
          return self.values.map((row) => row.slice());
        }
      };
    },
    clear() {
      this.values = [];
      return this;
    },
    getRange(row, col, height, width) {
      const self = this;
      return {
        setValues(grid) {
          for (let r = 0; r < height; r++) {
            const targetRow = row - 1 + r;
            while (self.values.length <= targetRow) self.values.push([]);
            for (let c = 0; c < width; c++) {
              self.values[targetRow][col - 1 + c] = grid[r] && grid[r][c] !== undefined ? grid[r][c] : '';
            }
          }
          return this;
        }
      };
    },
    setFrozenRows(count) {
      this.frozen = count;
      return this;
    }
  };
}

function createSpreadsheetApp(properties) {
  const sheets = new Map();

  function spreadsheet(id) {
    return {
      id,
      getId() {
        return this.id;
      },
      getUrl() {
        return `https://docs.google.com/spreadsheets/d/${this.id}/edit`;
      },
      getSheetByName(name) {
        return sheets.get(name) || null;
      },
      insertSheet(name) {
        const sheet = createSheet(this, name);
        sheets.set(name, sheet);
        return sheet;
      }
    };
  }

  return {
    create(title) {
      properties.setProperty('PJS_SPREADSHEET_ID', 'mock-spreadsheet-id');
      void title;
      return spreadsheet('mock-spreadsheet-id');
    },
    openById(id) {
      if (id !== 'mock-spreadsheet-id') throw new Error('not found');
      return spreadsheet(id);
    },
    getActiveSpreadsheet() {
      throw new Error('standalone script: no container');
    }
  };
}

/** Load Code.gs with Google's services faked. */
function loadBridge(properties) {
  const source = fs.readFileSync(BRIDGE_SOURCE, 'utf8');
  const factory = new Function(
    'SpreadsheetApp',
    'PropertiesService',
    'LockService',
    'ContentService',
    'ScriptApp',
    'Session',
    `${source}\nreturn { doGet, doPost, PJS_TABLES };`
  );

  const ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput(text) {
      return {
        text,
        getContent() {
          return text;
        },
        setMimeType() {
          return this;
        }
      };
    }
  };

  const ScriptApp = { getScriptId: () => 'mock-script-id' };
  const Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) };
  const LockService = {
    getScriptLock() {
      return {
        waitLock() {},
        releaseLock() {}
      };
    }
  };

  return factory(
    createSpreadsheetApp(properties),
    { getScriptProperties: () => properties },
    LockService,
    ContentService,
    ScriptApp,
    Session
  );
}

/** Serve the bridge over HTTP the way Apps Script does. */
async function serveBridge() {
  const properties = createProperties();
  const bridge = loadBridge(properties);
  const calls = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const body = Buffer.concat(chunks).toString('utf8');
      calls.push({ method: req.method, action: url.searchParams.get('action') || (body ? JSON.parse(body).action : '') });
      let out;
      try {
        if (req.method === 'POST') {
          out = bridge.doPost({ parameter: Object.fromEntries(url.searchParams.entries()), postData: { contents: body } });
        } else {
          out = bridge.doGet({ parameter: Object.fromEntries(url.searchParams.entries()) });
        }
      } catch (err) {
        out = { text: JSON.stringify({ ok: false, error: String(err && err.message) }) };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(out.getContent ? out.getContent() : out.text);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}/exec`,
    calls,
    bridge,
    properties,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

/* --------------------------------------------------------------- website run */

async function startServer({ port, sheetsUrl, dataDir, storage, token }) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      PJS_DATA_DIR: dataDir,
      PJS_STORAGE: storage,
      PJS_SHEETS_URL: sheetsUrl,
      PJS_SHEETS_TOKEN: token,
      ADMIN_EMAIL: 'owner@example.com',
      ADMIN_PASSWORD: 'OwnerPass123',
      PJS_FLUSH_INTERVAL_MS: '400'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (d) => {
    output += d.toString();
  });
  child.stderr.on('data', (d) => {
    output += d.toString();
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (/is running/.test(output)) return { child, output: () => output };
    if (/WILL NOT START|FATAL|Fatal error/.test(output)) break;
    await sleep(150);
  }
  return { child, output: () => output, failedToStart: true };
}

async function stopServer(handle) {
  if (!handle || !handle.child || handle.child.exitCode !== null) return;
  handle.child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    handle.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function client(port) {
  const base = `http://127.0.0.1:${port}`;
  const jar = new Map();
  async function call(method, urlPath, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual'
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const raw of setCookie) {
      const [pair] = String(raw).split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    return { status: res.status, ...data };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b === undefined ? {} : b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p)
  };
}

/* --------------------------------------------------------------------- tests */

async function main() {
  console.log('\nGoogle Sheets bridge (apps-script/Code.gs running inside Node)\n');

  const sheet = await serveBridge();
  const TOKEN = 'test-bridge-token';
  const PORT = 3400 + Math.floor(Math.random() * 300);

  /* 1 ── the one-time setup call, the same one you make from a phone browser */
  const setupRes = await fetch(`${sheet.url}?action=setup&token=${TOKEN}`);
  const setup = await setupRes.json();
  check('?action=setup creates the spreadsheet and stores the token', setup.ok === true && setup.data.tokenConfigured === true, JSON.stringify(setup).slice(0, 160));

  const pingRes = await fetch(`${sheet.url}?action=ping&token=${TOKEN}`);
  const ping = await pingRes.json();
  check('?action=ping answers with the protocol and tab list', ping.ok === true && ping.data.protocol === 'pjs-bridge/1' && ping.data.tabs.length === 11, JSON.stringify(ping.data && ping.data.protocol));
  check('every table of the website has a tab', ping.ok && ping.data.tabs.every((t) => t.rows === 0));

  const noToken = await (await fetch(`${sheet.url}?action=dump`)).json();
  check('a request without the token is refused', noToken.ok === false);

  /* 2 ── the website, with Google Sheets as its database */
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-sheets-'));
  let server = await startServer({ port: PORT, sheetsUrl: sheet.url, dataDir, storage: 'sheets', token: TOKEN });
  check('the site boots with PJS_STORAGE=sheets', !server.failedToStart, server.output().split('\n').slice(-6).join(' | '));
  check('boot reads the Sheet', /Google Sheets loaded/.test(server.output()), server.output().split('\n').slice(-4).join(' | '));

  if (server.failedToStart) {
    console.log(server.output());
    await sheet.close();
    process.exit(1);
  }

  const api = client(PORT);
  const email = `member${Date.now()}@example.com`;
  const registered = await api.post('/api/auth/register', { email, password: 'MemberPass123', name: 'Sheet Member' });
  check('a member can register', registered.ok === true, JSON.stringify(registered).slice(0, 160));

  const login = await api.post('/api/auth/login', { email, password: 'MemberPass123' });
  check('the member can log in', login.ok === true, JSON.stringify(login).slice(0, 160));

  const saved = await api.put('/api/profile', { age: 31, gender: 'Male', city: 'Raipur', state: 'Chhattisgarh', community: 'Panika', about_me: 'Bridged through Google Sheets' });
  check('a profile can be saved', saved.ok === true, JSON.stringify(saved).slice(0, 160));

  const me = await api.get('/api/me');
  check('the profile comes back with the saved values', me.ok && me.profile && me.profile.city === 'Raipur' && Number(me.profile.age) === 31, JSON.stringify(me.profile || {}).slice(0, 200));

  /* 3 ── did it really land in the Sheet? */
  const dumpRes = await fetch(`${sheet.url}?action=dump&token=${TOKEN}`);
  const dump = await dumpRes.json();
  const users = dump.data.tables.users || [];
  const profiles = dump.data.tables.profiles || [];
  check('the new member is a row in the users tab', users.some((u) => u.email === email), `${users.length} user rows`);
  check('the profile is a row in the profiles tab', profiles.some((p) => p.city === 'Raipur'), `${profiles.length} profile rows`);
  check('row ids are assigned', users.every((u) => Number(u.id) > 0));

  /* 3b ── a retried write must not create duplicates (upsert) */
  async function mutate(ops) {
    const res = await fetch(`${sheet.url}?action=mutate&token=${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ v: 1, action: 'mutate', token: TOKEN, ops })
    });
    return res.json();
  }
  async function rowsWhere(table, where) {
    const res = await fetch(`${sheet.url}?action=query&token=${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ v: 1, action: 'query', token: TOKEN, table, where })
    });
    const json = await res.json();
    return (json.data && json.data.rows) || [];
  }

  await mutate([
    { type: 'insert', table: 'settings', row: { key: 'dup_test', value: 'first' } },
    { type: 'insert', table: 'settings', row: { key: 'dup_test', value: 'first' } }
  ]);
  const dupRows = await rowsWhere('settings', { key: 'dup_test' });
  check('the same insert twice does not duplicate a row', dupRows.length === 1, `${dupRows.length} rows`);

  await mutate([{ type: 'update', table: 'settings', where: { key: 'dup_test' }, patch: { value: 'second' } }]);
  const updated = await rowsWhere('settings', { key: 'dup_test' });
  check('update changes the row in place', updated.length === 1 && updated[0].value === 'second', JSON.stringify(updated));

  await mutate([{ type: 'remove', table: 'settings', where: { key: 'dup_test' } }]);
  const afterRemove = await rowsWhere('settings', { key: 'dup_test' });
  check('remove deletes the row', afterRemove.length === 0, JSON.stringify(afterRemove));

  /* 4 ── restart: everything must come back from the Sheet */
  await stopServer(server);
  server = await startServer({ port: PORT, sheetsUrl: sheet.url, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-sheets-')), storage: 'sheets', token: TOKEN });
  check('the site boots again against the same Sheet', !server.failedToStart);

  const api2 = client(PORT);
  const login2 = await api2.post('/api/auth/login', { email, password: 'MemberPass123' });
  check('the member is still there after a restart (loaded from the Sheet)', login2.ok === true, JSON.stringify(login2).slice(0, 160));
  const me2 = await api2.get('/api/me');
  check('the profile survived the restart', me2.ok && me2.profile && me2.profile.city === 'Raipur', JSON.stringify(me2.profile || {}).slice(0, 200));

  /* 5 ── edits made directly in the Sheet appear on the site */
  const edit = await fetch(`${sheet.url}?action=mutate&token=${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ v: 1, action: 'mutate', token: TOKEN, ops: [{ type: 'update', table: 'profiles', where: { city: 'Raipur' }, patch: { city: 'Bilaspur' } }] })
  });
  const editJson = await edit.json();
  check('an edit written straight into the Sheet is applied', editJson.ok && editJson.data.applied === 1, JSON.stringify(editJson).slice(0, 160));

  const admin = client(PORT);
  await admin.post('/api/auth/login', { email: 'owner@example.com', password: 'OwnerPass123' });
  const reloaded = await admin.post('/api/admin/apps-script/reload', {});
  check('"Reload from Sheet" refreshes the site', reloaded.ok === true && reloaded.rows > 0, JSON.stringify(reloaded).slice(0, 160));
  const me3 = await api2.get('/api/me');
  check('the hand-made Sheet edit is now visible on the site', me3.ok && me3.profile && me3.profile.city === 'Bilaspur', JSON.stringify(me3.profile || {}).slice(0, 160));

  await stopServer(server);

  /* 6 ── mirror mode: local database + live copy in the Sheet */
  const mirrorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-mirror-'));
  const mirrorServer = await startServer({ port: PORT + 1, sheetsUrl: sheet.url, dataDir: mirrorDir, storage: 'mirror', token: TOKEN });
  check('the site boots with PJS_STORAGE=mirror', !mirrorServer.failedToStart, mirrorServer.output().split('\n').slice(-5).join(' | '));

  const api3 = client(PORT + 1);
  const mirrorEmail = `mirror${Date.now()}@example.com`;
  const mirrorReg = await api3.post('/api/auth/register', { email: mirrorEmail, password: 'MirrorPass123', name: 'Mirror Member' });
  check('a member can register in mirror mode', mirrorReg.ok === true, JSON.stringify(mirrorReg).slice(0, 160));
  await sleep(1200); // let the queue flush

  const dump2 = await (await fetch(`${sheet.url}?action=dump&token=${TOKEN}`)).json();
  check('the new member is mirrored into the Sheet', (dump2.data.tables.users || []).some((u) => u.email === mirrorEmail));
  const health = await (await fetch(`http://127.0.0.1:${PORT + 1}/api/health`)).json();
  check('/api/health reports the Sheets link', health.ok === true && health.remote && health.remote.sheets && health.remote.sheets.connected === true, JSON.stringify(health.remote || {}).slice(0, 200));
  await stopServer(mirrorServer);

  await sheet.close();

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\n  Failures:');
    for (const f of failures) console.log(`   - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\n  Bridge test crashed:', err);
  process.exit(1);
});
