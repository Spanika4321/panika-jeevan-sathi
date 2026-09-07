# Deploying SEVA MARKET INDIA on Render (free plan)

Follow this once, top to bottom. Total time: about 15 minutes.
Everything here can be done from a phone browser.

---

## What you are setting up

| Data | Where it lives | If the host wipes its disk |
|---|---|---|
| Catalog — locations, categories, providers, services | Local SQLite, rebuilt at boot from `src/db/seed-data.js` | Rebuilt in ~1 second |
| **Accounts** | **Supabase Postgres** (`seva_users`) | **Untouched** |
| **Customer enquiries** | **Supabase Postgres** (`seva_leads`) | **Untouched** |
| **Audit trail** | **Supabase Postgres** (`seva_audit_logs`) | **Untouched** |

Render's free plan deletes the filesystem on every deploy and every
wake-from-sleep. That is why only regenerable data is allowed to live there.

---

## Step 1 — Create the Postgres tables (Supabase)

1. Open <https://supabase.com/dashboard> and pick your project.
2. Left sidebar → **SQL Editor** → **New query**.
3. Open `seva-market-india/scripts/supabase-storage.sql` in this repo, copy
   the whole file, paste it into the editor.
4. Press **Run**. You should see `Success. No rows returned`.

The script is idempotent — running it twice changes nothing and deletes
nothing. It creates three tables with Row Level Security **on** and all
`anon` / `authenticated` grants revoked, so a leaked public key can read
nothing.

5. Paste `seva-market-india/scripts/supabase-verify.sql` and press Run. That
   message above only means "nothing errored"; this file answers "is the
   schema actually there, and is it locked down?". It is SELECT-only — safe
   to run as often as you like, and every line is independent, so a line
   lost in a phone paste costs one check, not the whole file.

   | Check | Expected |
   |---|---|
   | tables present | 4 rows, `present = t` |
   | RLS on | `rls_enabled = t` on all four |
   | policies | `policy_count = 0` |
   | public-key grants | `can_select = f`, `can_insert = f` on all 8 rows |
   | mirror rows | the counts on the file's `EXPECTED MIRROR ROWS` line (190 in total) |
   | durable tables | `0` until a real signup or enquiry arrives |

### Which paste is which

| Paste | File | Creates |
|---|---|---|
| reference-data mirror | `scripts/supabase-init.sql` | `seva_mirror` (catalog copy, optional) |
| durable storage | `scripts/supabase-storage.sql` | `seva_users`, `seva_leads`, `seva_audit_logs` |

Both are checked by `scripts/supabase-verify.sql`. Step 1 above is the one
this deploy needs; the mirror is documented in `README.md` and only feeds
read-only catalog queries.

## Step 2 — Copy the two Supabase secrets

In the same project: **Project Settings** → **API**.

| Copy this | Into the env var | Looks like |
|---|---|---|
| Project URL | `SUPABASE_URL` | `https://abcdefgh.supabase.co` |
| `service_role` secret | `SUPABASE_SERVICE_ROLE_KEY` | long token, marked *secret* |

> Use the **service_role** key, not `anon`. The anon key is browser-safe and
> cannot write to RLS-protected tables — the app checks the key type at boot
> and refuses to start with the wrong one, so a mistake here is loud, not
> silent.

## Step 3 — Create the Render service

1. Open <https://dashboard.render.com> → **New +** → **Blueprint**.
2. Pick the repository `Spanika4321/panika-jeevan-sathi`.
3. Render reads `seva-market-india/render.yaml` and proposes a service named
   **seva-market-india**. Approve it.
4. It will ask for the two values marked `sync: false`. Paste:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. **Apply** / **Create resources**.

Everything else (`NODE_ENV`, `SEVA_STORAGE=supabase`,
`SEVA_REQUIRE_REMOTE=1`, `SESSION_SECRET`, …) is set by the blueprint.

> Deploying without a blueprint? Create a Web Service by hand with
> **Root Directory** `seva-market-india`, **Build** `npm install --omit=dev`,
> **Start** `node server.js`, **Health check path** `/api/v1/health`, then add
> the same environment variables listed in `render.yaml`.

## Step 4 — Watch the first boot

Open the service → **Logs**. A healthy boot prints:

```
Catalog seeded: 27 categories, 154 locations, 6 providers, 12 services.
SEVA MARKET INDIA listening on http://0.0.0.0:10000 (production)
```

If Supabase is misconfigured the service **crashes on purpose** with a
message that names the missing variable, for example:

```
StorageConfigError: Storage driver "supabase" needs SUPABASE_SERVICE_ROLE_KEY.
```

Fix the variable in **Settings → Environment** and redeploy. A crash here is
the safety net working: it is what stops customer enquiries from being
written to a disk that is about to be erased.

## Step 5 — Verify durability (do not skip)

Open in a browser:

```
https://<your-service>.onrender.com/api/v1/health
```

You want:

```json
{ "ok": true, "data": { "status": "ok", "storage": { "driver": "supabase", "durable": true } } }
```

`"durable": true` is the whole point. If it says `"driver": "sqlite"`, the
service is storing data on the ephemeral disk — stop and fix Step 2/3.

Then the deep check:

```
https://<your-service>.onrender.com/api/v1/health/deep
```

```json
{ "status": "ok", "catalog": { "ready": true }, "storage": { "ok": true, "latency_ms": 120 } }
```

## Step 6 — Prove it with a real round trip

1. Open the site, submit one enquiry through a provider page.
2. Supabase → **Table Editor** → `seva_leads`. Your row is there.
3. Render → **Manual Deploy** → **Deploy latest commit** (this wipes the disk).
4. Reload `seva_leads`. The row is still there.

That is the data-loss question answered by evidence rather than by promise.

---

## Checking from a computer, before deploying

```bash
cd seva-market-india

npm run storage:sql        # prints the SQL to paste in Step 1

SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
SEVA_REQUIRE_REMOTE=1 NODE_ENV=production \
npm run storage:verify     # config + tables + a real write, exit 0 = durable
```

`npm run storage:doctor` does the same without writing the canary row.

---

## Environment variables reference

| Variable | Required | Meaning |
|---|---|---|
| `SUPABASE_URL` | yes (production) | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (production) | service-role key; never sent to a browser |
| `SEVA_STORAGE` | no | `supabase` or `sqlite`; auto-detected otherwise |
| `SEVA_REQUIRE_REMOTE` | recommended | `1` = refuse to boot without Supabase (ephemeral hosts) |
| `SEVA_ALLOW_EPHEMERAL` | no | `1` = silence the SQLite-in-production warning (real disk) |
| `SEVA_SEED_ON_BOOT` | no | `0` disables the catalog rebuild at startup |
| `SEVA_DB_FILE` | no | path to the local catalog file |
| `SESSION_SECRET` | recommended | salts the HMAC used by the per-IP enquiry throttle |
| `TRUST_PROXY_HOPS` | on Render: `1` | how many proxy hops to trust for the client IP |
| `SITE_URL` | no | canonical origin |

---

## Local development is unaffected

```bash
npm install
npm run seed
npm start          # storage driver: sqlite, everything in ./data
npm test           # 179 tests (175 offline, 4 gated on real Postgres)
```

The Supabase path only switches on in production or when you set
`SEVA_STORAGE=supabase` explicitly.

---

## Other hosts

* **Railway / Fly / any container host** — same rules: ephemeral filesystem,
  so set `SEVA_STORAGE=supabase`, `SEVA_REQUIRE_REMOTE=1` and the two
  Supabase variables.
* **VPS with a real disk** — `SEVA_STORAGE=sqlite` plus
  `SEVA_ALLOW_EPHEMERAL=1` is fine; back up `data/seva-market.db` yourself.
