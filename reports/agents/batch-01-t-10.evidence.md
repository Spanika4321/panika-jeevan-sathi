# BATCH-01 / T-10 — raw execution log
executor : arena-coordinator-sandbox (linux/x64, node v22.22.3)
head     : 8ef92b7b9c6296d72369535850990cfd79f1c223
objective: After all tests, prove no member data or throwaway database can leak into git and that the working copy holds no stray runtime artifacts: data/ and uploads/ stay ignored and untracked, the batch dirties only reports/ and ops/batches/, and no data/ directory was created inside the repo by T-03/T-04/T-05.
verdict  : PASS

$ git status --porcelain -- data uploads storage lib public server.js
(exit 0, 3ms)
--- stdout ---
(none)
--- stderr ---
(none)

$ git check-ignore -v data/
(exit 0, 2ms)
--- stdout ---
.gitignore:2:data/	data/

--- stderr ---
(none)

$ git ls-files -- data uploads
(exit 0, 3ms)
--- stdout ---
(none)
--- stderr ---
(none)

$ git diff --name-only HEAD
(exit 0, 2ms)
--- stdout ---
(none)
--- stderr ---
(none)

$ node scripts/termux-batch.mjs list
(exit 0, 36ms)
--- stdout ---
BATCH-01     10 tasks  → no result batch yet

--- stderr ---
(none)
