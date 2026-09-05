# SEVA MARKET INDIA — data model

Source of truth: **`seva-market/lib/db/migrations/*.sql`**, mirrored (and test-enforced) by the
domain models in `lib/domain/`.

## Conventions

| Decision | Why |
| --- | --- |
| `id text` UUIDv4 primary keys | portable across SQLite/Postgres, safe in URLs, no enumeration, no count leaks |
| `bigint` epoch-millisecond timestamps | SQLite has no timezone-aware type; one portable integer type |
| `integer` 0/1 flags with `CHECK (… IN (0,1))` | portable boolean |
| Money in **paise** (`integer`) | no floating-point rounding on ₹ amounts |
| Lower-case `search_text` column | keyword search that behaves identically on SQLite and Postgres today |
| Parameterised SQL + quoted identifiers | injection-safe |
| `ON DELETE CASCADE` / `SET NULL` | referential integrity is enforced by the database |

## Tables

### Location hierarchy

```
countries ──< states ──< districts ──< cities ──< localities
                                   └──< pincodes ──┘
```

| Table | Key columns | Notes |
| --- | --- | --- |
| `countries` | `name`, `code` (IN), `iso3`, `phone_code`, `currency_code` | root, so the model is not hard-coded to one country |
| `states` | `country_id`, `name`, `slug`, `code` (MH), `type` `state`/`union_territory` | all 28 states + 8 UTs seeded |
| `districts` | `state_id`, `name`, `slug` | unique per state |
| `cities` | `district_id`, `state_id`, `name`, `slug`, `is_metro`, lat/lng | `state_id` is denormalised for state-wide search |
| `pincodes` | `code` (6 digits, unique), `office_name`, `city_id`, `district_id`, `state_id`, lat/lng | India Post PIN codes are their own entity: one PIN can cover several localities |
| `localities` | `city_id`, `pincode_id`, `name`, `slug`, lat/lng | neighbourhoods ("Koramangala", "Karol Bagh") |

**Why six tables and not one tree?** Levels mean different things in India: districts are
administrative, cities are what people search for, localities make a result feel "near me", and PIN
codes are postal — a PIN can span localities and, at borders, even districts. Modelling them
separately keeps each query an indexed lookup.

### Catalogue

| Table | Key columns | Notes |
| --- | --- | --- |
| `categories` | `parent_id` (self FK), `name`, `slug`, `icon`, `sort_order`, `is_active` | 12 seeded; `parent_id` allows future sub-categories |
| `services` | `category_id`, `name`, `slug`, `sort_order` | 65 seeded; the specific job a customer books |

### Accounts

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | `email` (unique), `phone` (unique when present), `password_hash`, `role` (`customer`/`provider`/`admin`), `status`, `email_verified`, `phone_verified`, `state_id`, `city_id`, `pincode`, `token_version` | one identity per person; owning a business is a separate provider record |

### Providers

| Table | Key columns | Notes |
| --- | --- | --- |
| `providers` | `user_id`, `business_name`, `slug`, `primary_category_id`, `locality_id`/`city_id`/`district_id`/`state_id`, `pincode_id` + denormalised `pincode`, `service_radius_km`, `phone`, `whatsapp`, `experience_years`, `status` (`draft`/`pending`/`approved`/`rejected`/`suspended`), `verification_level`, `is_active`, `rating_sum`/`rating_count`, `search_text` | the business a customer contacts |
| `provider_services` | `provider_id`, `service_id`, `category_id`, `price_from`, `price_to`, `price_unit`, `is_primary` | what they do and an indicative (non-transactional) price range |
| `provider_areas` | `provider_id`, `pincode_id`, `pincode` | every PIN they travel to — this is what makes PIN search exact |

### Platform

`schema_migrations(version, checksum, applied_at)` — written by the migration runner.

## Search: how "plumber in 110001" is answered

1. `geo.resolve()` turns the PIN/city/state/free text into `{ cityId, stateId, localityId, pincode }`.
2. `providers.search()` takes providers whose **own PIN** matches, **or** who list that PIN in
   `provider_areas`, **or** whose city matches — then intersects with providers linked to the
   requested service(s) (`provider_services`), then filters by keyword on `search_text`.
3. Only `status = 'approved' AND is_active = 1` rows are ever returned.
4. Results are ranked by verification level, then rating, then popularity; `sort` accepts
   `relevance | rating | experience | newest`.

The whole path uses only the portable driver API (no raw SQL), so the same code is exercised by the
in-memory driver in tests and SQLite in development. When the dataset grows, step 2 is the single
place to replace with a Postgres full-text + PostGIS query.

## Importing the full PIN directory

The seeded subset is a verified starter set (metros, major state capitals, and Manipur). The schema
is sized for the complete India Post dataset (~19,000 PIN codes). To import it:

```js
import { createLocationRepository } from './lib/repo/locations.js';
// for every row of the official CSV:
await locations.createPincode({ code, office_name, city_id, district_id, state_id });
await locations.createLocality({ city_id, pincode_id, name });
```

`createPincode` / `createLocality` are idempotent and slug-collision safe, so the import can be
re-run whenever the government dataset is refreshed. Districts and cities must exist first — extend
`lib/seed/data/places.js` or drive the same repository calls from the CSV.

## PostgreSQL

The SQL in `lib/db/migrations` is written in a subset both engines accept (`text`, `bigint`,
`integer`, `real`, `create table if not exists`, `create unique index if not exists`, partial
unique indexes, foreign keys, `check`). `SEVA_DB_DRIVER=postgres` is reserved and currently returns
"not enabled yet"; enabling it means adding a `driver-postgres.js` that speaks the same seven-method
contract (`insert`, `update`, `upsert`, `remove`, `one`, `all`, `count`, `query`, `transaction`).
No migration or model would change.
