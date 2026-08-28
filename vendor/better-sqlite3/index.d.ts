export type RunResult = { changes: number | bigint; lastInsertRowid: number | bigint };

export type Statement = {
  run(...params: unknown[]): RunResult;
  all<T = Record<string, unknown>>(...params: unknown[]): T[];
  get<T = Record<string, unknown>>(...params: unknown[]): T | undefined;
  raw(): {
    get(...params: unknown[]): unknown[] | undefined;
    all(...params: unknown[]): unknown[][];
  };
};

export type Database = {
  prepare(sql: string): Statement;
  exec(sql: string): this;
  transaction<T>(callback: (...args: never[]) => T): {
    deferred: () => T;
    immediate: () => T;
    exclusive: () => T;
  };
};

declare class BetterSqlite3Stub {
  constructor(path?: string, options?: Record<string, unknown>);
}

export default BetterSqlite3Stub;
