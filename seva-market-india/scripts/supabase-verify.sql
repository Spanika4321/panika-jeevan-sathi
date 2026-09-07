-- =====================================================================
-- SEVA MARKET INDIA — read-only checks to run after a SQL paste.
--
-- "Success. No rows returned" only proves the editor ran something without
-- erroring. This file proves the objects really exist, are locked down, and
-- (for the mirror) are loaded. Paste the whole file or one line at a time:
-- every statement is independent and SELECT-only, so nothing here can
-- change the database, and line order does not matter.
--
-- WHAT A GOOD ANSWER LOOKS LIKE
--   1. four rows, present = t                          — the tables exist
--   2. rls_enabled = t on every row                    — RLS is on
--   3. policy_count = 0                                — no policy exists, so
--                                                        anon/authenticated can
--                                                        read nothing (that is
--                                                        the design, not a gap)
--   4. can_select = f and can_insert = f on all 8 rows — the REVOKEs landed
--   5. one row per source table, matching the counts on the
--      EXPECTED MIRROR ROWS line below                  — the mirror is loaded
--   6. total_rows = the same line's total               — nothing was lost
--
-- EXPECTED MIRROR ROWS: locations=105 categories=36 providers=10 services=14 service_areas=25 total=190
--
-- `ERROR: relation "public.seva_mirror" does not exist` is not a failure of
-- this file: it means that paste has not run yet.
--   mirror table   -> scripts/supabase-init.sql  (README, "Supabase mirror")
--   durable tables -> scripts/supabase-storage.sql (DEPLOY.md, Step 1)
-- =====================================================================

-- 1. Which of the four tables exist? A name missing here = that paste did not run.
select 'seva_mirror' as table_name, to_regclass('public.seva_mirror') is not null as present union all select 'seva_users', to_regclass('public.seva_users') is not null union all select 'seva_leads', to_regclass('public.seva_leads') is not null union all select 'seva_audit_logs', to_regclass('public.seva_audit_logs') is not null order by 1;

-- 2. Row Level Security must be ON for all four.
select relname as table_name, relrowsecurity as rls_enabled from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in ('seva_mirror','seva_users','seva_leads','seva_audit_logs') order by 1;

-- 3. And no policy may exist: RLS with zero policies is what hides the rows.
select count(*) as policy_count from pg_policy p join pg_class c on c.oid = p.polrelid where c.relnamespace = 'public'::regnamespace and c.relname in ('seva_mirror','seva_users','seva_leads','seva_audit_logs');

-- 4. The public keys must hold no table privilege. A server without those roles reads null.
select g.grantee, c.relname as table_name, case when pr.rolname is not null then has_table_privilege(pr.oid, c.oid, 'select') end as can_select, case when pr.rolname is not null then has_table_privilege(pr.oid, c.oid, 'insert') end as can_insert from pg_class c cross join (values ('anon'), ('authenticated')) as g(grantee) left join pg_roles pr on pr.rolname = g.grantee where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('seva_mirror','seva_users','seva_leads','seva_audit_logs') order by 1, 2;

-- 5. Mirror contents, per source table.
select tbl, count(*) as row_count from public.seva_mirror group by tbl order by 1;

-- 6. Mirror total and arrival times, so a partial paste shows up.
select count(*) as total_rows, min(synced_at) as first_row_at, max(synced_at) as last_row_at from public.seva_mirror;

-- 7. The durable tables stay empty until a real signup or enquiry arrives.
select (select count(*) from public.seva_leads) as leads_stored, (select count(*) from public.seva_users) as accounts_stored, (select count(*) from public.seva_audit_logs) as audit_rows_stored;
