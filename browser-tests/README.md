# Browser end-to-end tests (Playwright + Chromium)

Real-browser tests for the complete member journey of PANIKA JEEVAN SATHI:
loading, navigation, internal link/asset crawl (broken links), signup, email
verification, login, session refresh, profile editing, photo upload, search
with filters, interest → accept, two-way messaging, shortlist, notifications,
logout/login, contact form, error handling (404 UI, API 404, wrong password,
short password, duplicate email) and mobile responsive behaviour (390×844).

**Every step also watches for:** console errors (`pageerror` + `console.error`),
failed API requests / broken responses (any HTTP ≥ 400), missing assets and
page-loading stalls — the run fails if anything unexpected shows up. A
`report.md` with the full results is written next to this file, and failure
screenshots land in `artifacts/`.

## Run — no configuration needed

```bash
cd browser-tests
npm install            # playwright-core + @sparticuz/chromium (chromium binary from npm — no CDN needed)
node run.mjs           # boots a real local server automatically and runs all 49 checks
```

## Test a specific deployment (e.g. production)

```bash
SITE_URL=https://your-site.example node run.mjs
```

You do **not** need to set `SITE_URL` by hand in CI: the daily workflow runs
`scripts/resolve-prod-url.mjs`, which auto-detects the deployed production URL
in this order — workflow input → `PJS_PRODUCTION_URL` repo secret → Render API
(`RENDER_API_KEY` repo secret) → otherwise it boots a local server, so the
pipeline works everywhere with zero configuration.

`HEADLESS=0 node run.mjs` watches the browser (local machines).

## CI wiring

- `ops/browser-e2e.workflow.yml` — the browser E2E workflow: runs daily at
  04:15 UTC against the auto-resolved production URL, on push/PR to `main`,
  and on demand. Activate it once by copying the file to
  `.github/workflows/browser-e2e.yml` (GitHub blocks automation from writing
  workflow files; the header of the file contains the exact 2-minute steps).
- Exit code is non-zero when any check fails, so it drops straight into CI.

## Notes

- The Chromium binary ships inside the `@sparticuz/chromium` npm package, so
  `npm install` alone is enough — no Playwright CDN access required. The NSS
  libraries bundled in the same package are extracted to `/tmp` and injected
  via `LD_LIBRARY_PATH` at launch (see `run.mjs`).