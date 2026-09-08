-- SEVA MARKET INDIA — one-time account tokens.
--
-- Two flows need a secret that travels through a mailbox:
--
--   verify_email     "prove you own this inbox"  (48 hour link)
--   reset_password   "prove it again, then choose a new password" (1 hour link)
--
-- WHAT IS STORED
--   Only the SHA-256 hash of the token. The raw token exists exactly twice:
--   in the email that was sent and in the URL the visitor clicks. A database
--   copy — a backup, a mirror, a leaked Supabase key — therefore cannot be
--   replayed to take over an account, which is the whole reason to hash it.
--
--   `user_id` is an application-level reference, not a SQLite foreign key:
--   in production accounts live in Supabase (see 0002 for the same reasoning
--   about providers.user_id), so a local FK would reject every real signup.
--
-- Single use: `consumed_at` is stamped the moment a token is spent, and
-- issuing a new one revokes the outstanding ones for that (user, purpose),
-- so an old email link can never be used after a newer one was requested.

CREATE TABLE account_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  purpose     TEXT    NOT NULL
                      CHECK (purpose IN ('verify_email','reset_password')),
  token_hash  TEXT    NOT NULL,
  ip_hash     TEXT,           -- HMAC of the requesting IP: throttling without storing addresses
  expires_at  TEXT    NOT NULL,
  consumed_at TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- A presented token is looked up by (purpose, hash); uniqueness also stops a
-- collision from ever silently activating somebody else's link.
CREATE UNIQUE INDEX account_tokens_lookup_idx ON account_tokens (purpose, token_hash);
-- "How many has this account requested recently?" — the throttle question.
CREATE INDEX account_tokens_user_idx  ON account_tokens (user_id, purpose, created_at);
-- Housekeeping: expired rows are deleted oldest-first.
CREATE INDEX account_tokens_expiry_idx ON account_tokens (expires_at);
