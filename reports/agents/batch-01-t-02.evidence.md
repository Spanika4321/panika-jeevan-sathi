# BATCH-01 / T-02 — raw execution log
executor : arena-coordinator-sandbox (linux/x64, node v22.22.3)
head     : aa836de9021d87a3d4aea69c8a2aa35feeebec5f
objective: Verify the app code on the device is exactly the code Arena pinned. Two separate claims: (a) nothing tracked under server.js, lib/, public/, agents/ or scripts/ is locally modified on this device; (b) between base commit 8ef92b7b9c6296d72369535850990cfd79f1c223 and the checked-out HEAD, the RUNTIME code (server.js, lib/, public/, agents/) is byte-identical. Tooling commits ARE expected on top of the base commit (ops/batches/**, scripts/termux-batch.mjs, package.json script entries, reports/**) — that is why scripts/ and package.json are outside check (b). Syntax and the agent-team safety config must both be green. The whitespace gate is scoped to code and tooling paths on purpose: reports/agents/*.evidence.md hold verbatim captured stdout/stderr, and right-stripping a captured line to satisfy a style check would falsify the evidence the whole protocol exists to protect.
verdict  : PASS

$ node scripts/check-syntax.mjs
(exit 0, 741ms)
--- stdout ---
  41 checked, 0 with syntax errors

--- stderr ---
(none)

$ node scripts/agent-team-check.mjs
(exit 0, 43ms)
--- stdout ---
PASS: agents/README.md
PASS: agents/config.json
PASS: agents/lib.mjs
PASS: agents/manager.mjs
PASS: agents/pooja.mjs
PASS: agents/priya.mjs

AGENT TEAM CHECK: PASS

--- stderr ---
(none)

$ git status --porcelain --untracked-files=no -- server.js lib public agents scripts
(exit 0, 3ms)
--- stdout ---
(none)
--- stderr ---
(none)

$ git diff --name-only 8ef92b7b9c6296d72369535850990cfd79f1c223 HEAD -- server.js lib public agents
(exit 0, 3ms)
--- stdout ---
agents/README.md

--- stderr ---
(none)

$ git diff --check 8ef92b7b9c6296d72369535850990cfd79f1c223 HEAD -- server.js lib public agents scripts package.json
(exit 0, 4ms)
--- stdout ---
(none)
--- stderr ---
(none)
