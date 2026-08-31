# ARENA ↔ TERMUX — Two-Way Batch Protocol (`arena-termux-batch/1`)

**ARENA is the coordinator. TERMUX is the execution environment.**
ARENA decides *what* is done and *what happens next*. TERMUX does the doing and reports
what actually happened. Nobody on either side gets to call something "done" without a
command behind it.

Everything in this protocol is machine-enforced by `scripts/termux-batch.mjs`:
the runner refuses unsafe verifiers, and the validator refuses dishonest results.

---

## 1. Message shapes

### ARENA → TERMUX: one ordered TASK BATCH at a time

File: `ops/batches/<BATCH-ID>.tasks.json` (human mirror: `<BATCH-ID>.md`)

Every task carries exactly these seven fields, and the runner rejects a batch that omits one:

| # | Field | Key |
| --- | --- | --- |
| 1 | Task ID | `id` (+ `order`, strictly 1…n, no duplicates) |
| 2 | Assigned worker | `worker` (an id from `storage/agents/index.json`) |
| 3 | Exact objective | `objective` |
| 4 | Allowed files/actions | `allowed.actions[]`, `allowed.files[]`, `allowed.forbidden[]` |
| 5 | Required verification | `verify.commands[]` (argv arrays), `verify.expect`, optional `require_lines`, `require_absent_lines`, `require_empty`, `allow_exit`, `blocked_exit_codes`, `blocked_match`, `env` |
| 6 | Expected report | `expected_report` |
| 7 | Stop condition if blocked | `stop_condition` |

Plus batch-level fields the tool checks: `protocol`, `batch_id`, `base_commit`,
`approved_hosts`, `protected.public_ui_fingerprint`, `ui_change_approved`, `rules[]`, `context[]`.

### TERMUX → ARENA: one RESULT BATCH after execution

File: `ops/batches/<BATCH-ID>.results.json` (+ `.results.md`, written by the runner)

Every result carries exactly these nine fields:

| # | Field | Key |
| --- | --- | --- |
| 1 | Task ID | `task_id` |
| 2 | Worker | `worker` (must equal the assigned worker) |
| 3 | Actual command/action performed | `action_performed[]` → `{cmd, exit, expected_exit, ok, duration_ms, stdout_tail, stderr_tail}` |
| 4 | PASS / FAIL / BLOCKED | `status` |
| 5 | Exact evidence | `evidence` (captured output, not a summary of intent) |
| 6 | Files changed | `files_changed` (measured with `git status --porcelain` before/after each task) |
| 7 | Tests performed | `tests_performed` |
| 8 | Report path | `report_path` (a real file; the validator checks it exists on the executing box) |
| 9 | Remaining dependency/problem | `remaining_dependency` (mandatory for FAIL and BLOCKED) |

Plus `executor{}` (hostname, platform, node version, `uname`, git head/branch, worktree state,
free disk, `public_ui_fingerprint`), `base_commit`, `head_matches_base`, `public_ui_drift`,
`summary{}`, `verification_token`.

---

## 2. What "PASS" is allowed to mean

The validator REJECTS a result batch when any of these hold:

- a task has no result at all — *a failed/skipped task may never be silently dropped*;
- a `PASS` where any recorded command did not exit with its expected code — **FAKE PASS**;
- a `PASS` where one of the task's `verify.commands[]` never appears in `action_performed`;
- a `PASS` while the task's `require_lines` are missing, its `require_empty` commands printed
  something, or a `require_absent_lines` string showed up;
- `evidence` empty/thinner than 20 chars or a placeholder (`ok`, `done`, `ho gaya`, `all good`…);
- `FAIL`/`BLOCKED` without naming the exact `remaining_dependency`;
- `summary` arithmetic that doesn't match the per-task statuses;
- `public_ui_drift: true` (or a `files_changed` entry under `public/**`) while
  `ui_change_approved` is not `true` — *the approved public UI is preserved by the tool, not by good intentions*;
- head ≠ `base_commit` on runtime code paths pinned by the batch (warning + evidence, never forgiven silently);
- `verification_token` mismatch — the file was edited after the runner wrote it, so it is treated as unproven and re-run.

Missing credential, missing binary, unreachable host, no permission ⇒ **BLOCKED** with the exact
dependency named. Never PASS, never "probably fine". The runner enforces this before it executes:
a task with unmet `requires[]` is never even attempted.

---

## 3. The exchange (one round)

```bash
# ---- TERMUX (execution environment) -------------------------------------
cd ~/panika-jeevan-sathi && git pull
node scripts/termux-batch.mjs show   BATCH-01     # read the batch, confirm scope
node scripts/termux-batch.mjs run    BATCH-01     # execute; evidence captured, not retyped
node scripts/termux-batch.mjs validate BATCH-01   # self-check before sending
#   → ops/batches/BATCH-01.results.json + .results.md
#   → reports/agents/batch-01-t-NN.evidence.md (raw stdout/stderr per task)
git add ops/batches/BATCH-01.results.json ops/batches/BATCH-01.results.md reports/agents \
  && git commit -m "BATCH-01 result batch from termux" && git push

# ---- ARENA (coordinator) ---------------------------------------------------
git pull
node scripts/termux-batch.mjs validate BATCH-01   # ACCEPTED | REJECTED + violation list
node scripts/termux-batch.mjs decide   BATCH-01   # splits requeue vs needs-owner-action
# then: cut BATCH-02 from ops/batches/QUEUE.md, or ask the owner for the named dependency
```

Exit codes are part of the protocol, so a shell can branch on them:
`0` everything green · `1` at least one FAIL (or a rejected batch) · `2` BLOCKED-only (a
dependency is missing, nothing is broken).

If Termux would rather work by hand, `template <BATCH>` emits a manual-entry file for every
`verify.mode: "manual"` task; those results are merged with `run --import <file>` and are then
flagged `provenance: "manual"` — Arena spot-checks them instead of trusting them.

---

## 4. Hard rules (both sides)

1. **Never fake PASS.** A status is only as good as the command that produced it.
2. **Never claim a command ran unless it actually ran.** The runner records exit codes and output
   tails; retyped "output" is treated as fabrication and rejected by the token check.
3. **Never silently skip a failed task.** Missing results are a violation, not an oversight.
4. **If blocked, report the exact dependency** (variable name, binary, host, permission, owner decision).
5. **ARENA decides the next batch** from a validated result batch — not from a verbal "ho gaya".
6. **TERMUX executes; ARENA coordinates.** Termux does not invent scope; Arena does not assume execution.
7. **No risky changes automatically**: no production deploy, no database/`.env` writes, no password or
   private-message access, no `git push` from inside a task, no social posting, no email.
   The verifier allowlist makes these *impossible to express*, not merely discouraged.
8. **Preserve the approved public UI** (`public/**`) unless an intentional change is explicitly approved
   by the owner — enforced by the `public_ui_fingerprint` in every batch.
9. **After any repair, retest.** A fix without a re-run of the failing verifier is not a fix; it is a
   hypothesis. Batch N+1 re-runs Batch N's failing checks before anything new is added.
10. **Continue batch-by-batch** until `ops/batches/QUEUE.md` is empty, or a real dependency needs the owner.

## 5. What the runner will refuse outright

`checkCommand()` gates every verifier: argv arrays only (no shell), binaries limited to a read-only
set (`node`, `git`, `curl`, `grep`, `find`, `ls`, `cat`, `wc`, `sort`, `uniq`, `sha256sum`, `df`, `du`,
`uname`, `date`, `which`, `printenv`), `git` limited to read-only subcommands (`status`, `log`,
`diff`, `show`, `ls-files`, `ls-tree`, `grep`, `check-ignore`, `rev-parse`, …), `node` limited to
repo-local entrypoints under `scripts|lib|agents` plus `server.js` (no `-e`), `curl` limited to GET
against `approved_hosts` + localhost with output only to `/dev/null`, `find` without `-delete/-exec`,
and no newlines/NULs in any token.

Proven in-repo (the tests are this file's evidence, run in the Arena sandbox on 2026-08-31):

```
✗ refused verifier ["git","push","origin","main"] — git subcommand "push" is not read-only
✗ refused verifier ["node","-e","require('node:fs').rmSync('/tmp/x')"] — node -e inline code is not allowed
✗ refused verifier ["curl","-sS","-X","POST","--data-binary","@/etc/passwd",…] — curl flag "-X" is not allowed
✗ refused verifier ["rm","-rf","public"] — binary "rm" is not in the read-only allowlist
✗ refused verifier ["node","scripts/../../etc/reactor"] — node entrypoint outside scripts|lib|agents
```

and a hand-edited result file fails closed:

```
✗ T-07: PASS claimed but 6 command(s) did not exit as expected — FAKE PASS
✗ T-03: NO RESULT RETURNED — a task may never be silently skipped
✗ verification_token mismatch — the result file was edited after the runner wrote it
```

## 6. Files

| Path | Role |
| --- | --- |
| `scripts/termux-batch.mjs` | runner + validator + renderer (`list/show/preflight/run/validate/render/template/decide`) |
| `ops/batches/BATCH-NN.tasks.json` | the batch Arena issues |
| `ops/batches/BATCH-NN.results.json/.md` | the result Termux returns |
| `reports/agents/batch-NN-t-XX.evidence.md` | raw per-task stdout/stderr |
| `reports/agents/batch-NN-validation.md` | Arena's accept/reject verdict |
| `ops/batches/QUEUE.md` | the ordered backlog Arena draws from |
| `storage/agents/<worker>/` | durable per-worker task/ledger state (unchanged by this protocol) |
