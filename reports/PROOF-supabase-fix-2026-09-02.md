# PROOF — Supabase data-loss fix

Generated: 2026-09-02 (Asia/Calcutta)

## Final verdict

**🟡 NOT FULLY PROVEN — MORE TEST REQUIRED**

Not 🟢: live `https://panikajeevansathi.onrender.com` has **not** been shown running
Supabase. This sandbox cannot set Render env or redeploy. A mock PostgREST wipe-disk
run is **not** production supabase.com proof.

Not 🔴 for the new code path: write → external store → wipe app disk → read **passed**
against the production client (`lib/supabase.js`) talking HTTP PostgREST + Storage.

Live site still loses data until `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set,
`supabase/schema.sql` is run, and the service is redeployed. After that, `/api/health`
must show `"storage":"supabase"` and `"photos":"supabase+cache"`.

## What changed in code

| Piece | Behaviour |
| --- | --- |
| `lib/supabase.js` | Write-through PostgREST + Storage. No in-memory queue. Failed remote write fails the API. |
| `lib/db.js` | Prefers Supabase, then D1, then sqlite/json. `mustUseRemote()` throws on Render/`PJS_REQUIRE_REMOTE` without a remote driver. |
| `lib/photos.js` | Awaits remote `put` before returning. Kind `supabase+cache`. |
| `lib/api.js` / `lib/settings.js` / `server.js` | All db/photo/settings calls are awaited. Boot fail-closed. |
| `supabase/schema.sql` | Postgres tables + RLS, no anon policies. |
| `render.yaml` | `PJS_REQUIRE_REMOTE=1`, `SUPABASE_*` env (sync:false). |

## Evidence table

| Check | Result | REAL/MOCK | Evidence | File/Line |
| --- | --- | --- | --- | --- |
| Live `/api/health` this turn | NOT VERIFIED | REAL | Render loading page (free-plan sleep spinner). No JSON body. Previous REAL health this session was `storage=sqlite` `photos=local` `time=1788336503473`. | `https://panikajeevansathi.onrender.com/api/health` |
| Fail-closed: `SITE_URL` onrender without SUPABASE_* | PASS | REAL (local process) | Throws: `This host has an ephemeral disk. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY` | `lib/db.js` `mustUseRemote()` + `open()` |
| Fail-closed: `PJS_REQUIRE_REMOTE=1` without SUPABASE_* | PASS | REAL (local process) | Same throw | `lib/db.js` |
| Local `PJS_STORAGE=auto` without remote env still sqlite | PASS | REAL (dev) | `kind sqlite remote null` | `lib/db.js` `open()` |
| Boot health reports supabase | PASS | MOCK | `{"storage":"supabase","photos":"supabase+cache"}` | `server.js` health + `lib/db.js` |
| Register via API | PASS | MOCK | HTTP 200, user id 2 | `lib/api.js` POST `/api/auth/register` |
| Profile save via API | PASS | MOCK | HTTP 200, age 29, community Panika | `lib/api.js` PUT `/api/profile` |
| Photo upload via API | PASS | MOCK | HTTP 200, `/uploads/u2-1788337538908.png` | `lib/photos.js` `save` → supabase `put` |
| External store has member **direct sqlite, not via app** | PASS | MOCK | `mock.hasUser(...)=true userCount=3` | mock sqlite file outside `PJS_DATA_DIR` |
| External store has photo object **direct, not via app** | PASS | MOCK | `hasObject=true` key `u2-1788337538908.png` | mock objects dir outside `PJS_DATA_DIR` |
| App disk wiped (no local sqlite leftover) | PASS | MOCK | `files=[]` | tmp `app-disk` |
| External sqlite still has member after wipe | PASS | MOCK | `hasUser=true userCount=3` store still had `supabase.sqlite` + WAL | mock sqlite |
| Login after wipe+restart | PASS | MOCK | HTTP 200, same email | `lib/api.js` POST `/api/auth/login` |
| Profile survived wipe+restart | PASS | MOCK | age 29, community Panika, occupation Engineer | profiles via PostgREST |
| Messages survived wipe+restart | PASS | MOCK | last_message `proof-message-1788337538523` | messages via PostgREST |
| Photo bytes survived wipe+restart | PASS | MOCK | HTTP 200, 93 bytes from remote `get` after empty local cache | `lib/photos.js` `ensure` |
| `npm test` e2e (local sqlite restart) | PASS | MOCK | 134 passed, 0 failed. This is **not** production persistence proof. | `scripts/e2e-test.mjs` |
| This wipe run used supabase.com | FAIL (expected) | MOCK | `SUPABASE_URL=http://127.0.0.1:37007` loopback mock. No production tokens. | `scripts/prove-supabase-wipe.mjs` |

## How to get 🟢 on production

1. Create a Supabase project. Run `supabase/schema.sql` in the SQL editor.
2. On Render → Environment, set:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (service_role, not anon)
   - `SUPABASE_STORAGE_BUCKET=uploads`
   - keep `PJS_REQUIRE_REMOTE=1`
3. Redeploy. Confirm `GET /api/health` returns `"storage":"supabase"` and `"photos":"supabase+cache"`.
4. Register a throwaway member, upload a photo, send a message, then **restart the Render service** (or wait for sleep) and read the same rows back.
5. Only that live write → Render sleep/restart → read is 🟢.

## Secrets

No production tokens, keys, or passwords are in this report. The mock key `proof-service-role` is not a live credential.

## Reproduce the sandbox wipe proof

```bash
node scripts/prove-supabase-wipe.mjs
```

This starts a durable mock PostgREST+Storage process whose sqlite/object files live **outside** the app data dir, writes through the real client, deletes the app dir, restarts the app, and reads the member/profile/message/photo back.
