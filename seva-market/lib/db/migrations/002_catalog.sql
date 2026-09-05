-- SEVA MARKET INDIA — migration 002: service catalogue
--
-- `categories` are what customers browse; `services` are the specific jobs they
-- want done. Providers link to services, never free-text.

CREATE TABLE IF NOT EXISTS categories (
  id          text PRIMARY KEY,
  parent_id   text REFERENCES categories(id) ON DELETE SET NULL,
  name        text NOT NULL,
  slug        text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon        text NOT NULL DEFAULT '',
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   integer NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  bigint NOT NULL,
  updated_at  bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_slug ON categories(slug);
CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_name ON categories(name);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

CREATE TABLE IF NOT EXISTS services (
  id          text PRIMARY KEY,
  category_id text NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   integer NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  bigint NOT NULL,
  updated_at  bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_services_category_slug ON services(category_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS ux_services_category_name ON services(category_id, name);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id);
