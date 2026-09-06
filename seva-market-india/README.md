# SEVA MARKET INDIA

India-wide **local services marketplace**. Customers find and contact local service
providers by **service + location + PIN code**.

Milestone 1 laid the foundation: project structure, a professional mobile-first UI,
server-rendered pages, a JSON API, and the database architecture for users, providers,
categories, services and the full Indian location hierarchy.

**Milestone 2 turned it into a marketplace**: accounts and sessions, provider
onboarding with a manual review queue, a provider dashboard (services, coverage PIN
codes, incoming enquiries) and an admin area. A provider can sign up, list a business,
be approved, and take enquiries from the PIN codes they cover — end to end, with no
third-party package anywhere in the path.

> **Zero npm dependencies.** The app is built entirely on Node.js built-ins
> (`node:http`, `node:sqlite`, `node:crypto`, `node:test`) and requires **Node.js 22.5+**.
> `npm install` is not needed to run, test or seed the site.

---

## Run it

```bash
node server.js             # http://localhost:3000
```

Booting creates the database file, applies migrations, and — in development only —
seeds the launch dataset when the database is empty, so a clone works on the first
`node server.js`. To do it by hand (or to rebuild production):

```bash
node scripts/migrate.mjs   # create the schema
node scripts/seed.mjs      # load the launch dataset (idempotent)
```

```bash
npm start          # run the site
npm run dev        # run with auto-reload
npm test           # full suite (230 tests)
npm run test:unit  # models, schema, search, auth, onboarding
npm run test:http  # HTTP layer, rendered pages, dashboard
npm run check      # syntax check every source file
npm run migrate    # apply migrations
npm run seed       # load seed data
```

```bash
# create an administrator on boot (both must be set; idempotent)
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-passphrase1' node server.js
```

Verification and password-reset links are written as files into `data/outbox/` — this
build has no SMTP dependency, and every link also carries a token that expires.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `production` turns on secure cookies and hides debug tokens |
| `SITE_URL` | — | Absolute base for emailed links |
| `SEVA_DB_FILE` | `./data/seva-market.db` | SQLite path (`:memory:` for tests) |
| `TRUST_PROXY_HOPS` | `0` | How many proxy hops to trust in `X-Forwarded-For` |
| `SESSION_SECRET` | auto | Signs session and token hashes. Generated into `data/session-secret.key` (`0600`) when unset — set it in production |
| `SEVA_SESSION_DAYS` | `30` | Session cookie lifetime |
| `SEVA_SECURE_COOKIES` | `NODE_ENV=production` | Force the `Secure` cookie flag on or off |
| `SEVA_REQUIRE_EMAIL_VERIFICATION` | `false` | Block sign-in until the emailed link is followed |
| `SEVA_LOGIN_WINDOW_MINUTES` / `SEVA_LOGIN_MAX_ATTEMPTS` | `15` / `10` | Login throttle per email + IP |
| `SEVA_VERIFY_TOKEN_MINUTES` / `SEVA_RESET_TOKEN_MINUTES` | `1440` / `60` | Token lifetimes |
| `SEVA_AUTO_APPROVE_PROVIDERS` | `false` | Publish new listings without review (demos only) |
| `SEVA_MAX_SERVICE_AREAS` | `25` | Coverage PIN codes per provider |
| `SEVA_OUTBOX_DIR` | `./data/outbox` | Where outbound email files are written |
| `SEVA_MAIL_ENABLED` | `true` | `false` disables the outbox entirely |
| `MAIL_FROM` | `SEVA MARKET INDIA <no-reply@seva-market.local>` | Envelope sender |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Bootstrap admin, created (and promoted) at boot |

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
│   │   ├── migrations/0002_auth_onboarding.sql
│   │   ├── seed.js              idempotent loader
│   │   ├── seed-data.js         the launch dataset (real PIN codes)
│   │   └── values.js            pure helpers: slugs, PIN/phone, LIKE patterns
│   ├── models/                  location, category, provider, service, user, lead,
│   │                            auth (passwords, sessions, tokens, throttle), verification
│   ├── http/
│   │   ├── router.js            pattern router + accurate Allow headers
│   │   ├── respond.js           one JSON envelope, HttpError, HTML sender
│   │   ├── request.js           body parsing (size-capped) + validators
│   │   ├── cookies.js           Set-Cookie serialisation
│   │   ├── auth.js              session resolution, CSRF proof, route guards
│   │   └── security.js          security headers, trusted client IP
│   ├── actions/                 the only place a multi-table write is orchestrated
│   │   ├── auth.js              register, sign in, verify, reset, change
│   │   ├── onboarding.js       account + listing + first service + coverage, atomically
│   │   └── dashboard.js         service / coverage / profile / lead updates
│   ├── mail/mailer.js           file outbox (no SMTP dependency in this build)
│   ├── routes/
│   │   ├── pages.js             public HTML pages, provider and service profiles
│   │   ├── auth-pages.js        sign in / up / account
│   │   ├── onboarding-pages.js  the provider listing form
│   │   ├── dashboard-pages.js   provider dashboard
│   │   ├── admin-pages.js       review queue, badge, housekeeping
│   │   ├── search-context.js    query string -> typed search filters
│   │   └── api/                 health, locations, categories, services, providers,
│   │                            auth, admin
│   └── views/                   layout, forms, HTML escaping, per-area page bodies
├── public/assets/               CSS (mobile-first), JS enhancement, logo
├── scripts/                     migrate, seed, syntax check
└── tests/                       230 tests over schema, models, search, HTTP, pages,
                                 auth, onboarding, dashboard
```

**Layering rule:** routes never write SQL, models never touch `req`/`res`, and views
never query the database. Anything that has to keep two tables consistent lives in
`src/actions/` and runs inside one transaction.

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
| `audit_logs` | Who changed what | every approval, badge, suspension and password change |
| `sessions` | Signed-in browser sessions | stores only `HMAC(secret, token)`; a leaked table cannot replay a cookie |
| `auth_tokens` | Email verification + password reset | single-use, purpose-partitioned hashes, expiry column |
| `login_throttle` | Failed sign-in counter | keyed by `HMAC(secret, email|ip)`, never the raw address |
| `provider_documents` | Verification references (GSTIN, Udyam, photos) | stored **masked** (`22*******A1Z5`), status follows the review |
| `schema_migrations` | Applied migration versions | forward-only, tracked per boot |

Migration `0002` widens the foundation rather than replacing it: `users.status`,
`providers.review_note`, `leads.read_at` / `provider_note` and the four tables above,
each with `ON DELETE CASCADE` back to `users` or `providers` so no orphan session or
document can survive an account deletion.

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
| `POST` | `/api/v1/providers` | One-step onboarding: account (optional) + listing + first service |
| `GET` | `/api/v1/providers/availability` | `?pin=` — who is already listed at that PIN |

**Auth** (session cookie + CSRF proof on every state-changing call):

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/auth/register` | Create an account, sign in immediately |
| `POST` | `/api/v1/auth/login` · `POST /logout` | Session cookie in, session revoked out |
| `GET` | `/api/v1/auth/me` | Current user + CSRF token for the SPA-less frontend |
| `POST` | `/api/v1/auth/verify-email` · `GET /verify-email` | Confirm the address from the emailed link |
| `POST` | `/api/v1/auth/password/forgot` · `/reset` · `/change` | Reset flow (identical response for unknown emails) |
| `POST` | `/api/v1/auth/sessions/revoke` | Sign every other device out |

**Provider account** (`me` resolves the caller's listing — no provider id is ever
accepted from the client):

| Method | Route | Purpose |
| --- | --- | --- |
| `GET`/`PATCH` | `/api/v1/providers/me` | Read and edit the business profile |
| `POST` | `/api/v1/providers/me/publish` | Ask for review / go live once approved |
| `POST` | `/api/v1/providers/me/services` | Add a service |
| `PUT`/`PATCH` | `/api/v1/providers/me/services/:id` | Edit or move a service between statuses |
| `PUT` | `/api/v1/providers/me/service-areas` | Replace the coverage PIN list |
| `GET`/`PATCH` | `/api/v1/providers/me/leads[/:id]` | Enquiry inbox and triage (`new/contacted/closed/spam`) |
| `POST` | `/api/v1/providers/me/documents` | Submit a masked document reference for verification |
| `GET` | `/api/v1/providers/me/pickers` | Category / location ids the dashboard form needs |

**Admin** (role-checked, audited):

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/summary` · `/audit` | Marketplace totals, recent events |
| `GET` | `/api/v1/admin/providers[/:id]` | The review queue, with owner contact and document counts |
| `POST` | `/api/v1/admin/providers/:id/review` | `approve` / `reject` / `request-info`, optional badge, notifies the owner |
| `POST` | `/api/v1/admin/providers/:id/verify` | Grant or remove the verified badge |
| `POST` | `/api/v1/admin/users/:id/suspend` | Suspend an account and kill its sessions |
| `POST` | `/api/v1/admin/housekeeping` | Purge expired sessions, tokens and throttle rows |

### Pages

Every page above has an HTML counterpart, so the site works with JavaScript disabled
and a form POST is answered with a redirect (POST-redirect-GET) rather than a page
that re-submits on reload.

`/`, `/search`, `/categories`, `/locations`, `/about`, `/contact`, `/privacy`, `/terms`,
`/providers/:slug`, `/services/:slug` — public and indexable.

`/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`,
`/account` — signed-in where it matters; `noindex` for anything behind a session.

`/providers/new` (the one-step listing form), `/dashboard` (overview, services,
coverage, enquiries, business details) and `/admin` (review queue, `/admin/overview`)
— all `noindex, nofollow`.

Pages that resolve a provider or service by `:slug` are registered **after** the
literal routes, because the router is first-match-wins at both layers: that is why
`/providers/new` is a form and not a business called "new".

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
- **Rate limiting** on enquiry capture (5/hour/IP) and on sign-in (10 attempts per
  email + IP per window), both returning `429` with a `Retry-After`. Client IPs are
  stored as a salted HMAC, never raw.
- **Sessions**: a 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure`
  in production); only its HMAC is stored. Revoking is instant — a suspended or
  re-signed-out account's next request finds no live session, and `last_seen_at` is
  written at most once every five minutes so browsing stays cheap.
- **CSRF**: state-changing requests that carry a session cookie must also carry the
  proof, in `x-csrf-token` (JSON) or a `_csrf` field (forms). The proof is derived from
  the session token with a different HMAC purpose, so it cannot be lifted from a URL,
  and it is checked before the handler parses the body.
- **Verification and reset tokens** are single-use, expiring, and hashed per purpose —
  a verification token will not authenticate a password reset. Links are emailed to
  the outbox; in development the raw token is also returned in the API response, and
  never in production.
- **Passwords**: a wrong password and an unknown email return byte-identical 401s with
  the same wording and comparable timing, so the form cannot be used to enumerate accounts.
- **Proxy trust** is explicit: only the configured number of `X-Forwarded-For` hops is
  believed, so a client cannot spoof its address.
- **Errors never leak internals** — a 500 returns a short reference id and logs server-side.
- Baseline headers on every response: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- Static file serving resolves inside `public/` and refuses path traversal.

---

## Testing

```bash
npm test          # 230 tests
npm run test:unit # schema, models, search, auth, onboarding
npm run test:http # HTTP layer, rendered pages, dashboard, admin
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
| `auth.test.mjs` | Password policy and hashing, registration, sessions, CSRF proof, tokens, throttle, bootstrap admin, audit rows |
| `auth-http.test.mjs` | Cookie flags, CSRF gate, throttle responses, every auth form page, open-redirect refusal, outbox mail |
| `onboarding.test.mjs` | One-step signup, validation before writes, coverage limits, review approve/reject, ownership |
| `dashboard.test.mjs` | Service CRUD, coverage replace, enquiry flow and triage, public profiles, admin pages, CSP hygiene |

---

## Deliberately not built yet

Payment gateway, UPI/QR, AdSense, Render deployment, messaging, and the reviews &
ratings write path. `rating_avg` / `rating_count` are read from the schema but nothing
writes them yet; the columns are already there so that milestone needs no destructive
migration. Email is a file outbox, not SMTP — a transport can be plugged in behind
`mailer.send()` without touching a single call site.

The location master ships with a representative sample (states, districts, cities,
localities and PIN codes for the launch markets) rather than all 19,000+ Indian PIN
codes. A provider in an unknown-but-valid PIN is still onboarded: `resolvePlace`
creates the missing branch of the tree instead of refusing the form.

## Next milestones

1. **Reviews & ratings** — the write path behind `rating_avg` / `rating_count`, with a
   verified-enquiry requirement before a review can be left.
2. **Full location master** — bulk import of all Indian districts and PIN codes.
3. **SEO surface** — `sitemap.xml`, `robots.txt`, canonical city/category landing pages.
4. **Real email transport** — SMTP or a provider API behind the existing `send()`.
5. **Messaging** — thread replies onto `leads` so a quote can be negotiated in-site.
