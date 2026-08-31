# BATCH-01 — TASK BATCH (ARENA → TERMUX)

**Protocol:** arena-termux-batch/1 · **Issued:** 2026-08-31T19:00:00Z · **By:** arena-coordinator
**Execute on:** termux · **Base commit:** `538beebd21e26fb8d1b9e3d4031d80f7dc81ae4c` · **Branch:** `arena/01a0591c-panika-jeevan-sathi`

## Why this batch

- Arena already executed every local verifier in its own coordinator sandbox (Linux, Node v22.22.3) and all were green: check-syntax 41 files / 0 errors, health-check 95 passed 0 failed, e2e-test 134 passed 0 failed (default store AND PJS_STORAGE=json), agent-team-check PASS, agent-storage doctor PASS with a 12-entry intact hash chain, worktree clean. This batch is about proving the same on Termux — not about re-guessing it.
- Arena's sandbox CANNOT reach the production host: TLS to panikajeevansathi.onrender.com:443 is reset (curl exit 35 SSL_ERROR_SYSCALL, node fetch ECONNRESET, both inside ~75 ms) while github.com returns 200 from the same box. That is coordinator egress, not evidence of an outage — only T-07 on the device can decide it.
- reports/agents/render-employee-latest.json still records 2 'production failures': /register.html and /forgot-password.html returning 404. Arena checked the tree: no page, no route and no link references either path (registration lives in /login.html?tab=register, reset lives in /reset-password.html), and the check that produced them is a hardcoded guess list in scripts/render-doctor.mjs. It is reported, NOT fixed, in this batch.
- Two further defects are queued for a later batch and must not be patched here: scripts/agent-storage-cycle.mjs exits 1 when a worker is only BLOCKED (0 FAIL), and reports/agents/zero-survival-latest.json is a 268-byte stub from a run whose network probes never succeeded.
- Termux is the only place some of these answers exist: real Android filesystem behaviour, real outbound network, the device's own Node build. Anything Arena could not measure is exactly what this batch measures.
- base_commit 538beebd21e2 is the commit that SHIPS this protocol (ops/TERMUX-BATCH-PROTOCOL.md, ops/batches/*, scripts/termux-batch.mjs, package.json batch scripts) on top of the app-code pin 8ef92b7b9c62. T-02 therefore pins the RUNTIME code (server.js, lib/, public/, agents/) to 8ef92b7b9c62 explicitly, so tooling commits can never mask or fake app-code drift; the runner also records head_matches_base and the validator prints any head drift as a warning.
- head_policy is "descendant-ok-with-app-code-pin": Termux must be AT or AHEAD of base_commit (a pure fast-forward pull). Being ahead is only forgiven because T-02 itself asserts server.js/lib/public/agents are byte-identical to app pin 8ef92b7b9c62 — a validator pass without that task passing is treated as a violation, not a warning.

## Ground rules for this batch

1. Execute one task at a time in the printed order. Do not reorder, merge, split or skip a task.
1. Never write PASS for a command that did not exit 0. Paste the exit code and output you actually saw.
1. Blocked means: name the exact missing dependency (env var, binary, permission, host) in remaining_dependency, then continue with the next task.
1. This batch is read-only. No edits to server.js, lib/, public/, agents/, scripts/. No git add/commit/push, no deploy, no database or .env writes, no password or private-message access, no email, no social posting.
1. Do not install anything (pkg/npm install) inside a task. A missing tool is a BLOCKED result naming that tool, not a setup job.
1. public/** must stay byte-identical to the fingerprint above. If any check reports drift, stop and report the file and its hash.
1. Use the runner so evidence is captured, not retyped: `node scripts/termux-batch.mjs run BATCH-01`. Then send ops/batches/BATCH-01.results.json and .results.md back to Arena.
1. Arena validates with `node scripts/termux-batch.mjs validate BATCH-01` and only then issues BATCH-02. A rejected result batch is re-run, never argued into acceptance.

## T-01 — Environment capability truth before anything else

| Field | Value |
| --- | --- |
| 1. Task ID | `T-01` (order 1) |
| 2. Assigned worker | manager — Manager (coordinator on-device) |
| 3. Exact objective | Produce the device's real capability record: Node version (must be >= 22.5 for node:sqlite, otherwise the JSON store fallback is the only supported mode), git and curl presence, free disk, current HEAD and branch, worktree cleanliness, the public/ UI file count and fingerprint, and whether the production hosts answer from this network. No check may be assumed; every line must come from a command that ran. |
| 4. Allowed | actions: read files; run read-only commands; print versions · files: `reports/agents/batch-01-t-01.evidence.md` |
| 4b. Forbidden | installing packages; editing any tracked file; network writes of any kind |
| 5. Verification | exit 0 AND the JSON shows missing_files [], public_ui_files 25 and public_ui_fingerprint 5469d228…; node_ok_22_5=false is a legitimate finding (report it, do not hide it). |
| 6. Expected report | One JSON block pasted verbatim into the result batch, plus a plain statement: Node <version>, sqlite <yes|json-fallback>, disk <MB> MB free, head <sha>, worktree <clean|dirty>, curl to Render <200|error>. |
| 7. Stop condition | If node is missing or older than 18, or curl is absent: record BLOCKED naming the missing binary and the version you have, then continue with T-02 (which does not need the network). Do NOT run pkg install or npm install to unblock — that is an owner-approved change. |
| Needs | `node`, `git`, `curl` |

```bash
$ node scripts/termux-batch.mjs preflight --json
```

## T-02 — Tree integrity at the pinned app commit

| Field | Value |
| --- | --- |
| 1. Task ID | `T-02` (order 2) |
| 2. Assigned worker | guardian — Guardian (Sardar) — safety & health authority |
| 3. Exact objective | Verify the app code on the device is exactly the code Arena pinned. Two separate claims: (a) nothing tracked under server.js, lib/, public/, agents/ or scripts/ is locally modified on this device; (b) between base commit 8ef92b7b9c6296d72369535850990cfd79f1c223 and the checked-out HEAD, the RUNTIME code (server.js, lib/, public/, agents/) is byte-identical. Tooling commits ARE expected on top of the base commit (ops/batches/**, scripts/termux-batch.mjs, package.json script entries, reports/**) — that is why scripts/ and package.json are outside check (b). Syntax and the agent-team safety config must both be green. |
| 4. Allowed | actions: read files; run the repo's own syntax + team checks · files: `reports/agents/batch-01-t-02.evidence.md` |
| 4b. Forbidden | editing any file to make a check pass; git checkout/reset/clean; any write outside reports/ |
| 5. Verification | check-syntax prints '41 checked, 0 with syntax errors'; agent-team-check prints 'AGENT TEAM CHECK: PASS'; and both empty-checks print nothing. Any filename in list (a) means the device edited app code; any filename in list (b) means the batch is being run against a different app tree than the one Arena pinned. |
| 6. Expected report | The two PASS lines, plus the exact list of any file that appears in either empty-check (normally: none). |
| 7. Stop condition | If either empty-check prints a name: STOP the batch, paste `git status --porcelain --untracked-files=no` and `git log --oneline -3`, and wait for Arena. Never 'fix' it by editing, stashing, checking out or resetting. |

```bash
$ node scripts/check-syntax.mjs
$ node scripts/agent-team-check.mjs
$ git status --porcelain --untracked-files=no -- server.js lib public agents scripts
$ git diff --name-only 8ef92b7b9c6296d72369535850990cfd79f1c223 HEAD -- server.js lib public agents
$ git diff --check 8ef92b7b9c6296d72369535850990cfd79f1c223 HEAD
```

## T-03 — 95-point site health + design lock, run locally on the device

| Field | Value |
| --- | --- |
| 1. Task ID | `T-03` (order 3) |
| 2. Assigned worker | guardian — Guardian (Sardar) |
| 3. Exact objective | Boot the real server on a temporary data folder and run the guardian health check: page/asset availability, 404 handling, path-traversal block, robots.txt, sitemap.xml, SEO tags, noindex on private pages, security headers, /api/health, and the approved-design baseline lock. Writes only a dated report under reports/. |
| 4. Allowed | actions: start a local throwaway server on a random port; read public/** · files: `reports/health-report-<UTC-date>.md`, `reports/health-report-latest.md`, `reports/agents/batch-01-t-03.evidence.md` |
| 4b. Forbidden | touching data/; changing public/** or reports/ui-baseline-body.md5; binding to a public interface |
| 5. Verification | exit 0 with '95 passed, 0 failed' and the design-lock line present. Any '✗' line must be pasted in full. |
| 6. Expected report | Final tally line, the report path the script printed, and every failing check name if the tally is not 95/0. |
| 7. Stop condition | If the UI baseline (check 10) fails: do not touch public/**, do not regenerate the baseline. Report the exact filenames whose body md5 moved, plus the before/after hash, and continue to T-04 so Arena gets the full picture. |

```bash
$ node scripts/health-check.mjs
```

## T-04 — Full member journey against the real SQLite driver

| Field | Value |
| --- | --- |
| 1. Task ID | `T-04` (order 4) |
| 2. Assigned worker | amit — Amit — profile quality & data model |
| 3. Exact objective | Run the end-to-end suite on-device: register → login → create/edit profile → photo upload → search/filters → interest → accept → message → receive → notifications → shortlist → privacy → report → admin → logout → re-login, plus 'data survives a server restart'. This is the check that proves the device's Node build actually has a working node:sqlite. |
| 4. Allowed | actions: start a local throwaway server + client fetches; create temp data under the OS temp dir · files: `reports/agents/batch-01-t-04.evidence.md` |
| 4b. Forbidden | writing to ./data; reading anyone's real database; reading passwords or private messages of real members |
| 5. Verification | exit 0 with '134 passed, 0 failed'. On Node < 22.5 a sqlite-driver failure is a legitimate finding — paste the first 3 ✗ lines and the driver line from the log. |
| 6. Expected report | Tally line, plus for any failing check the exact '✗ <name> — <detail>' line; also state which storage driver the server reported. |
| 7. Stop condition | If the suite cannot start the server (port/permission), record BLOCKED with the OS error text. Never edit lib/ or server.js to make a test pass. |

```bash
$ node scripts/e2e-test.mjs
```

## T-05 — Fallback storage path (this is what an old Android Node must run)

| Field | Value |
| --- | --- |
| 1. Task ID | `T-05` (order 5) |
| 2. Assigned worker | amit — Amit |
| 3. Exact objective | Repeat the full end-to-end journey with PJS_STORAGE=json so the JSON-store fallback is proven on the device, independent of node:sqlite. Both stores passing is what makes a Termux-hosted demo safe to talk about. |
| 4. Allowed | actions: start a local throwaway server with an env override · files: `reports/agents/batch-01-t-05.evidence.md` |
| 4b. Forbidden | modifying package.json scripts; writing to ./data |
| 5. Verification | exit 0 with '134 passed, 0 failed' while PJS_STORAGE=json is set for this task only (the runner applies it, the shell is untouched). |
| 6. Expected report | Tally line + confirmation that the JSON driver was used (quote the server/health line that names the storage kind). |
| 7. Stop condition | If it fails only here and T-04 passed (or vice versa), report both tallies side by side. Do not 'harmonise' them by changing the store. |

```bash
$ node scripts/e2e-test.mjs
```

## T-06 — Agent memory integrity and tamper-evident ledger on-device

| Field | Value |
| --- | --- |
| 1. Task ID | `T-06` (order 6) |
| 2. Assigned worker | vikram — Vikram — analytics & reporting |
| 3. Exact objective | Prove the 12-agent storage tree on this device is readable, complete, JSON-valid and that the hash-chained ledger verifies end-to-end, with the queue and incident register reported as they are. Read-only: no cycle run, no snapshot, no state mutation (a partial CI cache must not be turned into committed history from a phone). |
| 4. Allowed | actions: read storage/**; run doctor and status in read-only mode · files: `reports/agents/batch-01-t-06.evidence.md` |
| 4b. Forbidden | npm run storage:init; storage:cycle; any snapshot; editing storage JSON by hand |
| 5. Verification | doctor prints 'DOCTOR: PASS', 'json files parse — 0 corrupt', 'ledger chain intact — N entries, 0 problem(s)' and exits 0; status prints the 12-agent table. |
| 6. Expected report | The full doctor output, the number of ledger entries checked, the open-incident count, and the queue pending/failed counts exactly as printed. |
| 7. Stop condition | If doctor reports a corrupt JSON or a broken ledger line: STOP the batch after this task, report the file path and the offending line, and do not repair, delete, re-init or re-snapshot anything. |

```bash
$ node scripts/agent-storage.mjs doctor
$ node scripts/agent-storage.mjs status
```

## T-07 — Live production reachability from a real network (the one thing Arena's sandbox cannot answer)

| Field | Value |
| --- | --- |
| 1. Task ID | `T-07` (order 7) |
| 2. Assigned worker | rahul — Rahul — uptime & performance |
| 3. Exact objective | From Termux's own network, measure the live service: /api/health body and status, / , /robots.txt, /sitemap.xml, the old cPanel host, and the actual route list discovered from served HTML. Render's free tier sleeps after 15 idle minutes, so the first request may take up to a minute — that is a wake-up, not an outage, and must be written up as such. PASS requires /api/health to return HTTP 200 with "ok":true; a refused/reset/unresolved connection is BLOCKED with the exact curl error; a 500 or an unhealthy body is FAIL. |
| 4. Allowed | actions: GET requests to the two approved production hosts only · files: `reports/agents/batch-01-t-07.evidence.md` |
| 4b. Forbidden | POST/PUT/DELETE or any write against production; hitting any other host; curl -L; triggering a deploy or restart to 'fix' a status; treating a guessed 404 as a bug |
| 5. Verification | HTTP 200 + {"ok":true,...} from /api/health, 200 for /, /robots.txt and /sitemap.xml, and route discovery printing '✓ / -> 200'. The cPanel host may legitimately be 200/404/DNS-error: report whichever it is with its code — no judgement, no editing. |
| 6. Expected report | A table of the 6 endpoints: url, http code, time_total, error text if any; the raw /api/health body (storage driver, photos driver, remote status); and the discovered route list. State explicitly whether the response looked like a Render cold-start. |
| 7. Stop condition | If the device has no network, or a captive portal intercepts TLS: BLOCKED naming that condition. Never mark this PASS because 'the site is probably fine' — Arena treats an unproven live claim as a violation. |
| Needs | `curl` |

```bash
$ curl -sS -o /dev/null --max-time 95 --connect-timeout 25 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.onrender.com/api/health
$ curl -sS --max-time 95 --connect-timeout 25 https://panikajeevansathi.onrender.com/api/health
$ curl -sS -o /dev/null --max-time 60 --connect-timeout 20 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.onrender.com/
$ curl -sS -o /dev/null --max-time 60 --connect-timeout 20 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.onrender.com/robots.txt
$ curl -sS -o /dev/null --max-time 60 --connect-timeout 20 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.onrender.com/sitemap.xml
$ curl -sS -o /dev/null --max-time 45 --connect-timeout 20 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.coolstore.in/
$ node scripts/render-route-discovery.mjs
```

## T-08 — Secrets, tracked-data and noindex hygiene on the device copy

| Field | Value |
| --- | --- |
| 1. Task ID | `T-08` (order 8) |
| 2. Assigned worker | sneha — Sneha — security & compliance |
| 3. Exact objective | Confirm on the pulled tree that: no secret-looking literal is committed in lib/, server.js or public/; nothing under data/, uploads/, storage/snapshots/ or .env is tracked (the committed audit ledger under storage/shared/ledger is deliberately tracked, so it is NOT part of this check); and the security worker still reports its noindex/header/secret result. Run the worker with the in-memory storage backend so the phone writes nothing into storage/. |
| 4. Allowed | actions: read-only git grep/ls-files; run the sneha worker with PJS_AGENT_STORAGE_BACKEND=memory · files: `reports/agents/batch-01-t-08.evidence.md` |
| 4b. Forbidden | printing the contents of any .env; reading data/ or anyone's credentials; opening private messages; writing storage state |
| 5. Verification | Both empties print nothing (git grep exit 1 = no match = clean), and the worker JSON reports status OK with the noindex/header/secret summary. If a match ever appears, do NOT print the matched secret text in the report — name file:line only. |
| 6. Expected report | The three command outputs verbatim (secrets masked to file:line), the worker's private-page count, and confirmation that no storage file was modified afterwards (git status --porcelain showing only reports/ and ops/batches/). |
| 7. Stop condition | If a real credential is found in the tree: STOP immediately, report only file:line and the variable name, do not paste the value, do not rewrite history, and wait for the owner. |

```bash
$ git ls-files -- .env data uploads storage/snapshots
$ git grep -I -n -E (api[_-]?key|apikey|secret|password)[[:space:]]*[:=][[:space:]]*["'][A-Za-z0-9_.-]{16,} -- lib server.js public
$ node agents/worker.mjs sneha
```

## T-09 — Broken internal-link audit against the device copy (manual — pipelines need a shell)

| Field | Value |
| --- | --- |
| 1. Task ID | `T-09` (order 9) |
| 2. Assigned worker | nisha — Nisha — support & FAQ knowledge |
| 3. Exact objective | Extract every internal href actually present in public/*.html, and confirm each one resolves to a real file (or a documented /api/ route). This is the on-device confirmation of Arena's finding that no page links to /register.html or /forgot-password.html — i.e. that the 2 'production failures' in reports/agents/render-employee-latest.json come from a hardcoded guess list in scripts/render-doctor.mjs, not from a broken UI. Audit only: no HTML edit is approved in this batch. |
| 4. Allowed | actions: run the listed shell pipeline; read public/*.html · files: `reports/agents/batch-01-t-09-manual.evidence.md`, `/tmp/pjs-links.txt` |
| 4b. Forbidden | editing any file under public/; regenerating reports/ui-baseline-body.md5; any deploy or push |
| 5. Verification | zero UNRESOLVED lines, and the wc -l count of distinct static internal hrefs equals 18 (Arena measured 18 on the pinned tree: /admin.html, /assets/css/app.css, /assets/img/favicon.svg, /contact.html, /dashboard.html, /edit-profile.html, /index.html, /interests.html, /login.html, /matches.html, /messages.html, /notifications.html, /privacy.html, /profile.html, /search.html, /settings.html, /shortlist.html, /terms.html). A different count on the device means a different tree — say so in the evidence. This pipeline only sees hrefs written literally in HTML; links built in JS (e.g. /profile.html?id=) are covered by T-03/T-04, not here. |
| 6. Expected report | The exact output of commands 1-4, the count from wc -l, and an explicit 'UNRESOLVED count: 0' (or the list). Include the sentence that no public/** file was modified. |
| 7. Stop condition | If a genuine UNRESOLVED link appears: report file + href and stop there. Public UI changes need the owner's explicit approval, so proposing a patch is allowed but applying one is not. |

```bash
$ grep -rhoE 'href="/[^"]+"' public/*.html | sed -E 's/.*href="//; s/[?#].*//; s/"$//' | sort -u > /tmp/pjs-links.txt
$ while read -r p; do case "$p" in /api/*) continue;; esac; [ -f "public$p" ] || echo "UNRESOLVED $p"; done < /tmp/pjs-links.txt
$ wc -l < /tmp/pjs-links.txt
$ node scripts/termux-batch.mjs template BATCH-01
```

Run the four lines by hand in the repo root on Termux. Command 2 must print NOTHING for a PASS. Paste all four outputs (including the empty one) into ops/batches/BATCH-01.manual-template.json — set status to PASS/FAIL/BLOCKED, put the real exit codes from `echo $?` into action_performed, then re-run the batch with `node scripts/termux-batch.mjs run BATCH-01 --import ops/batches/BATCH-01.manual-template.json`. The runner will refuse to invent this result: if you do not import it, T-09 is recorded BLOCKED.

## T-10 — Local-data safety: nothing real left behind or about to be committed

| Field | Value |
| --- | --- |
| 1. Task ID | `T-10` (order 10) |
| 2. Assigned worker | manager — Manager (coordinator on-device) |
| 3. Exact objective | After all tests, prove no member data or throwaway database can leak into git and that the working copy holds no stray runtime artifacts: data/ and uploads/ stay ignored and untracked, the batch itself dirties only reports/ and ops/batches/ (the diff guard is therefore scoped to server.js, lib/, public/, agents/ and storage/ — the batch's own artifacts must never be mistaken for a violation), and no data/ directory was created inside the repo by T-03/T-04/T-05. |
| 4. Allowed | actions: read-only git status/ls-files/check-ignore; list repo top-level entries · files: `reports/agents/batch-01-t-10.evidence.md` |
| 4b. Forbidden | git add/commit/push; deleting files to make status look clean; modifying .gitignore; touching data/ if it already exists |
| 5. Verification | All three empties print nothing; check-ignore prints the .gitignore rule that keeps data/ out of git; `termux-batch.mjs list` shows BATCH-01 with its task count. Any tracked file under data/ or uploads/ is a PII risk: report it, do not delete it. |
| 6. Expected report | Outputs of all five commands, plus a plain statement: 'member data cannot enter git from this working copy: yes/no', and the list of files the batch itself produced. |
| 7. Stop condition | If data/ or uploads/ shows up as tracked or dirty: STOP, report the file names only (never their contents), and wait for the owner. No cleanup, no .gitignore edit, no push. |
| Needs | `git` |

```bash
$ git status --porcelain -- data uploads storage lib public server.js
$ git check-ignore -v data/
$ git ls-files -- data uploads
$ git diff --name-only HEAD -- server.js lib public agents storage
$ node scripts/termux-batch.mjs list
```

## How to return the RESULT BATCH

```bash
node scripts/termux-batch.mjs run BATCH-01
node scripts/termux-batch.mjs validate BATCH-01
```

That writes `ops/batches/BATCH-01.results.json` + `.md`. Send both to ARENA (paste, or push the branch and say "batch done"). ARENA validates before deciding the next batch.

Task count: 10. Do not reorder, split or skip a task; if blocked, report it and continue with the next one.

allowlist check: all 26 verifier commands are read-only and approved-host clean (panikajeevansathi.onrender.com, panikajeevansathi.coolstore.in).
