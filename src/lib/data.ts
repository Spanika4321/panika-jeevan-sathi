import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  ne,
  notInArray,
  or,
  type SQL,
} from "drizzle-orm";
// NOTE: use `like` (standard SQL) — SQLite's LIKE is case-insensitive for ASCII,
// so it serves as ilike. The generic `ilike` renders PG-only syntax.
const ilike = like;
import { db } from "@/db";
import {
  adminUsers,
  announcements,
  blocks,
  contactMessages,
  conversationParticipants,
  conversations,
  interests,
  matches,
  messages,
  notifications,
  partnerPreferences,
  privacySettings,
  profiles,
  reports,
  shortlists,
  users,
} from "@/db/schema";
import type { MiniProfile, ProfileCardData, SessionUser } from "./data-types";
import { calculateAge, sameText, searchParam, textIncludes, toInt, yearsAgoDate } from "./utils";

function mapProfileCard(row: Omit<ProfileCardData, "age">): ProfileCardData {
  return { ...row, age: calculateAge(row.dateOfBirth) };
}

export async function getHomeStats() {
  const [totalUsers, verifiedProfiles, successfulMatches] = await Promise.all([
    db.select({ value: count() }).from(users).where(ne(users.status, "deleted")),
    db.select({ value: count() }).from(profiles).where(eq(profiles.verificationStatus, "verified")),
    db.select({ value: count() }).from(matches).where(eq(matches.status, "active")),
  ]);
  return {
    totalMembers: totalUsers[0]?.value ?? 0,
    verifiedProfiles: verifiedProfiles[0]?.value ?? 0,
    successfulMatches: successfulMatches[0]?.value ?? 0,
  };
}

export async function getBlockedUserIds(viewerId?: number | null) {
  if (!viewerId) return [] as number[];
  const rows = await db
    .select({ blockerId: blocks.blockerId, blockedUserId: blocks.blockedUserId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, viewerId), eq(blocks.blockedUserId, viewerId)));
  return rows.map((row) => (row.blockerId === viewerId ? row.blockedUserId : row.blockerId));
}

export async function getBlockedUsers(viewerId: number) {
  const rows = await db
    .select({ blockedUserId: blocks.blockedUserId, reason: blocks.reason, createdAt: blocks.createdAt })
    .from(blocks)
    .where(eq(blocks.blockerId, viewerId))
    .orderBy(desc(blocks.createdAt));

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      profile: await getMiniProfile(row.blockedUserId),
    })),
  );
}

export async function getMiniProfile(userId: number): Promise<MiniProfile | null> {
  const rows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      dateOfBirth: users.dateOfBirth,
      location: profiles.location,
      profession: profiles.profession,
      education: profiles.education,
      profilePhotoUrl: profiles.profilePhotoUrl,
      verificationStatus: profiles.verificationStatus,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, verificationStatus: row.verificationStatus ?? "unverified", age: calculateAge(row.dateOfBirth) };
}

export async function getOwnProfile(userId: number) {
  const rows = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function getOwnPreferences(userId: number) {
  const rows = await db.select().from(partnerPreferences).where(eq(partnerPreferences.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function getOwnPrivacy(userId: number) {
  const rows = await db.select().from(privacySettings).where(eq(privacySettings.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function hasAcceptedConnection(userA?: number | null, userB?: number | null) {
  if (!userA || !userB || userA === userB) return false;
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

export async function getProfileDetails(profileUserId: number, viewer?: SessionUser | null) {
  const rows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      gender: users.gender,
      dateOfBirth: users.dateOfBirth,
      email: users.email,
      mobile: users.mobile,
      userStatus: users.status,
      profileId: profiles.id,
      displayName: profiles.displayName,
      profilePhotoUrl: profiles.profilePhotoUrl,
      headline: profiles.headline,
      about: profiles.about,
      familyDetails: profiles.familyDetails,
      lifestyle: profiles.lifestyle,
      religion: profiles.religion,
      community: profiles.community,
      motherTongue: profiles.motherTongue,
      maritalStatus: profiles.maritalStatus,
      education: profiles.education,
      profession: profiles.profession,
      income: profiles.income,
      location: profiles.location,
      heightCm: profiles.heightCm,
      approvalStatus: profiles.approvalStatus,
      verificationStatus: profiles.verificationStatus,
      visibility: profiles.visibility,
      createdAt: profiles.createdAt,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, profileUserId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const isOwner = viewer?.id === profileUserId;
  const viewerIsAdmin = viewer?.role === "admin";
  const privacy = await getOwnPrivacy(profileUserId);
  const preferences = await getOwnPreferences(profileUserId);
  const accepted = await hasAcceptedConnection(viewer?.id, profileUserId);

  if (!isOwner && !viewerIsAdmin) {
    if (row.userStatus !== "active" || row.approvalStatus !== "approved") return null;
    if (privacy?.profileVisibility === "private") return null;
    if (privacy?.profileVisibility === "members" && !viewer) return null;
  }

  const sentRows = viewer
    ? await db
        .select({ id: interests.id, status: interests.status, message: interests.message, createdAt: interests.createdAt })
        .from(interests)
        .where(and(eq(interests.senderId, viewer.id), eq(interests.receiverId, profileUserId)))
        .limit(1)
    : [];

  const receivedRows = viewer
    ? await db
        .select({ id: interests.id, status: interests.status, message: interests.message, createdAt: interests.createdAt })
        .from(interests)
        .where(and(eq(interests.senderId, profileUserId), eq(interests.receiverId, viewer.id)))
        .limit(1)
    : [];

  const shortlistedRows = viewer
    ? await db
        .select({ id: shortlists.id })
        .from(shortlists)
        .where(and(eq(shortlists.userId, viewer.id), eq(shortlists.shortlistedUserId, profileUserId)))
        .limit(1)
    : [];

  return {
    ...row,
    age: calculateAge(row.dateOfBirth),
    preferences,
    privacy,
    isOwner,
    accepted,
    shortlisted: shortlistedRows.length > 0,
    sentInterest: sentRows[0] ?? null,
    receivedInterest: receivedRows[0] ?? null,
    canSeeEmail: isOwner || (accepted && privacy?.hideEmail === false),
    canSeePhone: isOwner || (accepted && privacy?.hidePhone === false),
  };
}

export async function getSearchResults(
  params: Record<string, string | string[] | undefined>,
  viewerId?: number | null,
) {
  const page = Math.max(1, toInt(searchParam(params, "page"), 1));
  const limit = 12;
  const offset = (page - 1) * limit;
  const conditions: SQL[] = [eq(profiles.approvalStatus, "approved"), eq(users.status, "active")];

  if (viewerId) {
    conditions.push(ne(users.id, viewerId));
    conditions.push(ne(profiles.visibility, "private"));
    const blockedIds = await getBlockedUserIds(viewerId);
    if (blockedIds.length > 0) conditions.push(notInArray(users.id, blockedIds));
  } else {
    conditions.push(eq(profiles.visibility, "public"));
  }

  const lookingFor = searchParam(params, "lookingFor");
  const ageMin = toInt(searchParam(params, "ageMin"));
  const ageMax = toInt(searchParam(params, "ageMax"));
  const location = searchParam(params, "location");
  const religion = searchParam(params, "religion");
  const community = searchParam(params, "community");
  const motherTongue = searchParam(params, "motherTongue");
  const maritalStatus = searchParam(params, "maritalStatus");
  const education = searchParam(params, "education");
  const profession = searchParam(params, "profession");
  const incomeMin = toInt(searchParam(params, "incomeMin"));
  const heightMin = toInt(searchParam(params, "heightMin"));
  const sort = searchParam(params, "sort") || "recent";

  if (lookingFor) conditions.push(eq(users.gender, lookingFor));
  if (ageMin > 0) conditions.push(lte(users.dateOfBirth, yearsAgoDate(ageMin)));
  if (ageMax > 0) conditions.push(gte(users.dateOfBirth, yearsAgoDate(ageMax + 1)));
  if (location) conditions.push(ilike(profiles.location, `%${location}%`));
  if (religion) conditions.push(ilike(profiles.religion, `%${religion}%`));
  if (community) conditions.push(ilike(profiles.community, `%${community}%`));
  if (motherTongue) conditions.push(ilike(profiles.motherTongue, `%${motherTongue}%`));
  if (maritalStatus) conditions.push(eq(profiles.maritalStatus, maritalStatus));
  if (education) conditions.push(ilike(profiles.education, `%${education}%`));
  if (profession) conditions.push(ilike(profiles.profession, `%${profession}%`));
  if (incomeMin > 0) conditions.push(gte(profiles.income, incomeMin));
  if (heightMin > 0) conditions.push(gte(profiles.heightCm, heightMin));

  const selected = {
    userId: users.id,
    profileId: profiles.id,
    fullName: users.fullName,
    gender: users.gender,
    dateOfBirth: users.dateOfBirth,
    location: profiles.location,
    profession: profiles.profession,
    education: profiles.education,
    religion: profiles.religion,
    community: profiles.community,
    motherTongue: profiles.motherTongue,
    maritalStatus: profiles.maritalStatus,
    income: profiles.income,
    heightCm: profiles.heightCm,
    about: profiles.about,
    headline: profiles.headline,
    profilePhotoUrl: profiles.profilePhotoUrl,
    approvalStatus: profiles.approvalStatus,
    verificationStatus: profiles.verificationStatus,
    visibility: profiles.visibility,
    createdAt: profiles.createdAt,
  };

  const orderBy =
    sort === "age"
      ? [desc(users.dateOfBirth)]
      : sort === "age_desc"
        ? [asc(users.dateOfBirth)]
        : sort === "location"
          ? [asc(profiles.location)]
          : sort === "relevant"
            ? [desc(profiles.verificationStatus), desc(profiles.updatedAt)]
            : [desc(profiles.createdAt)];

  const rows = await db
    .select(selected)
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit + 1)
    .offset(offset);

  return {
    results: rows.slice(0, limit).map(mapProfileCard),
    page,
    hasNext: rows.length > limit,
  };
}

export async function getRecommendedMatches(user: SessionUser | null) {
  if (!user) {
    const recent = await getSearchResults({ sort: "recent" }, null);
    return recent.results.map((profile) => ({ ...profile, matchPercent: 70 }));
  }

  const preference = await getOwnPreferences(user.id);
  const ownProfile = await getOwnProfile(user.id);
  const lookingFor =
    preference?.lookingFor || (user.gender === "Male" ? "Female" : user.gender === "Female" ? "Male" : "");
  const search = await getSearchResults(
    { lookingFor: lookingFor || undefined, sort: "relevant" },
    user.id,
  );

  const scored = search.results.map((profile) => {
    let score = 30;
    if (preference?.ageMin && profile.age && profile.age >= preference.ageMin) score += 8;
    if (preference?.ageMax && profile.age && profile.age <= preference.ageMax) score += 8;
    if (!preference?.ageMin && !preference?.ageMax && profile.age) score += 8;
    if (textIncludes(profile.location, preference?.location || ownProfile?.location)) score += 14;
    if (sameText(profile.religion, preference?.religion || ownProfile?.religion)) score += 12;
    if (sameText(profile.community, preference?.community || ownProfile?.community)) score += 10;
    if (sameText(profile.motherTongue, preference?.motherTongue || ownProfile?.motherTongue)) score += 8;
    if (sameText(profile.maritalStatus, preference?.maritalStatus || ownProfile?.maritalStatus)) score += 8;
    if (textIncludes(profile.education, preference?.education)) score += 6;
    if (textIncludes(profile.profession, preference?.profession)) score += 5;
    if (profile.verificationStatus === "verified") score += 4;
    return { ...profile, matchPercent: Math.min(99, Math.max(50, score)) };
  });

  return scored.sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0));
}

export async function getInterestsData(userId: number) {
  const [sentRows, receivedRows] = await Promise.all([
    db.select().from(interests).where(eq(interests.senderId, userId)).orderBy(desc(interests.createdAt)).limit(50),
    db.select().from(interests).where(eq(interests.receiverId, userId)).orderBy(desc(interests.createdAt)).limit(50),
  ]);

  const sent = await Promise.all(
    sentRows.map(async (interest) => ({ interest, profile: await getMiniProfile(interest.receiverId) })),
  );
  const received = await Promise.all(
    receivedRows.map(async (interest) => ({ interest, profile: await getMiniProfile(interest.senderId) })),
  );

  return { sent, received };
}

export async function getMyMatches(userId: number) {
  const rows = await db
    .select({
      userOneId: matches.userOneId,
      userTwoId: matches.userTwoId,
      score: matches.score,
      createdAt: matches.createdAt,
    })
    .from(matches)
    .where(
      and(
        eq(matches.status, "active"),
        or(eq(matches.userOneId, userId), eq(matches.userTwoId, userId)),
      ),
    )
    .orderBy(desc(matches.createdAt))
    .limit(60);

  return Promise.all(
    rows.map(async (row) => {
      const otherId = row.userOneId === userId ? row.userTwoId : row.userOneId;
      return {
        score: row.score,
        createdAt: row.createdAt,
        profile: await getMiniProfile(otherId),
      };
    }),
  );
}

export async function getShortlistData(userId: number) {
  const rows = await db
    .select()
    .from(shortlists)
    .where(eq(shortlists.userId, userId))
    .orderBy(desc(shortlists.createdAt))
    .limit(60);
  return Promise.all(rows.map(async (row) => ({ shortlist: row, profile: await getMiniProfile(row.shortlistedUserId) })));
}

export async function getConversationList(userId: number) {
  const participantRows = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.userId, userId), isNull(conversationParticipants.deletedAt)))
    .limit(80);

  const ids = participantRows.map((row) => row.conversationId);
  if (ids.length === 0) return [];

  const conversationRows = await db
    .select()
    .from(conversations)
    .where(inArray(conversations.id, ids))
    .orderBy(desc(conversations.updatedAt))
    .limit(80);

  return Promise.all(
    conversationRows.map(async (conversation) => {
      const otherParticipant = await db
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(and(eq(conversationParticipants.conversationId, conversation.id), ne(conversationParticipants.userId, userId)))
        .limit(1);
      const lastMessage = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      const unread = await db
        .select({ value: count() })
        .from(messages)
        .where(and(eq(messages.conversationId, conversation.id), eq(messages.receiverId, userId), isNull(messages.readAt)));

      return {
        conversation,
        other: otherParticipant[0] ? await getMiniProfile(otherParticipant[0].userId) : null,
        lastMessage: lastMessage[0] ?? null,
        unreadCount: unread[0]?.value ?? 0,
      };
    }),
  );
}

export async function getTotalUnreadMessages(userId: number) {
  const rows = await db
    .select({ value: count() })
    .from(messages)
    .where(and(eq(messages.receiverId, userId), isNull(messages.readAt)))
    .limit(1);
  return rows[0]?.value ?? 0;
}

export async function getChat(userId: number, conversationId: number) {
  const participant = await db
    .select({ id: conversationParticipants.id })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId)))
    .limit(1);
  if (!participant[0]) return null;

  const otherParticipant = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, conversationId), ne(conversationParticipants.userId, userId)))
    .limit(1);

  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(and(eq(messages.conversationId, conversationId), eq(messages.receiverId, userId), isNull(messages.readAt)));

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(120);

  const otherId = otherParticipant[0]?.userId;
  let isBlocked = false;
  if (otherId) {
    const blockRows = await db
      .select({ id: blocks.id })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, userId), eq(blocks.blockedUserId, otherId)),
          and(eq(blocks.blockerId, otherId), eq(blocks.blockedUserId, userId)),
        ),
      )
      .limit(1);
    isBlocked = blockRows.length > 0;
  }

  return {
    other: otherId ? await getMiniProfile(otherId) : null,
    messages: rows,
    isBlocked,
  };
}

export async function getNotifications(userId: number) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(80);
}

export async function getUnreadNotificationCount(userId: number) {
  const rows = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .limit(1);
  return rows[0]?.value ?? 0;
}

export async function getPublicProfiles(limit = 8) {
  const rows = await db
    .select({
      userId: users.id,
      profileId: profiles.id,
      fullName: users.fullName,
      gender: users.gender,
      dateOfBirth: users.dateOfBirth,
      location: profiles.location,
      profession: profiles.profession,
      education: profiles.education,
      religion: profiles.religion,
      community: profiles.community,
      motherTongue: profiles.motherTongue,
      maritalStatus: profiles.maritalStatus,
      income: profiles.income,
      heightCm: profiles.heightCm,
      about: profiles.about,
      headline: profiles.headline,
      profilePhotoUrl: profiles.profilePhotoUrl,
      approvalStatus: profiles.approvalStatus,
      verificationStatus: profiles.verificationStatus,
      visibility: profiles.visibility,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .where(and(eq(profiles.approvalStatus, "approved"), eq(users.status, "active"), ne(profiles.visibility, "private")))
    .orderBy(desc(profiles.verificationStatus), desc(profiles.createdAt))
    .limit(limit);
  return rows.map(mapProfileCard);
}

export async function getLatestAnnouncement() {
  const rows = await db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(1);
  return rows[0] ?? null;
}

export async function getAdminDashboardData(search = "") {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [totalUsers, activeUsers, newUsers, verifiedProfiles, pendingReports, pendingInterests, contactCount] =
    await Promise.all([
      db.select({ value: count() }).from(users).where(ne(users.status, "deleted")),
      db.select({ value: count() }).from(users).where(eq(users.status, "active")),
      db.select({ value: count() }).from(users).where(gte(users.createdAt, weekAgo)),
      db.select({ value: count() }).from(profiles).where(eq(profiles.verificationStatus, "verified")),
      db.select({ value: count() }).from(reports).where(eq(reports.status, "pending")),
      db.select({ value: count() }).from(interests).where(eq(interests.status, "pending")),
      db.select({ value: count() }).from(contactMessages).where(eq(contactMessages.status, "new")),
    ]);

  const userConditions: SQL[] = [ne(users.status, "deleted")];
  if (search) {
    userConditions.push(
      or(ilike(users.fullName, `%${search}%`), ilike(users.email, `%${search}%`), ilike(users.mobile, `%${search}%`))!,
    );
  }

  const userRows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      mobile: users.mobile,
      status: users.status,
      role: users.role,
      createdAt: users.createdAt,
      approvalStatus: profiles.approvalStatus,
      verificationStatus: profiles.verificationStatus,
      location: profiles.location,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(and(...userConditions))
    .orderBy(desc(users.createdAt))
    .limit(50);

  const profileRows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      approvalStatus: profiles.approvalStatus,
      verificationStatus: profiles.verificationStatus,
      visibility: profiles.visibility,
      location: profiles.location,
      profession: profiles.profession,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .orderBy(desc(profiles.createdAt))
    .limit(50);

  const reportRows = await db.select().from(reports).orderBy(desc(reports.createdAt)).limit(30);
  const enrichedReports = await Promise.all(
    reportRows.map(async (report) => ({
      report,
      reporter: report.reporterId ? await getMiniProfile(report.reporterId) : null,
      reported: report.reportedUserId ? await getMiniProfile(report.reportedUserId) : null,
    })),
  );

  const announcementRows = await db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(10);
  const adminRows = await db.select().from(adminUsers).where(eq(adminUsers.isActive, true));
  const contactRows = await db.select().from(contactMessages).orderBy(desc(contactMessages.createdAt)).limit(30);
  const recentInterestRows = await db.select().from(interests).orderBy(desc(interests.createdAt)).limit(20);
  const recentInterests = await Promise.all(
    recentInterestRows.map(async (interest) => ({
      interest,
      sender: await getMiniProfile(interest.senderId),
      receiver: await getMiniProfile(interest.receiverId),
    })),
  );

  return {
    stats: {
      totalUsers: totalUsers[0]?.value ?? 0,
      activeUsers: activeUsers[0]?.value ?? 0,
      newUsers: newUsers[0]?.value ?? 0,
      verifiedProfiles: verifiedProfiles[0]?.value ?? 0,
      pendingReports: pendingReports[0]?.value ?? 0,
      pendingInterests: pendingInterests[0]?.value ?? 0,
      newContacts: contactCount[0]?.value ?? 0,
    },
    users: userRows,
    profiles: profileRows,
    reports: enrichedReports,
    announcements: announcementRows,
    admins: adminRows,
    contacts: contactRows,
    recentInterests,
  };
}
