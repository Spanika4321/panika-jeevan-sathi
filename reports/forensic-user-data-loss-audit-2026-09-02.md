# PANIKA JEEVAN SATHI — User Data-Loss Forensic Audit

**Date:** 2026-09-02  
**Code under audit:** git `arena/01a0611d-panika-jeevan-sathi` @ `a04ac8a` (same tree as `main`)  
**Production URL probed:** `https://panikajeevansathi.onrender.com`  
**Auditor rule:** PASS / OK / “95 tests passed” / mock e2e is **not** treated as proof that data-loss is solved.

---

## FINAL VERDICT

# 🔴 FAILED — DATA LOSS PROBLEM STILL POSSIBLE

**Stronger than “possible”:** live production is **currently** writing members and photos to **Render’s ephemeral local disk**, not to Cloudflare D1 / R2.

Live `GET /api/health` (REAL PRODUCTION, 2026-09-02):

```json
{
  "ok": true,
  "service": "panika-jeevan-sathi",
  "time": 1788335918755,
  "storage": "sqlite",
  "photos": "local",
  "remote": {
    "database": { "kind": "sqlite" },
    "photos": {
      "kind": "local",
      "remote": false,
      "pending": 0,
      "uploads": 0,
      "downloads": 0,
      "lastFlushAt": 0,
      "lastError": null
    }
  }
}
```

- `storage: "sqlite"` → member DB is `data/panika-jeevan-sathi.db` on the instance.
- `photos: "local"` + `remote: false` → photos are `data/uploads/` on the instance.
- Render Free **wipes that filesystem** on sleep (≈15 min idle), restart, and redeploy. The Blueprint itself says so (`render.yaml` lines 8–22).

`ok: true` only means the process is up. It is **not** a persistence proof.

Live `GET /api/site` (REAL PRODUCTION): `counts.members = 2`. That number is **not** durable. `ensureAdmin()` recreates the owner on every empty boot (`server.js` 82–141), so a freshly wiped instance still looks “healthy” with 1–2 rows.

---

## 1. CURRENT STORAGE ARCHITECTURE (code proof)

| Provider | Used for production **user** data? | Proof |
| --- | --- | --- |
| **node:sqlite file** | **YES — this is what production reports today** | Live health `storage=sqlite`. Code default: `lib/db.js` 731–787, `PJS_STORAGE=auto` → D1 only if `CF_*` present, else sqlite file `PJS_DATA_DIR/panika-jeevan-sathi.db`. |
| **Cloudflare D1** | **Code exists. Production is NOT using it.** | Client: `lib/d1.js` 41–52 `configFromEnv()` needs `CF_ACCOUNT_ID` + `CF_D1_DATABASE_ID` + `CF_D1_API_TOKEN`. Driver: `lib/db.js` 408–557 `createMirrorDriver`, `kind: 'd1'`. Live health is `sqlite`, not `d1`. |
| **Cloudflare R2** | **Code exists. Production is NOT using it.** | `lib/r2.js` 35–52; `lib/photos.js` 32–161, `kind: client ? 'r2+cache' : 'local'`. Live health `photos=local`, `remote=false`. |
| **Supabase** | **NO** | Repo grep (excluding docs about the *old* site): no supabase client. |
| **Firebase / Firestore** | **NO** | Repo grep: no matches. |
| **PostgreSQL / MongoDB** | **NO in this app** | `DEPLOY.md` 112–115: previous Next.js+PostgreSQL site was superseded. Current app does not import postgres/mongo. |
| **Google Sheets / Apps Script** | **NO in this tree** | Not in `lib/` or `server.js`. |
| **Render / local filesystem** | **YES — authoritative store in production right now** | `server.js` 25 `DATA_DIR = process.env.PJS_DATA_DIR \|\| …/data`. SQLite file + `uploads/` + `outbox/` + `session-secret.key` + `admin-credentials.txt`. |
| **Browser localStorage / sessionStorage** | **Not authoritative user data** | No `localStorage` / `sessionStorage` in `public/` or `lib/`. Session = HMAC cookie `pjs_session` (`lib/auth.js` 12–13, 105–116). |
| **`storage/` JSON (agents)** | **Not user data** | AI-agent memory only (`storage/README.md`). |

### Driver selection (exact)

`lib/db.js` 739–787:

1. `PJS_STORAGE` default `'auto'` (line 743).
2. If mode is `d1` **or** (`auto` **and** `d1Lib.configFromEnv()` non-null) → D1 mirror driver (746–766).
3. Else try sqlite file `dataDir/panika-jeevan-sathi.db` (775–779).
4. Else JSON file `dataDir/panika-jeevan-sathi.json` (782–783).

`render.yaml` 40–42 sets `PJS_STORAGE=auto`. Cloudflare keys 51–66 are `sync: false` (must be typed in Render dashboard). Comment at `render.yaml` 20–22:

> Without those values the site still boots, but it uses the local SQLite file and will lose its data on the next restart.

That is **exactly** the live configuration.

### Photos

- Save: `lib/photos.js` 85–91 — `fs.writeFileSync` into `<dataDir>/uploads`, then **queue** R2 `put` **only if** `client` exists.
- Serve: `server.js` 338–348 `/uploads/:name` → `photos.ensure()` → local file, or R2 download if client exists.
- Production: no R2 client → `kind: 'local'` (`lib/photos.js` 79). `server.js` 53–55 even warns: if D1 were on and R2 off, photos would be lost on restart. Today **both** DB and photos are local.

---

## 2. REAL WRITE PATH

### Frontend → API

`public/login.html` 266–276 (register form):

```
PJS.post('/api/auth/register', { name, email, password, gender, looking_for, community, religion, city, state })
```

`public/assets/js/app.js` 128–150: `fetch(urlPath, { credentials: 'same-origin' })` — relative `/api/…`, cookie session, **no localStorage write of the profile**.

Profile: `public/edit-profile.html` → `PJS.put('/api/profile', …)` and `PJS.post('/api/profile/photo', { data_url })`.

### API → database function

`lib/api.js` 395–469 `POST /api/auth/register`:

- 414: `db.insert('users', { email, password_hash, name, … })`
- 430: `db.insert('profiles', { user_id, gender, city, … })`
- 487: `return ok(ctx.res, { user: serializeUser(...) })` → `sendJson` → `res.end` (`lib/api.js` 23–31)

`lib/api.js` 250–267 photo: `photos.save(...)` then `db.update('users', { id }, { photo: url })`.

Messages / interests / shortlist: same `db.insert` / `db.update` on tables defined in `lib/db.js` 19–31.

### What `db.insert` actually hits **in production today**

Because live `storage=sqlite`, `db` is `createSqliteDriver` (`lib/db.js` 123–217):

- `INSERT INTO "users" …` against the **local file**
- Not D1 HTTPS
- File path: `PJS_DATA_DIR/panika-jeevan-sathi.db` (`lib/db.js` 741)

### Intended D1 write path (code only — NOT live)

If `CF_*` were set:

1. `createMirrorDriver` keeps **RAM** tables (`lib/db.js` 259–351, 408–418).
2. `insert` mutates RAM and `onMutate` → `record()` queues `INSERT INTO "users" …` (`lib/db.js` 434–456). **Plain `INSERT`, not `INSERT OR REPLACE`.**
3. After the HTTP handler: `server.js` 333–334 `await api.handle(…); await persist();`
4. `persist()` 71–80 calls `driver.flush()` → `client.run(statements)` → `POST https://api.cloudflare.com/client/v4/accounts/{id}/d1/database/{id}/query` (`lib/d1.js` 174–185).

**This path is dormant on production** because `configFromEnv()` returned null (otherwise health would say `d1`).

### Critical: “saved” is returned **before** remote flush

`lib/api.js` `handle()` 1648–1650 calls `sendJson` / `res.end` **inside** the handler.  
`server.js` 333–334 runs `persist()` **after** `handle()` returns.

Comments that claim otherwise are **false relative to the code**:

- `lib/db.js` 514–517: “Awaited by the server before each response is finished”
- PR #9 text: “every change is written through to D1 before the HTTP response completes”

`persist()` **swallows errors** (`server.js` 75–79). Client can get HTTP 200 while D1/R2 never ACK. Queue retries on a 5s timer (`server.js` 197–201) and on SIGTERM (`server.js` 393–407). A Render kill / sleep / crash **drops the in-memory queue**.

---

## 3. REAL READ PATH

### Production today (sqlite)

```
SQLite file on instance disk
  → createSqliteDriver.one/all (`lib/db.js` 176–206)
  → API handlers e.g. GET /api/me (`lib/api.js` 626–636), GET /api/profile (687–705), GET /api/conversations, …
  → JSON response
  → frontend PJS.get (app.js 146–150)
```

Login: `POST /api/auth/login` (`lib/api.js` 491–541) → `db.one('users', { email })` → cookie.

Photos: `GET /uploads/<file>` → `photos.ensure` → `fs` path (`server.js` 338–348, `lib/photos.js` 109–125). No R2.

### D1 path (code only — NOT live)

Boot: `driver.load()` SELECTs every table into RAM (`lib/db.js` 488–508).  
**All later reads are RAM only** (`createMemoryDriver.one/all`). They are **not** live D1 reads. After restart, RAM is empty until `load()` succeeds. If D1 never received the flush, the member is gone.

---

## 4. LOCAL / TEMPORARY STORAGE AUDIT

| Location | Role for **user** data | Authoritative in production? |
| --- | --- | --- |
| Browser `localStorage` / `sessionStorage` / `indexedDB` | **Not used** (grep empty in `public/`, `lib/`, `server.js`) | No |
| HMAC cookie `pjs_session` | Session only (`lib/auth.js`). Points at `users.id`. | No (pointer, not store) |
| `data/panika-jeevan-sathi.db` | **YES — live production DB** | **YES today** |
| `data/panika-jeevan-sathi.json` | Fallback if `node:sqlite` missing or `PJS_STORAGE=json` | Not live (Node 22.22.3 on Render per `render.yaml` 38) |
| `data/uploads/` | **YES — live production photos** | **YES today** |
| `data/outbox/` | Mail copies, not profiles (`lib/api.js` 89–91) | No |
| `data/session-secret.key` | Secret if `SESSION_SECRET` unset (`lib/auth.js` 18–36). Render Blueprint generates `SESSION_SECRET` (`render.yaml` 46–47). | Session continuity, not member rows |
| `/tmp` | Only mock tests (`scripts/lib/mock-cloud.mjs` 22, 155) | No |
| `storage/agents/**` JSON | AI agents, not members | No |
| Render filesystem | Host of sqlite + uploads | **YES — and it is ephemeral** |

**Conclusion:** production user data **does** permanently depend on Render local disk. That is the data-loss bug.

---

## 5. D1 / R2 CONFIGURATION PROOF

### Env names (no secret values — none are present in this checkout)

| Purpose | Variables | Source |
| --- | --- | --- |
| D1 | `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_API_TOKEN` (or `CF_API_TOKEN`) | `lib/d1.js` 41–52 |
| D1 API override (tests) | `CF_D1_API_URL` | `lib/d1.js` 50 |
| R2 | `R2_ACCOUNT_ID` (fallback `CF_ACCOUNT_ID`), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `lib/r2.js` 35–52 |
| R2 extras | `R2_ENDPOINT`, `R2_REGION`, `R2_PREFIX` (default `uploads`) | `lib/r2.js` 41–51 |
| Mode | `PJS_STORAGE=auto\|sqlite\|json\|d1` | `lib/db.js` 743 |

This audit environment: **all of the above UNSET** (cannot query real D1/R2 from here).

`render.yaml` 51–66: those keys are `sync: false` → **not stored in git**. Live health proves they are **not set (or not complete)** on the running service: otherwise `configFromEnv()` would be non-null and `storage` would be `d1`.

### Fallback behaviour

- Missing D1 config + `auto` → sqlite, site still boots (`lib/db.js` 768–787). **This is the live path.**
- `PJS_STORAGE=d1` with missing config → throw (`lib/db.js` 747–750).
- D1 configured but unreachable at boot → `process.exit(1)` (`server.js` 161–184). **Does not apply today** because D1 is not selected.
- R2 missing → photos local (`lib/photos.js` 168–171).

### Binding

There is **no** Wrangler `[[d1_databases]]` / Worker binding. D1 is used only via Cloudflare HTTP API from the Node process. No `wrangler.toml` in the repo.

---

## 6. ACTUAL PERSISTENCE TESTS

### 6.1 REAL PRODUCTION — health / site (executed)

| Step | Result | Label |
| --- | --- | --- |
| `GET https://panikajeevansathi.onrender.com/api/health` | `storage=sqlite`, `photos=local`, `remote.photos.remote=false` | **REAL PRODUCTION** |
| `GET https://panikajeevansathi.onrender.com/api/site` | `counts.members=2`, `stories=0` | **REAL PRODUCTION** |
| `GET https://panikajeevansathi.coolstore.in/api/health` | **503 Service Unavailable** | **REAL PRODUCTION** (old URL down) |
| Production register `DATA_LOSS_AUDIT_<ts>` | **NOT VERIFIED** — this sandbox’s Node/Python/curl TLS to Render fails (`Client network socket disconnected before secure TLS connection was established`). GET health worked only via a separate fetch proxy. No production POST was performed. | NOT VERIFIED |
| Independent D1 SELECT of a test row | **NOT VERIFIED** — no `CF_*` credentials here | NOT VERIFIED |
| Production restart / redeploy then re-read | **NOT VERIFIED** — no Render API key, cannot bounce the service | NOT VERIFIED |

**Do not treat members=2 as survival.** After a wipe, `ensureAdmin()` creates the owner again (`server.js` 105–141). A site that “has an admin and looks fine” is the classic false-healthy state.

### 6.2 LOCAL sqlite — same driver production uses (executed)

Script: `scripts/forensic-persistence-audit.mjs`  
Marker: `PJS_PERSISTENCE_PROOF_1788336024639`  
User name: `DATA_LOSS_AUDIT_1788336024639`

| Step | Result | Label |
| --- | --- | --- |
| Boot without `CF_*` | `storage=sqlite photos=local` | LOCAL |
| A) Register | HTTP 200, `id=2` | LOCAL |
| Profile + photo write | HTTP 200, `/uploads/u2-1788336024946.png` | LOCAL |
| B) Row in sqlite file | `users=2 nameMatch=true` file `/tmp/pjs-forensic-sqlite-*/panika-jeevan-sathi.db` | LOCAL |
| Same-disk restart login + profile + photo | HTTP 200, `about_me` marker intact | LOCAL — **proves sqlite-on-persistent-disk only** |
| **Wipe data dir (Render sleep simulation) then login** | **HTTP 401 — CONFIRMED_DATA_LOSS** | **SIMULATION of production host** |

Same-disk restart **must not** be sold as a Render proof. Render does not keep that file.

### 6.3 MOCK D1 / MOCK R2 (executed — not production)

`scripts/e2e-cloud-test.mjs` header lines 4–13 and 123–138: **local HTTP stand-ins** (`scripts/lib/mock-cloud.mjs`), `CF_D1_API_URL` / `R2_ENDPOINT` pointed at `127.0.0.1`.

This audit’s mock run:

- mock D1 register + disk wipe + login: HTTP 200, marker survived — **MOCK**
- mock R2 photo after disk wipe: HTTP 200 — **MOCK**

**`e2e-cloud-test.mjs` is not production D1 proof.** Guardian CI (`.github/workflows/guardian.yml`) does not even run it; it runs sqlite e2e, json e2e, and `health-check.mjs` (95 page/SEO checks, no D1).

`reports/health-report-latest.md` “95 passed / Healthy” is **LOCAL** page checks. It does not touch persistence.

---

## 7. PHOTO / FILE PERSISTENCE

| Test | Result | Label |
| --- | --- | --- |
| Production photo store | `photos=local`, `remote=false` | **REAL PRODUCTION — FAIL (ephemeral)** |
| Local upload then same-disk restart | Photo HTTP 200 | LOCAL only |
| Local upload then wiped dir | Photo gone with the sqlite user (401 on login) | SIMULATION — data loss |
| Mock R2 after wipe | Photo HTTP 200 | MOCK — not Cloudflare |

Production photo URL shape is `/uploads/u{id}-{ts}.{ext}` (`lib/api.js` 262–263). There is no R2 public bucket URL in the app. After Render wipe, `ensure()` has no local file and no R2 client → 404 (`lib/photos.js` 109–115).

---

## 8. PRODUCTION VS MOCK (do not mix)

| Suite | What it actually is |
| --- | --- |
| Live `/api/health` | **REAL PRODUCTION** |
| `scripts/forensic-persistence-audit.mjs` sqlite half | **LOCAL** / **SIMULATION** |
| `scripts/e2e-test.mjs` section 14 restart | **LOCAL** — same `PJS_DATA_DIR`, sqlite file kept (`scripts/e2e-test.mjs` 646–669) |
| `scripts/e2e-cloud-test.mjs` | **MOCK** D1 + **MOCK** R2 |
| `scripts/lib/mock-cloud.mjs` | **MOCK** — temp sqlite + temp folder behind D1/R2 HTTP shapes |
| `npm run health` / 95 checks | **LOCAL** availability/SEO/design lock |
| Guardian Actions | **LOCAL** on GitHub runner, not Render, not D1 |
| Unmerged PR #21 / other-branch audits | **Not this tree.** Mentioned only as context. |

---

## 9. DEPLOYMENT SURVIVAL

| Asset | Survives Render Free restart/sleep/redeploy **today**? |
| --- | --- |
| Users | **NO** — sqlite file erased. Verdict: **FAIL** (architecture + live driver). Full bounce test: **NOT VERIFIED** (no Render API). |
| Profiles | **NO** — same file, table `profiles` |
| Registrations | **NO** |
| Messages | **NO** — table `messages` in same file |
| Photos | **NO** — local `uploads/` |
| Admin account | **Re-created empty** by `ensureAdmin()` — looks alive, members gone |

`https://panikajeevansathi.coolstore.in` → 503. Not a durable fallback.

Docker (`Dockerfile` 6 `PJS_DATA_DIR=/app/data`) is also ephemeral unless a volume is mounted (`DEPLOY.md` 147–154). Railway is documented dead (`DEPLOY.md` 20–27).

---

## 10. DATA-LOSS ROOT CAUSE

### BEFORE (original)

- Node + **local sqlite** + **local uploads** (`server.js` 7–8 still says “All data lives in ./data”).
- Deployed to **Render Free** (`render.yaml` plan `free`, no disk).
- Render Free disk is **ephemeral**.

### ATTEMPTED AFTER (PR #9, merged 2026-08-29, commit `7e65de3` / `f0e1966`)

- Added D1 + R2 clients and `PJS_STORAGE=auto`.
- **Did not fail the boot** when Cloudflare env vars are missing.
- Dashboard must paste 7 secrets (`render.yaml` `sync: false`).

### AFTER — what is actually running (this audit)

Live health **still `sqlite` + `local`**. The D1/R2 code is **dead code on production**.

Root cause is **not** “D1 client missing from the repo”. Root cause is:

1. **Authoritative store = Render instance filesystem.**
2. **D1/R2 never switched on** (env not complete).
3. **Silent fallback** so the site looks healthy (`ok: true`, admin recreated, `members` 1–2).
4. Even if D1 were turned on, remaining code defects (below) can still lose writes.

### Additional loss paths (even after D1 is connected)

These are in **this** tree; they are **not** fixed on `main`:

1. **HTTP 200 before flush** + swallowed flush errors (`server.js` 71–80, 333–334).
2. **Plain `INSERT` retry poison** (`lib/db.js` 434–456). If D1 applied a batch but the HTTP call timed out, retry hits `UNIQUE` / PK, `retryable: false` (`lib/d1.js` 236–241), queue stuck, later writes never leave RAM, restart drops them. An unmerged branch (`Fix permanent data loss: D1 retry bug…`) and PR #21 describe switching to `INSERT OR REPLACE`. **Not in this code.**
3. **Reads from RAM, not D1** after boot (`lib/db.js` 390–396, 488–508).
4. **Photos stay local unless R2 env is set.** PR #21 (OPEN, not merged) states R2 was unavailable and tries D1 blobs — **not in this tree**.
5. **No production persistence watchdog on `main`.** `verify-cloud.mjs` exists but is not in Guardian CI.

Historical live observation on another branch’s report (`reports/audit-data-loss-2026-09-01.md` on `arena/01a05ecf-…`, **not this commit**): health was already `storage=sqlite`. **Still sqlite today.** The env-var fix never landed on the running service.

---

## 11. WHAT WOULD BE REQUIRED TO MOVE OFF 🔴

Not done in this audit (would be **owner** work + a later audit):

1. Render dashboard: set all `CF_*` and `R2_*` (or an equivalent durable store). Redeploy.
2. Live `/api/health` must show `"storage":"d1"` and photos `"remote": true` (or a reviewed D1-blob photo mode **merged and deployed**).
3. Create `DATA_LOSS_AUDIT_<ts>` / `PJS_PERSISTENCE_PROOF_<ts>` on production.
4. Prove the row in **D1** (query API), via **API**, then after **restart/redeploy**, same row and photo.
5. Fix INSERT retry + “200 before flush” if D1 is the store.

Until 1–4 are real evidence, **do not declare solved**.

---

## 12. EVIDENCE TABLE

| Check | Result | REAL/MOCK | Evidence | File/Line |
| --- | --- | --- | --- | --- |
| Database provider | **FAIL — live sqlite file, not D1** | REAL PRODUCTION | health JSON `storage=sqlite` | live `/api/health`; `lib/db.js` 739–787 |
| User write | Writes to **local sqlite** today. D1 insert function exists but unused | REAL PRODUCTION + code | register `db.insert('users')`; driver.kind sqlite | `lib/api.js` 414–430; `lib/db.js` 151–164 |
| User read | Reads from **local sqlite** today. D1 path would read RAM mirror | REAL PRODUCTION + code | `db.one` / `db.all`; D1 `load()` then RAM | `lib/api.js` 626–636, 176–178; `lib/db.js` 488–508 |
| Persistent storage | **FAIL** — Render ephemeral disk is authoritative | REAL PRODUCTION | health `sqlite`+`local`; Blueprint admits wipe | `render.yaml` 8–22, 40–42; `server.js` 25 |
| No local authoritative storage | **FAIL** — local **is** authoritative | REAL PRODUCTION | sqlite file + uploads | `lib/db.js` 741; `lib/photos.js` 85–91 |
| D1 production connection | **FAIL / NOT CONNECTED** | REAL PRODUCTION | health not `d1`; `CF_*` `sync: false` | `lib/d1.js` 41–52; `render.yaml` 51–56 |
| R2 production connection | **FAIL / NOT CONNECTED** | REAL PRODUCTION | `photos.remote=false` | `lib/r2.js` 35–52; `lib/photos.js` 79 |
| User survives restart | **FAIL (architecture). Bounce: NOT VERIFIED** | REAL + SIMULATION | wipe sim → login 401; no Render bounce | `scripts/forensic-persistence-audit.mjs`; `render.yaml` 8–12 |
| User survives redeploy | **FAIL (architecture). Redeploy: NOT VERIFIED** | REAL PRODUCTION | same ephemeral disk | `render.yaml` 8–22 |
| Photo survives restart | **FAIL** | REAL PRODUCTION | `photos=local` | live health; `lib/photos.js` 85–91, 109–115 |
| Data-loss root cause fixed | **FAIL — not fixed on live site** | REAL PRODUCTION | still sqlite+local after PR #9 | this report §10 |

---

## Appendix A — Production payloads (verbatim)

Health:

```json
{"ok":true,"service":"panika-jeevan-sathi","time":1788335918755,"storage":"sqlite","photos":"local","remote":{"database":{"kind":"sqlite"},"photos":{"kind":"local","remote":false,"pending":0,"uploads":0,"downloads":0,"lastFlushAt":0,"lastError":null}}}
```

Site counts: `members=2`, `stories=0`.  
coolstore.in: HTTP 503 “Service Unavailable”.

## Appendix B — Local/simulation command output (excerpt)

```
FORENSIC LOCAL AUDIT  marker=PJS_PERSISTENCE_PROOF_1788336024639
[LOCAL] boot without CF_* uses sqlite: PASS — storage=sqlite photos=local
[LOCAL] register write accepted: PASS — HTTP 200 id=2
[LOCAL] sqlite file contains the test user: PASS — users=2 nameMatch=true
[LOCAL] same-disk restart: profile readable: PASS
[SIMULATION] Render-style wipe DESTROYS user data when storage=sqlite: CONFIRMED_DATA_LOSS — login HTTP 401
[MOCK] mock D1: profile survived instance replacement: PASS
```

Mock survival is **not** a production pass.

## Appendix C — What this audit did **not** do

- Did not print or use any Cloudflare / Render secret (none available).
- Did not register a user on the live site (TLS POST blocked from this sandbox).
- Did not bounce Render.
- Did not merge or deploy a fix. This document is an audit, not a patch.
