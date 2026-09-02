# LIVE STATUS — 2026-09-02 (post-merge update, session: arena/01a0614b)

**Question:** is the data-loss problem fixed on production?

## Verdict

# 🔴 CODE IS ON main — PRODUCTION STILL ON OLD SQLITE BUILD

## What happened this session (timeline, UTC)

| Time | Event | Evidence |
| --- | --- | --- |
| 08:45 | Live health checked: `storage=sqlite` (old build) | REAL `GET /api/health` `time=1788338754477`, old response shape (no `boot_at`) |
| ~08:50 | PR #22 work merged into session branch, all proofs re-run: 134/134 e2e, 20/20 wipe-proof (mock), live-script 20/21 vs disk-backed mock | logs in this session |
| 09:01 | **PR #23 merged into `main`** (commit `f654d03`). PR #22 auto-marked MERGED (its commits landed via #23) | `gh pr view 23` mergedAt 2026-09-02T09:01:22Z |
| ~09:06 | Site showed Render "Application loading" (deploy/cold-start in progress) | fetch_page |
| 09:07 | Live health again: **old build still serving** — response has no `boot_at` → pre-merge code | REAL `GET /api/health` `time=1788340036227`, `storage=sqlite`, old shape |
| 09:12 | Workflow dispatch attempt from sandbox → **HTTP 403** (integration token cannot dispatch) | `gh workflow run` error |

## Reading of the evidence

The merged code, on Render, **refuses to boot without `SUPABASE_*`**
(fail-closed, `PJS_REQUIRE_REMOTE=1` + `PJS_STORAGE=supabase` in the synced
blueprint). The instance that keeps answering has the OLD response shape, so
one of these is true:

1. The new deploy ran and **failed its health check because
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are not set** → Render keeps
   the previous version serving (their documented rollback behavior), or
2. autoDeploy did not fire yet.

Both mean the same thing for the user: **set the three env vars on Render and
trigger a deploy.** Until then members/photos still land on the ephemeral disk
(no worse than before — but the fix is not live).

No real member data is at risk of being lost in the switch: live `/api/site`
counted `members: 1` (the auto-created admin) before the merge.

## Exact remaining steps (user — ~5 minutes)

1. **Supabase** (if not already done): project → SQL Editor → run
   `supabase/schema.sql` once. Settings → API → copy **Project URL** and the
   **service_role** key.
2. **Render** → service `panikajeevansathi` → **Environment** → add:
   - `SUPABASE_URL` = `https://<ref>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key (never the anon key, never paste it in chat)
   - `SUPABASE_STORAGE_BUCKET` = `uploads`
   Save changes (this queues a deploy). If not: **Manual Deploy → Deploy latest
   commit** (`main` @ `f654d03`).
3. **Verify**: `https://panikajeevansathi.onrender.com/api/health` must show
   `"storage":"supabase"`, `"photos":"supabase+cache"`, `"durable":true` and a
   `boot_at` field. If the service fails to boot: the env vars are wrong —
   check spelling and that the key is service_role.
4. **Prove durability** (the 🟢 gate): GitHub → **Actions → "Live proof
   (production durability)" → Run workflow** with the default 17-minute wait.
   (The sandbox token cannot dispatch workflows — HTTP 403 — so this click is
   yours.) Or from your own machine:
   `node scripts/verify-supabase-live.mjs --wait-min 17`
5. Say **continue** — the next session will re-read live health and the
   workflow log and mark the verdict.

## What is on `main` now (for the next agent)

- Supabase Postgres + Storage write-through, fail-closed on Render (PR #23 /
  former #22).
- `/api/health` exposes `boot_at` (restart proof), `durable`, `data_loss_risk`.
- `scripts/verify-supabase-live.mjs` — REAL write→idle→wake→read proof, red
  verdict while sqlite, self-cleaning test members.
- `.github/workflows/live-proof.yml` — manual durability proof job (log
  artifact `live-proof-log`).
- DEPLOY.md §C2 documents all of this.

---

## Update — session `arena/01a061c4` (2026-09-02, ~11:05 UTC): automation locked in

PR **#25** ("Keep-alive: Supabase never pauses again + weekly auto durability
proof") adds the automation that keeps the fix alive after the manual steps:

1. **`.github/workflows/keep-alive.yml`** — Mon + Thu **07:40 IST**
   (`10 2 * * 1,4`): `GET /api/site` (REAL database read → Supabase activity,
   max gap ≈ 3.5 days vs the ~7-day free-tier pause limit) + watchdog on
   `/api/health`: unreachable or `storage != "supabase"` → REAL alert email
   (`scripts/keepalive-alert.mjs`, Resend, `.report-recipient`) and a red
   Actions run.
2. **`live-proof.yml` now weekly** — Sunday **09:55 IST** (`25 4 * * 0`), full
   §C2 write → sleep-wake → read proof; scheduled runs use production-default
   input fallbacks. Manual dispatch button unchanged.
3. **DEPLOY.md §C3** documents both schedules and how to disable them.

Validation: YAML lint ✓, `node --check` ✓, `npm test` **134/134** ✓.

Note for the next agent: this sandbox could NOT reach `onrender.com` at all
(TLS handshake reset — `SSL_ERROR_SYSCALL`), so live health must be read via
GitHub Actions runners (live-proof pre-check / keep-alive watchdog), not from
the sandbox. The previous session's claimed commit `9a98803` never existed in
git — the keep-alive work was recreated from scratch here (commit `a5e9918`).
