# RAW PROOF — production is sqlite/local (data-loss still live)

This file is evidence only. No “95 passed”. No mock counted as production.

---

## PROOF 1 — live website, twice (REAL PRODUCTION)

URL: `https://panikajeevansathi.onrender.com/api/health`

**Capture A** (time `1788335918755` = 2026-09-02T07:58:38.755Z):

```json
{"ok":true,"service":"panika-jeevan-sathi","time":1788335918755,"storage":"sqlite","photos":"local","remote":{"database":{"kind":"sqlite"},"photos":{"kind":"local","remote":false,"pending":0,"uploads":0,"downloads":0,"lastFlushAt":0,"lastError":null}}}
```

**Capture B** (time `1788336328326`, ~7 minutes later, still the same driver):

```json
{"ok":true,"service":"panika-jeevan-sathi","time":1788336328326,"storage":"sqlite","photos":"local","remote":{"database":{"kind":"sqlite"},"photos":{"kind":"local","remote":false,"pending":0,"uploads":0,"downloads":0,"lastFlushAt":0,"lastError":null}}}
```

| Field | Value | Meaning |
| --- | --- | --- |
| `storage` | `"sqlite"` | **Not D1.** Member DB is a local file. |
| `photos` | `"local"` | **Not R2.** |
| `remote.photos.remote` | `false` | No Cloudflare photo mirror. |
| `ok` | `true` | Process is up. **Not** persistence. |

`GET /api/site` same window: `"counts":{"members":2,"stories":0}`.

What health is allowed to report is coded here:

```375:386:lib/api.js
  route('GET', '/api/health', async () => ({
    status: 200,
    body: {
      ok: true,
      service: 'panika-jeevan-sathi',
      time: Date.now(),
      storage: db.kind || 'unknown',
      photos: photos.kind,
      remote: options.remoteStatus ? options.remoteStatus() : null
    }
  }));
```

`db.kind` is `'sqlite'` only from `createSqliteDriver` (`lib/db.js` 142).  
D1 would have been `'d1'` (`lib/db.js` 485). Live JSON is `'sqlite'`. **D1 is not the live store.**

---

## PROOF 2 — the running host wipes that sqlite file (REAL CONFIG)

```8:22:render.yaml
# IMPORTANT — why there is no disk here:
# Render's Free plan has an *ephemeral* filesystem and cannot attach a
# persistent disk, so a normal SQLite file would be erased every time the
# service sleeps (15 min idle) or redeploys.
# ...
# Without those values the site still boots, but it uses the local SQLite file
# and will lose its data on the next restart (fine for a demo, not production).
```

```32:42:render.yaml
    plan: free
    ...
      - key: PJS_STORAGE
        value: auto # auto → D1 when CF_* is set, else local SQLite
```

Cloudflare keys are `sync: false` (not in git, must be set in dashboard). Live health proves they are **not active**.

---

## PROOF 3 — why missing CF_* becomes sqlite (CODE)

```743:787:lib/db.js
  const mode = String(process.env.PJS_STORAGE || 'auto').trim().toLowerCase();
  const d1Config = mode === 'd1' || mode === 'auto' ? d1Lib.configFromEnv() : null;

  if (mode === 'd1' || (mode === 'auto' && d1Config)) {
    ...
  }
  ...
      driver = createSqliteDriver(sqliteFile);
  ...
  return { driver, driverError, ready: null, sqliteFile, jsonFile, remote: null };
```

`configFromEnv()` returns `null` unless all three of `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_API_TOKEN` are set (`lib/d1.js` 41–47). Null → sqlite file `data/panika-jeevan-sathi.db`.

Register writes that same `db`:

```414:430:lib/api.js
    const user = db.insert('users', {
      email,
      password_hash: auth.hashPassword(password),
      name,
      ...
    });

    db.insert('profiles', {
      user_id: user.id,
      ...
```

On production today that `insert` is sqlite-on-disk, not D1.

Photos:

```85:91:lib/photos.js
    save(name, buffer, contentType) {
      const clean = safeName(name);
      if (!clean) throw new Error('Invalid photo name.');
      fs.writeFileSync(path.join(dir, clean), buffer);
      if (client) enqueue({ type: 'put', name: clean, buffer, contentType });
      return `/${dirName}/${clean}`;
    },
```

Live `photos.remote=false` → `client` is null → file stays only on instance disk.

---

## PROOF 4 — same driver, disk wiped → user gone (SIMULATION of Render)

Executed `node scripts/forensic-persistence-audit.mjs` at 2026-09-02.

Marker: `PJS_PERSISTENCE_PROOF_1788336342717`

```
[LOCAL] boot without CF_* uses sqlite: PASS — storage=sqlite photos=local
[LOCAL] register write accepted: PASS — HTTP 200 id=2
[LOCAL] sqlite file contains the test user: PASS
[LOCAL] same-disk restart: user can log in: PASS
[SIMULATION] Render-style wipe DESTROYS user data when storage=sqlite: CONFIRMED_DATA_LOSS — login HTTP 401
```

Same-disk restart surviving is **not** Render proof. Render does not keep the file. Wipe → **401**. That is the production failure mode.

---

## NOT proof (do not mix)

| Item | Label |
| --- | --- |
| Mock D1 after wipe still logs in | **MOCK** (`scripts/lib/mock-cloud.mjs`) — not Cloudflare, not production |
| `e2e-cloud-test.mjs` | **MOCK** |
| Guardian “95 passed” | **LOCAL** pages/SEO, no D1 |
| Production register of `DATA_LOSS_AUDIT_*` | **NOT VERIFIED** — this sandbox cannot POST to Render (TLS `ECONNRESET`) |
| Production process bounce then re-read | **NOT VERIFIED** — no Render API key |

---

## Verdict from this proof

Live site, two independent GETs, both say **`storage=sqlite` + `photos=local`**.

That store is the Render Free disk. The Blueprint says that disk is erased on sleep/redeploy.

**Data-loss problem is not solved.**
