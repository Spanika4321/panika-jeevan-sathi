# PANIKA JEEVAN SATHI — SEO Center

A **permanent, real** SEO system inside the website — not a demo UI.

```
         PANIKA JEEVAN SATHI
                  │
                  ▼
      ┌─────────────────────┐
      │  GOOGLE SEARCH DATA │
      │    Search Console   │
      └──────────┬──────────┘
                 │ OAuth / API
                 ▼
      ┌─────────────────────┐
      │    SEO DASHBOARD    │
      │ Clicks / Impr. / CTR│
      │ Avg Pos / Queries   │
      │ Pages               │
      └──────────┬──────────┘
                 │
                 ▼
          ┌─────────────┐
          │  AI ENGINE  │
          │ Gemini      │
          │ → Router    │
          └──────┬──────┘
                 │
          ┌──────┴──────┐
          ▼             ▼
       POOJA          PRIYA
    SEO Research    Verification
          │             │
          └──────┬──────┘
                 ▼
              MANAGER
                 │
                 ▼
            SEO REPORT
                 │
                 ▼
         PERMANENT STORAGE
```

**Dashboard:** `/seo-center.html` (admin login required, like the admin panel).
**Every cycle:** Check → Search Data → AI Analysis → Pooja → Priya → Manager →
Report → Verify → Next Cycle.

## What is real vs. what is never faked

| Thing | Behaviour |
| --- | --- |
| Search data | **Only** the real Google Search Console API (`webmasters/v3` searchAnalytics). No synthetic rows exist anywhere in the code. |
| Metrics | Clicks, impressions, CTR, average position, top queries, top pages — straight from GSC. |
| AI engine | Gemini first, **Router fallback**, and a clearly-labelled local rule-engine below Router. Every attempt (provider, model, error) is recorded. |
| Pooja | SEO research (keyword opportunities, page recommendations, content gaps, technical checks) built on the real snapshot. |
| Priya | **Deterministic verification** — every claim is compared against the actual GSC snapshot (numbers, queries, pages). PASS is computed, never assumed. |
| Manager | Releases the plan + final recommendation **only after Priya passes**. Otherwise the recommendation is withheld and the cycle shows FAIL. |
| Reports | Saved permanently as JSON + Markdown, re-read after writing (verify step), mirrored to Fil One and to the agent team's permanent memory. |
| Credentials | GSC OAuth tokens live in `data/seo/oauth.json` (mode 0600, git-ignored). The browser only ever sees masked ids (`1234…abcd`) and statuses. |
| Failures | Missing/failing integration → **BLOCKED** or **NOT CONNECTED** in the UI, the report and the cycle history. No fake PASS. |

## Server-side environment variables

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client (Search Console). Without these the connect button shows BLOCKED. |
| `GOOGLE_SEARCH_CONSOLE_SITE` | Property, e.g. `sc-domain:panikajeevansathi.com` or `https://panikajeevansathi.com/` (also settable in the dashboard). |
| `GOOGLE_SEARCH_CONSOLE_TOKEN` | Optional: a refresh token (or an `ya29.…` access token) seeded directly, e.g. for GitHub Actions. |
| `GEMINI_API_KEY` | Gemini (primary AI engine). `GEMINI_MODEL` overrides the model (default `gemini-2.0-flash`); `GEMINI_API_BASE` overrides the endpoint. |
| `GEMINI_ROUTER_URL` + `GEMINI_ROUTER_API_KEY` | Router fallback (OpenAI-compatible `/v1/chat/completions`). `GEMINI_ROUTER_MODEL` overrides the model. |
| `FIL_ONE_ENDPOINT` / `FIL_ONE_ACCESS_KEY` / `FIL_ONE_SECRET_KEY` / `FIL_ONE_BUCKET` / `FIL_ONE_REGION` | Fil One (S3-compatible on Filecoin). Reports are mirrored with AWS SigV4 only when all of these are set; otherwise the dashboard shows **NOT CONNECTED** and reports stay in local permanent storage. |
| `SEO_SCHEDULER` | `1` enables the in-app cycle scheduler. |
| `SEO_CYCLE_HOUR_UTC` / `SEO_CYCLE_MINUTE_UTC` | Daily run time (e.g. `4` / `15` → 04:15 UTC), or `SEO_CYCLE_INTERVAL_MINUTES` (default 1440) for interval mode. |
| `SEO_CYCLE_ON_BOOT` | `1` runs one cycle ~30 s after the server boots (when the scheduler is enabled). |
| `SITE_URL` | Canonical public origin — used for the OAuth redirect URI and live indexability checks. |
| `PJS_SEO_DATA_DIR` | Overrides the SEO data folder (default `<data>/seo`). Used by CI. |

**Never expose any of these to the browser.** The engine sends only masked/boolean
status to the dashboard.

## Connecting Google Search Console (OAuth)

1. Create a Google Cloud project → enable the **Search Console API**
   (`https://www.googleapis.com/auth/webmasters.readonly` scope).
2. OAuth consent screen → add yourself as a test user (external → testing is fine).
3. Credentials → OAuth client ID → **Web application** →
   authorised redirect URI: `https://<your-site>/api/seo/oauth/callback`.
4. Set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` on the host, redeploy.
5. Open `/seo-center.html` → **Connect Google Search Console** → approve.
   Tokens (incl. refresh token, `access_type=offline`) are stored server-side
   in `data/seo/oauth.json` and auto-refreshed before expiry.
6. Save the property (`sc-domain:…` or `https://…`) in the dashboard (or via
   `GOOGLE_SEARCH_CONSOLE_SITE`) and press **Run cycle now**.

If the Google account cannot see the property, the step shows the real 403
message from Google — the cycle is recorded as FAIL/BLOCKED, never PASS.

## Scheduling (choose ONE)

- **In-app scheduler:** set `SEO_SCHEDULER=1` (+ `SEO_CYCLE_HOUR_UTC`,
  `SEO_CYCLE_MINUTE_UTC`). The next run time is shown on the dashboard. Use a
  single instance for this (a duplicate instance would double-run — cycles are
  idempotent, but keep it clean).
- **GitHub Actions:** `ops/seo-cycle.workflow.yml` runs daily at 04:15 UTC
  (also `workflow_dispatch`). Copy it to `.github/workflows/seo-cycle.yml`
  (see `ops/INSTALL-WORKFLOWS.md` for the repo's install convention), put the
  variables above into repo **secrets** and `SITE_URL` into repo **variables**.
  Reports + agent memory are uploaded as workflow artifacts (retained 90 days)
  — nothing is committed or pushed.
- **External cron:** `node scripts/seo-cycle.mjs` (a local `.env` is read first).
  See `npm run seo:cycle` / `npm run seo:verify`.

## Permanent storage

| Target | Path | When |
| --- | --- | --- |
| Local archive | `data/seo/reports/seo-report-*.json` + `.md`, `data/seo/cycles.json`, `data/seo/snapshots/` | Always (persistent disk) |
| Fil One (S3) | `s3://<FIL_ONE_BUCKET>/seo/reports/…` via SigV4 | When `FIL_ONE_*` is fully configured |
| Agent memory | `storage/agents/{pooja,priya,manager}/` state + log + metrics, `storage/shared/ledger/`, `storage/shared/kv/seo-center/` | Every cycle |

> Render Free has no persistent disk — enable Fil One (or run the GitHub
> Actions cycle) so reports survive restarts there.

## Proof that the agent team is really working

1. `npm run seo:squad` — **poora 12-agent team ek command mein SEO Center ke kaam pe**:
   Manager har worker ko assignment deta hai (mailbox + task list + shared
   queue), Guardian full health check chalta hai, Arjun backlink research,
   Kavita content briefs, Rahul reachability, Sneha noindex/secrets audit,
   Amit profile→landing ideas, Nisha FAQ, Vikram scorecard, Meera email
   (BLOCKED without RESEND). Squad report:
   `reports/agents/seo-squad-latest.json` + `.md`.
2. `npm run seo:verify` — live round: real GSC API call, real Gemini + Router
   pings, storage write/read, Fil One upload probe. Every line is a real call;
   anything missing reports **NOT CONNECTED / BLOCKED**.
3. `/seo-center.html` → **Run cycle now** → watch the 8 pipeline steps fill in.
4. Open the resulting report — Priya's checks list each claim and the exact
   evidence from the snapshot; Manager's plan carries the verified numbers.
5. `npm run storage:status` — all 12 agents now have SEO-cycle / squad runs,
   summaries and failure streaks in their permanent memory.
6. Cycle history and the report archive keep growing across restarts.

## Safety

- Nothing deploys, pushes to git, or posts anywhere.
- Reports contain **aggregate search data only** — never member emails,
  messages, or passwords.
- The page is `noindex` and blocked in `robots.txt` like the other private pages.
- Existing site features, design and workflows are untouched (the new engine
  mounts only under `/api/seo/*`).
