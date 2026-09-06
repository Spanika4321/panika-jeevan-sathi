'use strict';
/**
 * SEVA MARKET INDIA — SQLite client wrapper.
 *
 * Zero npm dependencies: uses the built-in `node:sqlite` driver (Node 22.5+).
 *
 * Two driver quirks are handled here once instead of at every call site:
 *   1. Bound parameters may only be null / number / bigint / string /
 *      Uint8Array, so `bind()` normalises booleans, Dates and `undefined`.
 *   2. `StatementSync` has no `finalize()` — prepared statements are
 *      reclaimed by the garbage collector, so they must not be closed by
 *      hand. (Calling a non-existent finalize() throws at runtime.)
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/** Convert a JS value into something node:sqlite will accept. */
function bind(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Map an array of JS values to bind-safe values. */
function bindAll(values = []) {
  return values.map(bind);
}

class Database {
  /**
   * @param {string} file Database path, or ':memory:' for an ephemeral DB.
   */
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new DatabaseSync(file);
    // Connection-level PRAGMAs must be set here, never inside a migration:
    // `journal_mode` errors inside a transaction and `foreign_keys` is a
    // silent no-op there. WAL is file-only — an in-memory DB cannot use it.
    if (file !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    /** Current transaction nesting depth. */
    this.depth = 0;
  }

  /** Run a statement that returns no rows (DDL, INSERT, UPDATE, DELETE). */
  run(sql, params = []) {
    return this.db.prepare(sql).run(...bindAll(params));
  }

  /** Return the first matching row, or null. */
  get(sql, params = []) {
    return this.db.prepare(sql).get(...bindAll(params)) ?? null;
  }

  /** Return every matching row as an array. */
  all(sql, params = []) {
    return this.db.prepare(sql).all(...bindAll(params));
  }

  /** Return the first column of the first row (counts, max ids...). */
  scalar(sql, params = []) {
    const row = this.get(sql, params);
    if (!row) return null;
    return Object.values(row)[0] ?? null;
  }

  /** Execute raw SQL (migrations). */
  exec(sql) {
    this.db.exec(sql);
  }

  /**
   * Run `fn` inside a transaction; rolls back on any throw.
   *
   * Re-entrant: a nested call joins the enclosing transaction instead of
   * issuing a second BEGIN (SQLite rejects that outright). This lets a model
   * method be safe standalone *and* safe inside a larger unit of work such
   * as the seed script.
   */
  transaction(fn) {
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return fn();
      } finally {
        this.depth -= 1;
      }
    }

    this.exec('BEGIN');
    this.depth = 1;
    try {
      const result = fn();
      this.exec('COMMIT');
      return result;
    } catch (err) {
      this.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth = 0;
    }
  }

  close() {
    try {
      this.db.close();
    } catch (_) {
      /* already closed */
    }
  }
}

module.exports = { Database, bind, bindAll };
