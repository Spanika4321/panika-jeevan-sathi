# Ops Queue — what ARENA draws the next batch from

Ordered, and every entry is grounded in something that was actually observed (file + line/report
named), not in a hunch. Status vocabulary is the batch vocabulary: `READY` (Termux can act now),
`VERIFY` (needs a measurement only the device/live host can give), `OWNER` (needs a human
decision, credential or approval — no batch may work around it), `UI-APPROVAL` (touches the
approved public design).

Cut from commit `8ef92b7b9c6296d72369535850990cfd79f1c223`, 2026-08-31.

| # | Item | Worker | Status | Blocks on | Why it is in the queue (evidence) |
| --- | --- | --- | --- | --- | --- |
| Q-01 | Run BATCH-01 on Termux; return the result batch | manager | **VERIFY** | device | Arena proved every local verifier green in its own sandbox (syntax 41/0, health 95/0, e2e 134/0 default **and** `PJS_STORAGE=json`, storage doctor PASS, worktree clean). T-01…T-10 exist to prove the same on the real execution environment, plus two things Arena structurally cannot see. |
| Q-02 | Decide what "production is reachable" means on this network | rahul | **VERIFY / OWNER** | Q-01 · T-07 | `reports/agents/agent-storage-cycle.md`: Rahul `BLOCKED — Network se … reach nahi ho paya`. From Arena's sandbox the TLS connection to `panikajeevansathi.onrender.com:443` is reset (curl exit 35 / `ECONNRESET`, ~75 ms) while `github.com` returns 200 — coordinator egress, **not** proof of an outage. Only a device measurement settles it; if it is down, the fix is a deploy/hosting decision (Q-06), not a code edit. |
| Q-03 | Stop the recurring false alarm: doctor scripts guess routes | pooja | **READY** | BATCH-02 | `reports/agents/render-employee-latest.json` still reports `PROBLEM_FOUND`, 198/200 passed, 2 "failures": `/register.html` and `/forgot-password.html` → 404. Both paths are referenced by **nothing** in the tree (registration is `/login.html?tab=register`, reset is `/reset-password.html`) — Arena verified this by grepping `public/ lib/ server.js` and by T-09's on-request link audit. The checks themselves hardcode the guess list (`scripts/render-doctor.mjs:3-20`), so every run re-reports the same phantom bug. Fix = derive routes from `public/*.html` + the route table in `lib/api.js`, and classify "route nobody links to" as INFO, never FAIL. Scripts only; no UI, no deploy. |
| Q-04 | `agent-storage-cycle.mjs` exits 1 for honest BLOCKED results | vikram | **READY** | BATCH-02 | Verified live: `PJS_AGENT_STORAGE_BACKEND=memory node scripts/agent-storage-cycle.mjs` printed `fail: 0`, `doctor: PASS`, `open incidents: 0` — and still exited **1**, because the return is `results.every(r => r.status === 'OK') ? 0 : 1` (`scripts/agent-storage-cycle.mjs:243`). A missing credential is not a broken build. Today a CI job or an eager agent "fixes" this by upgrading BLOCKED→OK, i.e. the tool *rewards* faking. Fix = distinct exit codes (0 green · 1 FAIL · 2 blocked-only, matching `scripts/termux-batch.mjs`) + keep CI green on 2. |
| Q-05 | The live-probe scripts throw away the only number that matters | manager, pooja | **READY** | BATCH-02 | `scripts/zero-survival-manager.mjs:29,33` runs `curl -L -sS -o /dev/null -w %{http_code}` through a `run()` helper that keeps **stdout only**, so every non-2xx/timeout/TLS failure collapses to the same `000` string with no error text in the report — `render_status:"000"` could mean a dead service or a dead phone network. Its last run (`reports/agents/zero-survival-latest.json`, 2026-08-30T19:27Z) did record real codes — `render_status: "200"`, `cpanel_status: "503"`, decision `RENDER_WORKING_BUT_PERSISTENCE_MUST_BE_VERIFIED` — which is the strongest evidence yet that Render answered **yesterday**, and it is exactly what T-07 re-measures on the device. Fix = keep `stderr`/`%{errormsg}` + `exit code` in the JSON, name the failure instead of `000`, and drop blind `-L`. |
| Q-06 | Hosting decision: Render-free + Cloudflare, or cPanel `panikajeevansathi.coolstore.in` | owner | **OWNER** | owner | `DEPLOY.md` recommends Render Free (sleeps after 15 idle min, filesystem wiped on sleep) and documents the old cPanel host as persistent-storage-capable. Q-02's measurement plus Q-05's real error text are what this decision needs. No agent may "resolve" it by deploying — production deploy needs the owner. |
| Q-07 | Email notifications (Meera) | meera | **OWNER** | `RESEND_API_KEY` | `reports/agents/agent-storage-cycle.md`: `meera … BLOCKED — Email draft ready, par RESEND_API_KEY configured nahi`. Sending owner mail to `sukulpanika939@gmail.com` from a batch is an external action: needs an explicit go-ahead, not just a key. |
| Q-08 | Search Console / Gemini (Pooja) and Meta (Priya) | pooja, priya | **OWNER** | `GOOGLE_SEARCH_CONSOLE_TOKEN`, `GEMINI_API_KEY`, `META_ACCESS_TOKEN`, `META_PAGE_ID` | `reports/agents/pooja-latest.json` / `priya-latest.json` both report `status: BLOCKED` with those exact flags `false`. Until the owner supplies them the workers keep doing local analysis only — and the protocol forbids turning that into a PASS (see Q-04 for the temptation). |
| Q-09 | `npm run check` never syntax-checks the code the agents actually run | guardian | **READY** | BATCH-03 | `scripts/check-syntax.mjs` only walks `public/assets/js/*.js` and inline `<script>` blocks in `public/*.html`. `server.js`, `lib/*.js`, `agents/*.mjs` and all 25 `scripts/*.mjs` + `scripts/*.cjs` (including the new `scripts/termux-batch.mjs`) are unchecked — a truncated edit on a phone would sail through "41 checked, 0 with syntax errors". Fix = extend the walk to those dirs (no behavior change to the UI checks), keeping the count in the report honest. |
| Q-10 | Any change under `public/**` | — | **UI-APPROVAL** | explicit owner approval | `agents/config.json → safety.preserve_public_ui: true`, and every batch carries `protected.public_ui_fingerprint` (currently `5469d2287361…`, 25 files). The runner refuses to execute and the validator rejects the result if `public/**` moved. If a UI change is ever approved, the batch must also regenerate `reports/ui-baseline-body.md5` in the same task, so the new design becomes the locked baseline instead of a permanent red flag. |
| Q-11 | GitHub workflow install for `agent-storage.yml` | owner | **OWNER** | repo settings | `ops/INSTALL-WORKFLOWS.md` exists because automated tooling may not create `.github/workflows/*`. Until it is pasted, agent memory resets to the committed baseline every run — which is also why no batch should trust `storage/` counts on a fresh clone (T-06 therefore asserts *integrity*, not history length). |

## Rules for drawing from this queue

1. One batch at a time, tasks ordered, ≤ 10 tasks, each independently verifiable.
2. A batch never mixes "measure" and "repair" for the same file: Q-01 first, then Q-03/Q-04/Q-05.
3. Every `READY` item becomes a task whose `verify` block re-runs the check that produced the finding
   (rule 9 of the protocol: after repair, always retest).
4. `OWNER` items are never scheduled. They are escalated with the exact missing dependency and stay
   in the queue until the owner moves them.
5. The queue is empty when every row is closed by a validated result batch — not before.

---

## Arena-side rehearsal (2026-08-31) — NOT the Termux result

Before issuing BATCH-01, Arena executed the whole batch once inside its own coordinator sandbox
(`PJS_BATCH_EXECUTOR=arena-coordinator-sandbox`, linux/x64, Node v22.22.3, head `8ef92b7b9c62`) so
that the *machinery* was proven and the task text was corrected against reality. Artifacts:
`ops/batches/BATCH-01.results.sandbox.{json,md}`, `reports/agents/batch-01-t-0{1..10}.evidence.md`,
`reports/agents/batch-01-validation.md`.

| Task | Worker | Status | What it proved |
| --- | --- | --- | --- |
| T-01 | manager | PASS | preflight: node v22.22.3 (sqlite-capable), 25 public files, fingerprint `5469d228…`, worktree clean, live probes UNREACHABLE |
| T-02 | guardian | PASS | `41 checked, 0 with syntax errors`, `AGENT TEAM CHECK: PASS`, no local app-code modification, no drift from the pinned base commit |
| T-03 | guardian | PASS | `95 passed, 0 failed`, design lock line present |
| T-04 | amit | PASS | `134 passed, 0 failed` (sqlite store) |
| T-05 | amit | PASS | `134 passed, 0 failed` under `PJS_STORAGE=json` |
| T-06 | vikram | PASS | `DOCTOR: PASS`, `0 corrupt`, `ledger chain intact`, 12 agents |
| T-07 | rahul | **BLOCKED** | 6/6 curls to the two production hosts died with exit 35 (`SSL_ERROR_SYSCALL`) in 38–255 ms; route-discovery printed no `✓ / -> 200`. Reclassified FAIL→BLOCKED by `blocked_exit_codes` — **this is the row Termux must replace** |
| T-08 | sneha | PASS | tracked-data list empty, secret grep exit 1 (no match), worker `status: OK`, and `PJS_AGENT_STORAGE_BACKEND=memory` left `storage/` untouched |
| T-09 | nisha | PASS (manual import) | 18 distinct internal hrefs, 0 UNRESOLVED; `/register.html` and `/forgot-password.html` referenced nowhere |
| T-10 | manager | PASS | `data/`, `uploads/`, snapshots untracked and ignored; only `reports/` + `ops/batches/` dirtied by the batch itself |

`validate` verdict on that file: **ACCEPTED**, with the two warnings Arena wants to see (a PASS whose
evidence line reads like a failure, and manual provenance). `run` exited **2** = blocked-only.

Three draft defects the rehearsal caught and Arena fixed in the batch itself — recorded here so the
corrections are visible rather than silently edited away:

1. T-02 originally required `git status --porcelain` to be empty, which any *new* untracked tooling file
   would fail → scoped to tracked app code with `--untracked-files=no`, and the base-commit diff to
   `server.js lib public agents` so tooling commits on top of the pin don't read as drift.
2. T-08 originally listed `storage/shared/ledger` as "must be untracked" — the ledger is *meant* to be
   committed, so that assertion was wrong (and produced a FAIL). Now it checks `.env data uploads storage/snapshots`.
3. T-08/T-05's `env` overrides were initially read from the wrong level (`task.env` only), so the memory
   backend silently did not apply and the sneha run dirtied `storage/agents/sneha/*` + appended ledger
   line 13 — visible in `files_changed`, which is exactly why the runner measures the tree after every task.

Tooling negative tests (all actually run, 2026-08-31): fake PASS → REJECTED; silently dropped task →
REJECTED; appended byte in `public/index.html` → batch refused before execution (fingerprint drift);
`git push` / `node -e` / `curl -X POST --data-binary` / `rm -rf` / `node scripts/../../etc/passwd` →
all five refused by the allowlist.
