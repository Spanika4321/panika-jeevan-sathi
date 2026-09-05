-- SEVA MARKET INDIA — migration 004: providers, their services, their areas
--
-- `providers.pincode` is a denormalised six-digit copy of the PIN so that the
-- headline "service + PIN code" search is one index lookup; `provider_areas`
-- lists every PIN a provider travels to.

CREATE TABLE IF NOT EXISTS providers (
  id                 text PRIMARY KEY,
  user_id            text REFERENCES users(id) ON DELETE SET NULL,
  business_name      text NOT NULL,
  slug               text NOT NULL,
  tagline            text NOT NULL DEFAULT '',
  description        text NOT NULL DEFAULT '',
  primary_category_id text REFERENCES categories(id) ON DELETE SET NULL,
  address_line       text NOT NULL DEFAULT '',
  locality_id        text REFERENCES localities(id) ON DELETE SET NULL,
  city_id            text REFERENCES cities(id) ON DELETE SET NULL,
  district_id        text REFERENCES districts(id) ON DELETE SET NULL,
  state_id           text REFERENCES states(id) ON DELETE SET NULL,
  pincode_id         text REFERENCES pincodes(id) ON DELETE SET NULL,
  pincode            text NOT NULL DEFAULT '',
  latitude           real,
  longitude          real,
  service_radius_km  integer NOT NULL DEFAULT 10,
  phone              text NOT NULL DEFAULT '',
  whatsapp           text NOT NULL DEFAULT '',
  email              text NOT NULL DEFAULT '',
  website            text NOT NULL DEFAULT '',
  experience_years   integer NOT NULL DEFAULT 0,
  team_size          integer NOT NULL DEFAULT 1,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('draft','pending','approved','rejected','suspended')),
  verification_level text NOT NULL DEFAULT 'unverified'
                     CHECK (verification_level IN ('unverified','phone','document','trusted')),
  is_active          integer NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  rating_sum         integer NOT NULL DEFAULT 0,
  rating_count       integer NOT NULL DEFAULT 0,
  view_count         integer NOT NULL DEFAULT 0,
  search_text        text NOT NULL DEFAULT '',
  created_at         bigint NOT NULL,
  updated_at         bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_providers_slug ON providers(slug);
CREATE INDEX IF NOT EXISTS idx_providers_status ON providers(status, is_active);
CREATE INDEX IF NOT EXISTS idx_providers_city ON providers(city_id);
CREATE INDEX IF NOT EXISTS idx_providers_pincode ON providers(pincode);
CREATE INDEX IF NOT EXISTS idx_providers_state ON providers(state_id);
CREATE INDEX IF NOT EXISTS idx_providers_category ON providers(primary_category_id);

CREATE TABLE IF NOT EXISTS provider_services (
  id          text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  service_id  text NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  price_from  integer,
  price_to    integer,
  price_unit  text NOT NULL DEFAULT 'visit'
              CHECK (price_unit IN ('visit','hour','day','month','sqft','unit','quote')),
  is_primary  integer NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  created_at  bigint NOT NULL,
  updated_at  bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_services_pair ON provider_services(provider_id, service_id);
CREATE INDEX IF NOT EXISTS idx_provider_services_service ON provider_services(service_id);
CREATE INDEX IF NOT EXISTS idx_provider_services_category ON provider_services(category_id);

CREATE TABLE IF NOT EXISTS provider_areas (
  id          text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  pincode_id  text REFERENCES pincodes(id) ON DELETE CASCADE,
  pincode     text NOT NULL,
  created_at  bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_areas_pair ON provider_areas(provider_id, pincode);
CREATE INDEX IF NOT EXISTS idx_provider_areas_pincode ON provider_areas(pincode);
