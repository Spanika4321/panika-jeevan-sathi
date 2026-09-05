# SEVA MARKET INDIA

An **India-wide local services marketplace**: customers find and contact nearby service providers by
**service**, **city / locality** or **PIN code**.

This is the **foundation** of the project — project structure, mobile-first UI shell, home page,
header + navigation, the database architecture with versioned migrations, and the core domain models
(Users, Providers, Categories, Services, Locations with the full
`India → State → District → City → Locality → PIN` hierarchy).

Built as a single Node.js process with **zero runtime dependencies**: Node.js ≥ 22.5, the standard
library, and the built-in `node:sqlite` driver.

---

## Run it

```bash
cd seva-market
node server.js                 # http://localhost:3100
PORT=3200 node server.js

npm run check                  # syntax gate (JS + inline HTML scripts + JSON-LD)
npm test                       # syntax + 131 unit/integration/HTTP/UI tests
npm run migrate                # apply schema migrations
npm run migrate -- --status    # show applied migrations
npm run seed                   # reference data (India → PIN codes, service catalogue)
npm run seed -- --demo         # + demonstration provider listings
```

On first boot in development the database is migrated and seeded automatically
(`SEVA_AUTO_SEED=1`, default outside production).

---

## What is in place today

| Area | Status |
| --- | --- |
| Layered architecture (config → db → repositories → services → API → UI) | ✅ |
| Versioned SQL migrations with checksums and a drift guard | ✅ |
| Portable schema (runs on SQLite now, PostgreSQL without changes later) | ✅ |
| Domain models: users, providers, categories, services, locations | ✅ |
| India geography: 36 states/UTs, districts, cities, localities, PIN codes | ✅ |
| Service + PIN code search with pagination and sorting | ✅ |
| Accounts: register, sign in, session cookie, listing ownership | ✅ |
| Mobile-first UI: header, drawer, bottom nav, home, search, provider, account | ✅ |
| Public JSON API (`/api/v1/*`) with rate limiting and security headers | ✅ |
| SEO: robots.txt, sitemap.xml, JSON-LD, canonical meta | ✅ |

## Deliberately **not** in this step

Per the brief, these are out of scope for the foundation and are not wired in anywhere:

- ❌ Payment gateway of any kind (no commissions, no checkout; providers are contacted directly)
- ❌ QR codes and UPI payment links
- ❌ Google AdSense or any advertising
- ❌ Render (or any other host) deployment config

The architecture leaves a place for each (see `docs/ARCHITECTURE.md` → "Deliberately deferred").

---

## Project structure

```
seva-market/
├── server.js                  # entry point: config → migrate → seed → services → listen
├── lib/
│   ├── config.js              # environment → validated configuration (fail fast at boot)
│   ├── errors.js              # typed AppError → HTTP status + stable machine code
│   ├── log.js                 # structured logger (pretty in dev, JSON in prod)
│   ├── validate.js            # declarative validation (IN phone, PIN, email, slug…)
│   ├── slug.js                # URL slugs
│   ├── ids.js                 # UUIDv4 primary keys
│   ├── db/
│   │   ├── index.js           # driver factory (sqlite | memory | postgres*)
│   │   ├── driver-sqlite.js   # portable SQL over node:sqlite
│   │   ├── driver-memory.js   # in-memory driver for tests
│   │   ├── migrate.js         # ordered, checksummed migrations
│   │   ├── schema.js          # table registry derived from the models
│   │   └── migrations/        # 001_locations · 002_catalog · 003_accounts · 004_providers
│   ├── domain/                # models: columns, rules, row builders, public shapes
│   │   ├── location.js  catalog.js  user.js  provider.js  index.js
│   ├── repo/                  # data access (the only place that touches the driver)
│   ├── services/              # business rules: auth, users, geo, catalog, search, providers
│   ├── http/                  # router, security headers, rate limiter, static files
│   ├── api/                   # /api/v1 route table + the handler that wraps it
│   └── seed/                  # reference data + idempotent seeders
├── public/                    # mobile-first web app (static HTML, CSS, vanilla JS)
│   ├── index.html  search.html  provider.html  account.html  404.html
│   └── assets/css  assets/js  assets/img
├── scripts/                   # check-syntax, run-tests, migrate, seed
├── tests/                     # node:test suites (unit → integration → HTTP → UI)
└── docs/                      # ARCHITECTURE.md, DATA-MODEL.md
```

---

## API

All responses are JSON. Success: `{ ok: true, … }`. Failure: `{ ok: false, error, code, details? }`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | platform health (driver, environment, migrations) |
| GET | `/api/v1/health` | API health + uptime |
| GET | `/api/v1/meta` | site constants and record counts |
| GET | `/api/v1/home` | one payload for the mobile home screen |
| GET | `/api/v1/categories` | browse categories |
| GET | `/api/v1/categories/:slug` | one category with its services |
| GET | `/api/v1/services?category=` | services in a category |
| GET | `/api/v1/locations/states` | 36 states and union territories |
| GET | `/api/v1/locations/districts?state=` | districts in a state |
| GET | `/api/v1/locations/cities?state_id=` | cities in a state/district |
| GET | `/api/v1/locations/localities?city_id=` | localities in a city |
| GET | `/api/v1/locations/pincodes/:code` | PIN code → full place |
| GET | `/api/v1/locations/resolve?q=` | resolve free text into a place |
| GET | `/api/v1/search` | `service`, `category`, `city`, `state`, `pincode`, `q`, `page`, `sort` |
| GET | `/api/v1/providers/:slug` | provider detail |
| GET | `/api/v1/providers/mine` | listings owned by the signed-in user |
| POST | `/api/v1/providers` | submit a listing (account required) |
| POST | `/api/v1/auth/register` | create an account (rate limited) |
| POST | `/api/v1/auth/login` | sign in (rate limited) |
| POST | `/api/v1/auth/logout` | clear the session cookie |
| GET | `/api/v1/auth/me` | current account |

```bash
curl 'http://localhost:3100/api/v1/search?service=tap-faucet-repair&pincode=110005'
curl 'http://localhost:3100/api/v1/locations/pincodes/560034'
```

---

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `3100` | HTTP port |
| `HOST` | `0.0.0.0` | bind address |
| `SEVA_DB_DRIVER` | `sqlite` | `sqlite` \| `memory` |
| `SEVA_DATA_DIR` | `./data` | SQLite file location |
| `SEVA_AUTO_MIGRATE` | `1` | apply migrations on boot |
| `SEVA_AUTO_SEED` | `1` outside production | seed reference data on boot |
| `SEVA_SITE_URL` | — | canonical HTTPS origin (required in production) |
| `SEVA_SESSION_SECRET` | generated in dev | HMAC session key (≥ 32 chars in production) |
| `SEVA_SESSION_TTL_HOURS` | `720` | session lifetime |
| `SEVA_TRUST_PROXY_HOPS` | `0` | exact number of trusted proxies |
| `SEVA_LOG_LEVEL` / `SEVA_LOG_JSON` | `debug` / off | logging |
| `SEVA_RATE_LIMIT_MAX` | `120` | requests per window per IP |

Production refuses to boot without an HTTPS `SITE_URL`, a ≥ 32-character session secret, a
persistent driver and auto-seed switched off — `validateConfig` lists every problem at once.

---

## Tests

```bash
npm test
```

131 tests across 10 files, plus 61 syntax checks:

`config` · `validate` · `auth` · `schema` (migration ↔ model drift guard) · `locations` ·
`catalog` · `users` · `providers` · `search` · `http` (real server, real SQLite) ·
`ui-foundation` (mobile-first, CSP-safe, no dead links)

---

## Next steps

Provider onboarding review queue · ratings and reviews · enquiry/lead tracking · the full
India Post PIN directory import · provider dashboard · admin console · payments (only when asked).

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** and **[docs/DATA-MODEL.md](docs/DATA-MODEL.md)**.
