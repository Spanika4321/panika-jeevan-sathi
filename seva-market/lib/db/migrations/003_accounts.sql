-- SEVA MARKET INDIA — migration 003: accounts
--
-- One identity per person. `role` separates customers from the marketplace
-- team; being a business owner is expressed by owning a `provider` record,
-- which keeps onboarding/verification out of the sign-in path.

CREATE TABLE IF NOT EXISTS users (
  id             text PRIMARY KEY,
  email          text NOT NULL,
  phone          text,
  password_hash  text NOT NULL DEFAULT '',
  name           text NOT NULL DEFAULT '',
  role           text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','provider','admin')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended')),
  email_verified integer NOT NULL DEFAULT 0 CHECK (email_verified IN (0,1)),
  phone_verified integer NOT NULL DEFAULT 0 CHECK (phone_verified IN (0,1)),
  state_id       text REFERENCES states(id) ON DELETE SET NULL,
  city_id        text REFERENCES cities(id) ON DELETE SET NULL,
  pincode        text,
  token_version  integer NOT NULL DEFAULT 1,
  last_login_at  bigint NOT NULL DEFAULT 0,
  created_at     bigint NOT NULL,
  updated_at     bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users(email);
-- Partial index: many accounts legitimately have no phone number yet.
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
