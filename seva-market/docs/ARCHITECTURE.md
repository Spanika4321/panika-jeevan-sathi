# SEVA MARKET INDIA — architecture

## Principles

1. **GitHub is the source of truth.** Every artefact that defines the system — migrations, seed
   reference data, code, tests, docs — lives in this repository. Nothing is configured by hand in a
   dashboard. There is no Render/Vercel/Netlify configuration in this step by design.
2. **Fail fast, fail loudly.** Configuration is validated before the port is bound; migrations run
   before traffic is served; a checksummed migration that changed fails the boot.
3. **One way in, one way out.** Repositories are the only code that touches the database. Route
   handlers return data or throw typed errors; they never write to the response directly.
4. **Portable, boring technology.** Node 22 + standard library + SQL that runs on SQLite today and
   PostgreSQL later. No build step, no bundler, no framework churn.
5. **Mobile-first.** The CSS is written for a 360px phone and only *adds* at `min-width`
   breakpoints; every touch target is at least 44px.

## Layers

```
        HTTP                static files (public/)        ─┐
          │                                                │
   ┌──────▼───────┐                                         ├─ lib/http
   │  api/index   │  body parsing · rate limit · auth       │
   ├──────────────┤                                         │
   │  api/v1      │  route table (returns data, throws)     │
   ├──────────────┤                                        ─┘
   │  services    │  business rules (search, geo, auth…)    ── lib/services
   ├──────────────┤
   │  repository  │  queries (only layer that knows SQL)    ── lib/repo
   ├──────────────┤
   │  db driver   │  sqlite │ memory │ postgres*            ── lib/db
   └──────────────┘
   domain models (columns, validation rules, row builders)  ── lib/domain
```

Each layer only calls the one below it. Tests build the same stack against the in-memory driver.

## Request lifecycle

1. `server.js` sets security headers on every response (including 404s and static files).
2. `OPTIONS` short-circuits; malformed paths are rejected with 400.
3. `/api/*` → `createApiHandler`:
   - route match (method + pattern) → 404 `{code: 'not_found'}`;
   - per-route rate limit → 429 with `Retry-After`;
   - JSON body read (≤ 256 KB) → 400/413;
   - session resolved from the signed cookie (never required unless a route says so);
   - handler runs, returns data → `{ ok: true, … }`; a `__cookie` key is stripped and sent as
     `Set-Cookie` so a token can never leak into a JSON body;
   - any throw → `AppError` → status + `{ ok: false, error, code, details }`.
4. Everything else → static handler (traversal-safe, correct MIME, `no-cache` for HTML).

## Security posture (foundation)

| Concern | Approach |
| --- | --- |
| Passwords | scrypt (`N=16384`), per-password salt, constant-time comparison |
| Sessions | HMAC-SHA256 signed cookie, `HttpOnly`, `SameSite=Lax`, `Secure` in production, `token_version` for global revocation |
| Login privacy | unknown email and wrong password return the identical message |
| Authorisation | checked in services, not only in routes (e.g. listing ownership) |
| Injection | parameterised queries only; identifiers are whitelisted (`[A-Za-z_][A-Za-z0-9_]*`) |
| XSS | strict CSP (`script-src 'self'`, no inline script/style); the UI toggles classes and never writes `element.style` |
| Traversal | resolved static paths must stay inside `public/` |
| Rate limiting | per-IP fixed window; tightened to 10/min on auth routes |
| Transport | HSTS when the request is HTTPS; `nosniff`, `SAMEORIGIN`, `Permissions-Policy` |
| Data exposure | `toPublic()` per model; the password hash and token version never leave the service layer |

## Data integrity

- **Migrations** are ordered files with SHA-256 checksums; editing an applied migration is a hard
  error, so environments cannot drift silently (`tests/schema.test.js` covers this).
- **Drift guard**: the model registry (`lib/db/schema.js`) is asserted to match the actual database
  columns after migration, in both directions. Add a column in one place and CI fails.
- **Idempotent seeders**: re-running `npm run seed` never duplicates a state, city, PIN or category.

## Deliberately deferred

Not built in this step, and the seams left for them:

- **Payments / UPI / QR** — providers are contacted directly (call/WhatsApp). Money fields already
  exist on `provider_services` in **paise** (`price_from`, `price_to`, `price_unit`), so a future
  checkout reads real data without a schema change. No gateway SDK is a dependency today.
- **AdSense / advertising** — no ad script, no `ca-pub-` id, no ad slot markup anywhere.
- **Deployment (Render etc.)** — the app is a plain Node HTTP server honouring `PORT`/`HOST` with a
  `/api/health` endpoint, so any host can run it; no host-specific file is committed yet.
- **Full India Post PIN directory** — a verified starter subset ships as seed data; the loader path
  is documented in `DATA-MODEL.md`.
- **Object storage / images** — providers have no gallery yet; `providers` has a `search_text` index
  and timestamps ready for an assets table.

## Testing strategy

| Level | Where | Speed |
| --- | --- | --- |
| Unit (pure functions) | `config`, `validate`, `auth`, `slugs` | ms, no I/O |
| Domain/integration | `locations`, `catalog`, `users`, `providers`, `search` on the memory driver | ~10 ms/case |
| Schema | `schema.test.js` on a real SQLite file | ensures SQL ↔ models agree |
| HTTP | `http.test.js` boots a real server on an ephemeral port | end-to-end JSON |
| UI foundation | `ui-foundation.test.js` asserts mobile-first, CSP-safe, no dead links | static analysis |

`npm test` = syntax gate + all of the above.
