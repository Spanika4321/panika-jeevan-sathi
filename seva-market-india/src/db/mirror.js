'use strict';
/**
 * SEVA MARKET INDIA — Appwrite durability mirror around the SQLite engine.
 *
 * The problem: free hosts (Render/Railway) wipe the local disk on every
 * sleep or redeploy, deleting every provider, service and customer lead.
 *
 * The solution here keeps SQLite as the *query engine* (all model SQL —
 * joins, LIKE search, transactions — keeps working untouched) and makes
 * Appwrite the *durable store*:
 *
 *   boot   →  restore: every Appwrite document is loaded into SQLite
 *   write  →  mirror : after each INSERT/UPDATE/DELETE the changed rows
 *                      are diffed and pushed to Appwrite (one document
 *                      per row, `json` attribute = the full row)
 *
 * The mirror is write-behind with an in-process serial queue: SQLite
 * answers instantly, the Appwrite push happens on the next tick and is
 * awaited at shutdown via flushNow(). Adoption rule per table: when the
 * remote has documents, remote wins (local is replaced at boot); when the
 * remote is empty but local has rows (first run against an existing dev
 * database), local is pushed up.
 */

const appwriteLib = require('./appwrite');

/**
 * Every mirrored table and how to derive its stable document id.
 * Order matters only for readability; restore runs with FKs off.
 */
const TABLES = [
  { name: 'schema_migrations', docId: (row) => String(row.version) },
  { name: 'users', docId: (row) => String(row.id) },
  { name: 'locations', docId: (row) => String(row.id) },
  { name: 'categories', docId: (row) => String(row.id) },
  { name: 'providers', docId: (row) => String(row.id) },
  { name: 'services', docId: (row) => String(row.id) },
  { name: 'service_areas', docId: (row) => `${row.provider_id}_${row.pin_code}` },
  { name: 'leads', docId: (row) => String(row.id) },
  { name: 'audit_logs', docId: (row) => String(row.id) },
];

const TABLE_NAMES = TABLES.map((t) => t.name);
const TABLE_BY_NAME = new Map(TABLES.map((t) => [t.name, t]));

/** Which mirrored table does this write statement touch, if any? */
function tablesTouchedBy(sql) {
  const found = new Set();
  const text = String(sql);
  const re = /\b(?:insert\s+(?:or\s+\w+\s+)?into|update|delete\s+from)\s+["'`[]?([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const table = match[1].toLowerCase();
    if (TABLE_BY_NAME.has(table)) found.add(table);
  }
  return found;
}

/**
 * Wrap a Database so every mutation is mirrored to Appwrite.
 * The wrapper preserves the full Database interface (run/get/all/scalar/
 * exec/transaction/close + .file), so models and routes need no changes.
 */
class MirroredDatabase {
  /**
   * @param {import('./client').Database} db     the local SQLite engine
   * @param {object} client                      appwrite client (appwrite.js)
   * @param {object} [options]
   * @param {Function} [options.log]
   * @param {number} [options.concurrency]       parallel document pushes
   */
  constructor(db, client, { log = () => {}, concurrency = 4 } = {}) {
    this.db = db;
    this.client = client;
    this.log = log;
    this.concurrency = Math.max(1, concurrency);
    this.file = db.file;
    this.remote = { kind: 'appwrite', endpoint: client.endpoint, databaseId: client.databaseId };

    /** table → Map(docId → row JSON string) — what the remote currently holds. */
    this.cache = new Map(TABLE_NAMES.map((name) => [name, new Map()]));
    this.dirty = new Set();
    this.queue = Promise.resolve();
    this.flushScheduled = false;
    this.lastError = null;
  }

  /* ------------------------------------------------ Database interface */

  run(sql, params = []) {
    const result = this.db.run(sql, params);
    this._afterWrite(sql);
    return result;
  }

  get(sql, params = []) {
    return this.db.get(sql, params);
  }

  all(sql, params = []) {
    return this.db.all(sql, params);
  }

  scalar(sql, params = []) {
    return this.db.scalar(sql, params);
  }

  exec(sql) {
    this.db.exec(sql);
    // exec is used for migrations and ad-hoc DDL; anything could have
    // changed, so mark every mirrored table that exists locally.
    for (const name of this._localTables()) this.dirty.add(name);
    if (this.db.depth === 0) this._scheduleFlush();
  }

  transaction(fn) {
    const result = this.db.transaction(fn);
    // Mutations inside fn() went through this.run/this.exec and marked
    // their tables dirty; push only after COMMIT succeeded.
    if (this.db.depth === 0 && this.dirty.size) this._scheduleFlush();
    return result;
  }

  close() {
    this.db.close();
  }

  /* --------------------------------------------------- mirror plumbing */

  _localTables() {
    return this.db
      .all("SELECT name FROM sqlite_master WHERE type='table'")
      .map((row) => row.name)
      .filter((name) => TABLE_BY_NAME.has(name));
  }

  _afterWrite(sql) {
    const touched = tablesTouchedBy(sql);
    if (!touched.size) return;
    for (const table of touched) this.dirty.add(table);
    if (this.db.depth === 0) this._scheduleFlush();
  }

  _scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => {
      this.flushScheduled = false;
      this.queue = this.queue.then(() => this._flush()).catch((err) => {
        // Keep the queue alive; the next write retries the whole diff.
        this.lastError = err;
        this.log(`[mirror] flush failed (will retry on next write): ${err.message}`);
        for (const name of this._localTables()) this.dirty.add(name);
      });
    });
  }

  /** Push every dirty table's diff to Appwrite. Serialized by this.queue. */
  async _flush() {
    const tables = [...this.dirty];
    this.dirty.clear();
    for (const table of tables) {
      await this._pushTable(table);
    }
    this.lastError = null;
  }

  async _pushTable(table) {
    const spec = TABLE_BY_NAME.get(table);
    const known = this.cache.get(table);
    const rows = this.db.all(`SELECT * FROM ${table}`);

    const present = new Map();
    for (const row of rows) present.set(spec.docId(row), JSON.stringify(row));

    const jobs = [];
    for (const [docId, json] of present) {
      if (known.get(docId) !== json) {
        jobs.push(async () => {
          await this.client.upsertDocument(table, docId, { json });
          known.set(docId, json);
        });
      }
    }
    for (const docId of known.keys()) {
      if (!present.has(docId)) {
        jobs.push(async () => {
          await this.client.deleteDocument(table, docId);
          known.delete(docId);
        });
      }
    }
    await runLimited(jobs, this.concurrency);
  }

  /** Await every pending push (shutdown / tests). */
  async flushNow() {
    if (this.dirty.size) this._scheduleFlush();
    // Two hops: one for the setImmediate, one for the queued flush.
    await new Promise((resolve) => setImmediate(resolve));
    await this.queue;
  }
}

/** Run async jobs with a small concurrency cap. */
async function runLimited(jobs, limit) {
  const executing = new Set();
  for (const job of jobs) {
    const promise = job().finally(() => executing.delete(promise));
    executing.add(promise);
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
}

/**
 * Boot-time restore: make SQLite match Appwrite (or seed Appwrite from
 * SQLite when the remote is empty). Call *after* migrations have run.
 *
 * @returns {{restored: Object<string, number>, pushed: string[]}}
 */
async function restore(mirror) {
  const { db, client, cache, log } = mirror;
  await client.ensureSchema(TABLE_NAMES);

  const localTables = new Set(mirror._localTables());
  const restored = {};
  const pushLater = [];

  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    for (const spec of TABLES) {
      if (!localTables.has(spec.name)) continue;
      const docs = await client.listAllDocuments(spec.name);
      const known = cache.get(spec.name);
      known.clear();

      if (docs.length === 0) {
        // Remote empty. If local rows exist (first run against an existing
        // database), adopt them upward instead of wiping them.
        const localCount = Number(db.scalar(`SELECT COUNT(*) FROM ${spec.name}`) ?? 0);
        if (localCount > 0) pushLater.push(spec.name);
        continue;
      }

      const rows = [];
      for (const doc of docs) {
        if (typeof doc.json !== 'string' || !doc.json) continue;
        try {
          rows.push(JSON.parse(doc.json));
        } catch (_) {
          log(`[mirror] skipping unparsable document ${spec.name}/${doc.$id}`);
        }
      }

      db.transaction(() => {
        db.db.exec(`DELETE FROM ${spec.name}`);
        for (const row of rows) {
          const cols = Object.keys(row);
          if (!cols.length) continue;
          db.db
            .prepare(
              `INSERT INTO ${spec.name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
            )
            .run(...cols.map((c) => normalise(row[c])));
        }
      });
      for (const row of rows) known.set(spec.docId(row), JSON.stringify(row));
      restored[spec.name] = rows.length;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  // Now push any local-only tables up to the (empty) remote collections.
  for (const table of pushLater) mirror.dirty.add(table);
  if (pushLater.length) {
    mirror._scheduleFlush();
    await mirror.flushNow();
  }

  return { restored, pushed: pushLater };
}

/** JSON round-trip can only hold null/number/string/bool; bind-safe them. */
function normalise(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/**
 * Build the full production stack: SQLite engine + Appwrite mirror,
 * restored and ready. Returns null when Appwrite is not configured.
 *
 * @param {import('./client').Database} db  migrated local database
 * @param {object} [options] {env, log, fetchImpl, client}
 */
async function attachMirror(db, options = {}) {
  const log = options.log || ((line) => console.log(line));
  const config = appwriteLib.configFrom(options.appwrite || {}, options.env || process.env);
  if (!config && !options.client) return null;

  const client = options.client || appwriteLib.createClient(config, { log, fetchImpl: options.fetchImpl });
  const mirror = new MirroredDatabase(db, client, { log });
  const result = await restore(mirror);

  const loaded = Object.entries(result.restored)
    .map(([table, n]) => `${table}:${n}`)
    .join(' ');
  log(`[mirror] Appwrite connected (${client.endpoint}, db "${client.databaseId}")`);
  if (loaded) log(`[mirror] restored from Appwrite → ${loaded}`);
  if (result.pushed.length) log(`[mirror] pushed local tables up → ${result.pushed.join(', ')}`);

  return mirror;
}

module.exports = { TABLES, TABLE_NAMES, MirroredDatabase, restore, attachMirror, tablesTouchedBy };
