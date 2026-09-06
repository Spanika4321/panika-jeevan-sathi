-- =====================================================================
-- SEVA MARKET INDIA — migration 0002: auth sessions + reviews & ratings
--
-- Milestone additions that turn the foundation into a working marketplace:
--
--   * sessions   — server-side login sessions. A random token goes to the
--                  client as an HttpOnly cookie; only its SHA-256 hash is
--                  stored here, so a database leak cannot replay a cookie.
--                  Storing sessions (rather than stateless signed cookies)
--                  lets logout and suspension revoke access immediately.
--
--   * reviews    — customer ratings behind `providers.rating_avg`. The
--                  rating is recomputed from approved reviews (a trigger
--                  would not know how to round), so the write path lives in
--                  the model, not the schema.
--
-- Both tables are append-only friendly and never alter 0001 tables, so the
-- foundation schema (and everything that reads it) is untouched.
-- =====================================================================

-- ---------------------------------------------------------- sessions
CREATE TABLE sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    TEXT    NOT NULL UNIQUE,       -- SHA-256 of the cookie token
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at    TEXT    NOT NULL,
  last_seen_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX sessions_user_idx ON sessions (user_id, expires_at);

-- ----------------------------------------------------------- reviews
CREATE TABLE reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id    INTEGER NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  service_id     INTEGER REFERENCES services (id) ON DELETE SET NULL,
  customer_name  TEXT    NOT NULL,
  customer_phone TEXT,
  rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  status         TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected')),
  ip_hash        TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX reviews_provider_idx ON reviews (provider_id, status, created_at);
