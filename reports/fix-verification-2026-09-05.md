# Fix and re-check — 5 September 2026 (IST)

## Fixed

- Malformed URLs/cookies no longer crash the server; invalid JSON and oversized requests return proper errors.
- Password-reset and verification tokens are no longer exposed in public API responses or notifications. Recovery links use the configured site origin; outbox files are private.
- Owner sign-ups must verify their mailbox before getting administrator access. Unverified and suspended accounts cannot use existing sessions.
- Direct photo requests enforce profile/photo privacy, including previously known URLs.
- Legacy registration, signup, password-reset and chat links redirect to working pages.
- Name search, photo-only search, invalid pagination and partial preferred-age updates are handled correctly.
- Chat read receipts refresh; drafts stay with the correct recipient; stale responses cannot overwrite another conversation. Missing chats show an error.
- Mobile contact details wrap correctly; confirmation dialogs resolve on cancellation; invalid API responses are not reported as successful.
- Syntax checks cover backend, agents and automation as well as browser scripts. Test processes do not inherit production storage or mail credentials.
- Guardian CI and its template now include regression, browser and local cloud-storage checks.

## Verification

The initial extra regression checks reproduced the failures before fixes. Checks were rerun after fixes.

| Suite | Result |
| --- | --- |
| All-source syntax | 81 checked, 0 errors |
| Security/error-handling regressions, SQLite | 19 passed |
| Member journey, SQLite | 137 passed |
| JSON fallback | 137 member checks + 19 regressions passed |
| Cloudflare D1/R2 local mocks | 137 member checks + 19 cloud checks passed |
| Supabase local mock, app-disk wipe and restart | 20 checks passed |
| AWS SigV4 | 35 passed |
| Local health and reviewed UI baseline | 118 passed |
| Chromium desktop/mobile flows | 6 passed |
| Agent storage integrity / agent-team checks | Passed |
| npm audit | 0 vulnerabilities |

The complete `npm run test:all` matrix passed. After the final recovery-screen wording updates, syntax, regression, member-flow and health checks were repeated and passed. The UI baseline was explicitly refreshed for the reviewed fixes, not disabled.

Browser checks used Chromium 149 via `PJS_CHROMIUM_EXECUTABLE` because the sandbox could not download Playwright's default browser. Normal setup is documented in README.md.

## Scope and deployment

These are local and mock-cloud results, **not live-production verification**. No production deployment, real-member modification, git push or merge was performed. SMTP must be configured and tested for actual email delivery; a private outbox entry is not a delivered email. Real deployment/durability verification remains a separate step in DEPLOY.md.
