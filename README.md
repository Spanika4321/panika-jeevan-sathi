# 🇮🇳 SEVA MARKET INDIA

**India-wide local services marketplace** — customers local service providers ko **service + city/locality + PIN code** ke through dhoondh aur contact kar sakte hain.

> **Status: Foundation v0.1** — ye starting foundation hai. Payments/UPI/QR, AdSense aur cloud deployment intentionally **abhi included nahi hain** (roadmap par hain).

---

## ✅ Foundation mein kya hai

| Area | Detail |
| --- | --- |
| Project structure | Next.js 14 App Router + TypeScript, layered & scalable |
| UI foundation | Mobile-first, Tailwind CSS design system (brand saffron + navy tokens) |
| Homepage | Hero + service/location/PIN search, categories grid, how-it-works, provider CTA |
| Header & navigation | Sticky header, desktop nav, mobile hamburger menu, mobile bottom nav bar |
| Database | Drizzle ORM + @libsql/client — SQLite-compatible (dev), PostgreSQL/libsql-ready |
| Models | `User`, `ProviderProfile`, `ServiceListing`, `Category`, `Service`, `State`, `District`, `City`, `Locality`, `PINCode` |
| Location tree | India → State → District → City → Locality → PIN (36 states/UTs + metro sample data seeded) |
| Pages | `/`, `/categories`, `/category/[slug]`, `/search`, `/provider/join`, `/api/health`, 404 |
| Validation | zod schemas at app boundary (search params, provider onboarding shape) |
| Tests | Vitest + Testing Library — utils, validation, components, database architecture |

## 🗺️ Roadmap (not in this phase)

Payments gateway · UPI/QR · Google AdSense · Render/cloud deployment · Auth (OTP login) · Reviews & ratings flow · Leads/chat · Provider dashboards

---

## 🛠️ Tech stack

- **Framework:** [Next.js 14](https://nextjs.org/) (App Router, React Server Components)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS (mobile-first) + lucide-react icons, fonts bundled via Fontsource
- **Database:** [Drizzle ORM](https://orm.drizzle.team) + [@libsql/client](https://github.com/tursodatabase/libsql) (local `file:` SQLite now; managed libsql/Turso or PostgreSQL later)
- **Validation:** zod
- **Testing:** Vitest, @testing-library/react, jsdom

## 🚀 Getting started

```bash
# 1. Install dependencies
npm install

# 2. Create the dev database + seed (36 states/UTs, metros, categories, demo providers)
npm run db:setup

# 3. Start dev server
npm run dev          # http://localhost:3000
```

Useful URLs: `/` homepage · `/categories` · `/search?service=Electrician&location=Karol+Bagh&pin=110005` · `/api/health`

## 🧪 Testing

```bash
npm test             # resets a throwaway test DB, then runs the full suite
npm run typecheck    # strict TypeScript check
npm run build        # production build verification
```

## 📜 Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server (`0.0.0.0:3000`) |
| `npm run build` / `start` | Production build / serve |
| `npm run db:setup` | Schema push + seed dev database |
| `npm run db:push` | Create/sync tables (idempotent) |
| `npm run db:reset` | Drop & re-create all tables |
| `npm run db:seed` | Seed only (idempotent upserts) |
| `npm test` | Test DB reset + full Vitest suite |
| `npm run typecheck` | `tsc --noEmit` |

## 📁 Project structure

```
├── app/                      # Next.js App Router
│   ├── layout.tsx            # Root layout — header, footer, bottom nav, SEO metadata
│   ├── page.tsx              # Homepage (DB-driven category grid)
│   ├── categories/           # All categories index
│   ├── category/[slug]/      # Category detail + services
│   ├── search/               # Provider search results (service + location + PIN)
│   ├── provider/join/        # Provider onboarding landing (static, foundation)
│   ├── api/health/           # Health check endpoint (app + DB)
│   └── not-found.tsx         # 404
├── components/
│   ├── layout/               # Header, Footer, MobileBottomNav, Logo
│   ├── home/                 # Hero, CategoryGrid, HowItWorks, ProviderCta
│   └── search/               # SearchBar (service + location + PIN)
├── lib/
│   ├── constants.ts          # Site config, nav links, fallback categories
│   ├── icons.tsx             # Category icon registry
│   ├── search.ts             # Shared provider-search filter builder
│   ├── utils.ts              # Pure helpers (slugify, formatINR, PIN/phone validators…)
│   └── validation.ts         # zod schemas (app boundary)
├── db/
│   ├── schema.ts             # Drizzle tables + relations + types (the data model)
│   ├── ddl.ts                # DDL kept 1:1 with schema (drift-guarded by tests)
│   ├── client.ts             # libsql client singleton + .env loader + FK pragma
│   ├── index.ts              # Drizzle instance (typed relational query API)
│   ├── push.ts               # `db:push` / `db:reset` schema sync script
│   └── seed.ts               # States/UTs, metros, categories, services, demo providers
├── tests/                    # Vitest suite (utils, validation, components, DB)
└── docs/
    └── ARCHITECTURE.md       # Architecture decisions & scaling path
```

## 🗃️ Data model

```
User 1 ── 1 ProviderProfile ──┐
        (role: PROVIDER)      │ lists
                               ▼
Category 1 ── N Service N ── 1 ServiceListing (provider ⇄ service, price band)

Location tree:
State 1 ── N District 1 ── N City 1 ── N Locality N ── 1 PINCode
                                    ▲                (one PIN covers many localities)
        ProviderProfile.baseLocality┘
```

Search flow: **service name/category → provider listings**, **city/locality name or PIN → provider locality** — dono filters combine hote hain (`/search?service=…&location=…&pin=…`).

## ⚙️ Environment

See [.env.example](./.env.example). Foundation sirf ek variable use karta hai:

```
DATABASE_URL="file:./dev.db"     # dev SQLite file (production: libsql/Turso URL)
```

**Production database paths (schema is dialect-portable):**
1. **libsql/Turso (zero-change):** `DATABASE_URL="libsql://…"` + auth token — same Drizzle schema, just add credentials.
2. **PostgreSQL:** `db/schema.ts` ko `drizzle-orm/pg-core` definitions mein port kijiye (column types 1:1 map hoti hain) — queries unchanged rehte hain kyunki app sirf relational query API use karta hai.

## 📄 License

© Seva Market India. All rights reserved. (Proprietary — license TBD before launch.)
