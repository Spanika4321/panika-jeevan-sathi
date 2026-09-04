/**
 * Local stand-in for Supabase PostgREST + Storage.
 *
 * Speaks the same HTTP contracts used by lib/supabase.js so the production
 * client can be tested without a Cloudflare/Supabase account.
 *
 * Durability: the database is a real SQLite *file*. Killing the Node app and
 * wiping PJS_DATA_DIR does not erase this file — that is the Render-sleep case.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const dbLib = require('../../lib/db.js');

function parseFilters(searchParams) {
  const conds = [];
  let order = [];
  let limit;
  let offset;
  let select = '*';
  for (const [rawKey, rawVal] of searchParams.entries()) {
    if (rawKey === 'select') {
      select = rawVal;
      continue;
    }
    if (rawKey === 'order') {
      order = String(rawVal)
        .split(',')
        .map((part) => {
          const [col, dir] = part.split('.');
          return { col, desc: dir === 'desc' };
        });
      continue;
    }
    if (rawKey === 'limit') {
      limit = Number(rawVal);
      continue;
    }
    if (rawKey === 'offset') {
      offset = Number(rawVal);
      continue;
    }
    const val = rawVal;
    if (val.startsWith('eq.')) conds.push({ col: rawKey, op: 'eq', value: decode(val.slice(3)) });
    else if (val.startsWith('neq.')) conds.push({ col: rawKey, op: 'ne', value: decode(val.slice(4)) });
    else if (val === 'is.null') conds.push({ col: rawKey, op: 'is_null' });
    else if (val.startsWith('gte.')) conds.push({ col: rawKey, op: 'gte', value: decode(val.slice(4)) });
    else if (val.startsWith('lte.')) conds.push({ col: rawKey, op: 'lte', value: decode(val.slice(4)) });
    else if (val.startsWith('gt.')) conds.push({ col: rawKey, op: 'gt', value: decode(val.slice(3)) });
    else if (val.startsWith('lt.')) conds.push({ col: rawKey, op: 'lt', value: decode(val.slice(3)) });
    else if (val.startsWith('ilike.') || val.startsWith('like.')) {
      const p = decode(val.slice(val.indexOf('.') + 1)).replace(/\*/g, '%').replace(/\?/g, '_');
      conds.push({ col: rawKey, op: 'like', value: p });
    } else if (val.startsWith('in.(') && val.endsWith(')')) {
      const inner = val.slice(4, -1);
      const values = inner ? inner.split(',').map(decode) : [];
      conds.push({ col: rawKey, op: 'in', value: values });
    }
  }
  return { conds, order, limit, offset, select };
}

function decode(v) {
  try {
    return decodeURIComponent(v);
  } catch (_) {
    return v;
  }
}

function coerce(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number') return value;
  if (/^-?\d+$/.test(String(value))) {
    const n = Number(value);
    if (Number.isSafeInteger(n)) return n;
  }
  return value;
}

function matches(row, cond) {
  const v = row[cond.col];
  switch (cond.op) {
    case 'eq':
      return v == cond.value; // eslint-disable-line eqeqeq
    case 'ne':
      return !(v == cond.value); // eslint-disable-line eqeqeq
    case 'is_null':
      return v === null || v === undefined;
    case 'in':
      return cond.value.some((x) => x == v); // eslint-disable-line eqeqeq
    case 'gte':
      return v !== null && v !== undefined && v >= coerce(cond.value);
    case 'lte':
      return v !== null && v !== undefined && v <= coerce(cond.value);
    case 'gt':
      return v !== null && v !== undefined && v > coerce(cond.value);
    case 'lt':
      return v !== null && v !== undefined && v < coerce(cond.value);
    case 'like': {
      const esc = String(cond.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
      return v !== null && v !== undefined && new RegExp('^' + esc + '$', 'i').test(String(v));
    }
    default:
      return false;
  }
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

export function createSupabaseMock(options = {}) {
  const token = options.token || 'test-service-role';
  const dbFile = options.file;
  if (!dbFile) throw new Error('createSupabaseMock requires options.file (durable sqlite path)');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(dbLib.SCHEMA);
  for (const sql of dbLib.INDEXES) db.exec(sql);

  const objectsDir = options.objectsDir || `${dbFile}.objects`;
  fs.mkdirSync(objectsDir, { recursive: true });
  const objects = new Map();
  for (const name of fs.readdirSync(objectsDir)) {
    try {
      objects.set(decodeURIComponent(name), fs.readFileSync(path.join(objectsDir, name)));
    } catch (_) {
      /* skip unreadable */
    }
  }
  function persistObject(key, buf) {
    objects.set(key, buf);
    fs.writeFileSync(path.join(objectsDir, encodeURIComponent(key)), buf);
  }
  function forgetObject(key) {
    objects.delete(key);
    try {
      fs.unlinkSync(path.join(objectsDir, encodeURIComponent(key)));
    } catch (_) {
      /* already gone */
    }
  }
  const buckets = new Set();
  const requests = [];

  function allRows(table) {
    try {
      return db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all();
    } catch (err) {
      throw Object.assign(new Error(err.message), { status: 404 });
    }
  }

  function filterRows(table, conds) {
    let rows = allRows(table);
    if (conds.length) rows = rows.filter((r) => conds.every((c) => matches(r, c)));
    return rows;
  }

  function authorized(req) {
    const auth = req.headers.authorization || '';
    const key = req.headers.apikey || '';
    return auth === `Bearer ${token}` || key === token;
  }

  function send(res, status, body, headers = {}) {
    const json = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers));
    res.end(json);
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://127.0.0.1');
      requests.push({ method: req.method, path: url.pathname });

      if (!authorized(req)) {
        send(res, 401, { message: 'Invalid API key' });
        return;
      }

      try {
        /* ---------------- storage ---------------- */
        if (url.pathname.startsWith('/storage/v1/bucket')) {
          const parts = url.pathname.split('/').filter(Boolean);
          if (req.method === 'GET' && parts[3]) {
            const name = decodeURIComponent(parts[3]);
            if (!buckets.has(name)) {
              send(res, 404, { message: 'Bucket not found' });
              return;
            }
            send(res, 200, { id: name, name, public: false });
            return;
          }
          if (req.method === 'POST') {
            const payload = raw.length ? JSON.parse(raw.toString('utf8')) : {};
            buckets.add(payload.id || payload.name);
            send(res, 200, { name: payload.id || payload.name });
            return;
          }
        }

        if (url.pathname.startsWith('/storage/v1/object/')) {
          const rest = url.pathname.slice('/storage/v1/object/'.length);
          if (req.method === 'DELETE') {
            const payload = raw.length ? JSON.parse(raw.toString('utf8')) : {};
            const prefixes = payload.prefixes || [];
            for (const p of prefixes) forgetObject(p);
            send(res, 200, { message: 'ok' });
            return;
          }
          const slash = rest.indexOf('/');
          const key = slash >= 0 ? decodeURIComponent(rest.slice(slash + 1)) : '';
          const bucket = slash >= 0 ? decodeURIComponent(rest.slice(0, slash)) : rest;
          buckets.add(bucket);
          if (req.method === 'POST' || req.method === 'PUT') {
            persistObject(key, raw);
            send(res, 200, { Key: key });
            return;
          }
          if (req.method === 'GET') {
            if (!objects.has(key)) {
              send(res, 404, { message: 'not found' });
              return;
            }
            const buf = objects.get(key);
            res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length });
            res.end(buf);
            return;
          }
        }

        /* ---------------- rest ------------------- */
        if (!url.pathname.startsWith('/rest/v1/')) {
          send(res, 404, { message: 'not found' });
          return;
        }
        const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length).split('/')[0]);
        if (!dbLib.TABLES[table]) {
          send(res, 404, { message: `relation ${table} does not exist` });
          return;
        }
        const parsed = parseFilters(url.searchParams);
        const prefer = String(req.headers.prefer || '');
        const wantCount = /count=exact/i.test(prefer);

        if (req.method === 'HEAD' || req.method === 'GET') {
          let rows = filterRows(table, parsed.conds);
          const total = rows.length;
          if (parsed.order.length) {
            rows = rows.slice().sort((a, b) => {
              for (const o of parsed.order) {
                const av = a[o.col];
                const bv = b[o.col];
                if (av === bv) continue;
                const cmp = av < bv ? -1 : 1;
                return o.desc ? -cmp : cmp;
              }
              return 0;
            });
          }
          if (parsed.offset) rows = rows.slice(parsed.offset);
          if (parsed.limit !== undefined) rows = rows.slice(0, parsed.limit);
          const headers = {};
          if (wantCount) headers['content-range'] = `0-${Math.max(0, rows.length - 1)}/${total}`;
          if (req.method === 'HEAD') {
            res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, headers));
            res.end();
            return;
          }
          send(res, 200, rows, headers);
          return;
        }

        if (req.method === 'POST') {
          const payload = raw.length ? JSON.parse(raw.toString('utf8')) : {};
          const cols = Object.keys(payload).filter((c) => payload[c] !== undefined);
          const pk = dbLib.TABLES[table];
          const stmt = db.prepare(
            `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(',')}) VALUES (${cols.map(() => '?').join(',')})`
          );
          stmt.run(...cols.map((c) => payload[c]));
          if (pk && payload[pk] === undefined) {
            const last = db.prepare('SELECT last_insert_rowid() AS id').get();
            payload[pk] = Number(last.id);
          }
          send(res, 201, [payload]);
          return;
        }

        if (req.method === 'PATCH') {
          const payload = raw.length ? JSON.parse(raw.toString('utf8')) : {};
          const rows = filterRows(table, parsed.conds);
          const cols = Object.keys(payload).filter((c) => payload[c] !== undefined);
          const pk = dbLib.TABLES[table];
          for (const row of rows) {
            if (!cols.length) continue;
            const whereCol = pk;
            const stmt = db.prepare(
              `UPDATE ${quoteIdent(table)} SET ${cols.map((c) => `${quoteIdent(c)} = ?`).join(', ')} WHERE ${quoteIdent(whereCol)} = ?`
            );
            stmt.run(...cols.map((c) => payload[c]), row[whereCol]);
            Object.assign(row, payload);
          }
          send(res, 200, rows.map((r) => Object.assign({}, r, payload)));
          return;
        }

        if (req.method === 'DELETE') {
          const rows = filterRows(table, parsed.conds);
          const pk = dbLib.TABLES[table];
          for (const row of rows) {
            db.prepare(`DELETE FROM ${quoteIdent(table)} WHERE ${quoteIdent(pk)} = ?`).run(row[pk]);
          }
          send(res, 200, rows);
          return;
        }

        send(res, 405, { message: 'method not allowed' });
      } catch (err) {
        send(res, err.status || 500, { message: err.message });
      }
    });
  });

  return {
    server,
    db,
    dbFile,
    objectsDir,
    token,
    requests,
    objects,
    async listen() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    close() {
      try {
        db.exec('PRAGMA wal_checkpoint(FULL);');
      } catch (_) {
        /* ignore */
      }
      server.close();
      try {
        db.close();
      } catch (_) {
        /* ignore */
      }
    },
    userCount() {
      return Number(db.prepare('SELECT COUNT(*) AS c FROM users').get().c);
    },
    hasUser(email) {
      return Boolean(db.prepare('SELECT id FROM users WHERE email = ?').get(email));
    },
    hasObject(key) {
      return objects.has(key);
    }
  };
}
