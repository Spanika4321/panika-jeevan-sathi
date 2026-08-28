'use strict';
/**
 * PANIKA JEEVAN SATHI - storage layer
 *
 * Primary driver : node:sqlite (built into Node.js >= 22.5, zero dependencies)
 * Fallback driver: JSON file store (used automatically when node:sqlite is
 *                  unavailable so the site still runs on older Node runtimes)
 *
 * Both drivers expose the exact same tiny table API, the rest of the app never
 * talks to SQL directly.
 */

const fs = require('node:fs');
const path = require('node:path');

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
  settings: 'key'
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

/* ------------------------------------------------------------- sql driver */

function createSqliteDriver(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  function buildWhere(where) {
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
    kind: 'json',

    exec() {},

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
      save();
      return clone;
    },

    update(table, where, row) {
      const rows = filterRows(table, where);
      for (const r of rows) Object.assign(r, row);
      save();
      return rows.length;
    },

    remove(table, where) {
      const conds = conditions(where);
      const keep = [];
      let removed = 0;
      for (const r of state.tables[table] || []) {
        if (conds.length && conds.every((c) => matches(r, c))) removed++;
        else keep.push(r);
      }
      state.tables[table] = keep;
      save();
      return removed;
    },

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
            const cmp = av === null || av === undefined ? -1 : bv === null || bv === undefined ? 1 : av < bv ? -1 : 1;
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
  };
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

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const sqliteFile = path.join(dataDir, 'panika-jeevan-sathi.db');
  const jsonFile = path.join(dataDir, 'panika-jeevan-sathi.json');
  let driver = null;
  let driverError = null;

  if (process.env.PJS_STORAGE === 'json') {
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

  return { driver, driverError, sqliteFile, jsonFile };
}

module.exports = { open, TABLES, SCHEMA, INDEXES };
