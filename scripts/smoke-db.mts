import { db } from "../src/db";
import { users, profiles } from "../src/db/schema";
import { eq, count } from "drizzle-orm";

async function main() {
  const all = await db.select().from(users).orderBy(users.id).limit(10);
  console.log("users:", all.length, all.slice(0, 3).map(u => `${u.fullName}/${u.role}/${u.status}`));
  const profs = await db.select().from(profiles).limit(8);
  console.log("profiles:", profs.length, profs.map(p => p.displayName).join(", "));
  const one = await db.select().from(profiles).where(eq(profiles.location, "Mumbai, Maharashtra")).limit(1);
  console.log("query by location:", one[0]?.displayName);
  const admin = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
  console.log("admin:", admin[0]?.email, "createdAt:", admin[0]?.createdAt);
  const [c] = await db.select({ value: count() }).from(profiles);
  console.log("count:", c?.value);
  await db.update(users).set({ updatedAt: new Date() }).where(eq(users.id, all[0].id));
  console.log("update ok");
}
main();
