-- =====================================================================
-- SEVA MARKET INDIA — migration 0002: comprehensive service catalog
--
-- Expands the foundation schema (0001) into the full Category →
-- Subcategory → Service hierarchy required by the India-wide marketplace.
--
--   categories        (existing)  — top-level catalog groups
--   subcategories     (new)       — second level, always under a category
--   catalog_services  (new)       — leaf services, under subcategory+category
--
-- Every catalog entity carries the same editorial fields:
--   name, slug, description, icon, image, sort_order, is_active.
-- Slugs are globally unique so they remain stable in public URLs and
-- for SEO.
--
-- `services` (provider listings) from 0001 is intentionally left
-- untouched — it stores provider-owned offers. `catalog_services` is the
-- canonical, provider-agnostic service directory used for browsing,
-- search and admin management.
-- =====================================================================

-- -------------------------------------------------------- categories (patch)
-- Add the editorial columns that 0001 omitted but the spec requires.
-- SQLite's ALTER TABLE ADD COLUMN is forgiving: existing rows receive the
-- default value, and the migration runs exactly once so IF NOT EXISTS is
-- unnecessary.
ALTER TABLE categories ADD COLUMN image TEXT;
ALTER TABLE categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ----------------------------------------------------- subcategories
CREATE TABLE subcategories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  slug          TEXT    NOT NULL UNIQUE,
  description   TEXT,
  icon          TEXT,
  image         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX subcategories_category_idx ON subcategories (category_id, sort_order);
CREATE INDEX subcategories_active_idx   ON subcategories (is_active, sort_order);
CREATE UNIQUE INDEX subcategories_slug_unique ON subcategories (slug);

-- -------------------------------------------------- catalog_services
CREATE TABLE catalog_services (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id     INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  subcategory_id  INTEGER REFERENCES subcategories (id) ON DELETE SET NULL,
  name            TEXT    NOT NULL,
  slug            TEXT    NOT NULL UNIQUE,
  description     TEXT,
  icon            TEXT,
  image           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX catalog_services_category_idx    ON catalog_services (category_id, is_active, sort_order);
CREATE INDEX catalog_services_subcategory_idx ON catalog_services (subcategory_id, is_active, sort_order);
CREATE INDEX catalog_services_active_idx      ON catalog_services (is_active, sort_order);
CREATE UNIQUE INDEX catalog_services_slug_unique ON catalog_services (slug);
