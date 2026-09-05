/**
 * In-memory database driver.
 *
 * Mirrors the SQLite driver's semantics exactly (same operators, same ordering
 * rules) so domain and API tests run without touching a file. Never used in
 * production — `validateConfig` refuses it.
 */
import { ConflictError } from '../errors.js';

const OPERATORS = ['in', 'gte', 'lte', 'gt', 'lt', 'like', 'ne'];

function cloneRow(row) {
  return row === null || row === undefined ? null : { ...row };
}

function likeToRegex(pattern) {
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
}

function matches(row, where) {
  if (!where) return true;
  for (const [column, raw] of Object.entries(where)) {
    if (raw === undefined) continue;
    const value = row[column];

    if (raw === null) {
      if (value !== null && value !== undefined) return false;
      continue;
    }

    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const operator of OPERATORS) {
        if (raw[operator] === undefined) continue;
        const operand = raw[operator];
        if (operator === 'in') {
          if (!Array.isArray(operand) || !operand.includes(value)) return false;
        } else if (operator === 'ne') {
          if (value === operand) return false;
        } else if (operator === 'like') {
          if (!likeToRegex(operand).test(String(value ?? ''))) return false;
        } else if (operator === 'gte') {
          if (!(Number(value) >= Number(operand))) return false;
        } else if (operator === 'lte') {
          if (!(Number(value) <= Number(operand))) return false;
        } else if (operator === 'gt') {
          if (!(Number(value) > Number(operand))) return false;
        } else if (operator === 'lt') {
          if (!(Number(value) < Number(operand))) return false;
        }
      }
      continue;
    }

    if (value !== raw) return false;
  }
  return true;
}

function compare(a, b) {
  const left = a ?? '';
  const right = b ?? '';
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

export function createMemoryDriver({ log } = {}) {
  const tables = new Map();
  const registered = new Map(); // table -> column list (from lib/db/schema.js)
  const uniqueIndexes = new Map(); // `${table}:${column}` -> true
  let closed = false;

  function store(table) {
    assertOpen();
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  }

  function assertOpen() {
    if (closed) throw new Error('database is closed');
  }

  function enforceUniques(table, row, ignoreId = null) {
    for (const key of uniqueIndexes.keys()) {
      const [indexTable, columns] = key.split('::');
      if (indexTable !== table) continue;
      const cols = columns.split(',');
      // Partial-unique semantics (NULLs are always distinct), matching the
      // `CREATE UNIQUE INDEX ... WHERE col IS NOT NULL` used by the SQL driver.
      if (cols.some((col) => row[col] === null || row[col] === undefined)) continue;
      const clash = tables
        .get(table)
        .find((existing) => existing.id !== ignoreId && cols.every((col) => existing[col] === row[col]));
      if (clash) throw new ConflictError(`${table} already exists with ${columns}=${cols.map((c) => row[c]).join('/')}`);
    }
  }

  const driver = {
    kind: 'memory',

    /** Called by registerMemorySchema with the model registry. */
    async registerTable(table, columns) {
      registered.set(table, [...columns]);
    },

    async columns(table) {
      // Columns come from the model registry (same source the SQL migrations
      // are validated against), so an empty table still reports its shape.
      if (registered.has(table)) return [...registered.get(table)];
      const set = new Set();
      for (const row of store(table)) for (const key of Object.keys(row)) set.add(key);
      return [...set];
    },

    async insert(table, row) {
      const rows = store(table);
      enforceUniques(table, row);
      rows.push(cloneRow(row));
      return cloneRow(row);
    },

    async insertMany(table, list) {
      const inserted = [];
      for (const row of list) inserted.push(await driver.insert(table, row));
      return inserted;
    },

    async update(table, where, patch) {
      const rows = store(table);
      let updated = 0;
      for (const row of rows) {
        if (!matches(row, where)) continue;
        Object.assign(row, patch);
        updated += 1;
      }
      return updated;
    },

    async upsert(table, row, conflictColumns = ['id']) {
      const rows = store(table);
      const index = rows.findIndex((existing) => conflictColumns.every((col) => existing[col] === row[col]));
      if (index === -1) return driver.insert(table, row);
      Object.assign(rows[index], row);
      return cloneRow(rows[index]);
    },

    async remove(table, where) {
      const rows = store(table);
      const kept = rows.filter((row) => !matches(row, where));
      const removed = rows.length - kept.length;
      tables.set(table, kept);
      return removed;
    },

    async one(table, where, options = {}) {
      return cloneRow(store(table).find((row) => matches(row, where)) || null);
    },

    async all(table, options = {}) {
      const { where, order, limit, offset = 0 } = options;
      let rows = store(table).filter((row) => matches(row, where));
      if (order) {
        const keys = (Array.isArray(order) ? order : [order]).map((entry) => ({
          column: String(entry).startsWith('-') ? String(entry).slice(1) : String(entry),
          desc: String(entry).startsWith('-')
        }));
        rows = rows.sort((a, b) => {
          for (const key of keys) {
            const result = compare(a[key.column], b[key.column]);
            if (result !== 0) return key.desc ? -result : result;
          }
          return 0;
        });
      }
      if (limit !== undefined) rows = rows.slice(offset, offset + limit);
      else if (offset) rows = rows.slice(offset);
      return rows.map(cloneRow);
    },

    async count(table, where) {
      return store(table).filter((row) => matches(row, where)).length;
    },

    async createUniqueIndex(table, columns) {
      uniqueIndexes.set(`${table}::${[...columns].sort().join(',')}`, true);
    },

    // Raw SQL is intentionally unsupported by this driver: anything that needs
    // it must go through the SQLite/Postgres drivers used in the real app.
    async query() {
      throw new Error('driver-memory does not support raw SQL; use the sqlite driver for query-dependent tests');
    },

    async exec() {
      return undefined;
    },

    async transaction(fn) {
      return fn(driver);
    },

    async close() {
      closed = true;
      tables.clear();
    }
  };

  log?.debug('memory database ready');
  return driver;
}
