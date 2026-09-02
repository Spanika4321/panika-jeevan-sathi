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

## 1. Ek baar ka Supabase setup (GitHub connection)

GitHub se connect karne ke baad schema **apne aap** lagta hai — SQL editor
me paste karne ki zaroorat nahi, jab tak **Deploy to production** on ho.

1. https://supabase.com/dashboard par project banaiye (free tier chalega).
2. **Project Settings → Integrations → GitHub** → ye repo connect kariye
   (`Spanika4321/panika-jeevan-sathi`).
   - **Working directory:** `.`
   - **Production branch:** `main`
   - **Deploy to production:** ON
3. `main` par merge ke baad GitHub `supabase/migrations/` apply karta hai
   aur `config.toml` se private `uploads` photo bucket banaata hai.
   Table Editor me `users`, `profiles`, `messages` dikhne chahiye.
4. **Project Settings → API** se `Project URL` aur `service_role` key copy
   kariye — ye Render par paste karni hai (neeche §2). GitHub connection
   schema lagata hai; website ko baat karne ke liye URL + key abhi bhi
   Render par chahiye.

**Fallback** (Deploy to production off ho): SQL Editor me `supabase/schema.sql`
paste karke Run, ya:

```bash
node scripts/supabase-setup.mjs --access-token sbp_xxx --apply
```

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
| `relation "users" does not exist` | schema nahi chala | GitHub **Deploy to production** ON + `main` merge, ya `schema.sql` SQL Editor me Run |
| photo upload fail, DB theek | bucket missing | Storage me `uploads` bucket banaiye |
| `401 Invalid API key` | anon key laga di | `service_role` key use kariye (server-only) |
