# BATCH-01 / T-02 — raw execution log
executor : arena-coordinator-sandbox (linux/x64, node v22.22.3)
head     : eb84dba5ab3f629f7a79ae4858aaca79af38d68d
objective: Verify the app code on the device is exactly the code Arena pinned. Two separate claims: (a) nothing tracked under server.js, lib/, public/, agents/ or scripts/ is locally modified on this device; (b) between base commit 8ef92b7b9c6296d72369535850990cfd79f1c223 and the checked-out HEAD, the RUNTIME code (server.js, lib/, public/, agents/) is byte-identical. Tooling commits ARE expected on top of the base commit (ops/batches/**, scripts/termux-batch.mjs, package.json script entries, reports/**) — that is why scripts/ and package.json are outside check (b). Syntax and the agent-team safety config must both be green.
verdict  : FAIL

$ node scripts/check-syntax.mjs
(exit 0, 579ms)
--- stdout ---
  41 checked, 0 with syntax errors

--- stderr ---
(none)

$ node scripts/agent-team-check.mjs
(exit 0, 33ms)
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

$ git diff --check 8ef92b7b9c6296d72369535850990cfd79f1c223 HEAD
(exit 2, 5ms)
--- stdout ---
reports/agents/batch-01-t-02.evidence.md:49: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:51: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:53: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:55: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:57: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:59: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:61: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:63: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:65: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:67: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:69: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:71: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:73: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:75: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:77: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:79: trailing whitespace.
++  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:81: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:83: trailing whitespace.
++  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:85: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:87: trailing whitespace.
++  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:89: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:91: trailing whitespace.
++  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:93: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:95: trailing whitespace.
++  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:97: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:99: trailing whitespace.
++  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.coolstore.in:443 
reports/agents/batch-01-t-02.evidence.md:101: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:103: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:105: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:107: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:109: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:111: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:113: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:115: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:117: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:119: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:121: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:123: trailing whitespace.
++  
reports/agents/batch-01-t-02.evidence.md:125: trailing whitespace.
++000 0.031069 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:127: trailing whitespace.
++curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:129: trailing whitespace.
++curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:131: trailing whitespace.
++000 0.031300 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:133: trailing whitespace.
++curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:135: trailing whitespace.
++000 0.030529 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:137: trailing whitespace.
++curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:139: trailing whitespace.
++000 0.031000 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:141: trailing whitespace.
++curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-02.evidence.md:143: trailing whitespace.
++000 0.188116 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.coolstore.in:443 
reports/agents/batch-01-t-02.evidence.md:145: trailing whitespace.
++curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.coolstore.in:443 
reports/agents/batch-01-t-07.evidence.md:10: trailing whitespace.
+000 0.030908 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:12: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:20: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:26: trailing whitespace.
+000 0.032613 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:28: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:34: trailing whitespace.
+000 0.033780 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:36: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:42: trailing whitespace.
+000 0.031142 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:44: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
reports/agents/batch-01-t-07.evidence.md:50: trailing whitespace.
+000 0.033209 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.coolstore.in:443 
reports/agents/batch-01-t-07.evidence.md:52: trailing whitespace.
+curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.coolstore.in:443 

--- stderr ---
(none)
