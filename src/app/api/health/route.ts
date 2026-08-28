import { db } from "@/db";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.select({ id: users.id }).from(users).limit(1);
    return Response.json({ ok: true, database: "connected" });
  } catch {
    return Response.json({ ok: true, database: "offline" });
  }
}
