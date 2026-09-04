# Deploying PANIKA JEEVAN SATHI

This app is a **Node.js server**. Production member data must live **off the host disk**
(Supabase Postgres + Storage). Local SQLite under `./data` is for development only.

> ⚠️ **GitHub Pages will not work.** Pages serves static files only — there is no Node process and no
> database, so registration, login, search, interests and messaging cannot run there. Use one of the
> options below.

Requirements: **Node.js 22.5+** (uses the built-in `node:sqlite`). Run `npm ci --omit=dev --ignore-scripts` for the locked SMTP dependency.

---

## Production URLs

| Environment | URL | Status / notes |
| --- | --- | --- |
| **Recommended production (Render, free)** | `https://panikajeevansathi.onrender.com` | Created by the Blueprint below. Pair with **Supabase** (Postgres + Storage) for durable data. |
| Previous production (cPanel hosting) | `https://panikajeevansathi.coolstore.in` | The old Next.js site. The superseded app can be replaced by this one on the same hosting (see § 1c) so the same domain stays live. |
| **Do not use** | `precious-abundance-production.up.railway.app` | Old Railway sandbox. Railway's free sandbox was removed, which is exactly what the **“Sandbox Not Found”** error means: the deployment container no longer exists. |

**Permanently fixing “Sandbox Not Found”:** the error comes from a dead Railway sandbox, not from
this app. The fix is to host the app on a platform whose service is guaranteed to exist (Render
Free, cPanel/VPS, or any durable Node host) — Railway requires a paid plan plus a persistent volume
now, so it is not used for this site.

---

## 1. Render — Free plan (recommended: ₹0/month)

Render's Free plan runs the Node server for free, but **its filesystem is wiped
every time the service sleeps (15 minutes idle) or redeploys, and free services
cannot attach a persistent disk**. So this deployment keeps everything that must
survive in **Supabase** (write-through HTTPS, no local queue):

| What | Where | Notes |
| --- | --- | --- |
| Members, profiles, interests, messages, settings | **Supabase Postgres** (PostgREST) | Run `supabase/schema.sql` once |
| Profile photos | **Supabase Storage** bucket `uploads` | Same project, service-role key |
| The web service itself | **Render Free** | 750 instance-hours / month, sleeps when idle |

`PJS_REQUIRE_REMOTE=1` (and `SITE_URL` on `onrender.com`) **refuse to boot** with
local sqlite. That fail-closed path is the only way Render sleep cannot silently
recreate an empty site.

### A. Create the Supabase project (once, ~5 minutes)

1. Sign up at [supabase.com](https://supabase.com) (free).
2. New project → copy **Project URL** (`https://<ref>.supabase.co`).
3. **Project Settings → API** → copy the **service_role** key (server only — never put it in the browser).
4. **SQL Editor** → paste and run [`supabase/schema.sql`](supabase/schema.sql).
5. **Storage** → ensure `uploads` is **private** (`public=false`). The app can create a missing private bucket; it refuses to start against a public bucket. RLS in `supabase/schema.sql` must stay enabled.

Cloudflare D1 + R2 remain a supported fallback if `SUPABASE_*` is unset and `CF_*` / `R2_*` are set.

### B. Deploy on Render (one click)

The Blueprint `render.yaml` creates the service **`panikajeevansathi`**, so the public URL is
**`https://panikajeevansathi.onrender.com`**.

1. Make sure the latest code is on `main` (it is, after merging this branch).
2. Open: `https://dashboard.render.com/blueprint/new?repo=https://github.com/Spanika4321/panika-jeevan-sathi`
3. Render reads `render.yaml`, creates the **Free** web service (Singapore region,
   `node server.js`, health check `/api/health`) and asks you to fill in
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from step A. `SESSION_SECRET`
   and `ADMIN_PASSWORD` are generated for you; `SITE_URL` is pre-set to
   `https://panikajeevansathi.onrender.com`. Without those two values the
   service **will not start** (`PJS_REQUIRE_REMOTE=1`).
4. Click **Apply**. Deployment takes ~2 minutes.

**Option 2 — guarded API deployment:** configure `RENDER_API_KEY` as a protected GitHub
secret, then use *Actions → Deploy to Render*. Select the intended ref; the workflow runs
the complete test suite and deploys the exact checked-out commit. Never put credentials in
workflow form inputs, command arguments, chat, issue bodies or Git.

For an existing service, storage/SMTP/owner/custom settings are read completely (including
pagination) and preserved. A failed settings read or update aborts deployment. Changing a
database or bucket is refused as an implicit migration. Optional `SUPABASE_*` and `SMTP_*`
GitHub secrets can supply configuration; omitted values never delete existing settings.
New service creation requires an explicit local `--create` and durable storage credentials.

The deployment runner uses secrets already present in the process environment:

```bash
npm run test:all
node scripts/deploy-render.mjs
```

### C. Read-only production safety check

```bash
npm run verify:production -- --url https://panikajeevansathi.onrender.com
```

This uses GET requests only: health, a real database-backed `/api/site` read, remote database
**and** photo status, error/pending-write flags, CSP/HSTS/privacy headers, private API denial,
and server-file protection. It also checks that the security release is deployed and SMTP is
configured. SMTP configuration does **not** establish inbox delivery. The check returns nonzero
on failed or unknown requirements; a Render loading page is not healthy API JSON.

Use the `ADMIN_PASSWORD` stored in Render's protected Environment settings for first login.
Configured passwords are not printed in release logs. Change it after signing in.

### C2. Explicit production write/restart/read test

The **Live proof** workflow is **manual and opt-in**, not scheduled. It creates two synthetic
members, a photo and a message. It attempts cleanup even on errors and refuses to create
unverifiable accounts when mandatory email verification would prevent cleanup. Enable its
`allow_test_members` input only when authorised to perform this test.

```bash
node scripts/verify-supabase-live.mjs --allow-test-members \
  --url https://panikajeevansathi.onrender.com --wait-min 17
```

A different `boot_at` is required for the restart check. Waiting 17 minutes or observing a slow
request is not proof of a restart. A restart/read-back is still **not a provider backup restore
or proof of a filesystem wipe**. If the run is forcibly cancelled or the provider stays down,
review temporary Liveproof members and complete cleanup in the admin panel.

### C3. Ongoing monitoring (not an uptime guarantee)

| Workflow | Schedule | Checks |
| --- | --- | --- |
| **Website Guardian** | Daily, plus code pushes/PRs | Syntax, security, dependencies, member journeys, local/mock storage, browser regressions |
| **Keep-alive** | Every six hours; also after main merges | The §C read-only production check, with a private-data-free report |
| **Live proof** | Manual opt-in only | §C2 synthetic write/restart/read test |

Schedules become active only after the workflow reaches the repository's default branch.
GitHub schedules can be delayed or disabled and provider outages/quotas remain possible.
The keep-alive job attempts an owner alert through the `RESEND_API_KEY` secret and
`.report-recipient`; missing credentials or provider rejection mean **no confirmed alert**,
while the failed check still turns the job red. Resend acceptance is not an inbox receipt.
No one-day continuous monitoring result is implied by installing these workflows.

### D. Durable data without Cloudflare (optional)

Upgrade to **Render Starter** and attach a persistent disk mounted at `/app/data`,
then set `PJS_STORAGE=sqlite`. No Cloudflare setup needed; backups = copy `/app/data`.

---

## 1c. Restoring the previous URL on cPanel (`panikajeevansathi.coolstore.in`)

The previous production site (a Next.js 16 + PostgreSQL app) was superseded by this
Node.js build. The cPanel account `/home/panikaje` already has **persistent
storage**, so this app runs there with a durable SQLite database — no Cloudflare,
no PostgreSQL, no extra costs.

1. cPanel → **Setup Node.js App** → Create Application:
   - Node.js version: **22.22.3** (or any 22.5+; the app falls back to the JSON store below 22.5)
   - Application root: `panika-jeevan-sathi`
   - Application URL: `panikajeevansathi.coolstore.in`
   - Startup file: `server.js`
2. Clone/copy this repository into `/home/panikaje/panika-jeevan-sathi`
   (or upload a zip and extract — no `npm install` needed).
3. Environment variables (cPanel → Setup Node.js App → Environment Variables):
   - `SITE_URL=https://panikajeevansathi.coolstore.in`
   - `SESSION_SECRET=` a long random string
   - `ADMIN_EMAIL=sukulpanika939@gmail.com`, `ADMIN_PASSWORD=` a strong password
   - optional: `SMTP_HOST=mail.panikajeevansathi.coolstore.in`, `SMTP_PORT=465`,
     `SMTP_USER=contact@panikajeevansathi.coolstore.in`, `SMTP_PASS=…`
4. **Start / Restart** the app. All data lives in `data/` in the app root —
   back it up with the rest of the account. Log in at `/admin.html`.

---

## 2. Railway — not recommended (this was the “Sandbox Not Found” host)

Railway's free sandbox tier no longer exists, so the old service shows **“Sandbox
Not Found”** and the URL returns **502 Bad Gateway**. If you still want Railway,
you must use a paid plan and a persistent **Volume** mounted at `/data`
(set `PJS_DATA_DIR=/data`), set `SESSION_SECRET`, and keep Node ≥ 22.5
(`railway.json` sets the health check; the app reads Node's version from
`package.json` `engines`). No code change is needed, but the project's
environment must be re-created — the old sandbox cannot be revived from code.

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 300
  }
}
```

## 3. Docker (any host: VPS, Fly.io, ECS…)

```bash
docker build -t panika-jeevan-sathi .
docker run -d --name pjs -p 3000:3000 \
  -e SESSION_SECRET="a-long-random-string" \
  -e SITE_URL="https://panikajeevansathi.onrender.com" \
  -v pjs-data:/app/data \
  panika-jeevan-sathi
```

Health check: `GET /api/health`.

## 4. VPS with systemd

```bash
git clone <repo> /opt/panika-jeevan-sathi && cd /opt/panika-jeevan-sathi
sudo tee /etc/systemd/system/pjs.service > /dev/null <<'UNIT'
[Unit]
Description=PANIKA JEEVAN SATHI
After=network.target

[Service]
WorkingDirectory=/opt/panika-jeevan-sathi
ExecStart=/usr/bin/node server.js
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=SITE_URL=https://panikajeevansathi.onrender.com
Environment=SESSION_SECRET=change-me-to-a-long-random-string
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl enable --now pjs
```

Put nginx or Caddy in front for TLS and proxy `/` to `127.0.0.1:3000`.

---

## First administrator login

The site-owner account is **not** a normal member. On first start the server creates an
administrator (default email `sukulpanika939@gmail.com` unless `ADMIN_EMAIL` is set). The password
comes from `ADMIN_PASSWORD` in production (Render can generate this environment value).
Local development can generate one and print it once. A private copy is written to
`data/admin-credentials.txt` (not committed); configured passwords are never printed.

```
  Email    : <ADMIN_EMAIL or sukulpanika939@gmail.com>
  Password : <ADMIN_PASSWORD or generated>
  Panel    : /admin.html
```

Log in at `/admin.html` and change the password immediately from **Admin account**.

To set your own:

```
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='YourStrongPass1' node server.js
```

You can list extra owner emails with `OWNER_EMAILS=one@x.com,two@x.com`.
A newly registered owner must verify that mailbox before being promoted; an unverified or
suspended account is never automatically activated by owner promotion.

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `HOST` | `0.0.0.0` | keep as-is on containers/PaaS |
| `PJS_DATA_DIR` | `./data` | **must be on persistent storage** |
| `SITE_URL` | request origin | canonical URL used in robots.txt + sitemap.xml (pin it in production) |
| `SESSION_SECRET` | local development: generated in `data/` | Production requires a persistent value of at least 32 characters |
| `TRUST_PROXY_HOPS` | `1` on Render, `0` otherwise | Configure the exact trusted reverse-proxy count; protect direct backend access |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | generated | first administrator only |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | — | SMTP credentials; Nodemailer is installed by `npm ci` |
| `PJS_STORAGE` | `auto` | `auto` = Supabase when `SUPABASE_*` is set, else D1, else SQLite; `supabase` / `d1` / `sqlite` / `json` force one |
| `PJS_REQUIRE_REMOTE` | unset | `1` = refuse local sqlite (set on Render) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | — | Production database + photos (required on Render Free) |
| `SUPABASE_STORAGE_BUCKET` | `uploads` | Storage bucket name |
| `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_API_TOKEN` | — | Cloudflare D1 fallback |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | — | Cloudflare R2 fallback photos |
| `R2_PREFIX` | `uploads` | folder inside the bucket |
| `R2_ENDPOINT` | derived from the account id | override for other S3-compatible hosts |

Verification/reset links are never shown publicly or returned by the API. Configure SMTP and
run the locked `npm ci` install for automatic delivery. Without SMTP (or after a delivery
failure), mail is kept in the private `data/outbox/` (admin panel → **Emails**) for local testing or
trusted support-assisted recovery; it has **not** been delivered. Enable mandatory verification only
after testing email delivery. Pin `SITE_URL` to the trusted production origin so forwarded Host
headers cannot change the destination of recovery links. For SMTPS on port 465 set `SMTP_SECURE=true`.

## Backups and recovery

Remote durability is **not a backup**. With Supabase, member records and photos do **not** live
in `PJS_DATA_DIR`; that folder only contains cache/local support files. Back up Postgres with
provider backup/export tooling **and** export Storage objects separately. Keep encrypted,
access-controlled off-provider copies and test restoration into a separate non-production
project. Confirm RLS, private buckets, membership counts and photo availability before any
cutover. Do not send database dumps, member messages, password hashes or reset tokens by email
or commit them to Git. Production backup scheduling/restore requires provider access and is
not established by local tests.

For SQLite, use the database backup API or stop the app before copying the entire data folder
(including WAL files if present). For D1/R2, export the database and objects separately. A corrupt
local database now stops startup instead of silently replacing the site with an empty store.
Preserve damaged files, restore a verified backup, then restart; never delete the only copy.

## Checks after deploying

```bash
curl -i https://your-domain/api/health      # {"ok":true,...}
curl -I https://your-domain/                # 200
```

Then run the member flow once: register → complete profile → search → interest → accept → message →
log out → log in again (data must still be there). Locally `npm test` runs 134 automated assertions
covering exactly this.
