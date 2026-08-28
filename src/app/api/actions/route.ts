import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  adminUsers,
  announcements,
  blocks,
  contactMessages,
  conversationParticipants,
  conversations,
  interests,
  messages,
  notifications,
  partnerPreferences,
  privacySettings,
  profiles,
  reports,
  shortlists,
  users,
} from "@/db/schema";
import {
  clearSessionCookie,
  createSession,
  ensureAdminUser,
  getCurrentUser,
  isAdminUser,
  setSessionCookie,
} from "@/lib/auth";
import {
  canUsersMessage,
  createMatchForAcceptedInterest,
  createNotification,
  findOrCreateConversation,
  getOtherParticipant,
} from "@/lib/mutations";
import {
  cleanPhone,
  getBool,
  getInt,
  getOptionalString,
  getString,
  normalizeEmail,
  safeReturnTo,
} from "@/lib/utils";
import { hashPassword, isStrongPassword, verifyPassword } from "@/lib/security";
import { redirectWithMessage } from "@/lib/utils";
import { REPORT_REASONS as REPORT_REASONS_LIST } from "@/lib/report-reasons";
const REPORT_REASONS = REPORT_REASONS_LIST as unknown as string[];

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ActionResult = { ok: boolean; message: string; redirectTo?: string };

function ok(message: string, redirectTo?: string): NextResponse {
  return NextResponse.json<ActionResult>({ ok: true, message, ...(redirectTo ? { redirectTo } : {}) });
}
function fail(message: string): NextResponse {
  return NextResponse.json<ActionResult>({ ok: false, message });
}

/* ------------------------------ AUTH ------------------------------ */

async function handleRegister(formData: FormData) {
  const fullName = getString(formData, "fullName");
  const gender = getString(formData, "gender");
  const dateOfBirth = getOptionalString(formData, "dateOfBirth");
  const email = normalizeEmail(getString(formData, "email"));
  const mobile = cleanPhone(getString(formData, "mobile"));
  const password = getString(formData, "password");

  if (fullName.length < 3) return fail("Please enter your full name.");
  if (!["Female", "Male", "Other"].includes(gender)) return fail("Please select your gender.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Please enter a valid email address.");
  if (mobile.replace("+91", "").length < 10) return fail("Please enter a valid 10-digit mobile number.");
  if (!isStrongPassword(password))
    return fail("Password must be at least 8 characters and include letters and numbers.");

  const emailTaken =
    (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)).length > 0;
  const mobileTaken =
    (await db.select({ id: users.id }).from(users).where(eq(users.mobile, mobile)).limit(1)).length > 0;
  if (emailTaken) return fail("An account with this email already exists. Please login instead.");
  if (mobileTaken) return fail("An account with this mobile number already exists.");

  const location = getOptionalString(formData, "location");
  const religion = getOptionalString(formData, "religion");
  const community = getOptionalString(formData, "community");
  const motherTongue = getOptionalString(formData, "motherTongue");
  const education = getOptionalString(formData, "education");
  const profession = getOptionalString(formData, "profession");
  const maritalStatus = getOptionalString(formData, "maritalStatus");
  const heightCm = getInt(formData, "heightCm");
  const income = getInt(formData, "income");
  const headline = getOptionalString(formData, "headline");
  const lookingFor = getOptionalString(formData, "lookingFor");

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        fullName,
        gender,
        dateOfBirth,
        email,
        mobile,
        passwordHash: hashPassword(password),
        role: "member",
        status: "active",
        emailVerified: true,
      })
      .returning({ id: users.id });
    const userId = inserted[0]!.id;

    await tx.insert(profiles).values({
      userId,
      displayName: fullName,
      location,
      religion,
      community,
      motherTongue,
      education,
      profession,
      maritalStatus,
      heightCm,
      income,
      headline,
      approvalStatus: "approved",
      verificationStatus: "unverified",
      visibility: "members",
    });

    await tx.insert(privacySettings).values({
      userId,
      hidePhone: true,
      hideEmail: true,
      profileVisibility: "members",
    });

    await tx
      .insert(partnerPreferences)
      .values({
        userId,
        lookingFor: lookingFor ?? (gender === "Male" ? "Female" : gender === "Female" ? "Male" : null),
      });
  });

  const user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0]!;
  const { token, expiresAt } = await createSession(user.id);
  await setSessionCookie(token, expiresAt);
  return ok("Welcome to PANIKA JEEVAN SATHI!", redirectWithMessage("/dashboard", "notice", "Your account is ready. Complete your profile to get better matches."));
}

async function handleLogin(formData: FormData) {
  const email = normalizeEmail(getString(formData, "email"));
  const password = getString(formData, "password");
  const returnTo = safeReturnTo(getOptionalString(formData, "returnTo"), "/dashboard");

  if (!email || !password) return fail("Please enter your email and password.");

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return fail("Invalid email or password.");
  }
  if (user.status === "suspended") return fail("Your account is suspended. Please contact support on WhatsApp.");
  if (user.status === "deleted") return fail("This account is no longer active.");

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const { token, expiresAt } = await createSession(user.id);
  await setSessionCookie(token, expiresAt);
  return ok("Login successful.", returnTo);
}

async function handleLogout() {
  await clearSessionCookie();
  return ok("You have been logged out.", "/");
}

/* --------------------------- PROFILE --------------------------- */

const PROFILE_FIELDS = [
  "headline",
  "about",
  "familyDetails",
  "lifestyle",
  "religion",
  "community",
  "motherTongue",
  "maritalStatus",
  "education",
  "profession",
  "location",
] as const;

async function handleUpdateProfile(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const field of PROFILE_FIELDS) {
    updates[field] = getOptionalString(formData, field);
  }
  updates.income = getInt(formData, "income");
  updates.heightCm = getInt(formData, "heightCm");
  if (getBool(formData, "deletePhoto")) updates.profilePhotoUrl = null;

  const photoUrl = getOptionalString(formData, "profilePhotoUrl");
  if (photoUrl) updates.profilePhotoUrl = photoUrl;

  const fullName = getString(formData, "fullName");
  if (fullName && fullName !== viewer.fullName) {
    updates.displayName = fullName.slice(0, 160);
  }

  await db.update(profiles).set(updates).where(eq(profiles.userId, viewer.id));

  const dob = getOptionalString(formData, "dateOfBirth");
  if (dob || (fullName && fullName !== viewer.fullName)) {
    await db
      .update(users)
      .set({
        ...(dob ? { dateOfBirth: dob } : {}),
        ...(fullName && fullName !== viewer.fullName ? { fullName: fullName.slice(0, 160) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, viewer.id));
  }

  return ok("Your profile has been updated.", redirectWithMessage("/profile", "notice", "Profile saved successfully."));
}

async function handleUpdatePreferences(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");

  const values = {
    lookingFor: getOptionalString(formData, "lookingFor"),
    ageMin: getInt(formData, "ageMin"),
    ageMax: getInt(formData, "ageMax"),
    location: getOptionalString(formData, "location"),
    religion: getOptionalString(formData, "religion"),
    community: getOptionalString(formData, "community"),
    motherTongue: getOptionalString(formData, "motherTongue"),
    maritalStatus: getOptionalString(formData, "maritalStatus"),
    education: getOptionalString(formData, "education"),
    profession: getOptionalString(formData, "profession"),
    incomeMin: getInt(formData, "incomeMin"),
    incomeMax: getInt(formData, "incomeMax"),
    heightMinCm: getInt(formData, "heightMinCm"),
    heightMaxCm: getInt(formData, "heightMaxCm"),
    description: getOptionalString(formData, "description"),
    updatedAt: new Date(),
  };

  await db
    .insert(partnerPreferences)
    .values({ userId: viewer.id, ...values })
    .onConflictDoUpdate({ target: partnerPreferences.userId, set: values });

  return ok("Partner preferences saved.", redirectWithMessage("/preferences", "notice", "Your partner preferences have been saved."));
}

async function handleChangePassword(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");

  const currentPassword = getString(formData, "currentPassword");
  const newPassword = getString(formData, "newPassword");
  const rows = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, viewer.id)).limit(1);
  const user = rows[0];
  if (!user) return fail("Account not found.");
  if (!verifyPassword(currentPassword, user.passwordHash)) return fail("Current password is incorrect.");
  if (!isStrongPassword(newPassword))
    return fail("New password must be at least 8 characters and include letters and numbers.");

  await db.update(users).set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() }).where(eq(users.id, viewer.id));
  return ok("Password changed.", redirectWithMessage("/settings", "notice", "Your password has been updated."));
}

async function handleUpdatePrivacy(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");

  const values = {
    hidePhone: getBool(formData, "hidePhone"),
    hideEmail: getBool(formData, "hideEmail"),
    profileVisibility: getString(formData, "profileVisibility") === "public" ? "public" : "members",
    updatedAt: new Date(),
  };

  await db
    .insert(privacySettings)
    .values({ userId: viewer.id, ...values })
    .onConflictDoUpdate({ target: privacySettings.userId, set: values });
  await db.update(profiles).set({ visibility: values.profileVisibility, updatedAt: new Date() }).where(eq(profiles.userId, viewer.id));

  return ok("Privacy settings saved.", redirectWithMessage("/settings", "notice", "Privacy settings updated."));
}

async function handleDeleteAccount(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");
  const confirm = getString(formData, "confirmName");
  if (confirm.toLowerCase() !== viewer.fullName.toLowerCase()) {
    return fail(`Please type your full name exactly (${viewer.fullName}) to confirm.`);
  }
  await db.update(users).set({ status: "deleted", updatedAt: new Date() }).where(eq(users.id, viewer.id));
  await db.delete(users).where(eq(users.id, viewer.id)).execute();
  await clearSessionCookie();
  return ok("Your account has been deleted.", "/");
}

/* --------------------------- INTERESTS --------------------------- */

async function handleSendInterest(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");

  const receiverId = getInt(formData, "receiverId");
  const message = getOptionalString(formData, "message") || undefined;
  if (!receiverId || receiverId === viewer.id) return fail("Invalid profile.");

  const target = (await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, receiverId)).limit(1))[0];
  if (!target || target.status !== "active") return fail("This profile is not available.");

  const blockRows = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      or(and(eq(blocks.blockerId, viewer.id), eq(blocks.blockedUserId, receiverId)), and(eq(blocks.blockerId, receiverId), eq(blocks.blockedUserId, viewer.id))),
    )
    .limit(1);
  if (blockRows.length > 0) return fail("You cannot send interest to this profile.");

  const existing = await db
    .select({ id: interests.id, status: interests.status, message: interests.message })
    .from(interests)
    .where(and(eq(interests.senderId, viewer.id), eq(interests.receiverId, receiverId)))
    .limit(1);
  if (existing[0] && existing[0].status !== "rejected") return fail("You have already sent interest to this profile.");

  await db
    .insert(interests)
    .values({ senderId: viewer.id, receiverId, status: "pending", message })
    .onConflictDoUpdate({
      target: [interests.senderId, interests.receiverId],
      set: { status: "pending", message: message ?? existing[0]?.message, updatedAt: new Date() },
    });

  await createNotification({
    userId: receiverId,
    actorId: viewer.id,
    type: "interest_received",
    title: "You received an interest",
    body: `${viewer.fullName} is interested in your profile.`,
    linkUrl: "/interests",
  });

  return ok("Interest sent!", redirectWithMessage(`/profile/${receiverId}`, "notice", "Your interest has been sent."));
}

async function handleInterestStatus(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");

  const interestId = getInt(formData, "interestId");
  const status = getString(formData, "status");
  if (!interestId) return fail("Invalid request.");

  const rows = await db.select().from(interests).where(and(eq(interests.id, interestId), eq(interests.receiverId, viewer.id))).limit(1);
  const interest = rows[0];
  if (!interest) return fail("This interest is not available for you to respond to.");
  if (interest.status !== "pending") return fail("This interest has already been responded to.");

  if (status === "accept") {
    await db.update(interests).set({ status: "accepted", updatedAt: new Date() }).where(eq(interests.id, interest.id));
    const conversationId = await createMatchForAcceptedInterest(interest.id, interest.senderId, interest.receiverId, 95);
    await createNotification({
      userId: interest.senderId,
      actorId: viewer.id,
      type: "interest_accepted",
      title: "Your interest was accepted 🎉",
      body: `${viewer.fullName} accepted your interest. You can now chat!`,
      linkUrl: conversationId ? `/messages/${conversationId}` : "/matches",
    });
    return ok("Interest accepted.", redirectWithMessage("/interests", "notice", "Interest accepted. You can now start a conversation."));
  }

  if (status === "reject") {
    await db.update(interests).set({ status: "rejected", updatedAt: new Date() }).where(eq(interests.id, interest.id));
    await createNotification({
      userId: interest.senderId,
      actorId: viewer.id,
      type: "interest_rejected",
      title: "Interest not accepted",
      body: `${viewer.fullName} did not accept your interest. Wishing you the best!`,
      linkUrl: "/find-matches",
    });
    return ok("Interest declined.", redirectWithMessage("/interests", "notice", "You have declined the interest."));
  }

  return fail("Invalid action.");
}

async function handleCancelInterest(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");
  const interestId = getInt(formData, "interestId");
  if (!interestId) return fail("Invalid request.");

  const rows = await db
    .select()
    .from(interests)
    .where(and(eq(interests.id, interestId), eq(interests.senderId, viewer.id)))
    .limit(1);
  const interest = rows[0];
  if (!interest) return fail("Interest not found.");
  if (interest.status === "accepted") return fail("Accepted interests cannot be cancelled.");

  await db.delete(interests).where(eq(interests.id, interest.id));
  return ok("Interest cancelled.", redirectWithMessage("/interests", "notice", "Your interest has been cancelled."));
}

/* --------------------------- SHORTLIST --------------------------- */

async function handleShortlist(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");
  const profileUserId = getInt(formData, "profileUserId");
  if (!profileUserId || profileUserId === viewer.id) return fail("Invalid profile.");

  const existing = await db
    .select({ id: shortlists.id })
    .from(shortlists)
    .where(and(eq(shortlists.userId, viewer.id), eq(shortlists.shortlistedUserId, profileUserId)))
    .limit(1);

  if (existing[0]) {
    await db.delete(shortlists).where(eq(shortlists.id, existing[0].id));
    return ok("Removed from shortlist.", redirectWithMessage("/shortlist", "notice", "Profile removed from your shortlist."));
  }

  await db.insert(shortlists).values({ userId: viewer.id, shortlistedUserId: profileUserId });
  await createNotification({
    userId: profileUserId,
    actorId: viewer.id,
    type: "shortlisted",
    title: "You were shortlisted",
    body: `${viewer.fullName} added you to their shortlist.`,
    linkUrl: "/shortlist",
  });
  return ok("Added to shortlist.", redirectWithMessage("/shortlist", "notice", "Profile added to your shortlist."));
}

/* --------------------------- MESSAGING --------------------------- */

async function handleStartConversation(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");
  const profileUserId = getInt(formData, "profileUserId");
  if (!profileUserId || profileUserId === viewer.id) return fail("Invalid profile.");

  const allowed = await canUsersMessage(viewer.id, profileUserId);
  if (!allowed) return fail("You can message this person only after an interest has been accepted.");

  const conversationId = await findOrCreateConversation(viewer.id, profileUserId);
  return ok("Conversation started.", `/messages/${conversationId}`);
}

async function handleSendMessage(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");

  const conversationId = getInt(formData, "conversationId");
  const content = getString(formData, "content").slice(0, 2000);
  if (!conversationId || content.length === 0) return fail("Please write a message first.");

  const participant = await db
    .select({ id: conversationParticipants.id })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, viewer.id)))
    .limit(1);
  if (!participant[0]) return fail("You are not part of this conversation.");

  const otherId = await getOtherParticipant(conversationId, viewer.id);
  if (!otherId) return fail("This conversation is not available.");

  const blockRows = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      or(and(eq(blocks.blockerId, viewer.id), eq(blocks.blockedUserId, otherId)), and(eq(blocks.blockerId, otherId), eq(blocks.blockedUserId, viewer.id))),
    )
    .limit(1);
  if (blockRows.length > 0) return fail("Messaging is blocked for this conversation.");

  await db.insert(messages).values({
    conversationId,
    senderId: viewer.id,
    receiverId: otherId,
    content,
  });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));

  await createNotification({
    userId: otherId,
    actorId: viewer.id,
    type: "new_message",
    title: "New message",
    body: `${viewer.fullName} sent you a message.`,
    linkUrl: `/messages/${conversationId}`,
  });

  return ok("Message sent.", `/messages/${conversationId}?sent=1`);
}

async function handleDeleteConversation(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");
  const conversationId = getInt(formData, "conversationId");
  if (!conversationId) return fail("Invalid conversation.");

  await db
    .update(conversationParticipants)
    .set({ deletedAt: new Date() })
    .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, viewer.id)));
  return ok("Conversation deleted.", "/messages");
}

/* --------------------------- SOCIAL --------------------------- */


async function handleReportProfile(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");

  const reportedUserId = getInt(formData, "profileUserId");
  const reason = getString(formData, "reason");
  const details = getOptionalString(formData, "details");
  if (!reportedUserId || reportedUserId === viewer.id) return fail("Invalid profile.");
  if (!REPORT_REASONS.includes(reason)) return fail("Please select a valid reason.");

  await db.insert(reports).values({
    reporterId: viewer.id,
    reportedUserId,
    reason,
    details,
    status: "pending",
  });
  return ok("Thank you. Our team will review this profile shortly.", redirectWithMessage(`/profile/${reportedUserId}`, "notice", "Your report has been submitted."));
}

async function handleBlockUser(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");
  const targetId = getInt(formData, "profileUserId");
  if (!targetId || targetId === viewer.id) return fail("Invalid profile.");

  await db
    .insert(blocks)
    .values({ blockerId: viewer.id, blockedUserId: targetId })
    .onConflictDoNothing();
  return ok("User blocked.", redirectWithMessage("/settings", "notice", "This user has been blocked. You will no longer see their profiles."));
}

async function handleUnblockUser(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");
  const targetId = getInt(formData, "profileUserId");
  if (!targetId) return fail("Invalid user.");

  await db.delete(blocks).where(and(eq(blocks.blockerId, viewer.id), eq(blocks.blockedUserId, targetId)));
  return ok("User unblocked.", redirectWithMessage("/settings", "notice", "This user has been unblocked."));
}

/* --------------------------- NOTIFICATIONS --------------------------- */

async function handleNotificationAction(formData: FormData) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail("Please login first.");

  const action = getString(formData, "subAction");
  const notificationId = getInt(formData, "notificationId");

  if (action === "markAll") {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, viewer.id), isNull(notifications.readAt)));
    return ok("All notifications marked as read.", "/notifications");
  }
  if (action === "markRead" && notificationId) {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, viewer.id)));
    return ok("Notification marked as read.", "/notifications");
  }
  return fail("Invalid action.");
}

/* --------------------------- CONTACT --------------------------- */

async function handleContactMessage(formData: FormData) {
  const name = getString(formData, "name").slice(0, 160);
  const email = normalizeEmail(getString(formData, "email")).slice(0, 255);
  const phone = cleanPhone(getString(formData, "phone")).slice(0, 32) || null;
  const message = getString(formData, "message").slice(0, 2000);

  if (name.length < 2) return fail("Please enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Please enter a valid email address.");
  if (message.length < 5) return fail("Please write a short message.");

  await db.insert(contactMessages).values({ name, email, phone, message, status: "new" });
  return ok("Message sent! We usually reply within 24 hours.", redirectWithMessage("/contact", "notice", "Thank you for reaching out. Our team will get back to you soon."));
}

/* --------------------------- ADMIN --------------------------- */

async function requireAdminOrFail() {
  const viewer = await getCurrentUser();
  if (!viewer) return null;
  const admin = await isAdminUser(viewer);
  if (!admin) return null;
  return ensureAdminUser(viewer);
}

async function handleAdminUserAction(formData: FormData) {
  const viewer = await requireAdminOrFail();
  if (!viewer) return fail("Admin access only.");

  const targetId = getInt(formData, "userId");
  const action = getString(formData, "subAction");
  if (!targetId) return fail("Invalid user.");
  const target = (await db.select().from(users).where(eq(users.id, targetId)).limit(1))[0];
  if (!target) return fail("User not found.");
  if (targetId === viewer.id) return fail("You cannot modify your own account here.");

  switch (action) {
    case "suspend":
      await db.update(users).set({ status: "suspended", updatedAt: new Date() }).where(eq(users.id, targetId));
      return ok(`${target.fullName} has been suspended.`, "/admin");
    case "activate":
      await db.update(users).set({ status: "active", updatedAt: new Date() }).where(eq(users.id, targetId));
      return ok(`${target.fullName} has been activated.`, "/admin");
    case "delete":
      await db.delete(users).where(eq(users.id, targetId));
      return ok(`${target.fullName} has been deleted.`, "/admin");
    case "makeAdmin":
      await db.update(users).set({ role: "admin", updatedAt: new Date() }).where(eq(users.id, targetId));
      await db.insert(adminUsers).values({ userId: targetId, name: target.fullName, email: target.email, role: "admin", isActive: true }).onConflictDoNothing();
      return ok(`${target.fullName} is now an admin.`, "/admin");
    case "removeAdmin":
      await db.update(users).set({ role: "member", updatedAt: new Date() }).where(eq(users.id, targetId));
      await db.delete(adminUsers).where(eq(adminUsers.userId, targetId));
      return ok(`${target.fullName} is no longer an admin.`, "/admin");
    default:
      return fail("Invalid action.");
  }
}

async function handleAdminProfileAction(formData: FormData) {
  const viewer = await requireAdminOrFail();
  if (!viewer) return fail("Admin access only.");

  const targetId = getInt(formData, "userId");
  const action = getString(formData, "subAction");
  if (!targetId) return fail("Invalid profile.");

  switch (action) {
    case "approve":
      await db.update(profiles).set({ approvalStatus: "approved", updatedAt: new Date() }).where(eq(profiles.userId, targetId));
      return ok("Profile approved.", "/admin");
    case "suspend":
      await db.update(profiles).set({ approvalStatus: "suspended", updatedAt: new Date() }).where(eq(profiles.userId, targetId));
      return ok("Profile suspended.", "/admin");
    case "verify":
      await db.update(profiles).set({ verificationStatus: "verified", updatedAt: new Date() }).where(eq(profiles.userId, targetId));
      return ok("Profile marked as verified.", "/admin");
    case "unverify":
      await db.update(profiles).set({ verificationStatus: "unverified", updatedAt: new Date() }).where(eq(profiles.userId, targetId));
      return ok("Verification removed.", "/admin");
    default:
      return fail("Invalid action.");
  }
}

async function handleAdminReportAction(formData: FormData) {
  const viewer = await requireAdminOrFail();
  if (!viewer) return fail("Admin access only.");

  const reportId = getInt(formData, "reportId");
  const action = getString(formData, "subAction");
  const adminNote = getOptionalString(formData, "adminNote");
  if (!reportId) return fail("Invalid report.");

  const report = (await db.select().from(reports).where(eq(reports.id, reportId)).limit(1))[0];
  if (!report) return fail("Report not found.");

  if (action === "resolve") {
    await db.update(reports).set({ status: "resolved", adminNote, updatedAt: new Date() }).where(eq(reports.id, reportId));
    if (report.reportedUserId) {
      await createNotification({
        userId: report.reportedUserId,
        type: "report_resolved",
        title: "Your report was reviewed",
        body: "Our team has reviewed the report. Thank you for helping keep the community safe.",
        linkUrl: "/safety",
      });
    }
    return ok("Report marked as resolved.", "/admin");
  }

  if (action === "dismiss") {
    await db.update(reports).set({ status: "dismissed", adminNote, updatedAt: new Date() }).where(eq(reports.id, reportId));
    return ok("Report dismissed.", "/admin");
  }

  if (action === "suspendUser" && report.reportedUserId) {
    await db.update(users).set({ status: "suspended", updatedAt: new Date() }).where(eq(users.id, report.reportedUserId));
    await db.update(reports).set({ status: "resolved", adminNote, updatedAt: new Date() }).where(eq(reports.id, reportId));
    return ok("Report resolved and user suspended.", "/admin");
  }

  return fail("Invalid action.");
}

async function handleAdminAnnouncement(formData: FormData) {
  const viewer = await requireAdminOrFail();
  if (!viewer) return fail("Admin access only.");

  const title = getString(formData, "title").slice(0, 180);
  const body = getString(formData, "body").slice(0, 1000);
  const audience = getString(formData, "audience") === "members" ? "members" : "all";
  if (title.length < 3) return fail("Please enter a title.");
  if (body.length < 3) return fail("Please enter the announcement text.");

  await db.insert(announcements).values({ title, body, audience });
  return ok("Announcement published.", redirectWithMessage("/admin", "notice", "Announcement published."));
}

async function handleAdminDeleteAnnouncement(formData: FormData) {
  const viewer = await requireAdminOrFail();
  if (!viewer) return fail("Admin access only.");
  const id = getInt(formData, "announcementId");
  if (!id) return fail("Invalid announcement.");
  await db.delete(announcements).where(eq(announcements.id, id));
  return ok("Announcement deleted.", "/admin");
}

async function handleAdminContactAction(formData: FormData) {
  const viewer = await requireAdminOrFail();
  if (!viewer) return fail("Admin access only.");
  const messageId = getInt(formData, "messageId");
  const action = getString(formData, "subAction");
  if (!messageId) return fail("Invalid message.");
  const status = action === "read" ? "read" : action === "reopen" ? "new" : "read";
  await db.update(contactMessages).set({ status }).where(eq(contactMessages.id, messageId));
  return ok("Contact message updated.", "/admin");
}

async function handleAdminDeleteContact(formData: FormData) {
  const viewer = await requireAdminOrFail();
  if (!viewer) return fail("Admin access only.");
  const messageId = getInt(formData, "messageId");
  if (!messageId) return fail("Invalid message.");
  await db.delete(contactMessages).where(eq(contactMessages.id, messageId));
  return ok("Message deleted.", "/admin");
}

/* --------------------------- ROUTE --------------------------- */

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const action = getString(formData, "action");

    switch (action) {
      case "register":
        return await handleRegister(formData);
      case "login":
        return await handleLogin(formData);
      case "logout":
        return await handleLogout();
      case "updateProfile":
        return await handleUpdateProfile(formData);
      case "updatePreferences":
        return await handleUpdatePreferences(formData);
      case "changePassword":
        return await handleChangePassword(formData);
      case "updatePrivacy":
        return await handleUpdatePrivacy(formData);
      case "deleteAccount":
        return await handleDeleteAccount(formData);
      case "sendInterest":
        return await handleSendInterest(formData);
      case "interestStatus":
        return await handleInterestStatus(formData);
      case "cancelInterest":
        return await handleCancelInterest(formData);
      case "shortlist":
        return await handleShortlist(formData);
      case "startConversation":
        return await handleStartConversation(formData);
      case "sendMessage":
        return await handleSendMessage(formData);
      case "deleteConversation":
        return await handleDeleteConversation(formData);
      case "reportProfile":
        return await handleReportProfile(formData);
      case "blockUser":
        return await handleBlockUser(formData);
      case "unblockUser":
        return await handleUnblockUser(formData);
      case "notificationAction":
        return await handleNotificationAction(formData);
      case "contactMessage":
        return await handleContactMessage(formData);
      case "adminUserAction":
        return await handleAdminUserAction(formData);
      case "adminProfileAction":
        return await handleAdminProfileAction(formData);
      case "adminReportAction":
        return await handleAdminReportAction(formData);
      case "adminAnnouncement":
        return await handleAdminAnnouncement(formData);
      case "adminDeleteAnnouncement":
        return await handleAdminDeleteAnnouncement(formData);
      case "adminContactAction":
        return await handleAdminContactAction(formData);
      case "adminDeleteContact":
        return await handleAdminDeleteContact(formData);
      default:
        return fail("Unknown action.");
    }
  } catch (error) {
    console.error("[Panika Jeevan Sathi] Action error:", error);
    return fail("Something went wrong. Please try again.");
  }
}

