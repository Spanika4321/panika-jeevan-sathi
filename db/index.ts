import { drizzle } from "drizzle-orm/libsql";
import { client } from "@/db/client";
import * as schema from "@/db/schema";

/**
 * Drizzle instance with the full relation graph — enables the typed
 * relational query API used across the app (`db.query.*`).
 */
export const db = drizzle(client, { schema });

export { schema };
export { client, ensureDbReady, resolveDatabaseUrl } from "@/db/client";
