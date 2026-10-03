'use strict';
/**
 * TEERNOVA — storage layer (refactored from PANIKA JEEVAN SATHI)
 *
 * Primary driver: node:sqlite (built into Node.js >= 22.5, zero dependencies)
 * Fallback driver: JSON file store
 *
 * Database tables:
 *   - users             — auth (Kept from original)
 *   - settings          — admin config (Kept from original)
 *   - audit_logs        — audit trail (Kept from original)
 *   - notifications     — notifications (Kept from original)
 *   - sessions          — NEW: session info (morning/day/evening/night)
 *   - session_schedules — NEW: session timings & schedule
 *   - official_results  — NEW: FR/SR results with house/ending
 *   - result_sources    — NEW: result source configuration
 *   - result_verifications — NEW: verification workflow
 *   - result_corrections   — NEW: correction history
 *   - announcements     — NEW: admin announcements
 *   - demo_sessions     — NEW: demo play sessions
 *   - demo_entries      — NEW: demo user entries
 *   - demo_results      — NEW: demo results
 */

const TABLES = {
  users: 'id',
  settings: 'key',
  audit_logs: 'id',
  notifications: 'id',
  sessions: 'id',
  session_schedules: 'id',
  official_results: 'id',
  result_sources: 'id',
  result_verifications: 'id',
  result_corrections: 'id',
  announcements: 'id',
  demo_sessions: 'id',
  demo_entries: 'id',
  demo_results: 'id',
  payment_intents: 'id',
  payments: 'id',
  subscriptions: 'id',
  user_credits: 'user_id'
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function conditions(where) {
  const out = [];
  if (!where) return out;
  for (const [col, raw] of Object.entries(where)) {
    if (raw === undefined) continue;
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
        if (!vals.length) sql.push('1 = 0');
        else {
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

function createSqliteDriver(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  function coerce(row) {
    if (!row) return row;
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = v;
    return out;
  }

  return {
    kind: 'sqlite',
    exec(sql) { db.exec(sql); },
    insert(table, row) {
      const cols = Object.keys(row).filter((c) => row[c] !== undefined);
      const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      // Convert booleans to integers — node:sqlite cannot bind boolean JS values
      const allParams = cols.map((c) => {
        const v = row[c];
        return v === true ? 1 : v === false ? 0 : v;
      });
      const stmt = db.prepare(sql);
      const res = stmt.run(...allParams);
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
      const { clause, params } = sqlWhere(where);
      const sql = `UPDATE "${table}" SET ${cols.map((c) => `"${c}" = ?`).join(',')}${clause}`;
      // Convert booleans to integers — node:sqlite cannot bind boolean JS values
      const setParams = cols.map((c) => {
        const v = row[c];
        return v === true ? 1 : v === false ? 0 : v;
      });
      const allParams = [...setParams, ...params.map(v => v === true ? 1 : v === false ? 0 : v)];
      const stmt = db.prepare(sql);
      const res = stmt.run(...allParams);
      return Number(res.changes || 0);
    },
    remove(table, where) {
      const { clause, params } = sqlWhere(where);
      const res = db.prepare(`DELETE FROM "${table}"${clause}`).run(...params);
      return Number(res.changes || 0);
    },
    one(table, where) {
      const { clause, params } = sqlWhere(where);
      const row = db.prepare(`SELECT * FROM "${table}"${clause} LIMIT 1`).get(...params);
      return coerce(row);
    },
    all(table, where, opts = {}) {
      const { clause, params } = sqlWhere(where);
      let sql = `SELECT * FROM "${table}"${clause}`;
      const keys = orderKeys(opts.order);
      if (keys.length) {
        sql += ' ORDER BY ' + keys.map((k) => `"${k.col}" ${k.desc ? 'DESC' : 'ASC'}`).join(', ');
      }
      if (opts.limit !== undefined) sql += ` LIMIT ${Math.max(0, Number(opts.limit) | 0)}`;
      if (opts.offset) sql += ` OFFSET ${Math.max(0, Number(opts.offset) | 0)}`;
      return db.prepare(sql).all(...params).map(coerce);
    },
    count(table, where) {
      const { clause, params } = sqlWhere(where);
      const row = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"${clause}`).get(...params);
      return Number(row.c || 0);
    },
    raw(sql, params = []) { return db.prepare(sql).all(...params).map(coerce); },
    close() { try { db.close(); } catch (_) {} }
  };
}

function createJsonDriver(file) {
  let state = { tables: {}, seq: {} };
  if (require('node:fs').existsSync(file)) {
    try {
      state = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
    } catch (_) { state = { tables: {}, seq: {} }; }
  }
  for (const t of Object.keys(TABLES)) {
    if (!state.tables[t]) state.tables[t] = [];
  }

  let saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const fs = require('node:fs');
      const path = require('node:path');
      fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    }, 15);
  }

  function likeToRegExp(pattern) {
    const esc = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp('^' + esc + '$', 'i');
  }

  function matches(row, cond) {
    const v = row[cond.col];
    switch (cond.op) {
      case 'eq': return v == cond.value;
      case 'ne': return !(v == cond.value);
      case 'is_null': return v === null || v === undefined;
      case 'in': return cond.value.some((x) => x == v);
      case 'gte': return v !== null && v !== undefined && v >= cond.value;
      case 'lte': return v !== null && v !== undefined && v <= cond.value;
      case 'gt': return v !== null && v !== undefined && v > cond.value;
      case 'lt': return v !== null && v !== undefined && v < cond.value;
      case 'like': return v !== null && v !== undefined && likeToRegExp(cond.value).test(String(v));
      default: return false;
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
    raw() { return []; },
    close() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      const fs = require('node:fs');
      const path = require('node:path');
      fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state));
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
            const av = a[k.col], bv = b[k.col];
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
    count(table, where) { return filterRows(table, where).length; },
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
      const cols = Object.keys(row || {});
      for (const r of rows) Object.assign(r, row);
      if (rows.length && cols.length) save();
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
      if (removed) save();
      return removed;
    }
  };
}

/**
 * TEERNOVA SCHEMA
 *
 * Adds TEERNOVA tables to existing schema - preserves all existing data.
 * Preserves existing tables - old matrimonial data remains.
 * Adds new TEERNOVA tables.
 */
const SCHEMA = `
-- Keep existing tables (with modifications for TEERNOVA)
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


-- TEERNOVA NEW TABLES

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'day', -- morning, day, evening, night
  state TEXT NOT NULL DEFAULT 'assam',
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_schedules (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  fr_time TEXT NOT NULL,
  sr_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS official_results (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL,
  schedule_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  round TEXT NOT NULL, -- 'FR' or 'SR'
  result INTEGER NOT NULL,
  house INTEGER,
  ending INTEGER,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'fetched', -- fetched, pending_verification, verified, published
  verified_by INTEGER,
  verified_at INTEGER,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (schedule_id) REFERENCES session_schedules(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(session_id, schedule_id, round)
);

CREATE TABLE IF NOT EXISTS result_sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  source_url TEXT,
  parser_type TEXT NOT NULL DEFAULT 'manual',
  is_active INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  last_checked INTEGER,
  last_successful_fetch INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS result_verifications (
  id INTEGER PRIMARY KEY,
  result_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  verified_by INTEGER,
  verified_at INTEGER,
  reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (result_id) REFERENCES official_results(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS result_corrections (
  id INTEGER PRIMARY KEY,
  result_id INTEGER NOT NULL,
  old_result INTEGER NOT NULL,
  new_result INTEGER NOT NULL,
  old_house INTEGER,
  new_house INTEGER,
  old_ending INTEGER,
  new_ending INTEGER,
  reason TEXT,
  corrected_by INTEGER,
  corrected_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (result_id) REFERENCES official_results(id) ON DELETE CASCADE,
  FOREIGN KEY (corrected_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Demo play tables (virtual credits only, no real money)
CREATE TABLE IF NOT EXISTS demo_sessions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  credit_amount INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  demo_session_id INTEGER NOT NULL,
  selected_number INTEGER NOT NULL,
  credit_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, won, lost
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (demo_session_id) REFERENCES demo_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS demo_results (
  id INTEGER PRIMARY KEY,
  demo_session_id INTEGER NOT NULL,
  winning_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (demo_session_id) REFERENCES demo_sessions(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_category ON sessions(category);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_session_schedules_date ON session_schedules(date);
CREATE INDEX IF NOT EXISTS idx_session_schedules_session ON session_schedules(session_id);
CREATE INDEX IF NOT EXISTS idx_official_results_date ON official_results(date);
CREATE INDEX IF NOT EXISTS idx_official_results_session ON official_results(session_id);
CREATE INDEX IF NOT EXISTS idx_official_results_round ON official_results(round);
CREATE INDEX IF NOT EXISTS idx_official_results_status ON official_results(status);
CREATE INDEX IF NOT EXISTS idx_result_sources_active ON result_sources(is_active);
CREATE INDEX IF NOT EXISTS idx_result_verifications_result ON result_verifications(result_id);
CREATE INDEX IF NOT EXISTS idx_result_corrections_result ON result_corrections(result_id);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_active ON demo_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_demo_entries_user ON demo_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_demo_entries_session ON demo_entries(demo_session_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- TEERNOVA Pay tables (custom payment gateway)
CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  plan_id TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'pending',
  demo_credits INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 0,
  upi_intent_url TEXT,
  payment_instructions TEXT,
  qrcode_data TEXT,
  transaction_id TEXT,
  completed_at INTEGER,
  expires_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  plan_id TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'pending',
  transaction_id TEXT,
  upi_transaction_id TEXT,
  payment_method TEXT NOT NULL DEFAULT 'upi',
  demo_credits INTEGER NOT NULL DEFAULT 0,
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  notes TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_credits (
  user_id INTEGER PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Payment indexes
CREATE INDEX IF NOT EXISTS idx_payment_intents_user ON payment_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_plan ON payments(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan_id);
`;

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_sessions_category ON sessions(category)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_session_schedules_date ON session_schedules(date)',
  'CREATE INDEX IF NOT EXISTS idx_session_schedules_session ON session_schedules(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_official_results_date ON official_results(date)',
  'CREATE INDEX IF NOT EXISTS idx_official_results_session ON official_results(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_official_results_round ON official_results(round)',
  'CREATE INDEX IF NOT EXISTS idx_official_results_status ON official_results(status)',
  'CREATE INDEX IF NOT EXISTS idx_result_sources_active ON result_sources(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_result_verifications_result ON result_verifications(result_id)',
  'CREATE INDEX IF NOT EXISTS idx_result_corrections_result ON result_corrections(result_id)',
  'CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_demo_sessions_active ON demo_sessions(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_demo_entries_user ON demo_entries(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_demo_entries_session ON demo_entries(demo_session_id)',
  'CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read)',
  'CREATE INDEX IF NOT EXISTS idx_payment_intents_user ON payment_intents(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status)',
  'CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)',
  'CREATE INDEX IF NOT EXISTS idx_payments_plan ON payments(plan_id)',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan_id)'
];

function open(dataDir, options = {}) {
  const log = options.log || (() => {});
  const fs = require('node:fs');
  const path = require('node:path');
  fs.mkdirSync(dataDir, { recursive: true });
  const sqliteFile = path.join(dataDir, 'teer-nova.db');
  const jsonFile = path.join(dataDir, 'teer-nova.json');
  const mode = String(process.env.PJS_STORAGE || 'auto').trim().toLowerCase();

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

    // Migration: add missing columns to existing tables
    const migrations = [
      'ALTER TABLE payment_intents ADD COLUMN metadata TEXT',
      'ALTER TABLE payment_intents ADD COLUMN notes TEXT',
      'ALTER TABLE payment_intents ADD COLUMN payment_instructions TEXT',
      'ALTER TABLE payment_intents ADD COLUMN qrcode_data TEXT',
      'ALTER TABLE payments ADD COLUMN metadata TEXT',
      'ALTER TABLE payments ADD COLUMN notes TEXT',
      'ALTER TABLE user_credits ADD COLUMN created_at INTEGER',
      'ALTER TABLE user_credits ADD COLUMN updated_at INTEGER',
    ];
    for (const sql of migrations) {
      try { driver.exec(sql); } catch (_) { /* column already exists or table missing */ }
    }
  }

  return { driver, driverError, ready: null, sqliteFile, jsonFile, remote: null };
}

module.exports = { open, TABLES, SCHEMA, INDEXES, createSqliteDriver, createJsonDriver };
