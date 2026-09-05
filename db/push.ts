/**
 * SEVA MARKET INDIA — schema push script.
 *
 *   tsx db/push.ts           → create missing tables/indexes (idempotent)
 *   tsx db/push.ts --reset   → DROP everything, then re-create (dev/test only!)
 *
 * Honours DATABASE_URL (defaults to file:./dev.db, see db/client.ts).
 * This mirrors what `drizzle-kit push` does, without external tooling —
 * deterministic, works offline, easy to audit.
 */
import { client, ensureDbReady, resolveDatabaseUrl } from "@/db/client";
import { DDL_STATEMENTS, DDL_TABLES } from "@/db/ddl";

async function main() {
  const reset = process.argv.includes("--reset");
  await ensureDbReady;

  console.log(`📦 Pushing schema to ${resolveDatabaseUrl()}${reset ? " (with reset)" : ""}`);

  if (reset) {
    // Disable FK checks while tearing down — drop order then doesn't matter.
    await client.execute("PRAGMA foreign_keys = OFF");
    for (const table of DDL_TABLES) {
      await client.execute(`DROP TABLE IF EXISTS ${table}`);
    }
    await client.execute("PRAGMA foreign_keys = ON");
    console.log("   • dropped existing tables");
  }

  for (const statement of DDL_STATEMENTS) {
    await client.execute(statement);
  }
  console.log(`   ✓ ${DDL_TABLES.length} tables ready (CREATE IF NOT EXISTS)`);

  const result = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  console.log(`   ✓ database now has ${result.rows.length} tables`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Schema push failed:", error);
    process.exit(1);
  });
