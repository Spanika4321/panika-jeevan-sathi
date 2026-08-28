import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { openNodeSQLite } from "./sqlite-shim";
import * as schema from "./schema";
import { ADMIN_EMAIL, ADMIN_NAME } from "@/lib/constants";
import { hashPassword } from "@/lib/security";

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const sqlite = openNodeSQLite(path.join(dataDir, "panika.db"));

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  gender TEXT NOT NULL,
  date_of_birth TEXT,
  email TEXT NOT NULL UNIQUE,
  mobile TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  email_verified INTEGER NOT NULL DEFAULT 1,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  profile_photo_url TEXT,
  headline TEXT,
  about TEXT,
  family_details TEXT,
  lifestyle TEXT,
  religion TEXT,
  community TEXT,
  mother_tongue TEXT,
  marital_status TEXT,
  education TEXT,
  profession TEXT,
  income INTEGER,
  location TEXT,
  height_cm INTEGER,
  approval_status TEXT NOT NULL DEFAULT 'approved',
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  visibility TEXT NOT NULL DEFAULT 'members',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS partner_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  looking_for TEXT,
  age_min INTEGER,
  age_max INTEGER,
  location TEXT,
  religion TEXT,
  community TEXT,
  mother_tongue TEXT,
  marital_status TEXT,
  education TEXT,
  profession TEXT,
  income_min INTEGER,
  income_max INTEGER,
  height_min_cm INTEGER,
  height_max_cm INTEGER,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS privacy_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  hide_phone INTEGER NOT NULL DEFAULT 1,
  hide_email INTEGER NOT NULL DEFAULT 1,
  profile_visibility TEXT NOT NULL DEFAULT 'members',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS interests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(sender_id, receiver_id)
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_one_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_two_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_id INTEGER REFERENCES interests(id) ON DELETE SET NULL,
  score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  UNIQUE(user_one_id, user_two_id)
);
CREATE TABLE IF NOT EXISTS shortlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shortlisted_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, shortlisted_user_id)
);
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(blocker_id, blocked_user_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link_url TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reported_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'owner',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_location ON profiles(location);
CREATE INDEX IF NOT EXISTS idx_profiles_religion ON profiles(religion);
CREATE INDEX IF NOT EXISTS idx_interests_sender ON interests(sender_id);
CREATE INDEX IF NOT EXISTS idx_interests_receiver ON interests(receiver_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
`;

sqlite.exec(DDL);

export const db = drizzle(sqlite, { schema });

/* ------------------------------------------------------------------ */
/* First-run seeding: admin account + sample members so search,        */
/* recommendations and the public home page work out of the box.       */
/* ------------------------------------------------------------------ */

const now = Math.floor(Date.now() / 1000);
const iso = (yearsAgo: number, month = 0, day = 15) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  d.setMonth(month);
  d.setDate(day);
  return d.toISOString().slice(0, 10);
};

type SeedProfile = {
  name: string;
  gender: string;
  dob: string;
  email: string;
  mobile: string;
  location: string;
  religion: string;
  community: string;
  motherTongue: string;
  education: string;
  profession: string;
  income: number;
  heightCm: number;
  maritalStatus: string;
  headline: string;
  about: string;
  family: string;
  lifestyle: string;
  photo: string;
  visibility: "members" | "public";
  verified: boolean;
};

const SEED_PROFILES: SeedProfile[] = [
  {
    name: "Ananya Sharma",
    gender: "Female",
    dob: iso(26, 2, 12),
    email: "ananya.sharma@member.example",
    mobile: "9812000101",
    location: "Mumbai, Maharashtra",
    religion: "Hindu",
    community: "Brahmin",
    motherTongue: "Hindi",
    education: "B.Tech (Computer Science)",
    profession: "Software Engineer",
    income: 1400000,
    heightCm: 165,
    maritalStatus: "Never Married",
    headline: "Software engineer who loves classical music, travel and good conversations.",
    about:
      "I work as a software engineer in Mumbai and enjoy building things that help people. I am a family-oriented person who values honesty, respect and a sense of humour. On weekends you will find me exploring new cafes, listening to classical music or planning a trip.",
    family: "I come from a small, close-knit family in Delhi. My father is a retired bank manager and my mother is a homemaker. I have one younger brother who works in banking.",
    lifestyle: "Non-smoker, social drinker only at festivals. I keep a simple, healthy lifestyle and enjoy cooking traditional dishes on special occasions.",
    photo: "/seed/f1.jpg",
    visibility: "public",
    verified: true,
  },
  {
    name: "Priya Patel",
    gender: "Female",
    dob: iso(28, 6, 3),
    email: "priya.patel@member.example",
    mobile: "9812000102",
    location: "Ahmedabad, Gujarat",
    religion: "Hindu",
    community: "Patel",
    motherTongue: "Gujarati",
    education: "B.Com, CA",
    profession: "Finance Analyst",
    income: 950000,
    heightCm: 160,
    maritalStatus: "Never Married",
    headline: "CA by profession, foodie by passion — looking for an equal partner.",
    about:
      "I work in finance in Ahmedabad and love numbers as much as I love food. I believe a good relationship is built on mutual respect, shared goals and lots of laughter. I am easy-going and value family above everything.",
    family: "We are a family of five — father runs a textile business, mother manages the home, and I have two younger sisters.",
    lifestyle: "I do not smoke and do not drink. I enjoy Gujarati cuisine, yoga and long family dinners.",
    photo: "/seed/f2.jpg",
    visibility: "public",
    verified: true,
  },
  {
    name: "Sana Khan",
    gender: "Female",
    dob: iso(27, 9, 21),
    email: "sana.khan@member.example",
    mobile: "9812000103",
    location: "Lucknow, Uttar Pradesh",
    religion: "Muslim",
    community: "Sunni",
    motherTongue: "Urdu",
    education: "MBBS",
    profession: "Doctor",
    income: 1200000,
    heightCm: 162,
    maritalStatus: "Never Married",
    headline: "Doctor from Lucknow who values kindness and a respectful home.",
    about:
      "I am a medical practitioner in Lucknow. Medicine taught me patience and empathy, and I look for a partner who values the same. I love Urdu poetry, travelling with family and quiet evenings at home.",
    family: "Middle-class family of five. Father is a government employee and my mother is a retired teacher. I have one brother who is a CA.",
    lifestyle: "Non-smoker and non-drinker, inshaAllah. I keep things simple and halal in every sense.",
    photo: "/seed/f3.jpg",
    visibility: "members",
    verified: false,
  },
  {
    name: "Ritika Iyer",
    gender: "Female",
    dob: iso(29, 4, 8),
    email: "ritika.iyer@member.example",
    mobile: "9812000104",
    location: "Chennai, Tamil Nadu",
    religion: "Hindu",
    community: "Iyer",
    motherTongue: "Tamil",
    education: "M.Tech",
    profession: "Data Scientist",
    income: 1600000,
    heightCm: 158,
    maritalStatus: "Never Married",
    headline: "Data scientist, temple devotee, and weekend potter in Chennai.",
    about:
      "I work with data by day and clay by weekend. I am calm, curious and practical. I look for someone kind and ambitious who wants to build a life full of learning and little rituals.",
    family: "Father is a professor, mother is an author. I am the youngest of three siblings, all settled.",
    lifestyle: "Vegetarian, non-smoker, non-drinker. I keep a small garden and a big bookshelf.",
    photo: "/seed/f4.jpg",
    visibility: "members",
    verified: true,
  },
  {
    name: "Arjun Verma",
    gender: "Male",
    dob: iso(29, 11, 2),
    email: "arjun.verma@member.example",
    mobile: "9812000201",
    location: "New Delhi",
    religion: "Hindu",
    community: "Brahmin",
    motherTongue: "Hindi",
    education: "MBA",
    profession: "Product Manager",
    income: 2200000,
    heightCm: 178,
    maritalStatus: "Never Married",
    headline: "Product manager in Delhi — cricket weekends, chai always.",
    about:
      "I work in product management and spend my weekends playing cricket or reading. I am a straightforward person who believes in honesty, work ethic and celebrating small wins together.",
    family: "Nuclear family. Father is a retired engineer, mother is a homemaker. I have one sister who works in IT.",
    lifestyle: "Non-smoker, social drinker. I work out three times a week and am learning to play the sitar.",
    photo: "/seed/m1.jpg",
    visibility: "public",
    verified: true,
  },
  {
    name: "Rohan Deshmukh",
    gender: "Male",
    dob: iso(31, 1, 25),
    email: "rohan.deshmukh@member.example",
    mobile: "9812000202",
    location: "Pune, Maharashtra",
    religion: "Hindu",
    community: "Maratha",
    motherTongue: "Marathi",
    education: "B.E. (Civil)",
    profession: "Civil Engineer",
    income: 1500000,
    heightCm: 174,
    maritalStatus: "Never Married",
    headline: "Engineer and weekend trekker — steady, simple, family first.",
    about:
      "I design and supervise construction projects in Pune. I am a calm and practical person who values stability and family. I enjoy trekking, old Marathi movies and a proper plate of misal.",
    family: "Father is a retired government engineer, mother is a homemaker. I have a younger brother in the Navy.",
    lifestyle: "Non-smoker, non-drinker. I keep a disciplined routine and love spending festivals with extended family.",
    photo: "/seed/m2.jpg",
    visibility: "public",
    verified: false,
  },
  {
    name: "Imran Sheikh",
    gender: "Male",
    dob: iso(30, 7, 14),
    email: "imran.sheikh@member.example",
    mobile: "9812000203",
    location: "Hyderabad, Telangana",
    religion: "Muslim",
    community: "Sunni",
    motherTongue: "Urdu",
    education: "B.Tech (IT)",
    profession: "IT Consultant",
    income: 1800000,
    heightCm: 176,
    maritalStatus: "Never Married",
    headline: "IT consultant in Hyderabad — cricket, qawwali and family time.",
    about:
      "I work as an IT consultant and love solving problems at work and in life. I am a family man at heart and I look for a partner who is kind, independent and values tradition without being rigid.",
    family: "Father runs a small trading business, mother is a homemaker. I have two younger sisters.",
    lifestyle: "Non-smoker, non-drinker. I play cricket on weekends and love old Hyderabad biryani.",
    photo: "/seed/m3.jpg",
    visibility: "members",
    verified: true,
  },
  {
    name: "Vikram Singh",
    gender: "Male",
    dob: iso(28, 3, 30),
    email: "vikram.singh@member.example",
    mobile: "9812000204",
    location: "Jaipur, Rajasthan",
    religion: "Hindu",
    community: "Jat",
    motherTongue: "Hindi",
    education: "BBA",
    profession: "Business Owner",
    income: 3000000,
    heightCm: 180,
    maritalStatus: "Never Married",
    headline: "Runs a hospitality business in Jaipur — warm host, big heart.",
    about:
      "I run a small hospitality business in Jaipur. My work has taught me to be hospitable, hardworking and honest. I am looking for a life partner who enjoys culture, travel and family celebrations.",
    family: "Father is in the same business, mother is a homemaker. I have one younger brother who is a captain in the army.",
    lifestyle: "Social drinker, non-smoker. I ride a motorbike on weekends and love the heritage walk of Jaipur.",
    photo: "/seed/m4.jpg",
    visibility: "public",
    verified: false,
  },
];

function seed() {
  const adminCount = (
    sqlite.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number }
  ).c;

  if (adminCount === 0) {
    const password = process.env.ADMIN_DEFAULT_PASSWORD || "Panika@123";
    sqlite
      .prepare(
        `INSERT INTO users (full_name, gender, date_of_birth, email, mobile, password_hash, role, status, email_verified, created_at, updated_at)
         VALUES (?, 'Female', NULL, ?, ?, ?, 'admin', 'active', 1, ?, ?)`,
      )
      .run(ADMIN_NAME, ADMIN_EMAIL, "9999900000", hashPassword(password), now, now);
    const adminId = (sqlite.prepare("SELECT id FROM users WHERE email = ?").get(ADMIN_EMAIL) as { id: number }).id;
    sqlite
      .prepare(`INSERT INTO admin_users (user_id, name, email, role, is_active, created_at) VALUES (?, ?, ?, 'owner', 1, ?)`)
      .run(adminId, ADMIN_NAME, ADMIN_EMAIL, now);
    console.log(`[Panika Jeevan Sathi] Admin account created: ${ADMIN_EMAIL} (default password: ${password})`);
  }

  const profileCount = (sqlite.prepare("SELECT COUNT(*) AS c FROM profiles").get() as { c: number }).c;
  if (profileCount === 0) {
    const insertUser = sqlite.prepare(
      `INSERT INTO users (full_name, gender, date_of_birth, email, mobile, password_hash, role, status, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'member', 'active', 1, ?, ?)`,
    );
    const insertProfile = sqlite.prepare(
      `INSERT INTO profiles (user_id, display_name, profile_photo_url, headline, about, family_details, lifestyle,
        religion, community, mother_tongue, marital_status, education, profession, income, location, height_cm,
        approval_status, verification_status, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
    );
    const insertPrefs = sqlite.prepare(
      `INSERT INTO partner_preferences (user_id, looking_for, age_min, age_max, location, religion, marital_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertPrivacy = sqlite.prepare(
      `INSERT INTO privacy_settings (user_id, hide_phone, hide_email, profile_visibility, created_at, updated_at)
       VALUES (?, 0, 0, ?, ?, ?)`,
    );

    const seedAll = () => {
      sqlite.exec("BEGIN");
      try {
      for (const p of SEED_PROFILES) {
        const res = insertUser.run(
          p.name,
          p.gender,
          p.dob,
          p.email,
          p.mobile,
          hashPassword("Member@123"),
          now,
          now,
        );
        const userId = Number(res.lastInsertRowid);
        insertProfile.run(
          userId,
          p.name,
          p.photo,
          p.headline,
          p.about,
          p.family,
          p.lifestyle,
          p.religion,
          p.community,
          p.motherTongue,
          p.maritalStatus,
          p.education,
          p.profession,
          p.income,
          p.location,
          p.heightCm,
          p.verified ? "verified" : "unverified",
          p.visibility,
          now,
          now,
        );
        insertPrefs.run(
          userId,
          p.gender === "Female" ? "Male" : "Female",
          25,
          38,
          p.location.split(",")[0],
          p.religion,
          "Never Married",
          now,
          now,
        );
        insertPrivacy.run(userId, p.visibility, now, now);
      }
      sqlite.exec("COMMIT");
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    };
    seedAll();
    console.log(`[Panika Jeevan Sathi] Seeded ${SEED_PROFILES.length} sample member profiles.`);
  }
}

seed();
