# Data-loss audit & fix — 1 September 2026

**Status: code side is DONE. Only owner actions remain (see [docs/GO-LIVE.md](../docs/GO-LIVE.md)).**

> **No-R2 update:** the seven-variable D1+R2 plan recorded below is historical.
> R2 was unavailable, so the completed follow-up now needs only the three D1
> values and keeps compressed photos in D1. See
> [no-r2-storage-2026-09-01.md](no-r2-storage-2026-09-01.md) for the current plan,
> tests and recovery workflow.

---

## 1. What was wrong

`GET /api/health` on the live site returned:

```json
{"storage":"sqlite","photos":"local",
 "remote":{"database":{"kind":"sqlite"},"photos":{"kind":"local","remote":false}}}
```

`storage: "sqlite"` means the member database was a file on Render's Free-plan
disk, which is erased whenever the instance sleeps (15 min idle), restarts or
redeploys. Every registration, profile, message and photo was being lost.
`/api/site` showed `members: 1` — the admin account `ensureAdmin()` recreates on
each boot, so the site *looked* healthy while holding no member data.

The Cloudflare D1 / R2 code path already existed and already passed its tests.
It was simply never switched on: **seven missing environment variables.**

Two assumptions in the original brief were wrong:

- There is **no** Google Apps Script / Sheets integration in this repository
  (`grep -riE "script.google|spreadsheet|googleapis|appsscript"` → 0 matches).
  Mail goes out through the Resend API in `scripts/email-report.mjs`.
- D1/R2 is not something to remove — it is the fix, and it was already written.

## 2. What changed in this branch

| File | Change |
|---|---|
| `lib/db.js` | **Bug fix.** The D1 mirror emitted plain `INSERT INTO`. If a flush timed out *after* D1 had applied the write, the retry hit a duplicate primary key and the entire write queue stalled behind it. Now `INSERT OR REPLACE INTO` — retries are idempotent. |
| `server.js` | A production boot with a non-D1 driver now prints a loud, unmissable data-loss banner pointing at `docs/GO-LIVE.md`. |
| `scripts/db-backup.mjs` | **New.** Dumps every D1 table to a snapshot, encrypts it (AES-256-GCM, scrypt-derived key from `BACKUP_KEY`), uploads it to `r2://…/backups/`, prunes to the newest 30. |
| `scripts/db-restore.mjs` | **New.** Restores from a local file or straight from R2. Dry-run by default; `--yes` to apply; `--wipe` optional. Uses `INSERT OR REPLACE`, so restoring twice is safe. |
| `scripts/backup-test.mjs` | **New, 20 checks.** Seeds a mock D1, backs up, verifies the snapshot is encrypted and that member e-mails are *not* readable in it, wipes D1 completely, restores from R2, checks every row is back, restores again (no duplicates), and proves a wrong `BACKUP_KEY` fails loudly. |
| `scripts/persistence-watch.mjs` | **New.** Asks the live site whether its data is safe: storage must be `d1`, photos `r2`, write queue unstuck, and the member count must never fall between runs. |
| `scripts/lib/mock-cloud.mjs` | R2 mock's `ListObjectsV2` is now recursive and honours `?prefix=`, like the real service. |
| `.github/workflows/db-backup.yml` | **New.** Nightly (20:00 UTC / 01:30 IST) encrypted snapshot → R2 **and** a GitHub artifact (90 days). Exits green with a notice while the secrets are unset, so it never spams red builds. |
| `.github/workflows/persistence-watch.yml` | **New.** Every 6 hours; opens/updates a labelled GitHub issue the moment persistence breaks, and closes it automatically when healthy again. Caches the previous member count so a *drop* is detectable. |
| `.github/workflows/guardian.yml` | Now also runs the SigV4, cloud-storage and backup/restore suites (steps 5–7). |
| `README.md`, `docs/GO-LIVE.md`, `ops/*.workflow.yml`, `package.json`, `.gitignore` | Documentation, copies for manual install, `npm run backup` / `restore` / `test:backup` / `watch:persistence`, and `backups/` kept out of git. |

## 3. Verification (all run in this branch)

```
npm run check                 41 checked, 0 syntax errors
node scripts/e2e-test.mjs     134 passed, 0 failed
node scripts/e2e-cloud-test.mjs  19 passed, 0 failed
node scripts/backup-test.mjs     20 passed, 0 failed   ← new
node scripts/test-sigv4.mjs      35 passed, 0 failed
```

`scripts/persistence-watch.mjs` could not reach the live site from this sandbox
(outbound network is blocked here — `example.com` fails too). It runs from
GitHub Actions, where the network is available.

## 4. What only the owner can do

Everything left is account work that needs your logins. It is written out
step by step, in Hindi, for a phone, in **[docs/GO-LIVE.md](../docs/GO-LIVE.md)**:

1. Create a free Cloudflare account, a D1 database and an R2 bucket (~5 min).
2. Paste 7 variables into Render → Environment (~2 min). **Data loss ends here.**
3. Paste the same 7 plus `BACKUP_KEY` into GitHub → Actions secrets (~3 min).

Then `/api/health` must read `"storage":"d1","photos":"r2"`.

## 5. After that, the data lives in three places

| Where | What | Retention |
|---|---|---|
| Cloudflare D1 | live database | permanent + 7-day Time Travel |
| Cloudflare R2 | photos + encrypted snapshots | permanent / newest 30 |
| GitHub artifacts | second, vendor-independent copy | 90 days |

Losing member data now requires all three to fail at once.

## 6. Free-tier headroom (why this stays free)

- **D1:** 500 MB per database, 5 M reads + 100 k writes/day. A profile row is
  well under 2 KB, so 500 MB is on the order of a quarter-million members.
- **R2:** 10 GB storage, zero egress fees. At ~200 KB per photo that is roughly
  50 000 photos.
- **GitHub Actions:** unmetered minutes on a public repo; artifacts capped at
  500 MB (currently ~5 MB used). A snapshot of a few thousand members is well
  under 1 MB, and only 90 days are retained.
- **Resend:** 100 e-mails/day — the alerting path deliberately uses GitHub
  issues, not e-mail, so the cap is never a factor.

## 7. Known limitation, deliberately left alone

GitHub's `schedule:` trigger is best-effort and skips runs under load — the
existing `employee-report` cron (`*/10 * * * *`) fired only 5 times since
31 August. The new workflows are therefore designed to be *idempotent and
self-correcting* rather than punctual: a missed backup simply means the next
night's snapshot, and `persistence-watch` compares against the last reading it
actually took, not against a wall clock.
