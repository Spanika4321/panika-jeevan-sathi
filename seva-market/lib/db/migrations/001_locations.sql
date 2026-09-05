-- SEVA MARKET INDIA — migration 001: location hierarchy
--
-- India → State → District → City → Locality → PIN code.
-- Portable SQL: text UUID keys, `bigint` epoch-millisecond timestamps, plain
-- `create table` / `create unique index`. Runs unchanged on SQLite and Postgres.

CREATE TABLE IF NOT EXISTS countries (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  code          text NOT NULL,
  iso3          text NOT NULL,
  phone_code    text NOT NULL DEFAULT '',
  currency_code text NOT NULL DEFAULT 'INR',
  is_active     integer NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    bigint NOT NULL,
  updated_at    bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_countries_code ON countries(code);

CREATE TABLE IF NOT EXISTS states (
  id         text PRIMARY KEY,
  country_id text NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name       text NOT NULL,
  slug       text NOT NULL,
  code       text NOT NULL DEFAULT '',
  type       text NOT NULL DEFAULT 'state' CHECK (type IN ('state','union_territory')),
  is_active  integer NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_states_slug ON states(slug);
CREATE UNIQUE INDEX IF NOT EXISTS ux_states_country_name ON states(country_id, name);

CREATE TABLE IF NOT EXISTS districts (
  id         text PRIMARY KEY,
  state_id   text NOT NULL REFERENCES states(id) ON DELETE CASCADE,
  name       text NOT NULL,
  slug       text NOT NULL,
  is_active  integer NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_districts_state_slug ON districts(state_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS ux_districts_state_name ON districts(state_id, name);
CREATE INDEX IF NOT EXISTS idx_districts_state ON districts(state_id);

CREATE TABLE IF NOT EXISTS cities (
  id         text PRIMARY KEY,
  district_id text NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  state_id   text NOT NULL REFERENCES states(id) ON DELETE CASCADE,
  name       text NOT NULL,
  slug       text NOT NULL,
  is_metro   integer NOT NULL DEFAULT 0 CHECK (is_metro IN (0,1)),
  latitude   real,
  longitude  real,
  is_active  integer NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cities_state_slug ON cities(state_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cities_district_name ON cities(district_id, name);
CREATE INDEX IF NOT EXISTS idx_cities_state ON cities(state_id);

-- India Post PIN codes. A PIN identifies a delivery post office and can cover
-- several localities, so it is a first-class entity rather than a column.
CREATE TABLE IF NOT EXISTS pincodes (
  id          text PRIMARY KEY,
  code        text NOT NULL,
  office_name text NOT NULL DEFAULT '',
  city_id     text REFERENCES cities(id) ON DELETE SET NULL,
  district_id text REFERENCES districts(id) ON DELETE SET NULL,
  state_id    text REFERENCES states(id) ON DELETE SET NULL,
  latitude    real,
  longitude   real,
  is_active   integer NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  bigint NOT NULL,
  updated_at  bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pincodes_code ON pincodes(code);
CREATE INDEX IF NOT EXISTS idx_pincodes_city ON pincodes(city_id);

-- Neighbourhoods inside a city (Sector 62, Andheri West, Gomti Nagar…).
CREATE TABLE IF NOT EXISTS localities (
  id         text PRIMARY KEY,
  city_id    text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  pincode_id text REFERENCES pincodes(id) ON DELETE SET NULL,
  name       text NOT NULL,
  slug       text NOT NULL,
  latitude   real,
  longitude  real,
  is_active  integer NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_localities_city_slug ON localities(city_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS ux_localities_city_name ON localities(city_id, name);
CREATE INDEX IF NOT EXISTS idx_localities_pincode ON localities(pincode_id);
CREATE INDEX IF NOT EXISTS idx_localities_city ON localities(city_id);
