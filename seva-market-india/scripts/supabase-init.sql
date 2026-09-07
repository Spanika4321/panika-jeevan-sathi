-- SEVA MARKET INDIA — one-time Supabase mirror provisioning.
--
-- Run ONCE in the Supabase SQL editor (dashboard → SQL Editor → paste → Run).
-- Creates a single mirror table in the SAME project Panika Jeevan Sathi
-- already uses. The name is unique (`seva_mirror`), so Panika's tables are
-- never touched and no data mixes: every Seva SQLite row is stored as one
-- JSON document in `doc`, keyed by (tbl, id).
--
-- The service-role key bypasses RLS, so no policy is needed for the app.
-- RLS is enabled and anonymous access is revoked: only the service role
-- (and the table owner) can touch this table.

create table if not exists public.seva_mirror (
  tbl       text not null,
  id        text not null,
  doc       jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (tbl, id)
);

-- PostgREST upserts rely on the PK (on_conflict=tbl,id). Keep the index
-- explicit for clarity and for fast per-table scans during recovery.
create index if not exists seva_mirror_tbl_idx on public.seva_mirror (tbl, id);

alter table public.seva_mirror enable row level security;

-- Anonymous / anon-key users get nothing. The service role is unaffected.
revoke all on table public.seva_mirror from anon, authenticated;
