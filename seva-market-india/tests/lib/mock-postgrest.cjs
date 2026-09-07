/**
 * SEVA MARKET INDIA — in-process PostgREST mock for tests.
 *
 * Speaks the subset of the PostgREST REST contract that src/db/supabase.js
 * uses: upsert (POST + on_conflict + Prefer resolution), filtered DELETE,
 * paged SELECT with Range/Content-Range + Prefer count=exact, and a
 * "table missing" mode (PGRST205) for provisioning tests.
 *
 * Mirrors rows as { tbl, id, doc } exactly like scripts/supabase-init.sql.
 */
'use strict';

const http = require('node:http');

function createPostgrestMock(options = {}) {
  let exists = options.tableExists !== false;
  const rows = new Map(); // "tbl\u0000id" → { tbl, id, doc }
  const requests = [];
  const key = (tbl, id) => `${tbl}\u0000${id}`;

  function send(res, status, body, headers = {}) {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers));
    res.end(body === undefined || body === null ? '' : JSON.stringify(body));
  }

  function getRows() {
    return [...rows.values()].map((r) => ({ tbl: r.tbl, id: r.id, doc: r.doc }));
  }

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://mock');
      const segments = decodeURIComponent(url.pathname).split('/').filter(Boolean); // ['rest','v1','seva_mirror']
      const table = segments[segments.length - 1];
      const qs = url.searchParams;
      requests.push({ method: req.method, path: url.pathname, query: qs.toString() });

      if (table !== 'seva_mirror' || !exists) {
        return send(res, 404, { code: 'PGRST205', message: `Could not find the table '${table}' in the schema cache` });
      }

      if (req.method === 'POST' && qs.get('on_conflict') === 'tbl,id') {
        const payload = JSON.parse(body || '{}');
        const k = key(payload.tbl, String(payload.id));
        rows.set(k, { tbl: payload.tbl, id: String(payload.id), doc: payload.doc });
        return send(res, 201, { tbl: payload.tbl, id: payload.id, doc: payload.doc });
      }

      if (req.method === 'DELETE') {
        const tbl = qs.get('tbl');
        const id = qs.get('id');
        const wanted = [];
        for (const [k, r] of rows) {
          if (tbl && r.tbl !== tbl.replace(/^eq\./, '')) continue;
          if (id && r.id !== id.replace(/^eq\./, '')) continue;
          wanted.push(k);
        }
        for (const k of wanted) rows.delete(k);
        return send(res, 204);
      }

      if (req.method === 'GET') {
        const select = qs.get('select') || '';
        const tblFilter = qs.get('tbl');
        let list = getRows();
        if (tblFilter) list = list.filter((r) => r.tbl === tblFilter.replace(/^eq\./, ''));
        list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

        const range = req.headers.range || '0-0';
        const [startRaw, endRaw] = range.split('/')[0].split('-');
        const start = parseInt(startRaw, 10);
        const end = Number.isFinite(parseInt(endRaw, 10)) ? parseInt(endRaw, 10) : start;

        if (select === 'id' || select === 'tbl,id,doc' || select === 'tbl,id') {
          const page = list.slice(start, end + 1);
          const total = list.length;
          const out = page.map((r) => {
            if (select === 'id') return { id: r.id };
            if (select === 'tbl,id') return { tbl: r.tbl, id: r.id };
            return { tbl: r.tbl, id: r.id, doc: r.doc };
          });
          const contentRange = total === 0 ? '*/0' : `${start}-${Math.min(end, total - 1)}/${total}`;
          return send(res, 200, out, {
            'Content-Range': contentRange,
            'Range-Unit': 'items',
          });
        }
        return send(res, 400, { code: 'PGRST105', message: `unexpected select ${select}` });
      }

      return send(res, 405, { code: 'PGRST100', message: 'method not allowed' });
    });
  });

  return {
    server,
    listen() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
      });
    },
    close() {
      server.close();
    },
    rows,
    requests,
    setTableExists(v) {
      exists = v;
    },
  };
}

module.exports = { createPostgrestMock };
