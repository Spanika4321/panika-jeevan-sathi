-- =====================================================================
-- SEVA MARKET INDIA — migration 0001: foundation schema
--
-- Hierarchy (single self-referencing tree, `locations`):
--   country(India) -> state -> district -> city -> locality -> pincode
--
-- Core domain objects: users, providers, categories, services.
-- Everything is append-friendly and index-first: the two hottest query
-- shapes on this site are "services near this PIN" and "providers in
-- this city for this category", so both get a covering composite index.
-- =====================================================================

-- Connection-level PRAGMAs (journal_mode, foreign_keys) deliberately live in
-- src/db/client.js, not here: SQLite refuses `PRAGMA journal_mode` inside a
-- transaction, and `PRAGMA foreign_keys` is a silent no-op there. A migration
-- must contain schema only.

-- ------------------------------------------------------------- users
CREATE TABLE users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  email               TEXT    NOT NULL,
  phone               TEXT,
  full_name           TEXT    NOT NULL,
  password_hash       TEXT    NOT NULL,
  role                TEXT    NOT NULL DEFAULT 'customer'
                              CHECK (role IN ('customer','provider','admin')),
  status              TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','active','suspended')),
  email_verified_at   TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_status_role_idx     ON users (status, role);

-- --------------------------------------------------------- locations
-- One table, six levels. `parent_id` builds India -> State -> District
-- -> City -> Locality -> PIN. `search_text` is a denormalised breadcrumb
-- ("Guwahati, Kamrup Metropolitan, Assam, India") used for LIKE search
-- and for building provider/service address labels without extra joins.
CREATE TABLE locations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT    NOT NULL
                       CHECK (kind IN ('country','state','district','city','locality','pincode')),
  parent_id    INTEGER REFERENCES locations (id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  slug         TEXT    NOT NULL,
  code         TEXT,                          -- ISO state code / district code
  pin_code     TEXT,                          -- set on kind='pincode'; denormalised for fast PIN lookup
  latitude     REAL,
  longitude    REAL,
  search_text  TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (kind, parent_id, slug)
);
CREATE INDEX locations_parent_idx  ON locations (parent_id, kind);
CREATE INDEX locations_pin_idx     ON locations (pin_code);
CREATE INDEX locations_kind_idx    ON locations (kind, is_active);
CREATE INDEX locations_search_idx  ON locations (search_text);

-- -------------------------------------------------------- categories
-- Self-referencing so "Home Repair" can own "Plumber", "Electrician"...
CREATE TABLE categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id   INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  description TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX categories_parent_idx ON categories (parent_id, sort_order);

-- --------------------------------------------------------- providers
CREATE TABLE providers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER REFERENCES users (id) ON DELETE SET NULL,
  business_name       TEXT    NOT NULL,
  slug                TEXT    NOT NULL UNIQUE,
  contact_name        TEXT,
  phone               TEXT    NOT NULL,
  alt_phone           TEXT,
  email               TEXT,
  category_id         INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  location_id         INTEGER NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
  pin_code            TEXT,
  address_line        TEXT,
  about               TEXT,
  experience_years    INTEGER NOT NULL DEFAULT 0 CHECK (experience_years >= 0),
  is_verified         INTEGER NOT NULL DEFAULT 0,
  status              TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','active','suspended')),
  rating_avg          REAL    NOT NULL DEFAULT 0,
  rating_count        INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX providers_category_idx  ON providers (category_id, status);
CREATE INDEX providers_location_idx  ON providers (location_id, status);
CREATE INDEX providers_pin_idx       ON providers (pin_code, status);

-- ---------------------------------------------------------- services
CREATE TABLE services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id  INTEGER NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  location_id  INTEGER NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
  title        TEXT    NOT NULL,
  slug         TEXT    NOT NULL UNIQUE,
  description  TEXT,
  pin_code     TEXT,
  price_min    INTEGER CHECK (price_min IS NULL OR price_min >= 0),
  price_max    INTEGER CHECK (price_max IS NULL OR price_max >= 0),
  price_unit   TEXT    NOT NULL DEFAULT 'visit'
                       CHECK (price_unit IN ('visit','hour','day','sqft','job','month')),
  status       TEXT    NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','active','paused','archived')),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX services_category_idx ON services (category_id, status);
CREATE INDEX services_location_idx ON services (location_id, status);
CREATE INDEX services_pin_idx      ON services (pin_code, status);
CREATE INDEX services_provider_idx ON services (provider_id, status);

-- A provider often serves many PIN codes beyond its own address.
CREATE TABLE service_areas (
  provider_id  INTEGER NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  pin_code     TEXT    NOT NULL,
  location_id  INTEGER REFERENCES locations (id) ON DELETE SET NULL,
  PRIMARY KEY (provider_id, pin_code)
);
CREATE INDEX service_areas_pin_idx ON service_areas (pin_code);

-- Customer -> provider enquiries. The whole point of the marketplace:
-- contact. No payment, no chat yet — just a captured lead.
CREATE TABLE leads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id   INTEGER REFERENCES services (id)  ON DELETE SET NULL,
  provider_id  INTEGER NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  phone        TEXT    NOT NULL,
  email        TEXT,
  pin_code     TEXT,
  message      TEXT,
  status       TEXT    NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','contacted','closed','spam')),
  ip_hash      TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX leads_provider_idx ON leads (provider_id, status, created_at);

CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT    NOT NULL DEFAULT 'system',
  action      TEXT    NOT NULL,
  entity      TEXT,
  entity_id   INTEGER,
  detail      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id);
