import type { Database } from "better-sqlite3";
import { DatabaseSync, type StatementSync } from "node:sqlite";

/**
 * Minimal better-sqlite3 compatible shim backed by Node's built-in
 * `node:sqlite` module. This keeps the project free of native builds while
 * using drizzle-orm's stable better-sqlite3 driver.
 *
 * Important: drizzle reads rows via `stmt.raw()` as POSITIONAL arrays, so the
 * raw mode here must return true arrays (node:sqlite's `setReturnArrays`),
 * not objects — object rows silently drop duplicate column names produced by
 * JOINs (e.g. two `id` columns).
 */

class ShimStatement {
  private db: DatabaseSync;
  private sql: string;

  constructor(db: DatabaseSync, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  private prepare(): StatementSync {
    return this.db.prepare(this.sql);
  }

  run(...params: unknown[]) {
    return this.prepare().run(...(params as never[]));
  }

  all(...params: unknown[]) {
    return this.prepare().all(...(params as never[]));
  }

  get(...params: unknown[]) {
    return this.prepare().get(...(params as never[]));
  }

  raw() {
    const stmt = this.prepare();
    stmt.setReturnArrays(true);
    return {
      get: (...params: unknown[]) => stmt.get(...(params as never[])),
      all: (...params: unknown[]) => stmt.all(...(params as never[])),
    };
  }
}

export class NodeSQLiteShim {
  constructor(private db: DatabaseSync) {}

  prepare(sql: string) {
    return new ShimStatement(this.db, sql);
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  transaction<T>(callback: (...args: unknown[]) => T) {
    const make = () => {
      return (...args: unknown[]) => {
        this.db.exec("BEGIN");
        try {
          const result = callback(...args);
          this.db.exec("COMMIT");
          return result;
        } catch (err) {
          this.db.exec("ROLLBACK");
          throw err;
        }
      };
    };
    return { deferred: make(), immediate: make(), exclusive: make() } as ReturnType<Database["transaction"]>;
  }
}

export function openNodeSQLite(path: string): Database {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return new NodeSQLiteShim(db) as unknown as Database;
}
