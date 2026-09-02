# PROOF — Supabase write-through (app-disk wipe)

Generated: 2026-09-02T08:36:15.000Z

## What this is

A **real** write → external store → wipe app disk → read cycle against the production PostgREST client (`lib/supabase.js`).
The remote endpoint is a **local mock** (`scripts/lib/mock-supabase.mjs`) whose sqlite file and object files live **outside** `PJS_DATA_DIR`.

This is **NOT** proof that production `panikajeevansathi.onrender.com` is on Supabase.
Mock-as-production is forbidden: live health is checked separately (REAL row below).

`scripts/e2e-cloud-test.mjs` talks to a **mock D1 + mock R2**. It is **not** production D1 proof.

## Verdict

**Code path (this sandbox):** write-through to an external store survived an app-disk wipe **and** a mock-process restart (sqlite file + object files on disk, not RAM). 20/20 MOCK checks PASS.

**Live production:** `GET https://panikajeevansathi.onrender.com/api/health` at time `1788338175630` returned `storage=sqlite` `photos=local`. No `durable` field (old deploy). Production member data is still on Render's ephemeral disk.

**Production write → sleep → read:** NOT VERIFIED (no Render API key, no SUPABASE_* in this environment, sandbox TLS cannot POST to onrender.com).

🟡 NOT FULLY PROVEN — MORE TEST REQUIRED

## Evidence table

| Check | Result | REAL/MOCK | Evidence | File/Line |
| --- | --- | --- | --- | --- |
| boot health reports supabase | PASS | MOCK | `{"storage":"supabase","photos":"supabase+cache"}` | server.js health + lib/db.js open() |
| boot photos are supabase write-through | PASS | MOCK | photos=`supabase+cache` remote.photos.remote=true | lib/photos.js createFromEnv |
| boot health durable=true (db+photos remote) | PASS | MOCK | `{"durable":true,"data_loss_risk":false}` | lib/api.js GET /api/health |
| register via API | PASS | MOCK | status=200 id=2 | lib/api.js POST /api/auth/register |
| profile save via API | PASS | MOCK | status=200 age=29 | lib/api.js PUT /api/profile |
| photo upload via API | PASS | MOCK | status=200 photo=/uploads/u2-….png | lib/photos.js save → supabase put |
| photo served after upload | PASS | MOCK | http 200 bytes=93 | server.js GET /uploads/ |
| message send via API | PASS | MOCK | status=200 | lib/api.js POST /api/messages |
| external store has the member (direct sqlite, not via app) | PASS | MOCK | mock.hasUser=true userCount=3 | scripts/lib/mock-supabase.mjs sqlite file |
| external store has the photo object (direct, not via app) | PASS | MOCK | hasObject=true | scripts/lib/mock-supabase.mjs objects dir |
| app disk wiped (no local sqlite leftover) | PASS | MOCK | files=[] | PJS_DATA_DIR |
| external sqlite still has the member after app-disk wipe | PASS | MOCK | hasUser=true userCount=3 files=objects,supabase.sqlite,supabase.sqlite-shm,supabase.sqlite-wal | external-store/supabase.sqlite |
| external object store still has the photo after app-disk wipe | PASS | MOCK | hasObject=true photoFileOnDisk=true | external-store/objects |
| external store survived mock-process restart (disk, not RAM) | PASS | MOCK | hasUser=true hasObject=true after close()+reopen of mock from same files | scripts/lib/mock-supabase.mjs |
| restart health still supabase (empty local disk) | PASS | MOCK | storage=supabase photos=supabase+cache | server.js after wipe |
| login after wipe+restart | PASS | MOCK | status=200 email=ravi.proof.…@example.com | lib/api.js POST /api/auth/login |
| profile survived wipe+restart | PASS | MOCK | age=29 community=Panika city=Bilaspur | profiles table via PostgREST |
| messages survived wipe+restart | PASS | MOCK | last_message=proof-message-… | messages table via PostgREST |
| photo bytes survived wipe+restart (fetched from remote store) | PASS | MOCK | http 200 bytes=93 | lib/photos.js ensure → supabase get |
| this run used a local PostgREST mock, not supabase.com | PASS | MOCK | SUPABASE_URL=http://127.0.0.1:… (loopback). Production not exercised. | scripts/prove-supabase-wipe.mjs |
| local e2e (sqlite data dir) | PASS | MOCK | 134/134 | scripts/e2e-test.mjs — local disk, not production persistence |
| e2e-cloud D1+R2 | PASS | MOCK | 19/19 against in-process mock D1/R2 | scripts/e2e-cloud-test.mjs — **not** production D1 |
| fail-closed: PJS_STORAGE=supabase without SUPABASE_* | PASS | REAL | process exit 1, Error: `PJS_STORAGE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.` | lib/db.js open() |
| fail-closed: PJS_REQUIRE_REMOTE=1 PJS_STORAGE=auto RENDER=true without remote creds | PASS | REAL | process exit 1, ephemeral-disk refuse | lib/db.js mustUseRemote() |
| live onrender.com /api/health | FAIL | REAL | `{"ok":true,"storage":"sqlite","photos":"local","remote":{"database":{"kind":"sqlite"},"photos":{"kind":"local","remote":false}}} time=1788338175630` — no `durable` field (old code). Site is up; data is **not** in Supabase. | https://panikajeevansathi.onrender.com/api/health |
| live write → Render sleep → read | NOT VERIFIED | REAL | No RENDER_API_KEY, no SUPABASE_* in this env, sandbox cannot POST to onrender.com (TLS). Live sqlite already proves durable store is not connected. | production |

## What still blocks 🟢

1. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the Render service (dashboard; `render.yaml` has `sync: false`).
2. Run `supabase/schema.sql` once in the Supabase SQL editor.
3. Merge/deploy this branch so production health shows `storage=supabase` `photos=supabase+cache` `durable=true`.
4. REAL write (register + photo + message) → wait for Render sleep or restart → same rows/bytes come back.

Until step 4, production data-loss is still possible.

## Secrets

No production tokens were used. Mock key `proof-service-role` is not a live credential.
This file contains no secret values.
