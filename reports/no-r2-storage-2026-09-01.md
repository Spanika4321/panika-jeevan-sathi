# No-R2 storage bridge — 1 September 2026

## Status: code complete

The previous data-loss fix required D1 for records and R2 for photos/backups.
R2 cannot currently be created, so this revision makes the existing D1 database
a supported temporary home for both records and compressed profile photos.
No R2 variable is required for the next 3–4 month bridge period.

## Implemented

- Added the `photo_blobs` D1 table (name, MIME type, base64 payload, byte size,
  timestamp).
- R2 remains first priority when configured; otherwise a D1 database driver
  automatically selects `photos: "d1+cache"`.
- Browser photos are resized to 640 px at JPEG quality 0.78; the server enforces
  a 512 KB default limit (640 KB absolute configuration ceiling).
- Photos are fetched one-at-a-time from D1 after a Render cold start. Blob data
  is deliberately excluded from the boot-time relational mirror, so hundreds
  of MB of photos cannot make startup download the whole table.
- API JSON responses are held until that request's persistence attempt finishes
  and report `X-PJS-Persistence: durable` (or `pending-retry` during an outage).
- If R2 is added later, old D1 photos stay readable and are lazily copied to R2
  on first access, then removed from D1.
- The daily encrypted backup includes `photo_blobs` and succeeds with no R2.
  The newest three artifacts are kept (each expires by 90 days) so large photo
  snapshots cannot quietly exhaust GitHub's free artifact storage.
- Plaintext backups are refused unless `--allow-plaintext` is explicitly used.
  The workflow uses `BACKUP_KEY`, falling back to the existing D1 token until a
  separate key is provided.
- Added a phone-friendly manual `Database restore` workflow. It downloads the
  largest retained healthy `pjs-db-backup` artifact, shows a dry-run, and uses
  idempotent `INSERT OR REPLACE` without wiping newer rows.
- Persistence watch accepts the D1 photo bridge, still rejects local ephemeral
  storage/member-count drops, and opens an alert at 120 MB of D1 photo payloads.
- Render Blueprint/setup/deploy helpers now need only the three D1 values; R2 is
  optional.

## Verification

```text
npm test
  syntax/front-end check             41 checked, 0 errors
  SQLite end-to-end                  134 passed, 0 failed
  cloud + cold-start + migration      32 passed, 0 failed
  backup/restore/no-R2                25 passed, 0 failed

npm run test:json-store              134 passed, 0 failed
npm run test:persistence-watch         5 passed, 0 failed
npm run test:sigv4                    35 passed, 0 failed
npm run health                        95 passed, 0 failed
YAML lint                             successful
```

Coverage includes: D1-only upload, complete local-cache wipe, login and photo
recovery on a fresh instance, 512 KB enforcement, later R2 migration, deletion
from the active backend, encrypted artifact-only backup, photo restoration,
wrong-key failure, plaintext-backup rejection, member-count loss detection and
the 120 MB capacity alarm.

## Deployment boundary

Repository code/workflows can be completed automatically. Account secrets
cannot be read or changed by this GitHub integration. Production is durable only
when Render reports `storage: "d1"`; the exact three-value check is in
`docs/GO-LIVE.md`. During this run the public URL remained on Render's
"Application loading" page, so its current environment could not be verified.
