'use strict';
/**
 * SEVA MARKET INDIA — Appwrite remote mirror (write-through change log).
 *
 * How data survives an ephemeral-host wipe:
 *
 *   1. Every mutation lands in SQLite AND is recorded in `_sync_log` inside
 *      the same transaction (see migrations/0002_remote_sync.sql).
 *   2. On the next flush (after each HTTP response, on a timer, at
 *      shutdown) the pending log rows are pushed to Appwrite Cloud:
 *        upsert  → read the current SQLite row, store it as one document
 *        delete  → remove the document
 *   3. At boot, when SQLite is missing/empty but Appwrite holds documents,
 *      `restoreFromRemote()` rebuilds the local database from the remote
 *      mirror before the app opens it. The site then serves the same data
 *      it had before the disk was erased.
 *
 * SQLite remains the query engine — models are untouched, ordering, LIKE,
 * joins and pagination behave exactly as before. `_sync_log` rows are
 * marked synced only after Appwrite acknowledges the write, and a failed
 * flush is retried on the next flush (nothing is dropped, nothing is
 * double-applied: upserts are idempotent, deletes ignore 404).
 */

const { configFromEnv, createClient } = require('./appwrite');

const TABLES = {
  users: { columns: ['id', 'email', 'phone', 'full_name', 'password_hash', 'role', 'status', 'email_verified_at', 'created_at', 'updated_at'], idColumn: 'id' },
  locations: { columns: ['id', 'kind', 'parent_id', 'name', 'slug', 'code', 'pin_code', 'latitude', 'longitude', 'search_text', 'is_active', 'created_at'], idColumn: 'id' },
  categories: { columns: ['id', 'parent_id', 'name', 'slug', 'description', 'icon', 'sort_order', 'is_active', 'created_at'], idColumn: 'id' },
  providers: { columns: ['id', 'user_id', 'business_name', 'slug', 'contact_name', 'phone', 'alt_phone', 'email', 'category_id', 'location_id', 'pin_code', 'address_line', 'about', 'experience_years', 'is_verified', 'status', 'rating_avg', 'rating_count', 'created_at', 'updated_at'], idColumn: 'id' },
  services: { columns: ['id', 'provider_id', 'category_id', 'location_id', 'title', 'slug', 'description', 'pin_code', 'price_min', 'price_max', 'price_unit', 'status', 'created_at', 'updated_at'], idColumn: 'id' },
  service_areas: { columns: ['provider_id', 'pin_code', 'location_id'], idColumn: 'provider_id', compositeId: true },
  leads: { columns: ['id', 'service_id', 'provider_id', 'name', 'phone', 'email', 'pin_code', 'message', 'status', 'ip_hash', 'created_at'], idColumn: 'id' },
  audit_logs: { columns: ['id', 'actor', 'action', 'entity', 'entity_id', 'detail', 'created_at'], idColumn: 'id' },
};

const ALL_TABLES = Object.keys(TABLES);

/** Reads the CURRENT row (for an upsert log entry) or null when gone. */
function selectRowFor(db, table, pk) {
  const def = TABLES[table];
  if (!def) return null;
  const cols = def.columns.map((c) => `"${c}"`).join(', ');
  const [first, second] = parsePk(table, pk);
  if (def.compositeId) {
    return db.get(
      `SELECT ${cols} FROM "${table}" WHERE "${def.idColumn}" = ? AND pin_code = ?`,
      [first, second],
    ) ?? null;
  }
  return db.get(`SELECT ${cols} FROM "${table}" WHERE "${def.idColumn}" = ?`, [first]) ?? null;
}

/**
 * `service_areas` composite key is "<provider_id>-<pin_code>".
 * Numeric tables: [Number(pk)]. Falls back to the raw string when the pk is
 * not purely numeric (never numeric for the mirrored tables).
 */
function parsePk(table, pk) {
  const text = String(pk);
  if (TABLES[table] && TABLES[table].compositeId) {
    const at = text.indexOf('-');
    return [Number(text.slice(0, at)), text.slice(at + 1)];
  }
  const numeric = /^-?\d+$/.test(text) ? Number(text) : text;
  return [numeric];
}

/** SQLite row → Appwrite document data (all JSON strings; null preserved). */
function rowToDoc(table, row) {
  const doc = {};
  for (const col of TABLES[table].columns) {
    if (col === 'id') continue;
    doc[col] = row[col] === null || row[col] === undefined ? null : JSON.stringify(row[col]);
  }
  return doc;
}

/** Appwrite document → SQLite row (JSON strings decoded; id restored). */
function docToRow(table, doc) {
  const def = TABLES[table];
  const row = {};
  for (const [key, value] of Object.entries(doc || {})) {
    if (key.startsWith('$') || key === 'permissions') continue;
    if (typeof value !== 'string') continue;
    try {
      row[key] = value === 'null' ? null : JSON.parse(value);
    } catch (_) {
      /* a plain string that was never JSON — store as-is */
      row[key] = value;
    }
  }
  if (def.idColumn === 'id') {
    if (typeof doc.$id === 'string' && /^\d+$/.test(doc.$id)) row.id = Number(doc.$id);
    else if (def.columns.includes('id') && row.id === undefined) row.id = null;
  }
  return row;
}

/** Appwrite document id for a row of a table. */
function rowDocId(table, row) {
  const def = TABLES[table];
  if (def.compositeId) return `${row[def.idColumn]}-${row.pin_code}`;
  return String(row[def.idColumn]);
}

function quoteId(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
}

/**
 * Push every unsynced `_sync_log` row to Appwrite; mark synced on success.
 * A failed batch stays pending and is retried next time.
 * @returns {number} rows pushed
 */
async function flushPending(db, client, { log = () => {}, chunk = 50 } = {}) {
  const pending = db.all(
    'SELECT id, tbl, op, pk FROM _sync_log WHERE synced_at IS NULL ORDER BY id LIMIT ?',
    [chunk],
  );
  if (!pending.length) return 0;

  let pushed = 0;
  for (const entry of pending) {
    try {
      const def = TABLES[entry.tbl];
      if (!def) {
        db.run(`UPDATE _sync_log SET synced_at = ${nowSql()} WHERE id = ?`, [entry.id]);
        continue;
      }
      if (entry.op === 'delete') {
        await client.deleteDoc(entry.tbl, entry.pk);
      } else {
        const row = selectRowFor(db, entry.tbl, entry.pk);
        if (row) {
          // create → on 409 (a previous log entry already mirrored this
          // document) fall back to update, so duplicate log entries never
          // deadlock the queue.
          try {
            await client.createDoc(entry.tbl, rowDocId(entry.tbl, row), rowToDoc(entry.tbl, row));
          } catch (err) {
            if (err.status === 409) {
              await client.updateDoc(entry.tbl, rowDocId(entry.tbl, row), rowToDoc(entry.tbl, row));
            } else {
              throw err;
            }
          }
        } else {
          // Row no longer exists (created and deleted before flush): nothing
          // to mirror; also make sure no stale document survives.
          await client.deleteDoc(entry.tbl, entry.pk);
        }
      }
      db.run(`UPDATE _sync_log SET synced_at = ${nowSql()} WHERE id = ?`, [entry.id]);
      pushed += 1;
    } catch (err) {
      // Stop at the first failure: remaining rows stay pending and the
      // whole batch will be retried on the next flush (order preserved).
      log(`[remote] flush stopped at log #${entry.id}: ${err.message}`);
      break;
    }
  }
  return pushed;
}

/**
 * Rebuild SQLite from the Appwrite mirror (boot recovery).
 * Destructive on `db` — only call when the local database is empty.
 */
async function restoreFromRemote(db, client, { log = () => {} } = {}) {
  db.exec('PRAGMA foreign_keys = OFF'); // FK constraints + mirror correctness
  try {
    const inserted = {};
    for (const table of ALL_TABLES) {
      const docs = await client.listAll(table);
      let n = 0;
      for (const doc of docs) {
        const row = docToRow(table, doc);
        // A row is only usable when its identity column came back.
        // (service_areas has no `id` column — its key is provider_id+pin_code.)
        const keyCol = TABLES[table].idColumn;
        if (row[keyCol] === null || row[keyCol] === undefined) continue;
        db.run(
          `INSERT INTO "${table}" (${TABLES[table].columns.map((c) => quoteId(c)).join(', ')})
           VALUES (${TABLES[table].columns.map(() => '?').join(', ')})`,
          TABLES[table].columns.map((c) => row[c] ?? null),
        );
        n += 1;
      }
      inserted[table] = n;
    }
    db.exec('PRAGMA foreign_keys = ON');
    log(`[remote] restored ${ALL_TABLES.map((t) => `${inserted[t]} ${t}`).join(', ')}`);
    return inserted;
  } catch (err) {
    db.exec('PRAGMA foreign_keys = ON');
    throw err;
  }
}

/** True when the remote mirror holds at least one document. */
async function remoteHasData(client) {
  return client.hasAnyData(ALL_TABLES);
}

/**
 * Drain the pending log until empty or until an error stops progress.
 * Used after each HTTP response, on an interval and at shutdown.
 * @returns {number} rows pushed in this drain
 */
async function drainPending(db, client, { log = () => {}, chunk = 100, maxRounds = 500 } = {}) {
  let total = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const before = db.scalar('SELECT COUNT(*) FROM _sync_log WHERE synced_at IS NULL');
    if (!before) return total;
    const pushed = await flushPending(db, client, { log, chunk });
    total += pushed;
    if (pushed === 0) break; // stalled on an error — retry later
  }
  return total;
}

/** Boot-time recovery from the remote mirror (see src/app.js). */
async function recoverMissingLocal(db, client, { log = () => {} } = {}) {
  const before = db.scalar(
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_sync_log'",
  );
  if (!before) {
    log('[remote] local database has no tables — nothing to recover into yet');
    return false;
  }
  const localCounts = {};
  for (const table of ALL_TABLES) localCounts[table] = Number(db.scalar(`SELECT COUNT(*) FROM "${table}"`) || 0);
  if (Object.values(localCounts).some((n) => n > 0)) return false; // local has data — nothing to recover
  if (!(await remoteHasData(client))) {
    log('[remote] remote mirror is empty too — starting fresh (seed will populate both)');
    return false;
  }
  const inserted = await restoreFromRemote(db, client, { log });
  log(`[remote] recovered ${Object.values(inserted).reduce((a, b) => a + b, 0)} row(s) from the mirror`);
  return true;
}

module.exports = {
  TABLES,
  ALL_TABLES,
  selectRowFor,
  rowDocId,
  rowToDoc,
  docToRow,
  flushPending,
  drainPending,
  restoreFromRemote,
  remoteHasData,
  recoverMissingLocal,
};
