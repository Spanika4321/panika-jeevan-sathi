# Security and operational safety

## What the application enforces

- Verified, active sessions; recovery tokens are not returned publicly. Password changes,
  suspension and privilege changes revoke old sessions. Owner-email claims alone grant no access.
- JSON-only state changes and same-origin checks prevent form/login CSRF. Rate limits use the
  socket address or the explicitly configured trusted proxy chain, not arbitrary client headers.
- CSP hashes allow the shipped inline scripts without permitting injected scripts or event
  attributes. HTTPS responses carry HSTS; recovery tokens are not sent in referrers.
- Profile visibility and photo privacy cover both JSON and actual image bytes, including chat,
  interests and shortlist routes. Private photos are not cached publicly.
- Supabase startup requires core member tables and a private photo bucket. Its service-role key
  stays server-side. Keep the RLS policies in `supabase/schema.sql`; do not add anonymous read policies.
- Corrupted SQLite/JSON storage fails closed. JSON writes are atomic and synced before acknowledgment;
  D1 writes wait for remote flush. Provider failures must not become a false successful save.
- SMTP uses TLS with certificate validation and bounded timeouts. Failed/rejected mail stays in a
  private local outbox, never a public token response. Outbox storage is not inbox delivery and is
  ephemeral on Render Free.
- Deployment preserves all existing environment variables and refuses unreadable/truncated settings,
  implicit storage migrations and local-only Render storage. Workflow forms contain no credentials.
- Admin mutations are serialised and permissions rechecked in the supported single app process.
  Last-admin safeguards also apply to moderation, not just the member editor.

## Required production setup

1. Set a canonical HTTPS `SITE_URL`, a strong persistent `SESSION_SECRET` (at least 32 characters),
   and a strong `ADMIN_PASSWORD` for the first boot. Store them in provider/protected GitHub secrets,
   never in chat, workflow inputs, logs, Git, issue bodies or browser code.
2. Run `supabase/schema.sql` and keep the photo bucket private. Use remote database **and** photo
   storage on ephemeral hosts. Do not clear environment variables or switch databases to fix an outage.
3. Run `npm ci --omit=dev --ignore-scripts` in production builds. Configure `SMTP_HOST`, `SMTP_PORT`,
   `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`. Check provider acceptance **and the recipient inbox** before
   enabling mandatory verification. Port 465 selects SMTPS by default; other ports require STARTTLS.
4. Set `TRUST_PROXY_HOPS` to the exact trusted proxy count (Render defaults to 1). Prevent access that
   bypasses those proxies. A local direct server defaults to 0. For an HTTPS development preview
   behind Arena's proxy, start with `TRUST_PROXY_HOPS=1`; do not point a preview at production data.
5. Keep encrypted, access-controlled database **and object** backups outside the primary provider.
   Test restoring into an isolated project. A local app-disk wipe test is not a production backup restore.

## Checks and monitoring

```sh
npm ci --ignore-scripts
npm audit --audit-level=high
npm test
npm run test:all          # requires Chromium: npx playwright install --with-deps chromium
npm run verify:production # read-only real-site check; no accounts, emails or photos are created
```

Website Guardian runs source/security/storage/browser checks. The production watchdog runs every
six hours and after main merges **once these workflow changes reach the default branch**. It checks
availability, remote storage and error/pending-write flags, security headers/release, private API
denial and SMTP configuration. It attempts an owner alert only when a configured Resend key is
available; a failure still makes the workflow red even if mail cannot be sent. Configure GitHub
workflow notifications too. Schedules can be delayed or disabled; they are not an availability SLA.

The production write/restart/read workflow is manual, explicitly opt-in, and attempts to remove
only its own temporary test members. No observed restart means no successful restart proof.
Cancellation/provider failure can prevent cleanup; inspect temporary Liveproof accounts if needed.

## Boundaries of the evidence

Local tests use disposable databases, mock cloud providers and dummy mail credentials. Passing them
is not evidence of a deployed release, real inbox delivery, live RLS/bucket configuration, a completed
24-hour run or a production backup restore. The health API reports current configuration/known errors;
`durable=true` is not protection against provider deletion, account compromise or all future failures.

Run a single app instance with the current D1 mirror/session-rate-limit design. Scaling requires shared
rate limiting and transactional cross-instance admin protections. Use provider edge rate limits/WAF,
keep dependencies patched, restrict administrator accounts, review access/audit logs and rotate any
exposed credentials. These changes are not a formal independent penetration test or a guarantee that
all vulnerabilities have been eliminated.

## Reporting an issue

Report suspected security issues privately to the repository owner via the GitHub security reporting
feature if available, or an existing verified owner contact. Do not put member details, reset links,
passwords, database dumps or provider keys in public issues. Describe the affected route and use
synthetic accounts for reproductions. Never test against other members without authorisation.
