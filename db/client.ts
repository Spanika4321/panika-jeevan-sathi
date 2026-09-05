import { createClient, type Client } from "@libsql/client";

/**
 * Minimal .env loader (no dependency): reads KEY=VALUE pairs from .env at the
 * project root without overriding variables that are already set.
 * Next.js loads .env itself — this only matters for tsx scripts (push/seed)
 * and Vitest, keeping `DATABASE_URL` handling consistent everywhere.
 */
function loadDotEnv(path = ".env") {
  if (typeof process === "undefined") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    if (!fs.existsSync(path)) return;
    for (const line of fs.readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) continue;
      const [, key, raw] = match;
      const value = raw.replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env is optional — ignore read errors.
  }
}

loadDotEnv();

/** Resolve DB URL: local SQLite file by default; libsql remote URL in prod. */
export function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? "file:./dev.db";
}

const globalForDb = globalThis as unknown as {
  __sevaDbClient?: Client;
  __sevaDbReady?: Promise<void>;
};

function createDbClient(): Client {
  return createClient({ url: resolveDatabaseUrl() });
}

export const client: Client = globalForDb.__sevaDbClient ?? createDbClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sevaDbClient = client;
}

/**
 * One-time per-process init. SQLite disables foreign keys by default —
 * we enforce them so cascade/restrict rules in db/schema.ts hold.
 */
export const ensureDbReady: Promise<void> =
  globalForDb.__sevaDbReady ??
  (async () => {
    await client.execute("PRAGMA foreign_keys = ON");
  })();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sevaDbReady = ensureDbReady;
}
