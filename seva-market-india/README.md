# SEVA MARKET INDIA

A local services marketplace for India: customers find and book verified service
professionals, professionals receive jobs and build a public rating, and administrators
approve profiles and watch the whole marketplace.

Built as a **single Node.js application with no third-party runtime dependencies** — the core
uses only Node built-ins (`node:http`, `node:sqlite`, `node:crypto`, `node:fs`).

---

## Run it

```bash
node server.js                 # http://localhost:3000
PORT=8080 node server.js
npm test                       # syntax check + full API smoke test (33 checks)
```

Requires **Node.js 22.5 or newer** (uses the built-in `node:sqlite` driver).

On first start an **administrator** is created (default `admin@sevamarketindia.in`, or
`ADMIN_EMAIL`). The password comes from `ADMIN_PASSWORD`, otherwise it is generated and written
to the private `data/admin-credentials.txt`. Demo accounts are also created so the flows can be
tried immediately (disable with `SMI_DEMO_ACCOUNTS=0`):

| Role | Email | Password |
| --- | --- | --- |
| Customer | `demo.customer@sevamarketindia.in` | `Demo@12345` |
| Professional | `demo.provider@sevamarketindia.in` | `Demo@12345` |
| Administrator | `ADMIN_EMAIL` (default `admin@sevamarketindia.in`) | `ADMIN_PASSWORD` or generated |

---

## What it does

**For customers**
- Home search by service + city, 12 service categories, transparent starting prices
- Professional search with filters: keyword, category, city, minimum rating, verified-only,
  sort by rating / price / experience / newest, pagination
- Professional profile: services with prices, real reviews, experience, jobs completed
- Booking flow: choose service → date → time slot → address → notes, with a live price summary
- Dashboard: active bookings, history, cancel, and review after completion
- Pay only after the work is done (cash or UPI, directly to the professional)

**For professionals**
- Free profile with business name, category, city, area, experience, headline and about text
- Job requests with accept / decline, mark completed, earnings summary
- Profile is reviewed by an administrator before it appears in search

**For administrators**
- Dashboard: customers, live professionals, pending approvals, bookings, gross booking value
- Approve / suspend / verify professionals
- Recent bookings across the platform

**Platform**
- scrypt password hashing, server-side sessions (logout and suspension really end a session)
- Same-origin + JSON required for every state-changing request
- Rate limiting on register, login, booking and the contact form
- Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy)
- `robots.txt`, `sitemap.xml`, canonical URLs, per-page titles and meta descriptions
- Mobile-first responsive design, no external fonts, no CDN, works offline

---

## Project layout

```
seva-market-india/
├── server.js              HTTP server, static files, robots.txt, sitemap.xml
├── lib/
│   ├── api.js             every JSON route (validation, authorisation, rate limits)
│   ├── auth.js            scrypt hashing, session tokens and cookies
│   ├── db.js              SQLite storage layer + catalogue seeding
│   ├── http-security.js   security headers, rate limiter, same-origin check
│   └── seed-data.js       categories, services, cities, demo professionals, reviews
├── public/
│   ├── index.html         home
│   ├── services.html      full service catalogue with prices
│   ├── providers.html     search and filters
│   ├── provider.html      profile + booking panel
│   ├── login.html         login and registration (customer / professional)
│   ├── dashboard.html     customer dashboard
│   ├── provider-dashboard.html  professional dashboard
│   ├── admin.html         administration
│   ├── about.html contact.html terms.html privacy.html 404.html
│   └── assets/            css + js (no build step, no bundler)
└── scripts/
    ├── check-syntax.mjs   node --check over every source file
    └── smoke-test.mjs     boots the real server and walks every flow over HTTP
```

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | service health and catalogue counts |
| GET | `/api/site` | categories, cities, slots, trust points, steps, counters |
| GET | `/api/categories` | service categories |
| GET | `/api/services?category=` | services with prices |
| GET | `/api/providers` | search (`category`, `city`, `q`, `min_rating`, `max_price`, `verified`, `sort`, `page`) |
| GET | `/api/providers/:id` | profile with services and reviews |
| POST | `/api/auth/register` | create a customer or professional account |
| POST | `/api/auth/login` · `/api/auth/logout` · GET `/api/me` | sessions |
| POST | `/api/bookings` · GET `/api/bookings` · PATCH `/api/bookings/:id` | booking lifecycle |
| POST | `/api/reviews` | review a completed booking (one per booking) |
| PUT | `/api/provider/me` | professional edits their own profile |
| GET | `/api/admin/stats` · `/api/admin/providers` · PATCH `/api/admin/providers/:id` · `/api/admin/bookings` | administration |
| POST | `/api/contact` | contact form (stored privately in `data/contacts.jsonl`) |

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | bind address |
| `SMI_DATA_DIR` | `./data` | SQLite file, admin credentials, contact messages |
| `SITE_URL` | request origin | canonical URLs in `robots.txt` / `sitemap.xml` |
| `ADMIN_EMAIL` | `admin@sevamarketindia.in` | first administrator |
| `ADMIN_PASSWORD` | generated | administrator password (never logged; written to `data/`) |
| `SMI_DEMO_ACCOUNTS` | `1` | set `0` in production to skip the demo accounts |
| `TRUST_PROXY_HOPS` | `0` | set `1` behind a single proxy (Render, Railway) for correct client IPs |

## Deployment

See **[DEPLOY.md](DEPLOY.md)**. In short: the app is a single process with one SQLite file, so
it runs anywhere Node 22.5+ is available. On hosts with an ephemeral disk (Render Free, most
serverless platforms) attach a **persistent disk** or point `SMI_DATA_DIR` at one — otherwise the
database is recreated when the instance restarts. The storage layer is isolated in `lib/db.js`,
so moving to Postgres later does not touch the API or the pages.

## Tests

```bash
npm test
```

`scripts/smoke-test.mjs` starts the real server on a random port with a temporary data
directory and exercises 33 checks across the public catalogue, customer registration and
booking, professional registration, admin approval, the review lifecycle, rate-limited forms,
SEO files, 404 handling and logout/session invalidation. No mocks and no network stubs.

## Scope

The catalogue, professionals, reviews and demo bookings in the seed are sample content for
demonstration. Payment is intentionally **offline by design**: customers settle with the
professional directly after the job, so no payment gateway, card data or wallet integration is
required. Email/SMS delivery is not wired up — bookings are visible in the dashboards, and the
contact form stores messages in `data/`.
