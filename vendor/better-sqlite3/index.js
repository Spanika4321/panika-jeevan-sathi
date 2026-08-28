"use strict";
/**
 * Compatibility placeholder for the "better-sqlite3" package.
 *
 * This project runs on Node's built-in `node:sqlite` module (no native
 * builds required). Drizzle ORM's better-sqlite3 driver `require`s this
 * package when the module loads, so we provide a minimal stub here.
 *
 * The real database handle is created in `src/db/sqlite-shim.ts`, which
 * exposes the same API surface drizzle needs. If this class is ever
 * instantiated it is a programming error.
 */
class BetterSqlite3Stub {
  constructor() {
    throw new Error(
      "The bundled better-sqlite3 stub cannot be instantiated. " +
        "Use openNodeSQLite() from src/db/sqlite-shim.ts (node:sqlite) instead.",
    );
  }
}
module.exports = BetterSqlite3Stub;
