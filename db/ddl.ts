/**
 * SEVA MARKET INDIA — DDL (kept 1:1 in sync with db/schema.ts).
 * Applied idempotently by `tsx db/push.ts` (npm run db:push).
 * A drift-guard test in tests/db.test.ts verifies every table exists.
 *
 * NOTE: SQLite forward references are fine — FKs resolve at runtime.
 */

export const DDL_TABLES = [
  "users",
  "provider_profiles",
  "categories",
  "services",
  "service_listings",
  "states",
  "districts",
  "cities",
  "localities",
  "pin_codes",
] as const;

export const DDL_STATEMENTS: string[] = [
  // ── Users & providers ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'CUSTOMER',
    avatar_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE TABLE IF NOT EXISTS provider_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL,
    about TEXT,
    address_line TEXT,
    locality_id TEXT REFERENCES localities(id) ON DELETE SET NULL,
    cover_image_url TEXT,
    is_verified INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    experience_years INTEGER NOT NULL DEFAULT 0,
    rating_avg REAL NOT NULL DEFAULT 0,
    rating_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS provider_profiles_locality_id_idx ON provider_profiles (locality_id)`,
  `CREATE INDEX IF NOT EXISTS provider_profiles_verified_active_idx ON provider_profiles (is_verified, is_active)`,
  `CREATE INDEX IF NOT EXISTS provider_profiles_rating_avg_idx ON provider_profiles (rating_avg)`,
  `CREATE TABLE IF NOT EXISTS service_listings (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    price_min INTEGER,
    price_max INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CONSTRAINT service_listings_provider_service_uq UNIQUE (provider_id, service_id)
  )`,
  `CREATE INDEX IF NOT EXISTS service_listings_service_id_idx ON service_listings (service_id)`,

  // ── Categories & services ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_hi TEXT,
    slug TEXT NOT NULL UNIQUE,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS categories_active_sort_idx ON categories (is_active, sort_order)`,
  `CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    unit TEXT,
    price_min INTEGER,
    price_max INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS services_category_id_idx ON services (category_id)`,

  // ── Locations ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS states (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    code TEXT UNIQUE,
    is_ut INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE TABLE IF NOT EXISTS districts (
    id TEXT PRIMARY KEY,
    state_id TEXT NOT NULL REFERENCES states(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CONSTRAINT districts_state_name_uq UNIQUE (state_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS cities (
    id TEXT PRIMARY KEY,
    district_id TEXT NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CONSTRAINT cities_district_name_uq UNIQUE (district_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS localities (
    id TEXT PRIMARY KEY,
    city_id TEXT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    pin_code TEXT NOT NULL REFERENCES pin_codes(code),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CONSTRAINT localities_city_name_uq UNIQUE (city_id, name)
  )`,
  `CREATE INDEX IF NOT EXISTS localities_pin_code_idx ON localities (pin_code)`,
  `CREATE TABLE IF NOT EXISTS pin_codes (
    code TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
];
