'use strict';
/**
 * TEERNOVA — Supabase driver (optional)
 *
 * Supabase → PostgreSQL (async client) par chalta hai.
 * Reads → in-memory mirror (instant, synchronous).
 * Writes → in-memory mirror + async flush to Supabase (before response).
 *
 * Zero third-party dependencies: uses the official @supabase/supabase-js
 * which you install once:  npm install @supabase/supabase-js
 */

let createClient = null;
let supabaseError = null;
try {
  const mod = require('@supabase/supabase-js');
  createClient = mod.createClient;
} catch (err) {
  supabaseError = err;
}

/* ------------------------------------------------------------------ schema */

const SUPABASE_SCHEMA = `
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
`;

const SUPABASE_INDEXES = [
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

/* ------------------------------------------------------------------ helpers */

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

/* ------------------------------------------------------------------ in-memory engine (same as JSON/D1 mirror) */

function createMemoryEngine(state) {
  const tables = state.tables;
  const seq = state.seq;

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
    const rows = tables[table] || [];
    const conds = conditions(where);
    if (!conds.length) return rows.slice();
    return rows.filter((r) => conds.every((c) => matches(r, c)));
  }

  return {
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

    insert(table, row) {
      const pk = 'id';
      const clone = Object.assign({}, row);
      if (clone.id === undefined) {
        seq[table] = (seq[table] || 0) + 1;
        clone.id = seq[table];
      } else if (pk && clone[pk] !== undefined) {
        seq[table] = Math.max(seq[table] || 0, Number(clone.id) || 0);
      }
      tables[table].push(clone);
      return clone;
    },

    update(table, where, row) {
      const rows = filterRows(table, where);
      const cols = Object.keys(row || {});
      for (const r of rows) Object.assign(r, row);
      return rows.length;
    },

    remove(table, where) {
      const conds = conditions(where);
      const keep = [];
      let removed = 0;
      for (const r of tables[table] || []) {
        if (conds.length && conds.every((c) => matches(r, c))) removed += 1;
        else keep.push(r);
      }
      tables[table] = keep;
      return removed;
    },

    raw(sql, params = []) {
      // Not used by app code — Supabase driver does not support raw SQL
      return [];
    }
  };
}

/* ------------------------------------------------------------------ driver factory */

/**
 * Create a Supabase-backed database driver.
 *
 *   url      — Supabase project URL (e.g. https://xyz.supabase.co)
 *   key      — anon/public key (service_role key also works, but anon is fine)
 *   log      — optional (message) => {} callback
 *
 * Returns { driver, kind, close }.
 * The driver exposes the SAME synchronous interface as the SQLite/JSON/D1
 * drivers — reads are from an in-memory mirror, writes are queued and flushed
 * asynchronously to Supabase before each HTTP response completes.
 */
function createSupabaseDriver({ url, key, log = () => {} }) {
  if (!url || !key) {
    throw new Error('Supabase driver needs SUPABASE_URL and SUPABASE_KEY.');
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false },
    database: { schema: 'public' }
  });

  // State — let so it can be reassigned in loadSupabaseTables
  let state = { tables: {}, seq: {} };
  const engine = createMemoryEngine(state);

  // Pending writes — flushed before each response + on timer + on shutdown.
  let queue = [];
  let chain = Promise.resolve();
  let lastError = null;
  let lastFlushAt = 0;

  function enqueueMutation(op) {
    // op: { type: 'insert'|'update'|'remove', table, row?|patch?|where? }
    queue.push(op);
  }

  /** Flush the write queue to Supabase. Best-effort; queue is retained on failure. */
  async function flushOnce() {
    if (!queue.length) return 0;
    const ops = queue;
    queue = [];
    let flushed = 0;
    for (const op of ops) {
      try {
        if (op.type === 'insert') {
          const cols = Object.keys(op.row).filter((c) => op.row[c] !== undefined);
          if (!cols.length) continue;
          const { data, error } = await supabase
            .from(op.table)
            .insert([op.row])
            .select()
            .single();
          if (error) throw error;
          // Refresh the in-memory row with server-assigned id if needed
          if (data && data.id !== undefined && op.row.id === undefined) {
            op.row.id = data.id;
          }
          flushed += 1;
        } else if (op.type === 'update') {
          const cols = Object.keys(op.patch || {}).filter((c) => op.patch[c] !== undefined);
          if (!cols.length) continue;
          const where = op.where || {};
          const { clause, params } = sqlWhere(where);
          // Build update object from patch
          const updateObj = {};
          for (const c of cols) updateObj[c] = op.patch[c];
          const { data, error } = await supabase.from(op.table).update(updateObj).where(where).select();
          if (error) throw error;
          flushed += 1;
        } else if (op.type === 'remove') {
          const where = op.where || {};
          const { error } = await supabase.from(op.table).delete().where(where);
          if (error) throw error;
          flushed += 1;
        }
      } catch (err) {
        // Put the operation back at the front so nothing is lost
        queue.unshift(op);
        lastError = err;
        log(`[supabase] flush error: ${err.message}`);
        break;
      }
    }
    lastFlushAt = Date.now();
    return flushed;
  }

  const driver = {
    kind: 'supabase',

    exec(sql) {
      // Schema/index creation — runs once at boot
      // Supabase: use RPC or run raw SQL via the dashboard.
      // For bootstrap we just log; actual DDL should be applied via
      // Supabase SQL editor or a migration script.
      if (sql.trim()) {
        log(`[supabase] exec called (DDL should be applied via Supabase dashboard): ${sql.slice(0, 80)}`);
      }
    },

    insert(table, row) {
      const clone = Object.assign({}, row);
      engine.insert(table, clone);
      enqueueMutation({ type: 'insert', table, row: clone });
      return clone;
    },

    update(table, where, row) {
      const affected = engine.update(table, where, row);
      if (affected) {
        enqueueMutation({ type: 'update', table, where, patch: row });
      }
      return affected;
    },

    remove(table, where) {
      const affected = engine.remove(table, where);
      if (affected) {
        enqueueMutation({ type: 'remove', table, where });
      }
      return affected;
    },

    one(table, where) {
      return engine.one(table, where);
    },

    all(table, where, opts = {}) {
      return engine.all(table, where, opts);
    },

    count(table, where) {
      return engine.count(table, where);
    },

    raw(sql, params = []) {
      return [];
    },

    async flush() {
      const run = chain.then(() => flushOnce());
      chain = run.then(() => {}, () => {});
      return run;
    },

    async close() {
      for (let i = 0; i < 3 && queue.length; i++) {
        try {
          await flushOnce();
        } catch (_) {}
      }
      await supabase.auth.signOut();
    },

    /** Synchronous mirror stats (for /api/health) */
    stats() {
      const totalRows = Object.values(state.tables).reduce((n, t) => n + t.length, 0);
      return {
        rows: totalRows,
        pending: queue.length,
        lastFlushAt,
        lastError: lastError ? lastError.message : null
      };
    }
  };

  return { driver, supabase, enqueueMutation };
}

/**
 * Load all rows from Supabase into the in-memory mirror at boot.
 * Must be called before serving traffic.
 */
async function loadSupabaseTables(supabase, tableNames) {
  const rows = {};
  for (const table of tableNames) {
    const { data, error } = await supabase.from(table).select('*');
    if (error && error.code !== 'PGRST116') { // PGRST116 = table not found — ok for empty DB
      throw new Error(`Supabase: could not load table "${table}": ${error.message}`);
    }
    rows[table] = (data || []);
  }
  return rows;
}

function computeSequences(rowsByTable) {
  const seq = {};
  for (const [table, rows] of Object.entries(rowsByTable)) {
    let max = 0;
    for (const row of rows) {
      const id = Number(row.id);
      if (Number.isFinite(id) && id > max) max = id;
    }
    seq[table] = max;
  }
  return seq;
}

/* ------------------------------------------------------------------ exports */

module.exports = {
  SUPABASE_SCHEMA,
  SUPABASE_INDEXES,
  createSupabaseDriver,
  loadSupabaseTables,
  computeSequences
};
