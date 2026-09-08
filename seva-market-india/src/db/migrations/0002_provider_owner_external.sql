-- @requires-foreign-keys-off
-- SEVA MARKET INDIA — provider owners can live in the durable account store.
--
-- In production users live in Supabase, while the discoverable catalog stays
-- local. `providers.user_id` is therefore an application-level owner id, not
-- a SQLite foreign key: enforcing it locally rejected every newly registered
-- Supabase provider with "FOREIGN KEY constraint failed".
--
-- Rebuild only this parent table, preserving every provider id and all
-- columns. The migration runner temporarily disables FK enforcement because
-- services/service_areas/leads legitimately reference providers while the
-- replacement table is renamed; it checks that enforcement is restored.

CREATE TABLE providers_rebuilt (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER,
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

INSERT INTO providers_rebuilt (
  id, user_id, business_name, slug, contact_name, phone, alt_phone, email,
  category_id, location_id, pin_code, address_line, about, experience_years,
  is_verified, status, rating_avg, rating_count, created_at, updated_at
)
SELECT
  id, user_id, business_name, slug, contact_name, phone, alt_phone, email,
  category_id, location_id, pin_code, address_line, about, experience_years,
  is_verified, status, rating_avg, rating_count, created_at, updated_at
FROM providers;

DROP TABLE providers;
ALTER TABLE providers_rebuilt RENAME TO providers;

CREATE INDEX providers_category_idx  ON providers (category_id, status);
CREATE INDEX providers_location_idx  ON providers (location_id, status);
CREATE INDEX providers_pin_idx       ON providers (pin_code, status);
