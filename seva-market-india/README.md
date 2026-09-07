# SEVA MARKET INDIA

India-wide **local services marketplace**. Customers find and contact local service
providers by **service + location + PIN code**.

This repository holds the **starting foundation** (milestone 1): project structure, a
professional mobile-first UI, server-rendered pages, a JSON API, and the database
architecture for users, providers, categories, services and the full Indian location
hierarchy.

> **Zero npm dependencies.** The app is built entirely on Node.js built-ins
> (`node:http`, `node:sqlite`, `node:crypto`, `node:test`) and requires **Node.js 22.5+**.
> `npm install` is not needed to run, test or seed the site.

---

## Run it

```bash
node scripts/migrate.mjs   # create the schema
node scripts/seed.mjs      # load the launch dataset (idempotent)
node server.js             # http://localhost:3000
```

```bash
npm start           # run the site
npm run dev         # run with auto-reload
npm test            # full suite (131 tests)
npm run check       # syntax check every source file
npm run migrate     # apply migrations
npm run seed        # load seed data (also mirrors to Supabase/Appwrite when configured)
npm run db:status   # durability report: db file, journal mode, snapshots
npm run db:backup   # crash-safe snapshot of the live database (cron-friendly)
npm run db:restore  # integrity-checked restore (newest snapshot, or pass a path)
npm run supabase:setup  # verify Supabase mirror table + initial sync (idempotent)
npm run appwrite:setup  # one-time Appwrite provisioning + initial sync (idempotent)
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `production` enables the durability fail-closed policy |
| `SEVA_DB_FILE` | `./data/seva-market.db` | SQLite path (`:memory:` for tests) |
| `SEVA_BACKUP_DIR` | — | **Durable backup home** (mounted volume / external disk). Every boot snapshots the database here; an empty-disk boot restores the newest snapshot instead of starting empty |
| `SEVA_REQUIRE_REMOTE` | — | `1` = refuse to boot on a local file database with no mirror. **Set on every ephemeral host (Render/Railway/Fly free tiers)** so a wiped disk can never silently serve an empty site. A configured mirror (Supabase or Appwrite) satisfies this requirement, so the app starts and recovers from the mirror instead of refusing |
| `SEVA_SUPABASE_URL` | — | Supabase project URL (`https://<ref>.supabase.co`) — the mirror store. Plain `SUPABASE_URL` also works (same vars Panika already uses) |
| `SEVA_SUPABASE_SERVICE_ROLE_KEY` | — | Supabase **service-role** key — never ship it in code, host env only. Plain `SUPABASE_SERVICE_ROLE_KEY` also works |
| `SEVA_SUPABASE_TABLE` | `seva_mirror` | Mirror table name (unique — Panika's tables are never touched) |
| `SEVA_APPWRITE_ENDPOINT` | `https://cloud.appwrite.io/v1` | Appwrite endpoint (only if you use Appwrite instead of Supabase) |
| `SEVA_APPWRITE_PROJECT_ID` | — | Appwrite project id (server API key needs `databases.*` scopes) |
| `SEVA_APPWRITE_API_KEY` | — | Appwrite **server** API key — host env only |
| `SEVA_APPWRITE_DATABASE_ID` | — | Appwrite Database id holding the mirror collections |
| `SEVA_REMOTE_INTERVAL_MS` | `3000` | Background re-drain interval for queued changes that failed to push |
| `TRUST_PROXY_HOPS` | `0` | How many proxy hops to trust in `X-Forwarded-For` |
| `SESSION_SECRET` | — | Reserved for the auth milestone; already salt for lead IP hashing |

---

## Keeping member data safe (read this before deploying)

**The risk.** This site stores its database in a local SQLite file
(`SEVA_DB_FILE`). Free-tier hosts — Render, Railway, Fly.io, Vercel — erase the
whole filesystem whenever an instance sleeps or redeploys. When that happens,
the file is gone; a normal boot then runs the migrations and creates a brand
new **empty** database, and the site keeps serving as if nothing happened.
That silent "second empty life" is what data loss looks like from the outside.

**The protection.** SQLite stays the query engine and the API is unchanged;
everything the site writes is also pushed to a **Supabase mirror** (or
Appwrite, if configured instead), which survives any host wipe. Four layers,
all covered by `tests/durability.test.mjs`, `tests/boot-durability.test.mjs`,
`tests/remote.test.mjs`, `tests/supabase.test.mjs` and
`tests/boot-remote.test.mjs`:

1. **Supabase mirror (recommended, fully automatic)** — every insert/update/
   delete in the site's tables is recorded in a SQLite change log
   (`_sync_log`, migration `0002`) inside the same transaction, then pushed
   to Supabase: right after each HTTP response, on a background interval, and
   once more at shutdown. On boot, an empty database is **rebuilt from the
   mirror before the site answers a single request** — no disk to mount,
   nothing to schedule. Covered end-to-end: seed → mirror → wipe → boot
   serves the recovered data.

2. **Boot snapshot** — whenever the app starts against a file database, it
   writes a crash-safe snapshot (`src/db/backup.js`: integrity-verified,
   atomic rename) into `SEVA_BACKUP_DIR`.

3. **Boot restore** — if the database file is missing/empty but the backup
   home has a snapshot and has never been seen by a previous boot, the newest
   snapshot is restored *before the app opens the database*. The site never
   starts empty when a recovery is possible.

4. **Fail closed** — with `SEVA_REQUIRE_REMOTE=1` the app refuses to start on
   a local file database with no durable store. A configured mirror
   (Supabase or Appwrite) *is* a durable store, so with the `SEVA_SUPABASE_*`
   (or `SEVA_APPWRITE_*`) vars set the app recovers from the mirror instead
   of refusing; without it, a wiped instance fails loudly rather than
   serving an empty site. `NODE_ENV=production` already refuses to boot when
   a database file that previously existed is missing.

### Setting up the Supabase mirror (one-time, ~3 minutes — the recommended path)

This reuses an **existing Supabase project** (e.g. the one Panika Jeevan
Sathi already runs on) — Seva's data goes into its own single mirror table
`seva_mirror`, so nothing of Panika's is touched or mixed:

1. **Create the mirror table once** — Supabase dashboard → **SQL Editor** →
   open `scripts/supabase-init.sql` → paste → **Run**. (PostgREST cannot
   create tables for you, so this one step is manual; it is idempotent.)
2. **Put two env vars on the host** (same values Panika already uses —
   the plain `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` names work too,
   so a host that already exports them needs no changes):
   `SEVA_SUPABASE_URL=https://<ref>.supabase.co` and
   `SEVA_SUPABASE_SERVICE_ROLE_KEY=<service-role key>`.
3. **Optional initial sync** from anywhere with DB access:
   `SEVA_SUPABASE_URL=... SEVA_SUPABASE_SERVICE_ROLE_KEY=... npm run supabase:setup`
   (boot and `npm run seed` also sync automatically when the env is set).

Done — every write mirrors after the response, every boot drains the queue,
and a wiped instance rebuilds itself from the mirror (log: `[durability]
local database rebuilt from the Supabase mirror`). If Supabase is briefly
unreachable the site keeps serving local writes; they stay queued in
`_sync_log` and drain on the retry interval / at shutdown.

### Setting up the Appwrite mirror (one-time, ~5 minutes — alternative store)

These are the only manual steps — everything after them is automatic:

1. In the [Appwrite console](https://cloud.appwrite.io) create a **Project**
   and inside it a **Database** (free tier is fine).
2. Create a **server API key** with `databases.*` scopes (Databases → read,
   write, create/delete collections and attributes — the key only ever needs
   to manage the mirror collections).
3. Put the four values on the host (server-side only, never in the repo):
   `SEVA_APPWRITE_PROJECT_ID`, `SEVA_APPWRITE_API_KEY`,
   `SEVA_APPWRITE_DATABASE_ID`, and `SEVA_APPWRITE_ENDPOINT` if you are not
   using Appwrite Cloud. `APPWRITE_*` spellings are accepted as aliases.
4. Run the one-time provision + initial sync once from anywhere that can
   reach both the database and Appwrite:

   ```bash
   SEVA_APPWRITE_PROJECT_ID=... SEVA_APPWRITE_API_KEY=... \
   SEVA_APPWRITE_DATABASE_ID=... npm run appwrite:setup
   ```

   It creates the mirror collections/attributes if missing (idempotent —
   safe to re-run) and pushes every existing row, so the remote starts in
   sync. `npm run seed` pushes its own baseline too when Appwrite is
   configured.

That's it. Every boot now provisions/mirrors automatically, every write is
pushed after the response, and a wiped instance rebuilds itself from
Appwrite (log: `[durability] local database rebuilt from the Appwrite
mirror`). If Appwrite is briefly unreachable the site keeps serving local
writes, which stay queued in `_sync_log` and drain on the retry interval /
at shutdown.

### What you must do on an ephemeral host

1. **Set `SEVA_SUPABASE_URL` + `SEVA_SUPABASE_SERVICE_ROLE_KEY`** (above) on
   the service (plain `SUPABASE_*` spellings work too — Panika-style hosts
   already export them). That alone gives you wipe-proof data: no mounted
   disk required.

2. **Set `SEVA_REQUIRE_REMOTE=1`** so that a wiped instance with a broken
   mirror connection refuses to serve an empty database instead of quietly
   deleting the site's content.

3. **Optionally add a `SEVA_BACKUP_DIR` + hourly `npm run db:backup`** for a
   second, independent copy. The backup uses SQLite's online mechanism, so
   the live site never blocks.

4. **Keep an off-host copy** for real disasters: ship `db:backup` snapshots
   to object storage, or simply download them after each seed/launch
   milestone.

### Recovery after a wipe

With the mirror configured, nothing to do: the new instance rebuilds the
database from Supabase/Appwrite at boot and logs `[durability] local database
rebuilt from the … mirror`. With only backup snapshots, it restores the
newest snapshot at boot (`[durability] local database was missing — restored
from backup`). To recover manually:

```bash
npm run db:restore                  # newest snapshot in SEVA_BACKUP_DIR
npm run db:restore ./old-snapshot.db
npm run db:status                   # verify file + snapshots before/after
```

---

## Project structure

```
seva-market-india/
├── server.js                    HTTP entry point (20 lines — no logic lives here)
├── package.json                 scripts; zero dependencies
├── src/
│   ├── app.js                   wires config + db + routes into handle(req, res)
│   ├── config.js                every environment value, read exactly once
│   ├── db/
│   │   ├── client.js            node:sqlite wrapper (param binding, transactions)
│   │   ├── migrate.js           forward-only SQL migrations
│   │   ├── migrations/0001_foundation.sql
│   │   ├── seed.js              idempotent loader
│   │   ├── seed-data.js         the launch dataset (real PIN codes)
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
│   └── views/                   layout, homepage, HTML escaping
├── public/assets/               CSS (mobile-first), JS enhancement, logo
├── scripts/                     migrate, seed, syntax check
└── tests/                       114 tests over schema, models, search, HTTP, pages
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
| `GET` | `/api/v1/health` | Liveness + DB probe |
| `GET` | `/api/v1/health/deep` | Readiness + table list |
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
npm test          # 114 tests
npm run test:unit # schema, models, search
npm run test:http # HTTP layer + rendered pages
```

The suite runs against real SQLite (in-memory, plus a real temporary file for the
persistence tests) and drives the actual router and handlers in-process.

| File | Covers |
| --- | --- |
| `database.test.mjs` | Migrations, idempotency, FK + CHECK enforcement, hierarchy counts, PIN validity |
| `persistence.test.mjs` | WAL on a real file, data surviving reopen, no PRAGMAs in migrations |
| `durability.test.mjs` | Boot snapshots, missing-db restore, `SEVA_REQUIRE_REMOTE` fail-closed, integrity-checked restores, online backup of a live database |
| `boot-durability.test.mjs` | `createApp` boots through a simulated instance wipe: restore path and fail-closed path |
| `models.test.mjs` | Location tree, categories, providers, services, scrypt auth, leads |
| `search.test.mjs` | Every filter combination, coverage PINs, pagination, wildcard escaping |
| `http.test.mjs` | Routes, envelope, status codes, 404/405/500, static files, security headers |
| `pages.test.mjs` | Header/nav, search form, data-driven content, escaping, mobile-first CSS |

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
