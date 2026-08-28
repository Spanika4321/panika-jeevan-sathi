import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers, sessions, users } from "@/db/schema";
import { ADMIN_EMAIL, ADMIN_NAME } from "./constants";
import type { SessionUser } from "./data-types";
import { addDays, hashSecret, randomToken } from "./security";

export const SESSION_COOKIE = "pjs_session";
const SESSION_DAYS = 30;

export async function getCurrentSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function createSession(userId: number) {
  const token = randomToken(48);
  const expiresAt = addDays(SESSION_DAYS);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashSecret(token),
    expiresAt,
  });
  return { token, expiresAt };
}

function isSecureCookies() {
  return process.env.NODE_ENV === "production" && process.env.DISABLE_SECURE_COOKIE !== "true";
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookies(),
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const token = await getCurrentSessionToken();
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashSecret(token)));
  }
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookies(),
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = await getCurrentSessionToken();
  if (!token) return null;

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      mobile: users.mobile,
      gender: users.gender,
      dateOfBirth: users.dateOfBirth,
      role: users.role,
      status: users.status,
      emailVerified: users.emailVerified,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashSecret(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const user = rows[0] ?? null;
  if (!user || user.status === "deleted") return null;

  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.tokenHash, hashSecret(token)));

  if (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return ensureAdminUser(user);
  }

  return user;
}

export async function ensureAdminUser(user: SessionUser): Promise<SessionUser> {
  if (user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return user;

  if (user.role !== "admin") {
    await db.update(users).set({ role: "admin", updatedAt: new Date() }).where(eq(users.id, user.id));
  }

  await db
    .insert(adminUsers)
    .values({ userId: user.id, name: ADMIN_NAME, email: ADMIN_EMAIL.toLowerCase(), role: "owner", isActive: true })
    .onConflictDoNothing();

  return { ...user, role: "admin" };
}

export async function isAdminUser(user: SessionUser | null) {
  if (!user) return false;
  if (user.role === "admin" || user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return true;
  const rows = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(and(eq(adminUsers.userId, user.id), eq(adminUsers.isActive, true)))
    .limit(1);
  return rows.length > 0;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status === "suspended") {
    redirect("/settings?error=Your%20account%20is%20suspended.%20Please%20contact%20support.");
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  const admin = await isAdminUser(user);
  if (!admin) redirect("/?error=Admin%20access%20only");
  return ensureAdminUser(user);
}
