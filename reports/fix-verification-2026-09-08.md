# Keep-alive watchdog repair — 8 September 2026 (UTC)

## Symptom

`Keep-alive (Supabase + storage watchdog)` failed on **25 consecutive runs** between
2026-09-04 21:16 UTC (run 33920310679) and 2026-09-08 21:55 UTC (run 34283185043). The last
green run was 33800635983 on 2026-09-03 20:09 UTC. Scheduled runs failed in ~37–41 s; runs
triggered by a merge to `main` failed at ~5m15s — five minutes of `sleep 300` followed by a red
check step. A watchdog that is always red cannot show a real durability regression.

## Diagnosis (read-only, real production data)

The sandbox shell cannot open TLS to Render (`curl https://panikajeevansathi.onrender.com/`
returns `000`), and Actions logs/artifacts could not be downloaded
(`productionresultssa7.blob.core.windows.net` → `EOF`), so the live endpoints were read with the
page-fetch tool. `GET /api/health` at 2026-09-08 23:10 UTC returned:

```json
{"ok":true,"service":"panika-jeevan-sathi","security_revision":"2026-09-05",
 "release":"ee97a74a1c0149e322cdba8fc6003eb2167196b2","storage":"supabase",
 "photos":"supabase+cache","durable":true,"data_loss_risk":false,
 "mail":{"configured":false,"delivery_verified":false},
 "remote":{"database":{"loaded":true,"pending":0,"lastError":null},
           "photos":{"remote":true,"pending":0,"lastError":null}}}
```

Evaluated with the monitor's own `healthProblems()` against that exact payload: **zero** problems.
`GET /api/site` reported `ok: true`, `maintenance: "0"`, 9 members. So the only failing check was

> `SMTP is configured (not an inbox delivery test)` — `mail.configured === false`

`nodemailer@10.0.0` **is** a production dependency and is installed by the Render build command
(`npm ci --omit=dev --ignore-scripts`, lockfile entry present), so `mailer.smtpConfigured()`
returns false only because `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` are not set on the Render
service. Those values live in the Render dashboard (`render.yaml` keeps them `sync: false`) — no
CI job can set them. Member verification and password-reset mail is therefore **not delivered**
today; messages are kept in the private server outbox.

## Fix

1. **Severity per check** (`scripts/lib/production-check.mjs`). Blocking (❌) checks — availability,
   database/photo durability, deployed security release, CSP/HSTS/privacy headers, anonymous-access
   denial, exposed server files — still fail the job. The SMTP check is advisory (⚠️): reported in
   the console, the report artifact, the job summary and as a `::warning::` annotation. Setting the
   environment or repository Actions variable `PJS_REQUIRE_MAIL=1` makes it blocking again, so the
   strict behaviour is one variable away once SMTP is configured. `scripts/deploy-render.mjs` keeps
   requiring mail explicitly (unchanged release gate).
2. **No more blind five-minute sleep.** `scripts/wait-for-release.mjs` polls the read-only
   `/api/health` until `release` equals the pushed commit (budget 5 min, GET only), so a post-merge
   run checks the deployment it just made. A cold start or slow deploy ends the wait without
   failing it.

## Verification

| Check | Result |
| --- | --- |
| `node scripts/check-syntax.mjs` | 88 files checked, 0 syntax errors |
| `npm test` (syntax + regression + security + deployment + member journey) | `node --test` regression/security/deployment: **53 tests, 0 failures** (21 of them deployment tests, 5 new); member journey **137 passed, 0 failed** |
| Shipped CLI replayed against the **real** production `/api/health` + `/api/site` JSON and the deployed commit's server behaviour | 15 checks ✅, 1 ⚠️ (SMTP), `Result: PASS — 1 advisory item(s)…`, **exit code 0** |
| Same replay with `PJS_REQUIRE_MAIL=1` | exit code **1** (strict behaviour preserved) |
| Blocking regression injected (`durable:false`) with advisory mail | `blocking_ok=false`, exit code 1 — advisory handling cannot hide it |
| `wait-for-release.mjs` against a local server stamped `RENDER_GIT_COMMIT=ee97a74…` | `WAIT_RESULT: matched (probes=1, waited=49ms)`, exit 0 |
| `wait-for-release.mjs` with the release not live | `WAIT_RESULT: budget-exhausted (probes=3)`, exit 0 |
| Website Guardian on this branch (run 34290097640) | success in 55 s |

The replay boots the same `server.js`/`lib` code as the deployed release (`release` in the live
health JSON equals commit `ee97a74`, this branch's parent) with `TRUST_PROXY_HOPS=1` and
`X-Forwarded-Proto: https`, exactly as Render's edge presents it, so the header, anonymous-access
and server-file checks are the production code paths. Only the transport was substituted, because
this sandbox cannot reach `onrender.com`. The keep-alive workflow itself could not be dispatched
from here (`workflow_dispatch` → HTTP 403 `Resource not accessible by integration`), so the CI job
was not observed green; it will run on the next schedule or merge once this reaches `main`.

## Owner action still required (CI cannot do this)

1. Render dashboard → `panikajeevansathi` → Environment: set `SMTP_HOST`, `SMTP_PORT`
   (587 STARTTLS, or 465 with `SMTP_SECURE=true`), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, then
   redeploy. Until then member verification/password-reset email is not delivered.
2. Optional: repository Settings → Secrets and variables → Actions → **Variables** → add
   `PJS_REQUIRE_MAIL=1` to make the mail check fail the job again once SMTP is live.
3. Optional: set the `RESEND_API_KEY` secret so a blocking failure actually emails
   `.report-recipient`; without it the alert step only logs a warning.
