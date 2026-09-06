# SEVA MARKET INDIA

India-wide **local services marketplace**. Customers find and contact local service
providers by **service + location + PIN code**.

This is a **working end-to-end marketplace**, built up from a mobile-first foundation
through the full roadmap:

1. **Foundation** — project structure, professional UI, server-rendered pages, JSON API,
   database architecture for users, providers, categories, services and the Indian
   location hierarchy.
2. **Auth + provider onboarding** — secure scrypt accounts, server-side sessions
   (HttpOnly cookies), customer signup and a combined provider-listing form.
3. **Provider dashboard** — manage services (publish/pause/archive), cover extra PIN
   codes, and respond to incoming enquiries.
4. **Reviews & ratings** — customer reviews roll up into each provider's public rating,
   with optional moderation.
5. **SEO surface** — indexable public provider/service pages, `robots.txt` and
   `sitemap.xml`, plus a bulk **location-master importer** for the full Indian PIN tree.

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
npm start            # run the site
npm run dev          # run with auto-reload
npm test             # full suite (126 tests)
npm run check        # syntax check every source file
npm run migrate      # apply migrations
npm run seed         # load seed data
npm run import:pincodes   # bulk-import a PIN JSON file (milestone 4)
# Full national master (all 35 states/UTs, ~600 districts, ~24k PINs):
node scripts/load-full-pincodes.mjs /path/to/pincodes.csv
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `production` tightens logging and marks cookies `Secure` |
| `SEVA_DB_FILE` | `./data/seva-market.db` | SQLite path (`:memory:` for tests) |
| `TRUST_PROXY_HOPS` | `0` | How many proxy hops to trust in `X-Forwarded-For` |
| `SESSION_SECRET` | random per boot | Signs login sessions + IP hashes. **Pin it in production** or sessions reset on restart |
| `SITE_URL` | placeholder | Canonical origin used by `sitemap.xml` / `robots.txt` |
| `REVIEWS_MODERATED` | unset | `1` holds new reviews in `pending` until approved in the dashboard |

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
├── scripts/                     migrate, seed, full PIN-master loader, syntax check
└── tests/                       126 tests over schema, models, search, HTTP, pages, auth & SEO
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
  └── state            Andhra Pradesh, Assam, Maharashtra, Kerala, Telangana, ... (all 35 states & UTs)
        └── district   Hyderabad, Pune, Kamrup Metropolitan, Ernakulam, ... (≈600)
              └── city Guwahati, Pune, Kochi, ... (≈3,200)
                    └── locality  Uzan Bazar, Connaught Place, Indiranagar, ... (≈38,000)
                          └── pincode  781001, 110001, 560038, ... (≈24,000)
```

The database ships with the **complete national location master**: all 35 states/UTs,
~600 districts, ~3,200 cities and ~24,000 PIN codes with their post-office areas, so
provider signup and "near me" search work for virtually any real Indian address. The
commit only contains a small launch sample; the full master is loaded with
`scripts/load-full-pincodes.mjs` from the community **India-Codes** postal directory
CSV (`PostOfficeName, Pincode, DistrictsName, City, State`).

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
| `sessions` | Server-side login sessions | only the SHA-256 hash of the cookie is stored; revocable on logout/suspension |
| `reviews` | Customer ratings + comments | `approved` rows roll into `providers.rating_avg` |
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
| `GET`  | `/api/v1/providers/:slug/reviews` | Approved reviews + live rating |
| `POST` | `/api/v1/providers/:slug/reviews` | Leave a review (rate-limited) |

Pages: `/`, `/search`, `/categories`, `/locations`, `/login`, `/register`,
`/providers/new` (provider signup), `/dashboard` (provider area), `/providers/:slug`
(public profile + reviews), `/services/:slug`, `/about`, `/contact`, `/privacy`,
`/terms`, `/robots.txt`, `/sitemap.xml`. All server-rendered, all indexable.

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
- **Sessions**: server-side; the client cookie holds a random token whose **SHA-256 hash**
  is all the database stores. Cookies are `HttpOnly` + `SameSite=Lax` (+ `Secure` in
  production). Logout and account suspension revoke sessions immediately. Every
  state-changing browser form follows Post/Redirect/Get, so no inline JavaScript.
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
npm test          # 126 tests
npm run test:unit # schema, models, search
npm run test:http # HTTP layer + rendered pages
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
| `features.test.mjs` | Sessions/auth, provider onboarding + dashboard, reviews & ratings, SEO |

---

## Milestones — completed

1. **Foundation** — project structure, mobile-first UI, server-rendered pages, JSON API,
   database architecture and 32-PIN launch dataset. ✅
2. **Auth + provider onboarding** — scrypt accounts, revocable server-side sessions
   (`sessions`), customer signup (`/register`) and combined provider-listing form
   (`/providers/new`). ✅
3. **Provider dashboard** — `/dashboard`: add + publish/pause/archive services, add/remove
   coverage PIN codes, move enquiries through new/contacted/closed/spam, and moderate
   pending reviews. ✅
4. **Reviews & ratings** — `reviews` write-path behind `rating_avg`/`rating_count`, shown
   on public provider pages and exposed by the JSON API. ✅
5. **SEO surface** — indexable `/providers/:slug` and `/services/:slug`, `robots.txt`,
   `sitemap.xml`, plus `npm run import:pincodes` to bulk-load the full Indian PIN tree
   (starter file: `scripts/sample-pincodes.json`). ✅

## Full Indian PIN master

`npm run seed` loads a small launch sample. To run the marketplace against **every
state and PIN code in India**:

1. Grab the community **India-Codes** postal CSV (`PostOfficeName, Pincode,
   DistrictsName, City, State`) — e.g. `kishorek/India-Codes`.
2. `node scripts/load-full-pincodes.mjs pincodes.csv`

The loader is idempotent, skips malformed rows, normalises legacy state names
(Orissa→Odisha, Uttaranchal→Uttarakhand, …), keeps one node per PIN even when offices
share a code, and preserves the seeded demo providers. A fresh run takes ~15 s.

> The generated SQLite file lives in `data/` (git-ignored), so re-running the loader
> is a normal first step after a fresh clone or deploy — never commit the 19 MB
> database to version control.

## Deliberately still out of scope

Email delivery/verification, a full admin panel, messaging/chat, payment gateway,
UPI/QR and AdSense. The schema reserves space for each (`audit_logs`, `is_verified`,
`email_verified_at`, `rating_avg`) so any can be added with a forward-only migration.
Set `REVIEWS_MODERATED=1` and wire an SMTP sender when you take onboarding into
production (see the migration 0002 notes and `config.js`).
