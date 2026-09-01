/**
 * Local stand-ins for Cloudflare D1 and R2.
 *
 * They implement the same HTTP contracts as the real services (documented in
 * lib/d1.js and lib/r2.js) so the whole site can be exercised end to end —
 * register, profile, photo upload, messages, admin, restart — against the exact
 * code paths that run on Render, without touching a real Cloudflare account.
 *
 *   D1 mock: real SQLite (node:sqlite) behind D1's REST API shape.
 *   R2 mock: a folder behind the S3 REST API, checking SigV4 headers.
 */

import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/* ------------------------------------------------------------------ D1 mock */

export function createD1Mock(options = {}) {
  const dbFile = options.file || path.join(fs.mkdtempSync('/tmp/pjs-mock-d1-'), 'mock.db');
  const db = new DatabaseSync(dbFile);
  const requests = [];
  let failNext = 0;
  let failureMode = null;

  function execute(sql, params = []) {
    const text = String(sql || '').trim();
    if (!text) return { results: [], meta: {} };
    const stmt = db.prepare(text);
    const isRead = /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(text);
    if (isRead) {
      const rows = stmt.all(...params).map((row) => {
        const out = {};
        for (const [k, v] of Object.entries(row)) {
          // D1 speaks JSON: Buffers become base64, everything else passes through.
          out[k] = Buffer.isBuffer(v) ? v.toString('base64') : v;
        }
        return out;
      });
      return { results: rows, success: true, meta: { rows_read: rows.length, rows_written: 0 } };
    }
    const info = stmt.run(...params);
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(info.changes || 0),
        last_row_id: Number(info.lastInsertRowid || 0)
      }
    };
  }

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({ url: req.url, body, method: req.method });

      if (options.token && req.headers.authorization !== `Bearer ${options.token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, errors: [{ code: 9109, message: 'Unauthorized' }] }));
        return;
      }

      // Fault injection for the retry paths.
      if (failNext > 0) {
        failNext -= 1;
        if (failureMode === 'http500') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, errors: [{ code: 8000000, message: 'internal error' }] }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, errors: [{ code: 7500, message: 'D1 is overloaded' }] }));
        }
        return;
      }

      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, errors: [{ message: 'invalid JSON' }] }));
        return;
      }

      const statements =
        payload.batch && Array.isArray(payload.batch)
          ? payload.batch
          : payload.sql
            ? [{ sql: payload.sql, params: payload.params || [] }]
            : [];

      try {
        const result = statements.map((s) => execute(s.sql, s.params || []));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result, errors: [], messages: [] }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            result: [],
            errors: [{ code: 7500, message: err.message }],
            messages: []
          })
        );
      }
    });
  });

  return {
    server,
    db,
    dbFile,
    requests,
    failNext(count = 1, mode = 'http500') {
      failNext = count;
      failureMode = mode;
    },
    statementCount() {
      return requests.reduce((n, r) => {
        try {
          const p = JSON.parse(r.body);
          return n + (Array.isArray(p.batch) ? p.batch.length : p.sql ? 1 : 0);
        } catch (_) {
          return n;
        }
      }, 0);
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    close() {
      server.close();
      try {
        db.close();
      } catch (_) {
        /* already closed */
      }
    }
  };
}

/* ------------------------------------------------------------------ R2 mock */

export function createR2Mock(options = {}) {
  const bucket = options.bucket || 'pjs-test';
  const prefix = options.prefix || 'uploads';
  const root = fs.mkdtempSync('/tmp/pjs-mock-r2-');
  const requests = [];

  function objectPath(key) {
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep) && target !== root) return null;
    return target;
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://127.0.0.1');
      const rawKey = decodeURIComponent(url.pathname.replace(new RegExp(`^/${bucket}/?`), ''));
      const key = rawKey.startsWith(`${prefix}/`) ? rawKey.slice(prefix.length + 1) : rawKey;
      requests.push({ method: req.method, key, url: req.url });

      // Every request must carry a SigV4 signature and the matching body hash.
      const auth = req.headers.authorization || '';
      if (!/^AWS4-HMAC-SHA256 Credential=.+\/\d{8}\/.+\/s3\/aws4_request, SignedHeaders=.+, Signature=[0-9a-f]{64}$/.test(auth)) {
        res.writeHead(403, { 'Content-Type': 'application/xml' });
        res.end('<Error><Code>SignatureDoesNotMatch</Code><Message>Bad SigV4 header</Message></Error>');
        return;
      }
      const declared = req.headers['x-amz-content-sha256'];
      const actual = crypto.createHash('sha256').update(body).digest('hex');
      if (declared && declared !== actual) {
        res.writeHead(400, { 'Content-Type': 'application/xml' });
        res.end('<Error><Code>XAmzContentSHA256Mismatch</Code><Message>Bad body hash</Message></Error>');
        return;
      }
      if (!req.headers['x-amz-date']) {
        res.writeHead(400, { 'Content-Type': 'application/xml' });
        res.end('<Error><Code>MissingSecurityHeader</Code><Message>x-amz-date required</Message></Error>');
        return;
      }

      if (req.method === 'PUT' && !key) {
        res.writeHead(200); // CreateBucket
        res.end();
        return;
      }

      const file = objectPath(key);
      if (!file) {
        res.writeHead(400, { 'Content-Type': 'application/xml' });
        res.end('<Error><Code>InvalidRequest</Code><Message>Bad key</Message></Error>');
        return;
      }

      if (req.method === 'PUT') {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
        res.writeHead(200, { ETag: `"${crypto.createHash('md5').update(body).digest('hex')}"` });
        res.end();
        return;
      }
      if (req.method === 'GET') {
        if (url.searchParams.get('list-type') === '2') {
          // Real S3/R2 listings are recursive and honour ?prefix=, so the mock
          // must be too — backups live under <prefix>/backups/.
          const walk = (dir, rel) => {
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir).flatMap((name) => {
              const full = path.join(dir, name);
              const child = rel ? `${rel}/${name}` : name;
              return fs.statSync(full).isDirectory()
                ? walk(full, child)
                : [{ key: `${prefix}/${child}`, size: fs.statSync(full).size }];
            });
          };
          const wanted = url.searchParams.get('prefix') || '';
          const keys = walk(root, '')
            .filter((entry) => !wanted || entry.key.startsWith(wanted))
            .map((entry) => `<Contents><Key>${entry.key}</Key><Size>${entry.size}</Size></Contents>`)
            .join('');
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><IsTruncated>false</IsTruncated>${keys}</ListBucketResult>`);
          return;
        }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.writeHead(404, { 'Content-Type': 'application/xml' });
          res.end('<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>');
          return;
        }
        const data = fs.readFileSync(file);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length });
        res.end(data);
        return;
      }
      if (req.method === 'HEAD') {
        if (!fs.existsSync(file)) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Length': fs.statSync(file).size });
        res.end();
        return;
      }
      if (req.method === 'DELETE') {
        try {
          fs.unlinkSync(file);
        } catch (_) {
          /* already gone */
        }
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(405, { 'Content-Type': 'application/xml' });
      res.end('<Error><Code>MethodNotAllowed</Code></Error>');
    });
  });

  return {
    server,
    root,
    bucket,
    prefix,
    requests,
    has(key) {
      const file = objectPath(key);
      return Boolean(file && fs.existsSync(file));
    },
    read(key) {
      const file = objectPath(key);
      return file && fs.existsSync(file) ? fs.readFileSync(file) : null;
    },
    keys() {
      const dir = path.join(root, prefix);
      return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    close() {
      server.close();
    }
  };
}
