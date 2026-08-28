import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

const ts = (name: string) => integer(name, { mode: "timestamp" }).notNull().$defaultFn(() => new Date());
const tsNull = (name: string) => integer(name, { mode: "timestamp" });
const bool = (name: string, def: number) => integer(name, { mode: "boolean" }).notNull().default(def === 1);

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fullName: text("full_name").notNull(),
    gender: text("gender").notNull(),
    dateOfBirth: text("date_of_birth"),
    email: text("email").notNull().unique(),
    mobile: text("mobile").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    emailVerified: bool("email_verified", 1),
    lastLoginAt: tsNull("last_login_at"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (table) => [index("users_status_idx").on(table.status), index("users_role_idx").on(table.role)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at"),
    lastSeenAt: ts("last_seen_at"),
    createdAt: ts("created_at"),
  },
  (table) => [index("sessions_user_idx").on(table.userId), index("sessions_expires_idx").on(table.expiresAt)],
);

export const profiles = sqliteTable(
  "profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    profilePhotoUrl: text("profile_photo_url"),
    headline: text("headline"),
    about: text("about"),
    familyDetails: text("family_details"),
    lifestyle: text("lifestyle"),
    religion: text("religion"),
    community: text("community"),
    motherTongue: text("mother_tongue"),
    maritalStatus: text("marital_status"),
    education: text("education"),
    profession: text("profession"),
    income: integer("income"),
    location: text("location"),
    heightCm: integer("height_cm"),
    approvalStatus: text("approval_status").notNull().default("approved"),
    verificationStatus: text("verification_status").notNull().default("unverified"),
    visibility: text("visibility").notNull().default("members"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (table) => [
    index("profiles_location_idx").on(table.location),
    index("profiles_religion_idx").on(table.religion),
    index("profiles_community_idx").on(table.community),
  ],
);

export const partnerPreferences = sqliteTable(
  "partner_preferences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
    lookingFor: text("looking_for"),
    ageMin: integer("age_min"),
    ageMax: integer("age_max"),
    location: text("location"),
    religion: text("religion"),
    community: text("community"),
    motherTongue: text("mother_tongue"),
    maritalStatus: text("marital_status"),
    education: text("education"),
    profession: text("profession"),
    incomeMin: integer("income_min"),
    incomeMax: integer("income_max"),
    heightMinCm: integer("height_min_cm"),
    heightMaxCm: integer("height_max_cm"),
    description: text("description"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
);

export const privacySettings = sqliteTable(
  "privacy_settings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
    hidePhone: bool("hide_phone", 1),
    hideEmail: bool("hide_email", 1),
    profileVisibility: text("profile_visibility").notNull().default("members"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
);

export const interests = sqliteTable(
  "interests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    senderId: integer("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    receiverId: integer("receiver_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    message: text("message"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (table) => [
    uniqueIndex("interests_pair_idx").on(table.senderId, table.receiverId),
    index("interests_sender_idx").on(table.senderId),
    index("interests_receiver_idx").on(table.receiverId),
  ],
);

export const matches = sqliteTable(
  "matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userOneId: integer("user_one_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    userTwoId: integer("user_two_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    interestId: integer("interest_id").references(() => interests.id, { onDelete: "set null" }),
    score: integer("score").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: ts("created_at"),
  },
  (table) => [uniqueIndex("matches_pair_idx").on(table.userOneId, table.userTwoId)],
);

export const shortlists = sqliteTable(
  "shortlists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shortlistedUserId: integer("shortlisted_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at"),
  },
  (table) => [uniqueIndex("shortlists_pair_idx").on(table.userId, table.shortlistedUserId)],
);

export const blocks = sqliteTable(
  "blocks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    blockerId: integer("blocker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    blockedUserId: integer("blocked_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    createdAt: ts("created_at"),
  },
  (table) => [uniqueIndex("blocks_pair_idx").on(table.blockerId, table.blockedUserId)],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    status: text("status").notNull().default("active"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
);

export const conversationParticipants = sqliteTable(
  "conversation_participants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deletedAt: tsNull("deleted_at"),
    createdAt: ts("created_at"),
  },
  (table) => [
    uniqueIndex("conv_participants_pair_idx").on(table.conversationId, table.userId),
    index("conv_participants_user_idx").on(table.userId),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    senderId: integer("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    receiverId: integer("receiver_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    readAt: tsNull("read_at"),
    createdAt: ts("created_at"),
  },
  (table) => [index("messages_conversation_idx").on(table.conversationId)],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    linkUrl: text("link_url"),
    readAt: tsNull("read_at"),
    createdAt: ts("created_at"),
  },
  (table) => [index("notifications_user_idx").on(table.userId)],
);

export const reports = sqliteTable(
  "reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reporterId: integer("reporter_id").references(() => users.id, { onDelete: "set null" }),
    reportedUserId: integer("reported_user_id").references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    details: text("details"),
    status: text("status").notNull().default("pending"),
    adminNote: text("admin_note"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (table) => [index("reports_status_idx").on(table.status)],
);

export const announcements = sqliteTable(
  "announcements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audience: text("audience").notNull().default("all"),
    createdAt: ts("created_at"),
  },
);

export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    role: text("role").notNull().default("owner"),
    isActive: bool("is_active", 1),
    createdAt: ts("created_at"),
  },
);

export const contactMessages = sqliteTable(
  "contact_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    message: text("message").notNull(),
    status: text("status").notNull().default("new"),
    createdAt: ts("created_at"),
  },
);

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type PartnerPreference = typeof partnerPreferences.$inferSelect;
export type Interest = typeof interests.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Report = typeof reports.$inferSelect;
