# PROOF — Supabase write-through (app-disk wipe)

Generated: 2026-09-04T21:09:26.763Z

## What this is

A **real** write → external store → wipe app disk → read cycle against the production PostgREST client (`lib/supabase.js`).
The remote endpoint is a **local mock** (`scripts/lib/mock-supabase.mjs`) whose sqlite file and object files live **outside** `PJS_DATA_DIR`.

This is **NOT** proof that production `panikajeevansathi.onrender.com` is on Supabase.
Mock-as-production is forbidden: live health must be checked separately.

## Verdict

**Code path (this sandbox):** write-through to an external store survived an app-disk wipe.

**Live production:** see `/api/health` on onrender.com — if `storage` is still `sqlite`, production data-loss is still possible.

🟡 NOT FULLY PROVEN — MORE TEST REQUIRED

## Evidence table

| Check | Result | REAL/MOCK | Evidence | File/Line |
| --- | --- | --- | --- | --- |
| boot health reports supabase | PASS | MOCK | {"storage":"supabase","photos":"supabase+cache"} | server.js health + lib/db.js open() |
| boot photos are supabase write-through | PASS | MOCK | {"photos":"supabase+cache","remote":{"database":{"kind":"supabase","loaded":true,"pending":0,"lastError":null,"requests":53},"photos":{"kind":"supabase+cache","remote":true,"pending":0,"uploads":0,"downloads":0,"lastFlushAt":0,"lastError":null}}} | lib/photos.js createFromEnv |
| boot health durable=true (db+photos remote) | PASS | MOCK | {"durable":true,"data_loss_risk":false} | lib/api.js GET /api/health |
| register via API | PASS | MOCK | {"status":200,"id":2} | lib/api.js POST /api/auth/register |
| profile save via API | PASS | MOCK | {"status":200,"age":29} | lib/api.js PUT /api/profile |
| photo upload via API | PASS | MOCK | {"status":200,"photo":"/uploads/u2-1788556166269.png"} | lib/photos.js save → supabase put |
| photo served after upload | PASS | MOCK | http 200 bytes=93 | server.js GET /uploads/ |
| message send via API | PASS | MOCK | {"status":200,"to":3} | lib/api.js POST /api/messages |
| external store has the member (direct sqlite, not via app) | PASS | MOCK | mock.hasUser(ravi.proof.1788556165652@example.com)=true userCount=3 | scripts/lib/mock-supabase.mjs sqlite file |
| external store has the photo object (direct, not via app) | PASS | MOCK | key=u2-1788556166269.png hasObject=true objectsDir=/tmp/pjs-supabase-proof-MfgWxz/external-store/objects | scripts/lib/mock-supabase.mjs objects dir |
| app disk wiped (no local sqlite leftover) | PASS | MOCK | files=[] | /tmp/pjs-supabase-proof-MfgWxz/app-disk |
| external sqlite still has the member after app-disk wipe | PASS | MOCK | hasUser=true userCount=3 store=/tmp/pjs-supabase-proof-MfgWxz/external-store files=objects,supabase.sqlite,supabase.sqlite-shm,supabase.sqlite-wal | /tmp/pjs-supabase-proof-MfgWxz/external-store/supabase.sqlite |
| external object store still has the photo after app-disk wipe | PASS | MOCK | hasObject=true photoFileOnDisk=true objects=u2-1788556166269.png | /tmp/pjs-supabase-proof-MfgWxz/external-store/objects |
| external store survived mock-process restart (disk, not RAM) | PASS | MOCK | hasUser=true hasObject=true url2=http://127.0.0.1:43719 | /tmp/pjs-supabase-proof-MfgWxz/external-store/supabase.sqlite |
| restart health still supabase (empty local disk) | PASS | MOCK | {"storage":"supabase","photos":"supabase+cache"} | server.js after wipe |
| login after wipe+restart | PASS | MOCK | {"status":200,"email":"ravi.proof.1788556165652@example.com"} | lib/api.js POST /api/auth/login |
| profile survived wipe+restart | PASS | MOCK | {"user_id":2,"headline":"Proof profile","phone":"","age":29,"gender":"Male","height_cm":null,"marital_status":"","religion":"","community":"Panika","sub_community":"","mother_tongue":"","city":"Bilaspur","state":"Chhattisgarh","country":"","education":"","education_detail":"","occupation":"Engineer","company":"","annual_income":"","diet":"","smoking":"","drinking":"","about_me":"Persistence proof row.","family_type":"","family_status":"","father_occupation":"","mother_occupation":"","siblings":" | profiles table via PostgREST |
| messages survived wipe+restart | PASS | MOCK | [{"user":{"id":3,"name":"Meera Proof","photo":null,"age":25,"city":"Raipur","state":"","community":"Panika","education":"","occupation":"Teacher","available":true},"last_message":"proof-message-1788556165652","last_at":1788556166393,"last_from_me":true,"unread":0}] | messages table via PostgREST |
| photo bytes survived wipe+restart (fetched from remote store) | PASS | MOCK | http 200 bytes=93 url=/uploads/u2-1788556166269.png | lib/photos.js ensure → supabase get |
| this run used a local PostgREST mock, not supabase.com | PASS | MOCK | SUPABASE_URL=http://127.0.0.1:43039 (loopback mock). Production not exercised. | scripts/prove-supabase-wipe.mjs |

## Paths

- App disk (wiped): `/tmp/pjs-supabase-proof-MfgWxz/app-disk`
- External store: `/tmp/pjs-supabase-proof-MfgWxz/external-store`
- Mock sqlite: `/tmp/pjs-supabase-proof-MfgWxz/external-store/supabase.sqlite`
- Mock objects: `/tmp/pjs-supabase-proof-MfgWxz/external-store/objects`
- Health after first boot: `{"ok":true,"service":"panika-jeevan-sathi","time":1788556166171,"boot_at":1788556165715,"security_revision":"2026-09-05","release":null,"storage":"supabase","photos":"supabase+cache","durable":true,"data_loss_risk":false,"mail":{"configured":false,"delivery_verified":false},"remote":{"database":{"kind":"supabase","loaded":true,"pending":0,"lastError":null,"requests":53},"photos":{"kind":"supabase+cache","remote":true,"pending":0,"uploads":0,"downloads":0,"lastFlushAt":0,"lastError":null}}}`
- Health after wipe+restart: `{"ok":true,"service":"panika-jeevan-sathi","time":1788556166668,"boot_at":1788556166472,"security_revision":"2026-09-05","release":null,"storage":"supabase","photos":"supabase+cache","durable":true,"data_loss_risk":false,"mail":{"configured":false,"delivery_verified":false},"remote":{"database":{"kind":"supabase","loaded":true,"pending":0,"lastError":null,"requests":20},"photos":{"kind":"supabase+cache","remote":true,"pending":0,"uploads":0,"downloads":0,"lastFlushAt":0,"lastError":null}}}`
- App files immediately after wipe: `[]`

## Secrets

No production tokens were used. Mock key `proof-service-role` is not a live credential.
