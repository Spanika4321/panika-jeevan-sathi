# Apps Script — repo se auto-update (phone par manual editing ZERO)

Aapka Apps Script project **alag** hai (`script.google.com/macros/s/.../exec`).
Hum **naya project nahi bana rahe**. Ye folder us **maujuda** project ka
**source of truth** hai; GitHub Action us purane project ka code overwrite
kar deta hai — **script ID aur /exec URL bilkul same rehte hain**.

```
apps-script/Code.gs          ← yahan edit hota hai (repo mein)
apps-script/appsscript.json  ← manifest
        │
        │  git push  →  GitHub Action  →  Apps Script API
        ▼
Maujuda project (same script ID) → naya version → maujuda deployment update
        ▼
https://script.google.com/macros/s/.../exec   (URL NAHI badalta)
```

## Ek baar ka setup (~10 min, phone se bhi ho jata hai)

**1. Apps Script API on karein**
<https://script.google.com/home/usersettings> → *Google Apps Script API* = **ON**

**2. Script ID copy karein**
Apps Script project → ⚙ **Project Settings** → *Script ID* → GitHub secret `GAS_SCRIPT_ID`

**3. Deployment ID copy karein**
Apps Script → **Deploy → Manage deployments** → aapki web app → *Deployment ID*
→ GitHub secret `GAS_DEPLOYMENT_ID`
*(Yahi wo deployment hai jiska URL aap already use kar rahe hain — isko update karne se URL same rehta hai.)*

**4. OAuth client banayein**
<https://console.cloud.google.com> → koi bhi project → *APIs & Services*
- *Library* → **Apps Script API** → Enable
- *Credentials* → **Create credentials → OAuth client ID → Desktop app**
- Client ID / Client secret → GitHub secrets `GAS_CLIENT_ID`, `GAS_CLIENT_SECRET`

**5. Refresh token banayein (ek hi baar)**
```bash
GAS_CLIENT_ID=xxx GAS_CLIENT_SECRET=yyy node scripts/appsscript-auth.mjs
```
Link kholein → allow → code paste → jo token print ho use GitHub secret
`GAS_REFRESH_TOKEN` mein daalein.

**6. Workflow install karein**
`ops/appsscript-deploy.workflow.yml` ka content GitHub par
`.github/workflows/appsscript-deploy.yml` naam se commit karein.
*(GitHub apps ko workflow files banane nahi deta, isliye ye ek step aapko karna hai.)*

## Uske baad — hamesha automatic

`apps-script/Code.gs` badla + `main` par push → Action chalta hai →
purane project ka code update → naya version → maujuda deployment us version par.
**Phone par kuch bhi copy-paste nahi.**

Manual chalana ho: GitHub → Actions → *Apps Script Deploy* → **Run workflow**.

Local test:
```bash
npm run appsscript:check    # syntax + manifest
npm run appsscript:dry      # kya bhejenge, bina bheje
npm run appsscript:deploy   # asli deploy (secrets env mein chahiye)
```

## Website ↔ Apps Script

Website par ye env variables set karein (Render/Railway dashboard):

| Variable | Value |
| --- | --- |
| `APPS_SCRIPT_URL` | aapka `.../exec` URL |
| `APPS_SCRIPT_TOKEN` | koi bhi lamba secret |

Aur Apps Script mein: **Project Settings → Script Properties**
- `PJS_SHARED_SECRET` = wahi token
- `PJS_SHEET_ID` = Google Sheet ka ID (log yahan aayega)
- `PJS_OWNER_EMAIL` = alert email (optional)

Ab har registration / contact message website se aapki Sheet mein bhi chala jayega.
Bridge ki health: `GET /api/health` → `apps_script`, ya admin ke liye
`GET /api/admin/apps-script`.

## Safety

- Apps Script band ho ya slow ho → website **bilkul normal** chalti rehti hai
  (fire-and-forget, 6 s timeout, member ko koi error nahi).
- `APPS_SCRIPT_URL` set na ho → bridge poori tarah off.
- Deploy se pehle `appsscript-check.mjs` syntax + `doGet`/`doPost` verify karta hai,
  isliye toota hua code kabhi live nahi jaata.
