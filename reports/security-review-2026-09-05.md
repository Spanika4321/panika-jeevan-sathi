# Security repair and recheck — 5 September 2026 (IST)

## Result at the end of the local security pass

**Local code/security repairs and the full recheck passed. This is not a claim that the repaired
release is deployed, all future problems are prevented, or production mail/backups are verified.**

The expanded audit first reproduced **11 failures in 12 new security tests**. They included
cross-origin account changes, form-compatible JSON writes, spoofed-IP rate-limit bypass,
missing CSP, hidden-profile enumeration, revived sessions after suspension, a last-admin
moderation bypass, public photo-bucket acceptance, misleading startup health, and silent
empty-store fallback after damaged SQLite/JSON files. The remaining initial test was preventive
coverage of simultaneous reset-token use, not a demonstrated SQLite failure.

### Fixes applied

- Cross-origin/form CSRF rejected, forwarded-IP trust bounded, strict CSP added with real-browser
  injection tests, and recovery-token referrers suppressed. Production validates HTTPS origin and
  persistent session secret settings.
- Hidden/suspended profile data no longer leaks through relationships; photo-byte access remains
  permission checked. Old sessions and reset links are revoked on security/role changes.
- Last-admin protections cover moderation and verification; concurrent admin mutations are
  serialised with renewed authorisation in the supported single-process deployment.
- Public Supabase photo buckets and missing core tables stop startup. Storage errors affect
  health without disclosing private provider error details.
- Damaged local databases are preserved and startup stops rather than silently opening an empty
  fallback. JSON writes are synced before acknowledgment; D1 mutations await remote persistence.
- Nodemailer is locked into production builds. SMTP requires verified TLS, bounded timeouts and
  recipient acceptance; unsuccessful mail falls back privately, never to a public token response.
- Render deployment preserves **all** existing settings, including SMTP/Cloudflare/custom variables;
  incomplete reads abort before changes. Implicit database/bucket migrations are refused.
- Deployment credentials were removed from workflow input forms. Releases run tests first and
  pin the checked-out commit. The read-only production watchdog checks every six hours once
  installed on the default branch. Synthetic-member live tests are manual and explicitly opt-in.
- Existing registration/verification, messaging, modal, mobile-layout and test-isolation repairs
  from the preceding pass remain included.

## Recheck evidence

| Check | Result |
| --- | --- |
| All-source syntax | **87 checked; 0 errors** |
| SQLite security/regression/deployment tests | **46 passed** (19 regressions + 13 security + 14 deployment/monitor/mail/storage tests) |
| SQLite member journey | **137 passed** |
| JSON fallback | **137 member assertions + 32 security/regression tests passed** |
| D1/R2 local mocks | **137 member assertions + 19 cloud checks passed** |
| Supabase external-store mock, local app disk wiped and restarted | **20 checks; PASS** |
| SigV4 signatures | **35 passed** |
| Health/intentional UI baseline | **118 passed** |
| Real Chromium desktop/mobile and CSP | **7 passed** |
| Locked npm install/audit | **0 reported vulnerabilities** |
| Agent storage/registry and whitespace | **Passed** |
| Workflow/Render YAML parsing | **20 files; 0 parse errors** |

Command: `npm ci --ignore-scripts && npm audit && npm run test:all`, with a command-local Chromium
executable/library override because standard sandbox browser downloads are blocked. After the
small production cold-start retry adjustment, the **14 deployment/monitor tests were repeated
and passed**. No production credentials reach test children. SMTP tests use a stub, not a real
mailbox. Actionlint could not be downloaded because the release asset connection returned EOF;
YAML parsing is not a substitute for a completed GitHub Actions run.

## Actual production observations (read-only)

The sandbox shell cannot establish TLS to the Render URL, but the separate page-fetch tool
obtained real JSON from:

- `https://panikajeevansathi.onrender.com/api/health`
- `https://panikajeevansathi.onrender.com/api/site`

The later cache-busted health observation at `time=1788556141459` reported:

- `ok: true`, `storage: supabase`, `photos: supabase+cache`
- `durable: true`, `data_loss_risk: false`
- database loaded, zero pending writes, no reported database/photo errors
- `boot_at: 1788555963515`, different from the earlier observed process

One intervening read returned Render's loading page; the subsequent health request returned
healthy JSON. This is consistent with a free-tier cold start, not evidence of a persistent outage.
The public site response reported 8 members and maintenance disabled. **No member records,
passwords, provider settings or real photo objects were changed by these probes.**

The observed production JSON did **not** contain the new `security_revision` field. Thus the
repaired release was **not yet observed live at this checkpoint**. Existing live health is not
proof of the new privacy fixes, actual inbox delivery, a private bucket/RLS inspection, or a
backup restore. Public health status is configuration/known-error evidence, not a disaster test.

## Release/access boundaries

GitHub repository/PR/run metadata was accessible. Reading Actions secrets/administration returned
HTTP 403 (`Resource not accessible by integration`), and no Render/Supabase/SMTP provider credentials
were supplied to this sandbox. This does not prove that remote secrets are absent. A branch push,
GitHub checks and any PR/release outcomes must be checked separately; a dry-run push is not a release.

No real email was sent, no production backup was restored, and no 24-hour continuous monitoring
run was completed during this audit. See [SECURITY.md](../SECURITY.md) and [DEPLOY.md](../DEPLOY.md)
for the precise production requirements and safe release/backup procedures. Any final deployment
or permission blocker is reported separately rather than silently treated as done.
