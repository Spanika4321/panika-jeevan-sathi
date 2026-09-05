import { relations } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * ═══════════════════════════════════════════════════════════════════
 * SEVA MARKET INDIA — Database schema (Foundation v0.1)
 * ───────────────────────────────────────────────────────────────────
 * ORM      : Drizzle (typed SQL, zero codegen)
 * Runtime  : @libsql/client — local `file:` SQLite now, remote
 *            libsql/Turso (or PostgreSQL via drizzle pg dialect) later.
 * DDL      : db/ddl.ts is kept 1:1 in sync — guarded by tests/db.test.ts.
 *
 * Model groups:
 *   1. Users & Providers   2. Categories & Services   3. Locations
 * ═══════════════════════════════════════════════════════════════════
 */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** SQLite stores booleans as 0/1 integers. */
const bool = (name: string) => integer(name, { mode: "boolean" });

const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());

// ─────────────────────────────────────────────────────────────
// 1 · USERS & PROVIDERS
// ─────────────────────────────────────────────────────────────

/** Any human on the platform. Role values: CUSTOMER | PROVIDER | ADMIN (lib/constants.ts). */
export const users = sqliteTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").unique(),
  phone: text("phone").notNull().unique(), // primary identity — OTP-ready
  passwordHash: text("password_hash"),
  role: text("role").notNull().default("CUSTOMER"),
  avatarUrl: text("avatar_url"),
  isActive: bool("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Business profile of a service provider — 1:1 with User. */
export const providerProfiles = sqliteTable(
  "provider_profiles",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    businessName: text("business_name").notNull(),
    about: text("about"),
    addressLine: text("address_line"),
    localityId: text("locality_id").references(() => localities.id, {
      onDelete: "set null",
    }),
    coverImageUrl: text("cover_image_url"),
    isVerified: bool("is_verified").notNull().default(false),
    isActive: bool("is_active").notNull().default(true),
    experienceYears: integer("experience_years").notNull().default(0),
    ratingAvg: real("rating_avg").notNull().default(0), // denormalised; recomputed as reviews land
    ratingCount: integer("rating_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    localityIdx: index("provider_profiles_locality_id_idx").on(t.localityId),
    verifiedActiveIdx: index("provider_profiles_verified_active_idx").on(t.isVerified, t.isActive),
    ratingIdx: index("provider_profiles_rating_avg_idx").on(t.ratingAvg),
  })
);

/** Which service a provider offers, with their own price band (INR). */
export const serviceListings = sqliteTable(
  "service_listings",
  {
    id: id(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    priceMin: integer("price_min"),
    priceMax: integer("price_max"),
    createdAt: createdAt(),
  },
  (t) => ({
    providerServiceUq: uniqueIndex("service_listings_provider_service_uq").on(
      t.providerId,
      t.serviceId
    ),
    serviceIdx: index("service_listings_service_id_idx").on(t.serviceId),
  })
);

// ─────────────────────────────────────────────────────────────
// 2 · CATEGORIES & SERVICES
// ─────────────────────────────────────────────────────────────

/** Top-level grouping on the homepage grid (Electrician, Plumber…). */
export const categories = sqliteTable(
  "categories",
  {
    id: id(),
    name: text("name").notNull(),
    nameHi: text("name_hi"), // Hindi label for bilingual UI
    slug: text("slug").notNull().unique(),
    icon: text("icon"), // lucide icon key, resolved in lib/icons.tsx
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: bool("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({ activeSortIdx: index("categories_active_sort_idx").on(t.isActive, t.sortOrder) })
);

/** A concrete bookable service inside a category ("Fan installation"). */
export const services = sqliteTable(
  "services",
  {
    id: id(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    unit: text("unit"), // "visit" | "hour" | "sq. ft." | "item" …
    priceMin: integer("price_min"), // platform guide price, INR
    priceMax: integer("price_max"),
    isActive: bool("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({ categoryIdx: index("services_category_id_idx").on(t.categoryId) })
);

// ─────────────────────────────────────────────────────────────
// 3 · LOCATIONS
//    India → State → District → City → Locality → PIN code
// ─────────────────────────────────────────────────────────────

export const states = sqliteTable("states", {
  id: id(),
  name: text("name").notNull().unique(),
  code: text("code").unique(), // official code, e.g. "MH"
  isUT: bool("is_ut").notNull().default(false),
  createdAt: createdAt(),
});

export const districts = sqliteTable(
  "districts",
  {
    id: id(),
    stateId: text("state_id")
      .notNull()
      .references(() => states.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({ stateNameUq: uniqueIndex("districts_state_name_uq").on(t.stateId, t.name) })
);

export const cities = sqliteTable(
  "cities",
  {
    id: id(),
    districtId: text("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({ districtNameUq: uniqueIndex("cities_district_name_uq").on(t.districtId, t.name) })
);

/** Neighbourhood-level unit — primary anchor for search & provider base. */
export const localities = sqliteTable(
  "localities",
  {
    id: id(),
    cityId: text("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pinCode: text("pin_code")
      .notNull()
      .references(() => pinCodes.code),
    createdAt: createdAt(),
  },
  (t) => ({
    cityNameUq: uniqueIndex("localities_city_name_uq").on(t.cityId, t.name),
    pinIdx: index("localities_pin_code_idx").on(t.pinCode),
  })
);

/** Indian Postal PIN (6 digits). One PIN covers many localities → search-by-PIN. */
export const pinCodes = sqliteTable("pin_codes", {
  code: text("code").primaryKey(),
  createdAt: createdAt(),
});

// ─────────────────────────────────────────────────────────────
// Relations (enable the typed relational query API: db.query.*)
// ─────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ one }) => ({
  providerProfile: one(providerProfiles, {
    fields: [users.id],
    references: [providerProfiles.userId],
  }),
}));

export const providerProfilesRelations = relations(providerProfiles, ({ one, many }) => ({
  user: one(users, { fields: [providerProfiles.userId], references: [users.id] }),
  locality: one(localities, {
    fields: [providerProfiles.localityId],
    references: [localities.id],
  }),
  services: many(serviceListings),
}));

export const serviceListingsRelations = relations(serviceListings, ({ one }) => ({
  provider: one(providerProfiles, {
    fields: [serviceListings.providerId],
    references: [providerProfiles.id],
  }),
  service: one(services, {
    fields: [serviceListings.serviceId],
    references: [services.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  services: many(services),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  category: one(categories, {
    fields: [services.categoryId],
    references: [categories.id],
  }),
  listings: many(serviceListings),
}));

export const statesRelations = relations(states, ({ many }) => ({
  districts: many(districts),
}));

export const districtsRelations = relations(districts, ({ one, many }) => ({
  state: one(states, { fields: [districts.stateId], references: [states.id] }),
  cities: many(cities),
}));

export const citiesRelations = relations(cities, ({ one, many }) => ({
  district: one(districts, { fields: [cities.districtId], references: [districts.id] }),
  localities: many(localities),
}));

export const localitiesRelations = relations(localities, ({ one, many }) => ({
  city: one(cities, { fields: [localities.cityId], references: [cities.id] }),
  pin: one(pinCodes, { fields: [localities.pinCode], references: [pinCodes.code] }),
  providers: many(providerProfiles),
}));

export const pinCodesRelations = relations(pinCodes, ({ many }) => ({
  localities: many(localities),
}));

// ─────────────────────────────────────────────────────────────
// Inferred model types
// ─────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ProviderProfile = typeof providerProfiles.$inferSelect;
export type NewProviderProfile = typeof providerProfiles.$inferInsert;
export type ServiceListing = typeof serviceListings.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type State = typeof states.$inferSelect;
export type District = typeof districts.$inferSelect;
export type City = typeof cities.$inferSelect;
export type Locality = typeof localities.$inferSelect;
export type PINCode = typeof pinCodes.$inferSelect;
