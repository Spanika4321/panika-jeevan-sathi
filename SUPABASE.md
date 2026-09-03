# Supabase setup — step by step (Hindi)

App runtime par sirf teen env vars padhta hai (`lib/supabase.js`):

| Naam (bilkul yahi spelling) | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** key |
| `SUPABASE_STORAGE_BUCKET` | `uploads` |

> Supabase ka GitHub integration Render par variables **nahi** bhejta. Render alag service hai — wahan manually daalne padte hain.

---

## 1. Supabase project banaiye
1. https://supabase.com → New project (region: **Singapore** — Render service bhi Singapore me hai).
2. Database password kahin note kar lijiye.

## 2. Schema chalaiye (sirf ek baar)
1. Supabase → **SQL Editor** → New query.
2. Is repo ki file `supabase/schema.sql` ka **poora content** paste karke **Run**.
3. Table Editor me `users`, `profiles`, `interests`, `messages`, `settings` ... dikhne chahiye.

## 3. Storage bucket banaiye
1. Supabase → **Storage** → New bucket.
2. Naam: `uploads`. **Public** rakhiye (photos browser me dikhni hain).
3. Create.

## 4. Keys copy kijiye
Supabase → **Project Settings → API**:
- **Project URL** → `SUPABASE_URL`
- **service_role** (secret) → `SUPABASE_SERVICE_ROLE_KEY`  ← `anon` key **mat** lijiye, warna RLS block karega.

## 5. Render par set kijiye  ← yahi missing link hai
1. Render dashboard → service **panikajeevansathi** → **Environment**.
2. Add environment variable, teeno naam upar wali table se (aage/peeche space na ho, quotes na lagayein).
3. **Save Changes**.
4. Phir **Manual Deploy → Deploy latest commit** (env change ke baad redeploy zaroori hai).

## 6. Verify
Browser me kholiye: https://panikajeevansathi.onrender.com/api/health

Sahi jawab aisa dikhega:
```json
{"ok":true,"storage":"supabase","photos":"supabase",
 "remote":{"database":{"kind":"supabase"},"photos":{"kind":"supabase","remote":true}}}
```
Agar abhi bhi `"storage":"sqlite"` aaye → variables app tak nahi pahunche (step 5 dobara).

Local par test:
```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_STORAGE_BUCKET=uploads \
PJS_STORAGE=supabase node server.js
```

---

## Troubleshooting

| Symptom | Wajah / fix |
|---|---|
| `"storage":"sqlite"` | Render par var nahi hai, ya save ke baad redeploy nahi hua |
| Boot fail: "needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY" | Var khaali/typo. `PJS_STORAGE=supabase` fail-closed hai — ye achha hai, data delete hone se bachata hai |
| 401 / "Invalid API key" | `anon` key daal di, `service_role` chahiye |
| Photo upload fail | Bucket ka naam `uploads` nahi hai, ya bucket bana hi nahi |
| Tables not found (PGRST205) | `supabase/schema.sql` chala hi nahi |
