# BATCH-01 / T-02 — raw execution log
executor : arena-coordinator-sandbox (linux/x64, node v22.22.3)
head     : 62c68d53eb7cf6b6c7ae8c46a10e6fc932c304e5
objective: Verify the app code on the device is exactly the code Arena pinned. Two separate claims: (a) nothing tracked under server.js, lib/, public/, agents/ or scripts/ is locally modified on this device; (b) between base commit 8ef92b7b9c6296d72369535850990cfd79f1c223 and the checked-out HEAD, the RUNTIME code (server.js, lib/, public/, agents/) is byte-identical. Tooling commits ARE expected on top of the base commit (ops/batches/**, scripts/termux-batch.mjs, package.json script entries, reports/**) — that is why scripts/ and package.json are outside check (b). Syntax and the agent-team safety config must both be green.
verdict  : FAIL

$ node scripts/check-syntax.mjs
(exit 0, 582ms)
--- stdout ---
  41 checked, 0 with syntax errors

--- stderr ---
(none)

$ node scripts/agent-team-check.mjs
(exit 0, 37ms)
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
(exit 0, 2ms)
--- stdout ---
agents/README.md

--- stderr ---
(none)

$ git diff --check 8ef92b7b9c6296d72369535850990cfd79f1c223 HEAD
(exit 2, 5ms)
--- stdout ---
reports/agents/batch-01-results.sandbox.md:71: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:81: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:84: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:85: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:88: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:89: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:92: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:220: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:264: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:268: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:273: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:278: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:283: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:288: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:298: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:303: trailing whitespace.
+  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-results.sandbox.md:304: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:305: trailing whitespace.
+  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-results.sandbox.md:306: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:307: trailing whitespace.
+  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-results.sandbox.md:308: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:309: trailing whitespace.
+  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-results.sandbox.md:310: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:311: trailing whitespace.
+  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-results.sandbox.md:312: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:313: trailing whitespace.
+  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.coolstore.in:443 
reports/agents/batch-01-results.sandbox.md:314: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:336: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:337: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:340: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:341: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:388: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:389: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:393: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:396: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:397: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:400: trailing whitespace.
+  
reports/agents/batch-01-results.sandbox.md:401: trailing whitespace.
+  
reports/agents/batch-01-t-07.evidence.md:10: trailing whitespace.
+000 0.031069 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:12: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:20: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:26: trailing whitespace.
+000 0.031300 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:28: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:34: trailing whitespace.
+000 0.030529 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:36: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:42: trailing whitespace.
+000 0.031000 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:44: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:50: trailing whitespace.
+000 0.188116 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.coolstore.in:443 
reports/agents/batch-01-t-07.evidence.md:52: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.coolstore.in:443 

--- stderr ---
(none)
