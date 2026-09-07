# SEVA MARKET INDIA

India-wide **local services marketplace**. Customers find and contact local service
providers by **service + location + PIN code**.

This repository holds the **starting foundation** (milestone 1): project structure, a
professional mobile-first UI, server-rendered pages, a JSON API, and the database
architecture for users, providers, categories, services and the full Indian location
hierarchy.

> **Zero npm dependencies.** The app is built entirely on Node.js built-ins
> (`node:http`, `node:sqlite`, `node:crypto`, `node:test`) and requires **Node.js 22.5+**.
> `npm install` is not needed to run, test or seed the site. The committed
> `package-lock.json` contains nothing on purpose: Render's `npm ci` fails
> without a lockfile, and an empty one makes the build step a no-op instead of
> a download.

---

## Run it

```bash
node scripts/migrate.mjs   # create the schema
node scripts/seed.mjs      # load the launch dataset (idempotent)
node server.js             # http://localhost:3000
```

```bash
npm start          # run the site
npm run dev        # run with auto-reload
npm test           # full suite (182 tests; 4 need a real Postgres)
npm run check      # syntax check every source file
npm run migrate    # apply migrations
npm run seed       # load seed data
npm run supabase:sql    # print the Supabase bootstrap SQL (paste into the SQL editor)
npm run supabase:setup  # mirror local rows into public.seva_mirror
npm run storage:sql     # print the Postgres schema for accounts + enquiries
npm run storage:doctor  # is customer data actually durable on this host?
npm run storage:prove   # wipe the disk in a sandbox and show the data survives
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `production` tightens logging |
| `SEVA_DB_FILE` | `./data/seva-market.db` | SQLite path (`:memory:` for tests) |
| `SEVA_STORAGE` | auto | `sqlite` or `supabase` — where accounts + enquiries are written |
| `SEVA_REQUIRE_REMOTE` | `0` | `1` = refuse to boot without Supabase (ephemeral hosts) |
| `SEVA_ALLOW_EPHEMERAL` | `0` | `1` = silence the SQLite-in-production warning |
| `SEVA_SEED_ON_BOOT` | `1` | Rebuild the catalog at startup when it is empty |
| `TRUST_PROXY_HOPS` | `0` | How many proxy hops to trust in `X-Forwarded-For` |
| `SESSION_SECRET` | — | Reserved for the auth milestone; already salt for lead IP hashing |
| `SUPABASE_URL` | — | Project URL for durable storage and the mirror |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service-role key; never the `anon` key |

---

## Durability: what survives a redeploy

Free PaaS hosts (Render, Railway, most containers) have an **ephemeral
filesystem**: everything written to disk is deleted on each deploy and each
wake-from-sleep. So the data is split by whether it can be regenerated.

| Data | Home | After a wipe |
| --- | --- | --- |
| Catalog — locations, categories, providers, services, service areas | local SQLite, seeded from `src/db/seed-data.js` | rebuilt at boot in ~1 s |
| **Accounts** (`seva_users`) | **Supabase Postgres** | untouched |
| **Enquiries** (`seva_leads`) | **Supabase Postgres** | untouched |
| **Audit trail** (`seva_audit_logs`) | **Supabase Postgres** | untouched |

Three properties make this safe rather than hopeful:

1. **Write-through, awaited.** `store.leads.create()` resolves only after
   Postgres has the row. There is no queue to lose, and a `201` can never be
   a lie — if Supabase is unreachable the API returns `500`.
2. **Fail-closed boot.** With `SEVA_REQUIRE_REMOTE=1` a missing, malformed or
   anon-typed Supabase key stops the process with a one-paragraph
   explanation. A crashed deploy is visible in the log; silently writing
   customer enquiries to a disk that is about to vanish is not.
3. **Proof on demand.** `npm run storage:prove` boots the app against a local
   Postgres stand-in, submits a real enquiry over the real HTTP handler,
   **deletes the SQLite file**, boots again, and reads the enquiry back.

```
$ npm run storage:prove
  ok   catalog rebuilt from seed — 10 providers, 14 services
  ok   POST /api/v1/leads returned 201
  ok   nothing customer-facing is in the SQLite file
  ok   SQLite file deleted — seva-market.db
  ok   catalog rebuilt automatically — 10 providers
  ok   the enquiry survived — "Durability Test" <durability@example.com>
  ok   the account survived — owner@example.com
  ok   password hash still verifies
```

`GET /api/v1/health` reports the answer in production too:

```json
{ "storage": { "driver": "supabase", "durable": true } }
```

The Postgres side is created by pasting `scripts/supabase-storage.sql` into
the Supabase SQL editor once: three tables, RLS enabled, no policies, and
`anon`/`authenticated` grants revoked, so only the server's service-role key
can read or write them. Table names are `seva_`-prefixed because the same
project may also host Panika Jeevan Sathi, which owns `public.users`.

**Deploying?** `DEPLOY.md` is the click-by-click Render guide.

---

## Project structure

```
seva-market-india/
├── server.js                    HTTP entry point (20 lines — no logic lives here)
├── package.json                 scripts; zero dependencies
├── package-lock.json            *intentionally empty* — makes Render's `npm ci` reproducible
├── src/
│   ├── app.js                   wires config + db + routes into handle(req, res)
│   ├── config.js                every environment value, read exactly once
│   ├── db/
│   │   ├── client.js            node:sqlite wrapper (param binding, transactions)
│   │   ├── migrate.js           forward-only SQL migrations
│   │   ├── migrations/0001_foundation.sql
│   │   ├── seed.js              idempotent loader
│   │   ├── seed-data.js         the launch dataset (real PIN codes)
│   │   ├── remote.js            PostgREST client over global fetch, zero deps
│   │   └── values.js            pure helpers: slugs, PIN/phone, LIKE patterns
│   ├── models/                  location, category, provider, service, user, lead
│   ├── http/
│   │   ├── router.js            pattern router + accurate Allow headers
│   │   ├── respond.js           one JSON envelope, HttpError, HTML sender
│   │   ├── request.js           body parsing (size-capped) + validators
│   │   └── security.js          security headers, trusted client IP
│   ├── routes/
│   │   ├── pages.js             server-rendered HTML pages
│   │   ├── search-context.js    query string -> typed search filters
│   │   └── api/                 health, locations, categories, services, providers
│   ├── store/
│   │   ├── index.js             one factory, two backends, one async interface
│   │   ├── guard.js             fail-closed boot checks (the data-loss net)
│   │   ├── sqlite-store.js      local file backend (dev, tests, real disks)
│   │   └── supabase-store.js    write-through Postgres backend (production)
│   └── views/                   layout, homepage, HTML escaping
├── public/assets/               CSS (mobile-first), JS enhancement, logo
├── scripts/                     migrate, seed, syntax check, Supabase setup
│   ├── supabase-init.sql        paste-once bootstrap SQL (5 statements)
│   ├── supabase-setup.mjs       --sql printer + PostgREST mirror sync
│   ├── supabase-storage.sql     accounts + enquiries + audit schema (paste once)
│   ├── supabase-verify.sql      read-only "did that paste actually land?" checks
│   ├── storage-doctor.mjs       "is this host durable?" — config, tables, canary write
│   └── prove-durability.mjs     wipes the disk in a sandbox and proves survival
├── DEPLOY.md                    click-by-click Render deployment guide
├── render.yaml                  Render blueprint (fail-closed env baked in; mirrored into the repo root)
└── tests/                       182 tests over schema, models, search, HTTP, pages, Supabase, durability, blueprints
```

**Layering rule:** routes never write SQL, models never touch `req`/`res`, and views
never query the database. Each layer can be tested alone.

---

## Database architecture

### The location hierarchy

One self-referencing `locations` table expresses the whole tree, and the level order is
**enforced in code** — a PIN cannot be attached straight to a state:

```
country (India)
  └── state            Assam, Maharashtra, Karnataka, Delhi, ...
        └── district   Kamrup Metropolitan, Pune, Bengaluru Urban, ...
              └── city Guwahati, Pune, Bengaluru, ...
                    └── locality  Uzan Bazar, Kothrud, Indiranagar, ...
                          └── pincode  781001, 411038, 560038, ...
```

Every row also carries a denormalised `search_text` breadcrumb
(`Uzan Bazar, Guwahati, Kamrup Metropolitan, Assam, India`) so address labels and
free-text search need no recursive joins.

### Tables

| Table | Purpose | Notes |
| --- | --- | --- |
| `users` | Customers, providers, admins | scrypt password hashes; unique lower-cased email |
| `locations` | The six-level geography tree | unique `(kind, parent_id, slug)`; indexed on `pin_code` |
| `categories` | Service taxonomy | two levels, e.g. Home Repair → Plumber |
| `providers` | A business that offers services | category + primary location + optional extra PINs |
| `services` | One priced offering | category + location + PIN; `draft/active/paused/archived` |
| `service_areas` | Extra PIN codes a provider covers | this is what makes "near me" search work |
| `leads` | Customer → provider enquiries | IP stored as a salted HMAC, never raw |
| `audit_logs` | Who changed what | reserved for the admin milestone |

`users`, `leads` and `audit_logs` exist in SQLite for local development. In
production they are backed by `seva_users`, `seva_leads` and `seva_audit_logs`
in Supabase Postgres (see **Durability** above); the SQLite copies stay empty
because nothing regenerable ever depends on them.
| `schema_migrations` | Applied migration versions | forward-only, tracked per boot |

The two hottest read paths each have a covering composite index:

```sql
CREATE INDEX services_pin_idx      ON services (pin_code, status);
CREATE INDEX providers_category_idx ON providers (category_id, status);
CREATE INDEX service_areas_pin_idx ON service_areas (pin_code);
```

Connection PRAGMAs (`journal_mode=WAL`, `foreign_keys=ON`) are set in `src/db/client.js`,
**not** in the migration — SQLite rejects `PRAGMA journal_mode` inside a transaction and
silently ignores `PRAGMA foreign_keys` there. `tests/persistence.test.mjs` guards this
against a real file-backed database.

---

## HTTP API

Envelope everywhere: `{"ok": true, "data": ...}` or `{"ok": false, "error": {...}}`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Liveness + DB probe + storage driver/durability |
| `GET` | `/api/v1/health/deep` | Readiness, catalog state, live Supabase probe, table list |
| `GET` | `/api/v1/locations` | `?pin=` resolve a PIN · `?q=` search · `?parent=&kind=` drill down |
| `GET` | `/api/v1/locations/:id` | One node with breadcrumb + children |
| `GET` | `/api/v1/locations/stats` | Count per hierarchy level |
| `GET` | `/api/v1/categories` | Nested tree with live service counts |
| `GET` | `/api/v1/categories/popular` | Homepage strip |
| `GET` | `/api/v1/categories/:slug` | One category + children |
| `GET` | `/api/v1/services` | **Core search**: `?q=&category=&place=&pin=&limit=&page=` |
| `GET` | `/api/v1/services/:slug` | One service with its provider |
| `GET` | `/api/v1/providers` | Provider search (`?verified=1` for verified only) |
| `GET` | `/api/v1/providers/:slug` | Public profile with services + coverage |
| `POST` | `/api/v1/leads` | Customer enquiry → `201` (rate-limited per IP) |

Pages: `/`, `/search`, `/categories`, `/locations`, `/providers/new`, `/about`,
`/contact`, `/privacy`, `/terms`. All server-rendered, all indexable.

---

## Security

- **Strict CSP** on every HTML response (`script-src 'self'`, `frame-ancestors 'none'`,
  no `unsafe-eval`). The templates emit no inline script and no inline event handler —
  `tests/pages.test.mjs` fails the build if one appears.
- **Output escaping** through a single `esc()` gate; `& < > " ' \`` are all covered, and a
  test injects `<script>` and attribute-breakout payloads through a provider name to prove it.
- **SQL injection**: every query is parameterised. `LIKE` patterns escape `%`, `_` and `\`
  with `ESCAPE '\'`, so a user typing `%` cannot match the whole table.
- **Passwords**: scrypt (`N=16384, r=8, p=1`), self-describing format so cost can be raised
  without a data migration; compared with `timingSafeEqual`.
- **Request bodies** are capped at 32 KB before parsing; unsupported content types are rejected.
- **Rate limiting** on enquiry capture (5/hour/IP), with the client IP hashed rather than stored.
- **Proxy trust** is explicit: only the configured number of `X-Forwarded-For` hops is
  believed, so a client cannot spoof its address.
- **Errors never leak internals** — a 500 returns a short reference id and logs server-side.
- Baseline headers on every response: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- Static file serving resolves inside `public/` and refuses path traversal.

---

## Testing

```bash
npm test             # 182 tests (4 gated on a real Postgres)
npm run test:unit    # schema, models, search
npm run test:http    # HTTP layer + rendered pages
npm run test:storage # durability: boot guard, write-through, schema lockdown
```

The suite runs against real SQLite (in-memory, plus a real temporary file for the
persistence tests) and drives the actual router and handlers in-process.

| File | Covers |
| --- | --- |
| `database.test.mjs` | Migrations, idempotency, FK + CHECK enforcement, hierarchy counts, PIN validity |
| `persistence.test.mjs` | WAL on a real file, data surviving reopen, no PRAGMAs in migrations |
| `models.test.mjs` | Location tree, categories, providers, services, scrypt auth, leads |
| `search.test.mjs` | Every filter combination, coverage PINs, pagination, wildcard escaping |
| `http.test.mjs` | Routes, envelope, status codes, 404/405/500, static files, security headers |
| `pages.test.mjs` | Header/nav, search form, data-driven content, escaping, mobile-first CSS |
| `supabase-setup.test.mjs` | SQL-file hygiene, the verify script, row mapping, batching, PostgREST upsert, error text |
| `storage.test.mjs` | Fail-closed boot, anon-key rejection, write-through to Postgres, throttle counts, health durability flags, schema lockdown (RLS + revokes + no DROP) |
| `blueprint.test.mjs` | The repo-root `render.yaml` mirrors this app's service byte for byte, the fail-closed env vars are present, `sync: false` keeps secrets out of git, and the lockfile stays dependency-free |

`supabase-setup.test.mjs` also contains one test that runs `scripts/supabase-init.sql`
against a **real PostgreSQL server**. It is skipped unless `SEVA_PSQL` points at a
`psql` binary, so the suite stays runnable anywhere:

```bash
SEVA_PSQL=$(command -v psql) PGDATABASE=postgres npm test
```

Verified against PostgreSQL 16.2: the file applies cleanly, applies cleanly a second
time (`NOTICE: relation "seva_mirror" already exists, skipping`), leaves RLS on and
zero grants for `anon`/`authenticated`.

`storage.test.mjs` gates the same way and does the same to
`scripts/supabase-storage.sql`: applies it twice, then asserts RLS is on for all
three durable tables, that no policy exists, that `anon`/`authenticated` hold
zero grants, and that the defaults and constraints the app relies on really fire
(`status='new'`, `role='customer'`, case-insensitive email uniqueness, the role
CHECK). Offline the suite is **182 tests, 178 passing** — the other 4 are the
PostgreSQL-gated ones, and they cover `scripts/supabase-verify.sql` too: both
paste scripts are applied, the verify file is pasted as a whole, and each of its
checks is asserted against the state the scripts actually leave behind.

---

## Supabase mirror

Reference data (locations, categories, providers, services, service areas) can be
mirrored into Supabase as a single server-only table. **190 rows** at launch.

**1. Create the table.** Run this, copy the output, paste it into the Supabase SQL
editor, press Run:

```bash
npm run supabase:sql
```

```sql
SET lock_timeout = '10s';
SET statement_timeout = '30s';
BEGIN;
CREATE TABLE IF NOT EXISTS public.seva_mirror (tbl text NOT NULL, id text NOT NULL, doc jsonb NOT NULL DEFAULT '{}'::jsonb, synced_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tbl, id));
ALTER TABLE public.seva_mirror ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.seva_mirror FROM anon;
REVOKE ALL ON TABLE public.seva_mirror FROM authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
```

Every statement sits on **one line with balanced parentheses**, on purpose. A
multi-line `CREATE TABLE` can lose its indented column lines in a copy/paste and
leave a dangling `)`, which Postgres reports as `syntax error at or near ")"`.
The test suite asserts no line starts with `)` and every line is a complete
statement, so that shape cannot come back.

Expected result: `Success. No rows returned` — which only means nothing
errored. To see what is actually in the project, paste
`scripts/supabase-verify.sql`: seven read-only statements that report whether
the tables exist, whether RLS is on, whether any `anon`/`authenticated` grant
survived, and how many mirror rows each source table has. Safe to run any time,
as often as you like.

`--sql` echoes `scripts/supabase-init.sql` byte for byte and refuses to print if the
file has picked up anything that is not SQL (a path, a fence, a comment) — the exact
class of paste error that produces `syntax error at or near ")"`.

### No terminal? Import the data instead

`npm run supabase:setup` needs Node on a computer. On a phone there is only the
dashboard, so the same 190 rows ship as files:

```bash
npm run supabase:emit-csv    # supabase-data/seva_mirror.csv  (one download)
npm run supabase:emit        # supabase-data/*.sql            (19 small pastes)
```

**Preferred: the CSV.** Copy/paste of a large text file on a phone is not
reliable — soft-wrapped lines come back as real newlines and long pastes arrive
reordered, which is how `COMMIT;` once landed in the middle of a JSON document
and Postgres reported `syntax error at or near ""latitude""`. A downloaded file
has none of those failure modes.

Open `supabase-data/seva_mirror.csv`, save it to the phone, then in the
dashboard: **Table Editor → `seva_mirror` → Insert → Import data from CSV**.

**Fallback: the SQL files.** Nineteen files of under 4 KB each, in
`supabase-data/`, pasted into the SQL editor in filename order. Each line is a
**complete, independent `INSERT ... ON CONFLICT` statement**, so:

* line order does not matter — verified on PostgreSQL 16.2 by running a file
  with its lines reversed, `rc=0`;
* a lost line costs exactly one row instead of failing the whole paste;
* re-running any file is harmless.

`created_at` / `updated_at` are omitted from the pasted `doc` — they are stamped
at seed time, so keeping them made the output non-deterministic, and
`seva_mirror.synced_at` already records arrival. The PostgREST sync path still
sends full rows. Tests regenerate both outputs from the seed data and fail if
the committed files drift.

Confirm afterwards with `scripts/supabase-verify.sql`, or the one check that
matters most:

```sql
select tbl, count(*) from public.seva_mirror group by tbl order by 1;
```

### Stuck at "Running..." with no result?

`ALTER TABLE` and `REVOKE` need an `ACCESS EXCLUSIVE` lock. If a previous query tab
is idle in a transaction, or a PostgREST connection is holding the table, the
statement waits — and the editor shows no error, just a spinner. The file sets
`lock_timeout = '10s'` so that case now fails in ten seconds with
`canceling statement due to lock timeout` instead of hanging.

Find what is holding it (this query itself needs no lock, so it always returns):

```sql
select pid,
       state,
       wait_event_type || '/' || coalesce(wait_event, '-') as waiting_on,
       pg_blocking_pids(pid) as blocked_by,
       now() - query_start as running_for,
       left(query, 60) as query
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
order by query_start;
```

Cancel the blocker by its `pid`, then re-run:

```sql
select pg_terminate_backend(<pid>);
```

If the project itself is paused (free tier goes idle), open the dashboard's
**Database** page and restore it first — no query will return until it is back up.

**2. Sync.** Then push the local rows:

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run supabase:setup
```

| Flag | Effect |
| --- | --- |
| `--sql` | print the bootstrap SQL and exit (no database, no credentials) |
| `--dry-run` | count what would be sent; sends nothing |
| `--tables=a,b` | limit the sync, e.g. `--tables=providers,services` |
| `--batch=N` | rows per request (default 200) |

Syncing is idempotent — `Prefer: resolution=merge-duplicates` upserts on
`(tbl, id)`, so re-running updates rather than duplicates. If the table does not
exist yet the script says so and points at `npm run supabase:sql` instead of
dumping a raw PostgREST error.

Why one `jsonb` table rather than mirroring the schema 1:1: a new local column needs
no DDL on Supabase, and RLS with zero `anon`/`authenticated` grants keeps the data
reachable only through the service-role key.

---

## Deliberately not in this milestone

Payment gateway, UPI/QR, AdSense, Render deployment, provider onboarding and
verification, reviews and ratings write-path, messaging, admin panel, email, sessions
and auth. The schema already reserves space for them (`audit_logs`, `is_verified`,
`rating_avg`, `SESSION_SECRET`) so they can be added without a destructive migration.

## Next milestones

1. **Auth + provider onboarding** — sessions, provider registration, verification flow.
2. **Provider dashboard** — manage services, coverage PINs, incoming enquiries.
3. **Reviews & ratings** — the write path behind `rating_avg` / `rating_count`.
4. **Full location master** — bulk import of all Indian districts and PIN codes.
5. **SEO surface** — `sitemap.xml`, `robots.txt`, canonical city/category landing pages.
