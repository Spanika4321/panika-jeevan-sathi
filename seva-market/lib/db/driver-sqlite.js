/**
 * SQLite driver (built-in `node:sqlite`, no native build step).
 *
 * This is the local/development driver. The SQL it emits is deliberately kept
 * to a portable subset (text UUID keys, `bigint` epoch timestamps, plain
 * `create table` / `create unique index`) so the same migrations run unchanged
 * on PostgreSQL later — see docs/DATA-MODEL.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const OPERATORS = ['in', 'gte', 'lte', 'gt', 'lt', 'like', 'ne'];

function quoteIdentifier(name) {
  if (!IDENTIFIER.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `"${name}"`;
}

function conditions(where) {
  const clauses = [];
  const params = [];
  if (!where) return { sql: '', params };

  for (const [column, raw] of Object.entries(where)) {
    if (raw === undefined) continue;
    const col = quoteIdentifier(column);

    if (raw === null) {
      clauses.push(`${col} IS NULL`);
      continue;
    }

    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const operator of OPERATORS) {
        if (raw[operator] === undefined) continue;
        const operand = raw[operator];
        if (operator === 'in') {
          const values = Array.isArray(operand) ? operand : [operand];
          if (!values.length) clauses.push('1 = 0');
          else {
            clauses.push(`${col} IN (${values.map(() => '?').join(', ')})`);
            params.push(...values.map(normaliseValue));
          }
        } else if (operator === 'ne') {
          clauses.push(`(${col} IS NULL OR ${col} != ?)`);
          params.push(normaliseValue(operand));
        } else if (operator === 'like') {
          clauses.push(`${col} LIKE ?`);
          params.push(String(operand));
        } else {
          const symbol = { gte: '>=', lte: '<=', gt: '>', lt: '<' }[operator];
          clauses.push(`${col} ${symbol} ?`);
          params.push(normaliseValue(operand));
        }
      }
      continue;
    }

    clauses.push(`${col} = ?`);
    params.push(normaliseValue(raw));
  }

  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

function normaliseValue(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  if (value instanceof Date) return value.getTime();
  return value;
}

function orderClause(order) {
  if (!order) return '';
  const parts = (Array.isArray(order) ? order : [order]).map((entry) => {
    const desc = String(entry).startsWith('-');
    const column = quoteIdentifier(desc ? String(entry).slice(1) : String(entry));
    return `${column} ${desc ? 'DESC' : 'ASC'}`;
  });
  return parts.length ? ` ORDER BY ${parts.join(', ')}` : '';
}

export function createSqliteDriver({ file = ':memory:', log } = {}) {
  const location = file === ':memory:' ? ':memory:' : path.resolve(file);
  if (location !== ':memory:') fs.mkdirSync(path.dirname(location), { recursive: true });

  const db = new DatabaseSync(location);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');

  let closed = false;
  const assertOpen = () => {
    if (closed) throw new Error('database is closed');
  };

  const driver = {
    kind: 'sqlite',
    location,

    async columns(table) {
      assertOpen();
      const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
      return rows.map((row) => row.name);
    },

    async insert(table, row) {
      assertOpen();
      const columns = Object.keys(row);
      const sql = `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns
        .map(() => '?')
        .join(', ')})`;
      db.prepare(sql).run(...columns.map((column) => normaliseValue(row[column])));
      return { ...row };
    },

    async insertMany(table, rows) {
      const inserted = [];
      for (const row of rows) inserted.push(await driver.insert(table, row));
      return inserted;
    },

    async update(table, where, patch) {
      assertOpen();
      const columns = Object.keys(patch);
      if (!columns.length) return 0;
      const { sql: whereSql, params: whereParams } = conditions(where);
      const sql = `UPDATE ${quoteIdentifier(table)} SET ${columns
        .map((column) => `${quoteIdentifier(column)} = ?`)
        .join(', ')}${whereSql}`;
      const result = db
        .prepare(sql)
        .run(...columns.map((column) => normaliseValue(patch[column])), ...whereParams);
      return Number(result.changes || 0);
    },

    async upsert(table, row, conflictColumns = ['id']) {
      assertOpen();
      const columns = Object.keys(row);
      const updates = columns
        .filter((column) => !conflictColumns.includes(column))
        .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`);
      const target = conflictColumns.map(quoteIdentifier).join(', ');
      const sql =
        `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) ` +
        `VALUES (${columns.map(() => '?').join(', ')}) ` +
        `ON CONFLICT(${target}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`;
      db.prepare(sql).run(...columns.map((column) => normaliseValue(row[column])));
      const { sql: whereSql, params: whereParams } = conditions(
        Object.fromEntries(conflictColumns.map((column) => [column, row[column]]))
      );
      return db.prepare(`SELECT * FROM ${quoteIdentifier(table)}${whereSql}`).get(...whereParams) || null;
    },

    async remove(table, where) {
      assertOpen();
      const { sql: whereSql, params } = conditions(where);
      const result = db.prepare(`DELETE FROM ${quoteIdentifier(table)}${whereSql}`).run(...params);
      return Number(result.changes || 0);
    },

    async one(table, where, options = {}) {
      assertOpen();
      const { sql: whereSql, params } = conditions(where);
      const sql = `SELECT * FROM ${quoteIdentifier(table)}${whereSql}${orderClause(options.order)} LIMIT 1`;
      return db.prepare(sql).get(...params) || null;
    },

    async all(table, options = {}) {
      assertOpen();
      const { where, order, limit, offset } = options;
      const { sql: whereSql, params } = conditions(where);
      let sql = `SELECT * FROM ${quoteIdentifier(table)}${whereSql}${orderClause(order)}`;
      if (limit !== undefined) {
        sql += ' LIMIT ? OFFSET ?';
        params.push(Number(limit), Number(offset || 0));
      }
      return db.prepare(sql).all(...params);
    },

    async count(table, where) {
      assertOpen();
      const { sql: whereSql, params } = conditions(where);
      const row = db.prepare(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}${whereSql}`).get(...params);
      return Number(row?.total || 0);
    },

    async createUniqueIndex(table, columns) {
      const list = [].concat(columns);
      const name = `ux_${table}_${list.join('_')}`.slice(0, 60);
      const partial = list.map((column) => `${quoteIdentifier(column)} IS NOT NULL`).join(' AND ');
      // Partial unique indexes keep SQLite and Postgres in agreement: both treat
      // NULLs as distinct, so optional columns (e.g. phone) can stay empty.
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(name)} ON ${quoteIdentifier(table)} (${list
          .map(quoteIdentifier)
          .join(', ')}) WHERE ${partial}`
      );
      return name;
    },

    /** Raw, parameterised read. `sql` is trusted code — never build it from user input. */
    async query(sql, params = []) {
      assertOpen();
      return db.prepare(sql).all(...params.map(normaliseValue));
    },

    async exec(sql) {
      assertOpen();
      return db.exec(sql);
    },

    async transaction(fn) {
      assertOpen();
      db.exec('BEGIN');
      try {
        const result = await fn(driver);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* the original failure is what matters */
        }
        throw error;
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      try {
        db.close();
      } catch {
        /* already closed */
      }
    }
  };

  log?.debug(`sqlite database ready (${location})`);
  return driver;
}
