# Supabase par PANIKA JEEVAN SATHI

Site ka data (users, profiles, interests, messages, photos) Supabase par rakhne
ke liye sirf teen environment variables chahiye. Code pehle se taiyar hai
(`lib/supabase.js`, `lib/db.js`, `lib/photos.js`).

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key — sirf server par, browser me kabhi nahi>
SUPABASE_STORAGE_BUCKET=uploads
```

Jab ye teeno set hote hain, boot par server likhta hai:

```
Storage : supabase (remote write-through)
Photos  : supabase+cache (remote write-through)
```

aur `GET /api/health` deta hai `"storage":"supabase"`, `"durable":true`,
`"data_loss_risk":false`.

## 1. Ek baar ka Supabase setup

1. https://supabase.com/dashboard par project banaiye (free tier chalega).
2. **SQL Editor** kholiye aur `supabase/schema.sql` ka poora content paste
   karke run kar dijiye. Isse 11 tables ban jayenge.
3. **Storage → New bucket** → naam `uploads`. Public rakhne ki zaroorat nahi;
   app service-role key se padhta-likhta hai.
4. **Project Settings → API** se `Project URL` aur `service_role` key copy
   kariye.

## 2. Render (production) par lagana

Render dashboard → service `panikajeevansathi` → **Environment** → teeno
variables add kariye → **Save, rebuild and deploy**.

Deploy ke baad verify:

```bash
curl -s https://panikajeevansathi.onrender.com/api/health
# "storage":"supabase","durable":true
node scripts/verify-supabase-live.mjs
```

Ab Render ka disk wipe ho ya instance badal jaye, member accounts, messages
aur photos Supabase me safe rehte hain.

## 3. GitHub Actions

Repo → Settings → Secrets and variables → Actions me wahi teen secrets
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`) add
kariye, taki keep-alive aur live-proof workflows Supabase check kar saken.

## 4. Bina account ke local par Supabase mode chalana

Supabase account/keys na hon tab bhi site ko **wahi Supabase code path** par
chalaya ja sakta hai:

```bash
npm run dev:supabase
```

Ye `scripts/supabase-dev.mjs` chalata hai. Agar `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` environment me mile to seedhe **asli project** se
baat karta hai. Warna repo ka PostgREST + Storage compatible server uthata hai
jiska data `.supabase-local/` (SQLite file + object directory, app data dir se
bahar) me rehta hai — yaani remote DB, remote photos, `durable=true`.

Durability proof:

```bash
npm run test:supabase-wipe   # app disk wipe + restart ke baad bhi data zinda
```

## Troubleshooting

| Lakshan | Wajah | Fix |
|---|---|---|
| health me `"storage":"sqlite"` | env vars nahi mile | teeno variables set karke redeploy |
| `relation "users" does not exist` | schema nahi chala | `supabase/schema.sql` SQL Editor me run |
| photo upload fail, DB theek | bucket missing | Storage me `uploads` bucket banaiye |
| `401 Invalid API key` | anon key laga di | `service_role` key use kariye (server-only) |
