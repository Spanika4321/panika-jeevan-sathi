/**
 * Local stand-in for the Supabase Management API (api.supabase.com).
 *
 * Used by scripts/supabase-setup-test.mjs so --apply / report can be proven
 * without a real account. Speaks the subset of /v1/projects the setup script
 * actually calls.
 */

import http from 'node:http';

export function createManagementMock(options = {}) {
  const token = options.token || 'sbp_test_token';
  const projects = (options.projects || [
    {
      id: 'abcdefghijklmn',
      name: 'panika-jeevan-sathi',
      region: 'ap-south-1',
      status: 'ACTIVE_HEALTHY'
    }
  ]).map((p) => ({ ...p }));

  const state = new Map();
  for (const p of projects) {
    state.set(p.id, {
      applied: Boolean(p.applied),
      users: Number(p.users || 0),
      queries: [],
      buckets: []
    });
  }

  function unauthorized(res) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Invalid access token' }));
  }

  function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://127.0.0.1');
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${token}`) {
        unauthorized(res);
        return;
      }

      try {
        if (req.method === 'GET' && url.pathname === '/v1/projects') {
          send(res, 200, projects);
          return;
        }

        const keysMatch = /^\/v1\/projects\/([^/]+)\/api-keys$/.exec(url.pathname);
        if (req.method === 'GET' && keysMatch) {
          const ref = decodeURIComponent(keysMatch[1]);
          if (!state.has(ref)) {
            send(res, 404, { message: 'Project not found' });
            return;
          }
          send(res, 200, [
            { name: 'anon', api_key: 'anon-key-xxxx-not-the-secret' },
            { name: 'service_role', api_key: 'service-role-secret-key-do-not-leak' }
          ]);
          return;
        }

        const queryMatch = /^\/v1\/projects\/([^/]+)\/database\/query$/.exec(url.pathname);
        if (req.method === 'POST' && queryMatch) {
          const ref = decodeURIComponent(queryMatch[1]);
          const st = state.get(ref);
          if (!st) {
            send(res, 404, { message: 'Project not found' });
            return;
          }
          const payload = raw.length ? JSON.parse(raw.toString('utf8')) : {};
          const query = String(payload.query || '').trim();
          st.queries.push(query);
          const lower = query.toLowerCase();

          if (/^create table if not exists users\b/.test(lower)) st.applied = true;
          if (/insert into storage\.buckets/.test(lower)) {
            st.buckets.push('uploads');
            send(res, 201, []);
            return;
          }
          if (/from users/.test(lower) || /from\s+users\b/.test(lower)) {
            if (!st.applied) {
              send(res, 400, { message: 'relation "users" does not exist' });
              return;
            }
            if (/count\(\*\)/.test(lower)) {
              send(res, 201, [{ c: st.users }]);
              return;
            }
          }
          if (/^create table|^create index|^alter table/.test(lower)) {
            send(res, 201, []);
            return;
          }
          send(res, 201, []);
          return;
        }

        send(res, 404, { message: `not found: ${req.method} ${url.pathname}` });
      } catch (err) {
        send(res, 500, { message: err.message });
      }
    });
  });

  return {
    server,
    token,
    projects,
    state,
    async listen() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    close() {
      server.close();
    }
  };
}
