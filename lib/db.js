'use strict';
/**
 * PANIKA JEEVAN SATHI - storage layer
 *
 * Production driver : Supabase Postgres via PostgREST (lib/supabase.js)
 * Fallback drivers  : Cloudflare D1, then node:sqlite, then JSON
 *
 * On Render / PJS_REQUIRE_REMOTE the sqlite/json fallbacks are refused.
 * All drivers expose the same table API; callers always await.
 */

const fs = require('node:fs');
const path = require('node:path');

const d1Lib = require('./d1');
const supabaseLib = require('./supabase');

const TABLES = {
  users: 'id',
  profiles: 'user_id',
  interests: 'id',
  shortlist: 'id',
  messages: 'id',
  notifications: 'id',
  reports: 'id',
  stories: 'id',
  contact_messages: 'id',
  settings: 'key',
  audit_logs: 'id',
  site_stats: 'id',
  site_visitors: 'id'
};

/* ------------------------------------------------------------------ helpers */

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Split a where-object into the list of conditions it represents. */
function conditions(where) {
  const out = [];
  if (!where) return out;
  for (const [col, raw] of Object.entries(where)) {
    if (raw === undefined) {
      continue; // undefined = "no constraint on this column"
    }
    if (raw === null) {
      out.push({ col, op: 'is_null' });
    } else if (isPlainObject(raw)) {
      if (Array.isArray(raw.in)) out.push({ col, op: 'in', value: raw.in });
      if (raw.gte !== undefined) out.push({ col, op: 'gte', value: raw.gte });
      if (raw.lte !== undefined) out.push({ col, op: 'lte', value: raw.lte });
      if (raw.gt !== undefined) out.push({ col, op: 'gt', value: raw.gt });
      if (raw.lt !== undefined) out.push({ col, op: 'lt', value: raw.lt });
      if (raw.like !== undefined) out.push({ col, op: 'like', value: raw.like });
      if (raw.ne !== undefined) out.push({ col, op: 'ne', value: raw.ne });
    } else {
      out.push({ col, op: 'eq', value: raw });
    }
  }
  return out;
}

function orderKeys(order) {
  if (!order) return [];
  const list = Array.isArray(order) ? order : [order];
  return list.map((o) => {
    const desc = String(o).startsWith('-');
    return { col: desc ? String(o).slice(1) : String(o), desc };
  });
}

/** Build the WHERE clause and bound parameters for a where-object. */
function sqlWhere(where) {
  const sql = [];
  const params = [];
  for (const c of conditions(where)) {
    switch (c.op) {
      case 'eq':
        sql.push(`"${c.col}" = ?`);
        params.push(c.value);
        break;
      case 'ne':
        sql.push(`("${c.col}" IS NOT ? OR "${c.col}" IS NULL)`);
        params.push(c.value);
        break;
      case 'is_null':
        sql.push(`"${c.col}" IS NULL`);
        break;
      case 'in': {
        const vals = Array.isArray(c.value) ? c.value : [];
        if (!vals.length) {
          sql.push('1 = 0');
        } else {
          sql.push(`"${c.col}" IN (${vals.map(() => '?').join(',')})`);
          params.push(...vals);
        }
        break;
      }
      case 'gte':
        sql.push(`"${c.col}" >= ?`);
        params.push(c.value);
        break;
      case 'lte':
        sql.push(`"${c.col}" <= ?`);
        params.push(c.value);
        break;
      case 'gt':
        sql.push(`"${c.col}" > ?`);
        params.push(c.value);
        break;
      case 'lt':
        sql.push(`"${c.col}" < ?`);
        params.push(c.value);
        break;
      case 'like':
        sql.push(`"${c.col}" LIKE ?`);
        params.push(c.value);
        break;
    }
  }
  return { clause: sql.length ? ' WHERE ' + sql.join(' AND ') : '', params };
}

/* ------------------------------------------------------------- sql driver */

function createSqliteDriver(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  const buildWhere = sqlWhere;

  function coerce(row) {
    if (!row) return row;
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = v;
    return out;
  }

  return {
    kind: 'sqlite',

    exec(sql) {
      db.exec(sql);
    },

    insert(table, row) {
      const cols = Object.keys(row).filter((c) => row[c] !== undefined);
      const stmt = db.prepare(
        `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`
      );
      stmt.run(...cols.map((c) => row[c]));
      const pk = TABLES[table];
      if (pk && row[pk] === undefined) {
        const last = db.prepare('SELECT last_insert_rowid() AS id').get();
        row[pk] = Number(last.id);
      }
      return row;
    },

    update(table, where, row) {
      const cols = Object.keys(row).filter((c) => row[c] !== undefined);
      if (!cols.length) return 0;
      const { clause, params } = buildWhere(where);
      const stmt = db.prepare(
        `UPDATE "${table}" SET ${cols.map((c) => `"${c}" = ?`).join(',')}${clause}`
      );
      const res = stmt.run(...cols.map((c) => row[c]), ...params);
      return Number(res.changes || 0);
    },

    remove(table, where) {
      const { clause, params } = buildWhere(where);
      const res = db.prepare(`DELETE FROM "${table}"${clause}`).run(...params);
      return Number(res.changes || 0);
    },

    one(table, where) {
      const { clause, params } = buildWhere(where);
      const row = db.prepare(`SELECT * FROM "${table}"${clause} LIMIT 1`).get(...params);
      return coerce(row);
    },

    all(table, where, opts = {}) {
      const { clause, params } = buildWhere(where);
      let sql = `SELECT * FROM "${table}"${clause}`;
      const keys = orderKeys(opts.order);
      if (keys.length) {
        sql +=
          ' ORDER BY ' + keys.map((k) => `"${k.col}" ${k.desc ? 'DESC' : 'ASC'}`).join(', ');
      }
      if (opts.limit !== undefined) sql += ` LIMIT ${Math.max(0, Number(opts.limit) | 0)}`;
      if (opts.offset) sql += ` OFFSET ${Math.max(0, Number(opts.offset) | 0)}`;
      return db.prepare(sql).all(...params).map(coerce);
    },

    count(table, where) {
      const { clause, params } = buildWhere(where);
      const row = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"${clause}`).get(...params);
      return Number(row.c || 0);
    },

    raw(sql, params = []) {
      return db.prepare(sql).all(...params).map(coerce);
    },

    close() {
      try {
        db.close();
      } catch (_) {
        /* ignore */
      }
    }
  };
}

/* ------------------------------------------------------------ json driver */

/**
 * In-memory table engine shared by the JSON and remote-SQL (D1) drivers.
 *
 * The whole database is kept in memory, so reads are synchronous and instant.
 * Every mutation is reported to `onMutate`, which decides how it is persisted
 * (JSON file, or a SQL statement queued for Cloudflare D1).
 */
function createMemoryDriver(options) {
  const state = options.state;
  const onMutate = options.onMutate || (() => {});

  function likeToRegExp(pattern) {
    const esc = String(pattern)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.');
    return new RegExp('^' + esc + '$', 'i');
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
        return v !== null && v !== undefined && v >= cond.value;
      case 'lte':
        return v !== null && v !== undefined && v <= cond.value;
      case 'gt':
        return v !== null && v !== undefined && v > cond.value;
      case 'lt':
        return v !== null && v !== undefined && v < cond.value;
      case 'like':
        return v !== null && v !== undefined && likeToRegExp(cond.value).test(String(v));
      default:
        return false;
    }
  }

  function filterRows(table, where) {
    const rows = state.tables[table] || [];
    const conds = conditions(where);
    if (!conds.length) return rows.slice();
    return rows.filter((r) => conds.every((c) => matches(r, c)));
  }

  return {
    /* ------------------------------------------------------------- reads */

    one(table, where) {
      const rows = filterRows(table, where);
      return rows.length ? Object.assign({}, rows[0]) : undefined;
    },

    all(table, where, opts = {}) {
      let rows = filterRows(table, where);
      const keys = orderKeys(opts.order);
      if (keys.length) {
        rows = rows.slice().sort((a, b) => {
          for (const k of keys) {
            const av = a[k.col];
            const bv = b[k.col];
            if (av === bv) continue;
            const cmp =
              av === null || av === undefined ? -1 : bv === null || bv === undefined ? 1 : av < bv ? -1 : 1;
            return k.desc ? -cmp : cmp;
          }
          return 0;
        });
      }
      if (opts.offset) rows = rows.slice(Number(opts.offset));
      if (opts.limit !== undefined) rows = rows.slice(0, Math.max(0, Number(opts.limit) | 0));
      return rows.map((r) => Object.assign({}, r));
    },

    count(table, where) {
      return filterRows(table, where).length;
    },

    /* ------------------------------------------------------------ writes */

    insert(table, row) {
      const pk = TABLES[table];
      const clone = Object.assign({}, row);
      if (pk === 'id' && clone.id === undefined) {
        state.seq[table] = (state.seq[table] || 0) + 1;
        clone.id = state.seq[table];
      } else if (pk && clone[pk] !== undefined && pk === 'id') {
        state.seq[table] = Math.max(state.seq[table] || 0, Number(clone.id) || 0);
      }
      state.tables[table].push(clone);
      onMutate({ type: 'insert', table, row: clone });
      return clone;
    },

    update(table, where, row) {
      const rows = filterRows(table, where);
      const cols = Object.keys(row || {});
      for (const r of rows) Object.assign(r, row);
      if (rows.length && cols.length) onMutate({ type: 'update', table, patch: row, where, count: rows.length });
      return rows.length;
    },

    remove(table, where) {
      const conds = conditions(where);
      const keep = [];
      let removed = 0;
      for (const r of state.tables[table] || []) {
        if (conds.length && conds.every((c) => matches(r, c))) removed += 1;
        else keep.push(r);
      }
      state.tables[table] = keep;
      if (removed) onMutate({ type: 'remove', table, where, count: removed });
      return removed;
    }
  };
}

function createJsonDriver(file) {
  let state = { tables: {}, seq: {} };
  if (fs.existsSync(file)) {
    try {
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      state = { tables: {}, seq: {} };
    }
  }
  for (const t of Object.keys(TABLES)) {
    if (!state.tables[t]) state.tables[t] = [];
  }

  let saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    }, 15);
  }

  const engine = createMemoryDriver({ state, onMutate: () => save() });

  return Object.assign(
    {
      kind: 'json',

      exec() {},

      raw() {
        return [];
      },

      close() {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(state));
      }
    },
    engine
  );
}

/**
 * Remote SQLite driver (Cloudflare D1).
 *
 * D1 lives behind an HTTPS API — far too slow to call once per query — so the
 * whole database is mirrored in memory (same engine as the JSON driver) and
 * every change is written through to D1 as SQL:
 *
 *   reads   → memory (instant, synchronous, no network at all)
 *   writes  → memory + a queued SQL statement, flushed by the server before
 *             the HTTP response completes, on a timer, and at shutdown
 *
 * The rest of the application is untouched: this driver exposes the same
 * synchronous interface as the SQLite and JSON drivers.
 */
function createMirrorDriver(options) {
  const client = options.client;
  const log = options.log || (() => {});
  const schemaSql = options.schemaSql || '';
  const indexSql = options.indexSql || '';

  const state = { tables: {}, seq: {} };
  for (const t of Object.keys(TABLES)) state.tables[t] = [];

  let queue = [];
  let chain = Promise.resolve();
  let lastError = null;
  let lastFlushAt = 0;
  let flushCount = 0;
  let loaded = false;

  function quote(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
  }

  function enqueue(statement) {
    queue.push(statement);
  }

  /** Turn a mutation of the mirror into the SQL that reproduces it on D1. */
  function record(op) {
    if (op.type === 'insert') {
      const cols = Object.keys(op.row).filter((c) => op.row[c] !== undefined);
      if (!cols.length) return;
      enqueue({
        sql: `INSERT INTO ${quote(op.table)} (${cols.map(quote).join(', ')}) VALUES (${cols
          .map(() => '?')
          .join(', ')})`,
        params: cols.map((c) => op.row[c])
      });
      return;
    }
    if (op.type === 'update') {
      const cols = Object.keys(op.patch || {}).filter((c) => op.patch[c] !== undefined);
      if (!cols.length) return;
      const { clause, params } = sqlWhere(op.where);
      enqueue({
        sql: `UPDATE ${quote(op.table)} SET ${cols.map((c) => `${quote(c)} = ?`).join(', ')}${clause}`,
        params: cols.map((c) => op.patch[c]).concat(params)
      });
      return;
    }
    if (op.type === 'remove') {
      const { clause, params } = sqlWhere(op.where);
      enqueue({ sql: `DELETE FROM ${quote(op.table)}${clause}`, params });
    }
  }

  const engine = createMemoryDriver({ state, onMutate: record });

  /** One flush attempt: send the queue and keep it if D1 cannot be reached. */
  async function flushOnce() {
    if (!queue.length) return 0;
    const statements = queue;
    queue = [];
    try {
      await client.run(statements);
      lastError = null;
      lastFlushAt = Date.now();
      flushCount += 1;
      return statements.length;
    } catch (err) {
      // Put the statements back at the front so nothing is lost and order is
      // preserved; the next flush (next request, timer or shutdown) retries.
      queue = statements.concat(queue);
      lastError = err;
      throw err;
    }
  }

  return Object.assign(
    {
      kind: 'd1',

      /** Load the whole database from D1 and make sure the schema exists. */
      async load() {
        if (schemaSql) await client.execScript(schemaSql);
        if (indexSql) await client.execScript(indexSql);

        const tables = Object.keys(TABLES);
        const results = await client.run(
          tables.map((table) => ({ sql: `SELECT * FROM ${quote(table)}`, params: [] }))
        );
        tables.forEach((table, i) => {
          const rows = (results[i] && results[i].results) || [];
          state.tables[table] = rows;
          let max = 0;
          for (const row of rows) {
            const id = Number(row.id);
            if (Number.isFinite(id) && id > max) max = id;
          }
          state.seq[table] = max;
        });
        loaded = true;
        lastFlushAt = Date.now();
        return { tables: tables.length, rows: tables.reduce((n, t) => n + state.tables[t].length, 0) };
      },

      /** DDL is applied by load(); nothing else in the app issues raw DDL. */
      exec() {},

      raw() {
        return [];
      },

      /**
       * Persist everything queued so far. Awaited by the server before each
       * response is finished, so a member sees their data saved before the
       * page comes back.
       */
      flush() {
        const run = chain.then(() => flushOnce());
        chain = run.then(
          () => {},
          () => {}
        );
        return run;
      },

      async close() {
        // Best effort: keep trying briefly so a restart does not lose writes.
        for (let attempt = 0; attempt < 3 && queue.length; attempt += 1) {
          try {
            await flushOnce();
          } catch (err) {
            log(`[db] flush on shutdown failed: ${err.message}`);
          }
        }
        if (queue.length) log(`[db] ${queue.length} change(s) could not be saved to D1`);
      },

      stats() {
        return {
          kind: 'd1',
          loaded,
          pending: queue.length,
          flushes: flushCount,
          lastFlushAt,
          lastError: lastError ? lastError.message : null,
          rows: Object.keys(TABLES).reduce((n, t) => n + (state.tables[t] || []).length, 0)
        };
      }
    },
    engine
  );
}


/* -------------------------------------------------------------- bootstrap */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  reset_token TEXT,
  reset_expires INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 1,
  photo TEXT,
  last_login INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY,
  headline TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  age INTEGER,
  gender TEXT DEFAULT '',
  height_cm INTEGER,
  marital_status TEXT DEFAULT '',
  religion TEXT DEFAULT '',
  community TEXT DEFAULT '',
  sub_community TEXT DEFAULT '',
  mother_tongue TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  country TEXT DEFAULT '',
  education TEXT DEFAULT '',
  education_detail TEXT DEFAULT '',
  occupation TEXT DEFAULT '',
  company TEXT DEFAULT '',
  annual_income TEXT DEFAULT '',
  diet TEXT DEFAULT '',
  smoking TEXT DEFAULT '',
  drinking TEXT DEFAULT '',
  about_me TEXT DEFAULT '',
  family_type TEXT DEFAULT '',
  family_status TEXT DEFAULT '',
  father_occupation TEXT DEFAULT '',
  mother_occupation TEXT DEFAULT '',
  siblings TEXT DEFAULT '',
  gotra TEXT DEFAULT '',
  manglik TEXT DEFAULT '',
  pref_age_min INTEGER,
  pref_age_max INTEGER,
  pref_gender TEXT DEFAULT '',
  pref_location TEXT DEFAULT '',
  pref_education TEXT DEFAULT '',
  pref_occupation TEXT DEFAULT '',
  pref_marital_status TEXT DEFAULT '',
  pref_religion TEXT DEFAULT '',
  pref_community TEXT DEFAULT '',
  pref_message TEXT DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'members',
  hide_photo INTEGER NOT NULL DEFAULT 0,
  hide_contact INTEGER NOT NULL DEFAULT 0,
  searchable INTEGER NOT NULL DEFAULT 1,
  profile_complete INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS interests (
  id INTEGER PRIMARY KEY,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  message TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  responded_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shortlist (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  target_user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  link TEXT DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  reporter_id INTEGER NOT NULL,
  target_user_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  details TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  couple TEXT NOT NULL DEFAULT '',
  location TEXT DEFAULT '',
  body TEXT DEFAULT '',
  photo TEXT DEFAULT '',
  approved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  handled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER NOT NULL DEFAULT 0,
  actor_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL DEFAULT '',
  target_id INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Anonymous daily visitor analytics (Aman — daily site & member report).
-- Sirf aggregate counters; koi personal data / raw IP nahi rakha jaata.
CREATE TABLE IF NOT EXISTS site_stats (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL UNIQUE,
  visits INTEGER NOT NULL DEFAULT 0,
  visitors INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS site_visitors (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  hid TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (day, hid)
);
`;

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_interests_to ON interests(to_user_id)',
  'CREATE INDEX IF NOT EXISTS idx_interests_from ON interests(from_user_id)',
  'CREATE INDEX IF NOT EXISTS idx_msg_receiver ON messages(receiver_id)',
  'CREATE INDEX IF NOT EXISTS idx_msg_sender ON messages(sender_id)',
  'CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read)',
  'CREATE INDEX IF NOT EXISTS idx_shortlist_user ON shortlist(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_user_id)',
  'CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles(gender)'
];

const ASYNC_METHODS = ['insert', 'update', 'remove', 'one', 'all', 'count', 'exec', 'raw', 'close', 'flush', 'load'];

/** Wrap sync driver methods so callers can always `await db.one(...)`. */
function asAsyncDriver(driver) {
  const out = Object.assign({}, driver);
  for (const name of ASYNC_METHODS) {
    const fn = driver[name];
    if (typeof fn !== 'function') continue;
    out[name] = async function wrapped(...args) {
      return await fn.apply(driver, args);
    };
  }
  return out;
}

/**
 * Hosts whose local disk is ephemeral must not silently fall back to sqlite.
 * Local `node server.js` without SITE_URL still uses sqlite for development.
 */
function mustUseRemote(env = process.env) {
  if (String(env.PJS_ALLOW_LOCAL || '') === '1') return false;
  if (String(env.PJS_REQUIRE_REMOTE || '') === '1') return true;
  const site = String(env.SITE_URL || '');
  if (/onrender\.com/i.test(site)) return true;
  if (env.RENDER === 'true' || env.RENDER_SERVICE_ID) return true;
  return false;
}

/**
 * Open the database.
 *
 *   PJS_STORAGE=auto (default) → Supabase when SUPABASE_URL+KEY are set,
 *                                else D1 when CF_* is set, else SQLite,
 *                                else the JSON store
 *   PJS_STORAGE=supabase|d1|sqlite|json  → force that driver
 *
 * Remote drivers return a `ready` promise: the server must await it before it
 * serves traffic.
 */
function open(dataDir, options = {}) {
  const log = options.log || (() => {});
  fs.mkdirSync(dataDir, { recursive: true });
  const sqliteFile = path.join(dataDir, 'panika-jeevan-sathi.db');
  const jsonFile = path.join(dataDir, 'panika-jeevan-sathi.json');
  const mode = String(process.env.PJS_STORAGE || 'auto').trim().toLowerCase();
  const sbConfig = mode === 'supabase' || mode === 'auto' ? supabaseLib.configFromEnv() : null;
  const d1Config = mode === 'd1' || mode === 'auto' ? d1Lib.configFromEnv() : null;

  if (mode === 'supabase' || (mode === 'auto' && sbConfig)) {
    if (!sbConfig) {
      throw new Error(
        'PJS_STORAGE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      );
    }
    const client = supabaseLib.createClient(sbConfig, { log });
    const driver = asAsyncDriver(supabaseLib.createDriver(client, { log }));
    return {
      driver,
      driverError: null,
      ready: () => driver.load(),
      sqliteFile: null,
      jsonFile: null,
      remote: { kind: 'supabase', url: sbConfig.url, bucket: sbConfig.bucket }
    };
  }

  if (mode === 'd1' || (mode === 'auto' && d1Config)) {
    if (!d1Config) {
      throw new Error(
        'PJS_STORAGE=d1 needs CF_ACCOUNT_ID, CF_D1_DATABASE_ID and CF_D1_API_TOKEN.'
      );
    }
    const client = d1Lib.createClient(d1Config, { log });
    const driver = asAsyncDriver(
      createMirrorDriver({
        client,
        schemaSql: SCHEMA,
        indexSql: INDEXES.join(';\n'),
        log
      })
    );
    return {
      driver,
      driverError: null,
      ready: () => driver.load(),
      sqliteFile: null,
      jsonFile: null,
      remote: { database: d1Config.databaseId, account: d1Config.accountId }
    };
  }

  if (mustUseRemote()) {
    throw new Error(
      'This host has an ephemeral disk. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see supabase/schema.sql). Starting with local sqlite would delete every member on the next sleep/redeploy.'
    );
  }

  let driver = null;
  let driverError = null;

  if (mode === 'json') {
    driverError = new Error('PJS_STORAGE=json requested');
  } else {
    try {
      driver = createSqliteDriver(sqliteFile);
    } catch (err) {
      driverError = err;
    }
  }

  if (!driver) {
    driver = createJsonDriver(jsonFile);
  }

  if (driver.kind === 'sqlite') {
    driver.exec(SCHEMA);
    for (const sql of INDEXES) driver.exec(sql);
  }

  return {
    driver: asAsyncDriver(driver),
    driverError,
    ready: null,
    sqliteFile,
    jsonFile,
    remote: null
  };
}

module.exports = {
  open,
  TABLES,
  SCHEMA,
  INDEXES,
  createMirrorDriver,
  createMemoryDriver,
  sqlWhere,
  asAsyncDriver,
  mustUseRemote
};
