import { and, eq, inArray, ne, or } from "drizzle-orm";
import { db } from "@/db";
import {
  conversationParticipants,
  conversations,
  interests,
  matches,
  notifications,
} from "@/db/schema";

export async function createNotification(input: {
  userId: number;
  type: string;
  title: string;
  body?: string;
  linkUrl?: string;
  actorId?: number;
}) {
  if (input.userId === input.actorId) return;
  await db.insert(notifications).values({
    userId: input.userId,
    actorId: input.actorId,
    type: input.type,
    title: input.title,
    body: input.body,
    linkUrl: input.linkUrl,
  });
}

export async function canUsersMessage(userA: number, userB: number) {
  if (userA === userB) return false;
  const rows = await db
    .select({ id: interests.id })
    .from(interests)
    .where(
      and(
        eq(interests.status, "accepted"),
        or(
          and(eq(interests.senderId, userA), eq(interests.receiverId, userB)),
          and(eq(interests.senderId, userB), eq(interests.receiverId, userA)),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function findConversationBetween(userA: number, userB: number) {
  const firstUserConversations = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.userId, userA));

  const ids = firstUserConversations.map((row) => row.conversationId);
  if (ids.length === 0) return null;

  const rows = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(and(inArray(conversationParticipants.conversationId, ids), eq(conversationParticipants.userId, userB)))
    .limit(1);

  return rows[0]?.conversationId ?? null;
}

export async function findOrCreateConversation(userA: number, userB: number) {
  const existing = await findConversationBetween(userA, userB);
  if (existing) return existing;

  const inserted = await db.insert(conversations).values({ status: "active" }).returning({ id: conversations.id });
  const conversationId = inserted[0]!.id;
  await db.insert(conversationParticipants).values([
    { conversationId, userId: userA },
    { conversationId, userId: userB },
  ]);
  return conversationId;
}

export async function createMatchForAcceptedInterest(interestId: number, senderId: number, receiverId: number, score = 90) {
  const userOneId = Math.min(senderId, receiverId);
  const userTwoId = Math.max(senderId, receiverId);

  await db
    .insert(matches)
    .values({ userOneId, userTwoId, interestId, score, status: "active" })
    .onConflictDoNothing();

  return findOrCreateConversation(senderId, receiverId);
}

export async function getOtherParticipant(conversationId: number, currentUserId: number) {
  const rows = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, conversationId), ne(conversationParticipants.userId, currentUserId)))
    .limit(1);
  return rows[0]?.userId ?? null;
}
