# BATCH-01 / T-07 — raw execution log
executor : arena-coordinator-sandbox (linux/x64, node v22.22.3)
head     : eb84dba5ab3f629f7a79ae4858aaca79af38d68d
objective: From Termux's own network, measure the live service: /api/health body and status, / , /robots.txt, /sitemap.xml, the old cPanel host, and the actual route list discovered from served HTML. Render's free tier sleeps after 15 idle minutes, so the first request may take up to a minute — that is a wake-up, not an outage, and must be written up as such. PASS requires /api/health to return HTTP 200 with "ok":true; a refused/reset/unresolved connection is BLOCKED with the exact curl error; a 500 or an unhealthy body is FAIL.
verdict  : BLOCKED

$ curl -sS -o /dev/null --max-time 95 --connect-timeout 25 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.onrender.com/api/health
(exit 35, 44ms)
--- stdout ---
000 0.035894 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
--- stderr ---
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 


$ curl -sS --max-time 95 --connect-timeout 25 https://panikajeevansathi.onrender.com/api/health
(exit 35, 41ms)
--- stdout ---
(none)
--- stderr ---
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 


$ curl -sS -o /dev/null --max-time 60 --connect-timeout 20 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.onrender.com/
(exit 35, 41ms)
--- stdout ---
000 0.032964 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
--- stderr ---
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 


$ curl -sS -o /dev/null --max-time 60 --connect-timeout 20 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.onrender.com/robots.txt
(exit 35, 40ms)
--- stdout ---
000 0.030624 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
--- stderr ---
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 


$ curl -sS -o /dev/null --max-time 60 --connect-timeout 20 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.onrender.com/sitemap.xml
(exit 35, 40ms)
--- stdout ---
000 0.031844 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 
--- stderr ---
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.onrender.com:443 


$ curl -sS -o /dev/null --max-time 45 --connect-timeout 20 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.coolstore.in/
(exit 35, 40ms)
--- stdout ---
000 0.031063 OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.coolstore.in:443 
--- stderr ---
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to panikajeevansathi.coolstore.in:443 


$ node scripts/render-route-discovery.mjs
(exit 0, 103ms)
--- stdout ---
==============================================
 POOJA — ACTUAL ROUTE DISCOVERY
==============================================
✗ / -> fetch failed
✗ /login.html -> fetch failed
✗ /profile.html -> fetch failed
✗ /search.html -> fetch failed
✗ /contact.html -> fetch failed
✗ /reset-password.html -> fetch failed

ACTUAL ROUTES/LINKS DISCOVERED:

==============================================
POOJA: ROUTE DISCOVERY COMPLETE
404 guessed URLs = NOT automatically treated as bugs
MANAGER: VERIFY ACTUAL ROUTES
PRIYA: REPORT REAL FAILURES ONLY
==============================================

--- stderr ---
(none)
