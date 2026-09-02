# LIVE STATUS — 2026-09-02 (session: arena/01a0614b)

**Question:** is the data-loss problem fixed on production?

## Verdict

# 🔴 NOT FIXED ON PRODUCTION YET — fix exists, is not deployed

Live `GET https://panikajeevansathi.onrender.com/api/health` (REAL, 2026-09-02 ~08:45 UTC):

```json
{"ok":true,"service":"panika-jeevan-sathi","time":1788338754477,"storage":"sqlite","photos":"local",
 "remote":{"database":{"kind":"sqlite"},"photos":{"kind":"local","remote":false}}}
```

- `storage: "sqlite"` + `photos: "local"` → members/photos still go to Render's
  ephemeral disk. A sleep/restart/redeploy still wipes them.
- Live `GET /api/site` (REAL): `counts.members = 1` → only the auto-created
  admin. **No real member data exists yet, so switching stores loses nothing.**

## Why the live site is still on sqlite

The Supabase fix lives in PR #22 (branch `arena/01a0611d-…`, head `3780030`)
and is **not merged**. Render auto-deploys `main`, and `main` has no Supabase
support — it silently uses sqlite even if `SUPABASE_*` env vars are set.
The sandbox cannot reach onrender.com over TLS (curl and Node fetch both
blocked), so the live switch/proof must run from GitHub Actions or the
user's machine.

## What this session added (branch `arena/01a0614b-…`, PR #24)

1. **`boot_at` in `/api/health`** — process start timestamp, so an external
   prover can *prove* a restart happened (boot_at changed) instead of guessing.
2. **`scripts/verify-supabase-live.mjs`** — REAL write→(idle)→read proof over
   HTTPS: health gate (stops red while sqlite), register ×2, profile, photo,
   interest→accept, message, idle wait, wake, restart detection via boot_at,
   re-login, read-back of profile/message/photo bytes, cleanup (deletes test
   members). Warns (not fails) if the platform didn't sleep in the window.
   Validated locally against the disk-backed mock: **20/21 PASS + 1 expected
   warn, exit 0**.
3. **`.github/workflows/live-proof.yml`** — manual "Live proof (production
   durability)" workflow (GitHub runners can reach onrender.com). Writes,
   idles 17 min past Render Free's sleep window, proves the restart, reads
   everything back, uploads the log. Red verdict if any check fails.
4. **DEPLOY.md § C2** — "Prove durability against production" instructions.

Re-verified on this branch after merge of the PR #22 work:

| Check | Result | REAL/MOCK |
| --- | --- | --- |
| `npm test` | 134/134 PASS | MOCK |
| `scripts/prove-supabase-wipe.mjs` | 20/20 PASS | MOCK |
| `scripts/verify-supabase-live.mjs` vs local mock server | 20/21 PASS + 1 expected warn | MOCK |
| Boot without `SUPABASE_*` under `PJS_REQUIRE_REMOTE=1` | refuses (exit) | REAL (sandbox) |
| Live `/api/health` | `storage=sqlite` — **still ephemeral** | **REAL** |

## Exact remaining steps (user actions)

1. Supabase project → SQL editor → run `supabase/schema.sql` once (if not done).
2. Render → `panikajeevansathi` → Environment: set `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (service_role), `SUPABASE_STORAGE_BUCKET=uploads`.
   **Do this before merging** — after the merge the service refuses to boot
   without them (by design: no silent sqlite).
3. Merge the PR (Render auto-deploys `main`; blueprint sets `PJS_STORAGE=supabase`).
4. Actions tab → **Live proof (production durability)** → Run workflow
   (17-minute wait). 🟢 only when every check passes there.

Order matters: env vars **first**, merge **second** — otherwise the site is
down (fail-closed) until the vars are saved.
