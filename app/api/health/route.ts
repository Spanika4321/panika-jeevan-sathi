import { NextResponse } from "next/server";
import { client } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * Health check — verifies both the app and DB connectivity.
 */
export async function GET() {
  let database: "connected" | "unavailable" = "unavailable";
  try {
    await client.execute("SELECT 1 AS ok");
    database = "connected";
  } catch {
    // DB unreachable — app still reports itself alive, DB flagged down.
  }

  return NextResponse.json({
    status: "ok",
    service: "seva-market-india",
    database,
    timestamp: new Date().toISOString(),
  });
}
