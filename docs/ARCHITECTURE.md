# SEVA MARKET INDIA — Architecture (Foundation v0.1)

> Ye document starting foundation ke architecture decisions ko capture karta hai aur future marketplace features ke liye scaling path deta hai.

## 1 · Goals & non-goals (this phase)

**Goals**
- Production-grade project structure jo bina rewrite kiye scale ho
- Mobile-first UI foundation (India ka primary traffic = mobile)
- Complete data model: Users, Providers, Categories, Services, Locations
- India-standard location hierarchy: **State → District → City → Locality → PIN**
- Working search foundation: service + location + PIN
- Test coverage jo refactors ko safe rakhe

**Non-goals (deliberately excluded)**
- ❌ Payment gateway / UPI / QR — *future*
- ❌ Google AdSense — *future*
- ❌ Cloud deployment (Render etc.) — *future*
- ❌ Auth/OTP, reviews posting, leads/chat — *future*

## 2 · System overview

```
                    ┌──────────────────────────────────────────┐
 Browser / Mobile ──►  Next.js 14 App Router (TypeScript)      │
   (mobile-first)   │  ├── React Server Components (pages)     │
                    │  ├── Client components (search, nav)     │
                    │  └── Route handlers (/api/health, …)     │
                    └───────────────┬──────────────────────────┘
                                    │ Drizzle ORM (db/schema.ts)
                    ┌───────────────▼──────────────────────────┐
                    │  @libsql/client                           │
                    │  local file: SQLite (dev) → libsql/Turso  │
                    │  or PostgreSQL (drizzle pg-core) (prod)   │
                    └──────────────────────────────────────────┘
```

**Layering rules**
- `app/**` — routing + server-side data fetching only
- `components/**` — presentational, props-driven (DB import nahi karte; sirf pages fetch karte hain)
- `lib/**` — pure utilities, validation, shared query builders (framework-free where possible)
- `db/**` — schema (tables + relations + DDL), client singleton, push & seed scripts

## 3 · Data model decisions

| Decision | Rationale |
| --- | --- |
| **Drizzle ORM** (not Prisma) | Zero codegen/engine downloads (pure npm), typed SQL, relational query API, dialect-portable (sqlite ↔ pg). Prisma requires engine binaries from external hosts — avoid. |
| `db/ddl.ts` mirror + drift-guard test | Drizzle-kit-free push: DDL `CREATE IF NOT EXISTS` statements run via `db/push.ts`; tests assert sqlite_master matches — schema.ts aur ddl.ts kabhi diverge nahi kar sakte chupke se. |
| Roles as **strings** (`CUSTOMER`/`PROVIDER`/`ADMIN`) | SQLite native enums support nahi karta; PostgreSQL migration par native enum ban sakta hai. Allowed values `lib/constants.ts` + zod enforce karte hain. |
| `PRAGMA foreign_keys = ON` at client init | SQLite defaults FKs OFF — cascades/restricts db/schema.ts mein tabhi hold karte hain. |
| `ProviderProfile` **1:1 User** se alag model | Customer bana kar provider banaya ja sakta hai; auth identity business profile se alag rahegi. |
| `ServiceListing` junction table (provider ⇄ service) | Provider apni price band rakhta hai; platform-wide guide price `Service` par rehti hai. |
| `Locality → PINCode` **N:1** | Real India mein ek PIN kai localities cover karta hai → "search by PIN" naturally supported. Future mein N:M (locality spanning PINs) ki zaroorat pade to junction table add ho sakti hai — schema non-breaking extendable hai. |
| Denormalised `ratingAvg`/`ratingCount` on provider | Reviews system future mein hai; read-path fast rahega, reviews write par recompute honge. |
| `localityId` nullable on provider (SetNull on delete) | Location data cleanup provider ko delete nahi karega. |
| Composite uniques (`stateId+name`, `districtId+name`, `cityId+name`) | Same naam ke districts/cities alag states mein valid hain. |

## 4 · Search design (foundation)

`/search?service=…&location=…&pin=…&category=…`
- **service** → matches `ProviderProfile.businessName`, `Service.name`, `Category.name` (contains)
- **location** → matches `Locality.name` ya `City.name`
- **pin** → exact `Locality.pinCode` (validated: 6-digit, non-zero start)
- Filters AND-combine hote hain; results verified-first, then rating.
- Filter builder `lib/search.ts` mein hai — app aur tests dono same logic use karte hain.
- SQLite `LIKE` case-insensitive hai (ASCII); PostgreSQL migration par `mode: "insensitive"` add karna hoga.

**Scaling path:** text search burden badhne par Elasticsearch/Meilisearch/Postgres full-text index lagta hai; query interface (`lib/search.ts` service layer) abhi banane ka sahi waqt hai jab filters stabilize ho.

## 5 · UI foundation

- **Design tokens** (`tailwind.config.ts`): `brand` (saffron) + `navy` scales, `font-display` (Poppins) + `font-sans` (Inter)
- **Mobile-first patterns:** bottom navigation bar (app-jaisa thumb reach), hamburger menu, stacked search bar, 2-col category grid → 4-col desktop
- **Accessibility:** skip-to-content link, aria-expanded menus, sr-only labels, focus-visible rings, semantic landmarks
- **Graceful degradation:** DB down hone par homepage fallback categories se render hota hai, error page nahi

## 6 · Testing strategy

| Layer | Tool | Files |
| --- | --- | --- |
| Pure utils (slugify, INR format, PIN/phone validators, search URL builder) | Vitest | `tests/utils.test.ts` |
| Validation schemas (zod) | Vitest | `tests/validation.test.ts` |
| Components (Header menu, SearchBar behaviour, CategoryGrid) | Vitest + Testing Library | `tests/components/` |
| Database architecture (hierarchy CRUD, uniques, cascades, search-shaped query) | Vitest + dedicated test SQLite DB | `tests/db.test.ts` |

`npm test` har run par throwaway test DB re-create karta hai (`db:push:test`) — tests hamesha clean state par chalte hain, dev DB kabhi touch nahi hota.

## 7 · Future extensions (design already ready)

- **Auth (OTP):** `User.phone` unique hai; `passwordHash` field reserved hai
- **Reviews:** `Review` model (user, provider, rating, text) → recompute denormalised aggregates
- **Leads/enquiries:** `Lead` model (customer, provider, service, status) — contact flow already tel: links par hai
- **Service areas:** `ServiceArea` (provider × locality) for wider coverage than base locality
- **Payments:** payment-intent table + webhook handlers as separate module; koi existing model change nahi hoga
- **Deployment:** `next build` + PostgreSQL DATABASE_URL; health endpoint (`/api/health`) monitoring ke liye ready hai
