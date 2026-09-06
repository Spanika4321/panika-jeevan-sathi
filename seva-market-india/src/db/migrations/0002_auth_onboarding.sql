-- =====================================================================
-- SEVA MARKET INDIA — migration 0002: accounts, sessions, onboarding
--
-- Adds the auth layer (server-side revocable sessions, single-use email
-- tokens, login throttling) and the provider onboarding layer (a claimed
-- provider record, a document queue and admin review).
--
-- Forward-only like every other migration: nothing here drops or rewrites
-- milestone-1 data, and `users`, `providers`, `leads` keep working for the
-- read paths already shipped.
-- =====================================================================

-- ------------------------------------------------------------- users
-- Auth bookkeeping. `password_hash` already existed; the columns below
-- record when it changed and when the account last signed in.
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;

-- ----------------------------------------------------------- sessions
-- Stateful on purpose. The cookie carries a 32-byte random token; the
-- database stores only HMAC-SHA256(secret, token). A database leak
-- therefore hands out no usable sessions, and logout / suspend / password
-- change are all immediate because the row is the authority.
CREATE TABLE sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash    TEXT    NOT NULL UNIQUE,
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ip_hash       TEXT,
  user_agent    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at    TEXT    NOT NULL,
  revoked_at    TEXT
);
-- Only live sessions are ever looked up, so the index leads with the two
-- predicates of the hot query: token_hash lookup + expiry check.
CREATE INDEX sessions_user_idx    ON sessions (user_id, revoked_at, expires_at);
CREATE INDEX sessions_expiry_idx  ON sessions (expires_at);

-- -------------------------------------------------------- auth tokens
-- Email verification and password reset. Tokens are single-use, stored
-- hashed the same way as session tokens, and expire independently.
CREATE TABLE auth_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose     TEXT    NOT NULL CHECK (purpose IN ('email_verification','password_reset')),
  token_hash  TEXT    NOT NULL UNIQUE,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT    NOT NULL,
  used_at     TEXT
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, purpose, used_at);

-- ------------------------------------------------------- login throttle
-- A counter per (email + client IP), not per session: the point is to slow
-- password guessing before a session ever exists. Raw IPs are never kept —
-- only the key hash.
CREATE TABLE login_throttle (
  key         TEXT PRIMARY KEY,
  attempts    INTEGER NOT NULL DEFAULT 0,
  first_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  blocked_until TEXT
);

-- ----------------------------------------------------------- providers
-- A provider row is now owned by an account and carries the review trail.
ALTER TABLE providers ADD COLUMN verified_at TEXT;
ALTER TABLE providers ADD COLUMN review_note TEXT;
ALTER TABLE providers ADD COLUMN reviewed_at TEXT;
ALTER TABLE providers ADD COLUMN website TEXT;
ALTER TABLE providers ADD COLUMN gst_number TEXT;
-- "My business" is the hottest lookup for a signed-in provider.
CREATE INDEX providers_user_idx ON providers (user_id, status);

-- Documents are referenced, never stored: a marketplace that hoards GST
-- certificates and ID scans becomes the most interesting table to breach.
-- `reference` holds a masked value ("GST 22*****4567P") and the file, if
-- any, lives in object storage outside this database.
CREATE TABLE provider_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id  INTEGER NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL CHECK (kind IN ('gst','udyam','pan','licence','photo','other')),
  reference    TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected')),
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at  TEXT
);
CREATE INDEX provider_documents_provider_idx ON provider_documents (provider_id, status);

-- --------------------------------------------------------------- leads
-- The dashboard triages enquiries, so a lead needs an owner-visible note and
-- a read flag on top of the existing status enum.
ALTER TABLE leads ADD COLUMN provider_note TEXT;
ALTER TABLE leads ADD COLUMN read_at TEXT;
CREATE INDEX leads_inbox_idx ON leads (provider_id, created_at);

-- -------------------------------------------------------- audit trail
-- `audit_logs` shipped in milestone 1 unused; auth and review now write to
-- it. Index on actor for "what did this admin do" forensics.
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor, created_at);
