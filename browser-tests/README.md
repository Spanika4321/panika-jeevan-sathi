# Browser end-to-end tests (Playwright + Chromium)

Real-browser tests for the complete member journey of PANIKA JEEVAN SATHI:
loading, navigation, login-guards, signup, email verification, login, session
refresh, profile editing, photo upload, search with filters, interest → accept,
two-way messaging, shortlist, notifications, logout/login, contact form, error
handling (404 UI, API 404, wrong password, short password, duplicate email)
and mobile responsive behaviour (390×844).

## Run

```bash
cd browser-tests
npm install            # playwright-core + @sparticuz/chromium (chromium binary from npm — no CDN needed)
node run.mjs           # spins up the real server locally and runs all 48 checks
```

Test any deployment (e.g. production) instead of the local server:

```bash
SITE_URL=https://panika-jeevan-sathi-gzza.onrender.com node run.mjs
HEADLESS=0 node run.mjs   # watch the browser (local machines)
```

## Notes

- The Chromium binary ships inside the `@sparticuz/chromium` npm package, so
  `npm install` alone is enough — no Playwright CDN access required. The NSS
  libraries bundled in the same package are extracted to `/tmp` and injected
  via `LD_LIBRARY_PATH` at launch (see `run.mjs`).
- Screenshots of failures land in `artifacts/`.
- Exit code is non-zero when any check fails, so it drops straight into CI.
  `ops/browser-e2e.workflow.yml` is a ready-made GitHub Actions workflow that
  runs this suite against the live production URL — copy it to
  `.github/workflows/` to enable.
