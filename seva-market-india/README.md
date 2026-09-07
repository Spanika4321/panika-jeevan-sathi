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
npm start          # run the site
npm run dev        # run with auto-reload
npm test           # full suite (121 tests)
npm run check      # syntax check every source file
npm run migrate    # apply migrations
npm run seed       # load seed data
npm run db:status  # durability report: db file, journal mode, snapshots
npm run db:backup  # crash-safe snapshot of the live database (cron-friendly)
npm run db:restore # integrity-checked restore (newest snapshot, or pass a path)
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `production` enables the durability fail-closed policy |
| `SEVA_DB_FILE` | `./data/seva-market.db` | SQLite path (`:memory:` for tests) |
| `SEVA_BACKUP_DIR` | — | **Durable backup home** (mounted volume / external disk). Every boot snapshots the database here; an empty-disk boot restores the newest snapshot instead of starting empty |
| `SEVA_REQUIRE_REMOTE` | — | `1` = refuse to boot on a local file database. **Set on every ephemeral host (Render/Railway/Fly free tiers)** so a wiped disk can never silently serve an empty site |
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

**The protection.** Three layers, all covered by `tests/durability.test.mjs`
and `tests/boot-durability.test.mjs`:

1. **Boot snapshot** — whenever the app starts against a file database, it
   writes a crash-safe snapshot (`src/db/backup.js`: integrity-verified,
   atomic rename) into `SEVA_BACKUP_DIR`.

2. **Boot restore** — if the database file is missing/empty but the backup
   home has a snapshot and has never been seen by a previous boot, the newest
   snapshot is restored *before the app opens the database*. The site never
   starts empty when a recovery is possible.

3. **Fail closed** — with `SEVA_REQUIRE_REMOTE=1` the app refuses to start on
   a local file database at all. An ephemeral host that has lost its data
   then fails loudly instead of serving an empty site. `NODE_ENV=production`
   already refuses to boot when a database file that previously existed is
   missing.

### What you must do on an ephemeral host

1. **Give the instance a durable home for backups.** On Render, add a
   **Disk** to the service and point `SEVA_BACKUP_DIR` at its mount path
   (e.g. `/var/data/backups`). On Railway, a volume mounts the same way.
   A disk survives redeploys — it is what makes recovery possible.

2. **Run `npm run db:backup` on a schedule.** Boot snapshots cover the moment
   of (re)deploy, but between boots your leads deserve an hourly copy. A
   Render **Cron Service** (or any scheduler) running
   `npm run db:backup` against the same `SEVA_BACKUP_DIR` keeps snapshots
   fresh. The backup uses SQLite's online mechanism, so the live site never
   blocks.

3. **Set `SEVA_REQUIRE_REMOTE=1`** so a wiped instance refuses to serve an
   empty database instead of quietly deleting the site's content.

4. **Keep an off-host copy** for real disasters: point a small script at the
   backup dir and ship snapshots to object storage, or simply download them
   after each seed/launch milestone.

### Recovery after a wipe

With the setup above, nothing to do: the new instance restores the newest
snapshot at boot and logs `[durability] local database was missing — restored
from backup`. To recover manually:

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
