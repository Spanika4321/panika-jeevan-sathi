# SEO Center — PANIKA JEEVAN SATHI

A permanent, real-data SEO system built into the website. No demo mode, no
sample numbers, no automatic production deploys.

```
              PANIKA JEEVAN SATHI
                       │
                       ▼
           GOOGLE SEARCH DATA (Search Console)
                       │  OAuth / API — server-side only
                       ▼
                 SEO DASHBOARD      Clicks · Impressions · CTR ·
                 /seo.html          Average position · Queries · Pages
                       │
                       ▼
              AI ENGINE — Gemini → Router fallback
                       │
              ┌────────┴────────┐
              ▼                 ▼
           POOJA              PRIYA
        SEO research      Verification
              └────────┬────────┘
                       ▼
                    MANAGER
                       │
                       ▼
                   SEO REPORT
                       │
                       ▼
               PERMANENT STORAGE
          database + disk + Fil One (S3)
```

Every cycle runs the same eight stages, in this order:

`Check → Search data → AI analysis → Pooja → Priya → Manager → Report → Verify → next cycle`

---

## 1. Open it

The SEO Center lives at **`/seo.html`** and is **administrator-only** — the API
under `/api/seo/*` returns 401 for visitors and 403 for normal members. A link
appears in the header and the menu for administrators.

Nothing is shown until it is real: if Google Search Console is not connected the
page shows a **NOT CONNECTED** banner and the metric cards show `—` instead of
numbers.

---

## 2. Connect Google Search Console

Three connection methods are supported. Pick one.

### A. OAuth (recommended — one click from `/seo.html`)

1. In [Google Cloud Console](https://console.cloud.google.com/) create an OAuth
   **Web application** client.
2. Enable the **Google Search Console API** for that project.
3. Add the authorised redirect URI:

   ```
   https://<your-site>/api/seo/connect/callback
   ```

4. Set these on the hosting service (Render / Railway / VPS):

   | Variable | Value |
   | --- | --- |
   | `GOOGLE_CLIENT_ID` | `…apps.googleusercontent.com` |
   | `GOOGLE_CLIENT_SECRET` | `GOCSPX-…` |
   | `GOOGLE_REDIRECT_URI` | *(optional)* defaults to `SITE_URL` + `/api/seo/connect/callback` |

5. Restart, open `/seo.html` → **Connect Google account** → choose the Google
   account that owns the property.

The access token and refresh token are stored **encrypted** (AES-256-GCM, key
derived from the site’s `SESSION_SECRET`) in the `seo_connections` table. They
are never sent to the browser and never written into a report.

### B. Refresh token in the environment

| Variable | Notes |
| --- | --- |
| `GSC_REFRESH_TOKEN` | a refresh token that has the `webmasters.readonly` scope |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | the same OAuth client it was issued for |

### C. Service account

| Variable | Notes |
| --- | --- |
| `GSC_SERVICE_ACCOUNT_JSON` | the whole JSON key, or |
| `GOOGLE_APPLICATION_CREDENTIALS` | a path to the key file |

Then add that service-account e-mail as a **user** of the property in Search
Console (Settings → Users and permissions).

### Property selection

`GSC_SITE_URL` (or `SEO_SITE_URL`) pins the property, e.g.
`https://panikajeevansathi.onrender.com/` or `sc-domain:example.com`. Without it
the first property in the account is used, and `/seo.html` lets you switch.

**If the connection fails**, the page shows **BLOCKED** with Google’s actual
error text (permission denied, invalid grant, property not found, rate limit…).
It never shows a green tick for a connection that did not work.

---

## 3. AI engine: Gemini → router

The analysis engine is tried in this order; the first provider that answers
wins, and the winner is recorded in the report:

| Order | Provider | Environment |
| --- | --- | --- |
| 1 | **Google Gemini** (primary) | `GEMINI_API_KEY`, optional `GEMINI_MODEL` |
| 2 | OpenAI-compatible | `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, `OPENAI_MODEL` |
| 3 | OpenRouter | `OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL` |
| 4 | Groq | `GROQ_API_KEY`, optional `GROQ_MODEL` |
| 5 | **Deterministic rule engine** | *(no key needed)* |

The order can be overridden with `SEO_AI_ORDER=gemini,openai,openrouter,groq`.

Gemini is called with the `x-goog-api-key` header (never in the URL, so keys do
not end up in proxy logs) and the model list `gemini-flash-latest →
gemini-2.5-flash → gemini-2.5-pro → gemini-2.0-flash`, so a retired model name
falls through to the next alias instead of failing the cycle.

**When no provider answers**, the cycle still runs: findings come from the
deterministic rule engine applied to the real rows, and the report states
`engine: "deterministic-rules"`, `remote: false` plus the list of failed
attempts. It never claims Gemini answered when it did not.

Keys are read from the environment and used in request headers only. `/api/seo/*`
returns booleans (`gemini: true/false`) — never a key value. The test suite
asserts this with sentinel keys.

---

## 4. The three agents

| Agent | Role | What it does |
| --- | --- | --- |
| **Pooja** | SEO research | Reads the real Search Console rows and produces findings: pages with impressions but no clicks, queries stuck at positions 8–20, strong rankings with low CTR, week-over-week drops, content gaps, internal-link concentration. Every finding carries the exact rows it is based on (`claims`). Keyword ideas are listed separately with `verified: false` — they are hypotheses, not data. |
| **Priya** | Verification | Pure arithmetic against the fetched rows: do the daily rows sum to the totals? Is CTR = clicks ÷ impressions? Does every claim match the data? Does every named query/page actually exist? Is any keyword hypothesis marked verified? Result: `VERIFIED`, `PARTIAL` or `FAILED`, with each check and each claim listed. |
| **Manager** | Planning | Turns verified findings into ranked priorities with impact/effort, the next-cycle focus and risks. Always records `production_deploy: NOT_TRIGGERED` and `publish: MANUAL_REVIEW_REQUIRED`. |

Priya is deliberately **not** an AI call — a verifier that shares the
researcher’s blind spots verifies nothing.

---

## 5. Permanent storage

Every finished report is written to three layers:

1. **Database** — `seo_reports` and `seo_cycles` in whatever store the site
   already uses (SQLite, JSON, or Cloudflare D1). Survives restarts, redeploys
   and instance recycling.
2. **Disk mirror** — `<data-dir>/seo/`:
   `reports/seo-report-0001-<timestamp>.json` + `.md`, `latest.json`,
   `latest.md` and an append-only `cycles.ndjson`.
3. **Fil One** — [fil.one](https://fil.one) S3-compatible object storage
   (`lib/s3.js`, AWS SigV4). Used only when configured; the report keeps its
   `archive_status` (`SAVED`, `FAILED`, `NOT_CONFIGURED`) so a broken archive is
   never hidden.

The final **Verify** stage reads the report back out of storage, recomputes its
SHA-256 and compares it with the stored checksum; when Fil One is configured the
archived object is downloaded and checksummed too.

### Fil One settings

| Variable | Example |
| --- | --- |
| `FILONE_ENDPOINT` | `https://eu-west-1.s3.filonecontent.com` |
| `FILONE_BUCKET` | `panika-seo-reports` |
| `FILONE_ACCESS_KEY_ID` | `FIL…` |
| `FILONE_SECRET_ACCESS_KEY` | *(secret)* |
| `FILONE_REGION` | `eu-west-1` (default) |
| `FILONE_PREFIX` | `panika-jeevan-sathi/seo` (default) |

Any S3-compatible endpoint works (`SEO_S3_*` variables are accepted as aliases).
The archive is reported as **CONNECTED** only after a real write → read →
compare → delete probe succeeds; `/seo.html` has a *Probe archive now* button.

---

## 6. API

All routes are administrator-only.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/seo/status` | connection, AI, storage, scheduler status (no secrets) |
| GET | `/api/seo/connect/start` | Google OAuth authorisation URL |
| GET | `/api/seo/connect/callback` | OAuth return; redirects to `/seo.html` |
| POST | `/api/seo/disconnect` | delete the stored tokens |
| GET | `/api/seo/properties` | properties the Google account can see |
| GET | `/api/seo/overview?days=28` | clicks, impressions, CTR, position, daily rows, previous-period deltas |
| GET | `/api/seo/queries?days=28&limit=250` | query table |
| GET | `/api/seo/pages?days=28&limit=250` | page table |
| POST | `/api/seo/cycle` | run one full cycle |
| GET | `/api/seo/reports` | stored reports (newest first) |
| GET | `/api/seo/reports/:id` | one report (`?format=md` downloads the Markdown) |
| GET | `/api/seo/cycles` | cycle history, including blocked ones |
| GET | `/api/seo/storage?probe=1` | storage layers + live archive probe |
| POST | `/api/seo/ai/test` | explicit AI connectivity test |

A blocked cycle returns **200 with `state: "BLOCKED"`** and the real reason — not
an error page and not a fabricated report.

---

## 7. Automatic cycles

| Variable | Default | Effect |
| --- | --- | --- |
| `PJS_SEO_AUTO_CYCLE_MINUTES` | `0` (off) | run a cycle every N minutes (minimum 5) |
| `PJS_SEO_AUTO_CYCLE_ON_BOOT` | unset | `1` also runs one cycle ~20 s after boot |
| `PJS_SEO_BOOT_DELAY_MS` | `20000` | boot delay for the first cycle |

```bash
PJS_SEO_AUTO_CYCLE_MINUTES=720 node server.js   # one cycle every 12 hours
```

Alternatively run cycles from CI without the web server:

```bash
npm run seo:status      # connection + storage status
npm run seo:cycle       # one full cycle (exit 0 OK · 2 BLOCKED · 1 FAIL · 3 review)
npm run seo:report      # print the newest stored Markdown report
node scripts/seo-cycle.mjs --days=7
```

`scripts/seo-cycle.mjs` also records the run in the permanent agent memory
(`storage/agents/pooja|priya|manager/` + the hash-chained ledger), so the SEO
history is visible alongside the rest of the agent team.

An optional GitHub Actions template is in `ops/seo-center.workflow.yml`
(daily 05:15 UTC); see `ops/INSTALL-WORKFLOWS.md` for the one-time install.

---

## 8. Guarantees

- **Real data only.** Every number comes from the Search Analytics API response
  of that cycle. There is no demo mode, no fixture and no sample dataset in the
  server code path.
- **No fake PASS.** A cycle with no data is `BLOCKED`; a report whose claims
  contradict the data is `REVIEW_REQUIRED`. Priya’s result is `VERIFIED` only
  when nothing contradicts and every numeric claim matched.
- **Secrets stay server-side.** Keys and tokens live in environment variables and
  an encrypted database column. The API returns booleans and labels only, and the
  test suite proves no sentinel key ever appears in a response.
- **No automatic production deploy.** The Manager records
  `production_deploy: NOT_TRIGGERED` on every report; nothing in the SEO Center
  calls a deploy, a `git push` or a social post.
- **Existing features untouched.** The SEO Center adds new files, three new
  database tables and new routes. The public site, member pages and admin panel
  behave exactly as before (verified by `npm test` and `npm run health`).

---

## 9. Files

| Path | Purpose |
| --- | --- |
| `lib/seo/index.js` | the cycle engine, OAuth, status, scheduler |
| `lib/seo/gsc.js` | Google Search Console client (OAuth, service account, Search Analytics) |
| `lib/seo/ai.js` | Gemini + router fallback |
| `lib/seo/agents.js` | Pooja, Priya, Manager |
| `lib/seo/store.js` | permanent storage (database, disk, Fil One) + Markdown renderer |
| `lib/s3.js` | S3-compatible object storage client (Fil One) |
| `public/seo.html`, `public/assets/js/seo.js` | the dashboard |
| `scripts/seo-cycle.mjs` | CLI / CI cycle runner |
| `scripts/seo-test.mjs` | 147-check test suite (`npm run test:seo`) |
| `ops/seo-center.workflow.yml` | optional scheduled workflow |
