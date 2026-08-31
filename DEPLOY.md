# Deploying PANIKA JEEVAN SATHI

This app is a **Node.js server + SQLite database**. It needs a host that can run a Node process
and keep files on disk (database + uploaded photos).

> ⚠️ **GitHub Pages will not work.** Pages serves static files only — there is no Node process and no
> database, so registration, login, search, interests and messaging cannot run there. Use one of the
> options below.

Requirements: **Node.js 22.5+** (uses the built-in `node:sqlite`). No `npm install` — zero dependencies.

---

## Production URLs

| Environment | URL | Status / notes |
| --- | --- | --- |
| **Recommended production (Render, free)** | `https://panikajeevansathi.onrender.com` | Created by the Blueprint below. Pair with Cloudflare D1 + R2 for durable data. |
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
survive in free Cloudflare services:

| What | Where | Free tier |
| --- | --- | --- |
| Members, profiles, interests, messages, settings | **Cloudflare D1** (SQLite over HTTPS) | 500 MB / database, no expiry |
| Profile photos | **Cloudflare R2** (S3-compatible) | 10 GB, no egress fees |
| The web service itself | **Render Free** | 750 instance-hours / month, sleeps when idle |

Data is mirrored in memory on the server and written through to D1 before each
HTTP response finishes, so nothing depends on the local disk.

### A. Create the two Cloudflare resources (once, ~5 minutes)

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (free).
2. Copy your **Account ID** from any page in the dashboard (right-hand column).
3. **D1 database** → *Storage & Databases → D1 → Create* → name it `panika-jeevan-sathi`.
   Copy its **Database ID** (a UUID).
   *Or let the helper do it:* `node scripts/cloud-setup.mjs --token <CF token>`
4. **API token for D1** → [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
   → *Create Custom Token* → Permissions: **Account · D1 · Edit** → copy the token.
5. **R2 bucket** → *R2 → Create bucket* → name it `panika-uploads`.
6. **R2 access keys** → *R2 → Manage R2 API tokens → Create API token*
   → permissions **Object Read & Write**, scoped to that bucket → copy the
   **Access Key ID** and **Secret Access Key**.

### B. Deploy on Render (one click)

The Blueprint `render.yaml` creates the service **`panikajeevansathi`**, so the public URL is
**`https://panikajeevansathi.onrender.com`**.

1. Make sure the latest code is on `main` (it is, after merging this branch).
2. Open: `https://dashboard.render.com/blueprint/new?repo=https://github.com/Spanika4321/panika-jeevan-sathi`
3. Render reads `render.yaml`, creates the **Free** web service (Singapore region,
   `node server.js`, health check `/api/health`) and asks you to fill in the
   **seven blank values** — paste the Cloudflare values from step A. `SESSION_SECRET`
   and `ADMIN_PASSWORD` are generated for you; `SITE_URL` is pre-set to
   `https://panikajeevansathi.onrender.com`.
4. Click **Apply**. Deployment takes ~2 minutes.

**Option 2 — fully automated (Render API key):** copy
`ops/deploy-render.workflow.yml` to `.github/workflows/deploy-render.yml`
(one-time, GitHub UI), then go to *Actions → “Deploy to Render” → Run workflow*,
fill in the Render API key and the Cloudflare values; they are masked in the log
and never stored in git. Or run locally from a machine that can reach
`api.render.com`:

```bash
RENDER_API_KEY=rnd_xxx node scripts/deploy-render.mjs \
  --cf-account-id ... --cf-d1-database-id ... --cf-d1-api-token ... \
  --r2-account-id ... --r2-bucket ... \
  --r2-access-key-id ... --r2-secret-access-key ...
```

### C. Check it

```bash
node scripts/verify-cloud.mjs --url https://panikajeevansathi.onrender.com
```

That checks D1, R2 **and** the live site (pages, health endpoint, storage driver,
unsaved-change count). Then log in at `/admin.html` — the administrator password
was generated at first boot; it is printed once in the deploy log
(Render → your service → **Logs**). Change it under **Admin → Account**.

> **Note on the free plan:** the first request after 15 minutes of inactivity
> wakes the service and takes up to a minute (Render shows a loading page).
> Everything else is identical to a paid plan. Upgrading to **Starter** later
> removes the sleep and lets you add a disk — no code change needed.

### D. Durable data without Cloudflare (optional)

Upgrade to **Render Starter** and attach a persistent disk mounted at `/app/data`,
then set `PJS_STORAGE=sqlite`. No Cloudflare setup needed; backups = copy `/app/data`.

---

## 1c. Restoring the previous URL on cPanel (`panikajeevansathi.coolstore.in`)

The previous production site (a Next.js 16 + PostgreSQL app) was superseded by this
zero-dependency build. The cPanel account `/home/panikaje` already has **persistent
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
is **generated** unless you set `ADMIN_PASSWORD`. It is printed once in the process logs and written
to `data/admin-credentials.txt` (not committed to git).

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

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `HOST` | `0.0.0.0` | keep as-is on containers/PaaS |
| `PJS_DATA_DIR` | `./data` | **must be on persistent storage** |
| `SITE_URL` | request origin | canonical URL used in robots.txt + sitemap.xml (pin it in production) |
| `SESSION_SECRET` | generated in `data/` | set a fixed value so sessions survive restarts/multi-instance |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | generated | first administrator only |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | — | real email; needs `npm i nodemailer` |
| `PJS_STORAGE` | `auto` | `auto` = D1 when `CF_*` is set, else SQLite; `sqlite` / `json` / `d1` force one driver |
| `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_API_TOKEN` | — | Cloudflare D1 (the member database) |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | — | Cloudflare R2 (profile photos) |
| `R2_PREFIX` | `uploads` | folder inside the bucket |
| `R2_ENDPOINT` | derived from the account id | override for other S3-compatible hosts |

Without SMTP the verification / reset links are shown on screen to the member and copied to
`data/outbox/` (visible in the admin panel → **Emails**), so nothing is ever lost.

## Backups

`npm run backup` writes a verifiable snapshot of **everything that matters** — the member database
and photos (`data/`) plus the 12 agents' permanent memory (`storage/`) — into `.backups/pjs-<timestamp>/`
with a sha256 manifest, then immediately re-hashes every file to prove the snapshot is readable:

```bash
npm run backup                       # snapshot + integrity verification
npm run backup -- --keep 14          # prune, keeping the 14 newest
npm run backup -- --list             # what exists, and how many members each snapshot held
npm run backup -- --verify .backups/pjs-20260831T071500   # prove it is restorable
npm run backup -- --dest /mnt/usb    # straight onto another disk
npm run restore -- .backups/pjs-20260831T071500           # dry run: shows the diff, writes nothing
npm run restore -- .backups/pjs-20260831T071500 --force   # apply (old data kept in data-replaced-*/)
```

A restore refuses to run if the manifest does not verify, because a half-written snapshot replacing
live member data silently is the one failure mode this site cannot afford. `npm run backup:selftest`
(round trip + tamper detection) is part of the Guardian health check, so a broken backup path fails
CI instead of being discovered during an incident.

With Cloudflare D1/R2 the data is already off-box — but those hold *today's* state, not a rewind
point, so the snapshot above is still what you keep.

## SEO Center — connecting the real pipeline (one-time, ~10 minutes)

`/seo-center.html` is the admin-only growth dashboard. It shows **only real**
Google Search Console data and never invents numbers: while a credential is
missing the stage reads `BLOCKED` / `NOT CONNECTED`, and that honest state is
itself verified by `npm run seo:selftest`.

```bash
npm run seo:status     # what is connected, what is missing, and where to get it
```

1. **Google Cloud Console** → APIs & Services → enable *Google Search Console API* →
   *Credentials* → create an **OAuth client ID (Web application)**:
   - Authorized redirect URI, exactly:
     `https://panikajeevansathi.onrender.com/api/seo/oauth/callback`
     (add `http://localhost:3000/api/seo/oauth/callback` too, for local runs)
   - set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the service.
2. **Search Console** → Add property → **Domain** → `panikajeevansathi.com` → verify with the
   DNS TXT record (or paste the HTML-tag token into `GOOGLE_SITE_VERIFICATION`, which the site
   injects into every public page at render time). The property string to store is
   `sc-domain:panikajeevansathi.com` (`GOOGLE_SEARCH_CONSOLE_SITE`).
3. **Gemini** — aistudio.google.com → *Create API key* → `GEMINI_API_KEY`
   (optionally a second, OpenAI-compatible fallback: `GEMINI_ROUTER_URL` +
   `GEMINI_ROUTER_API_KEY` + `GEMINI_ROUTER_MODEL`).
4. **Daily run** — either `SEO_SCHEDULER=1` on the service (the dashboard shows the next
   run time), or copy `ops/seo-cycle.workflow.yml` to `.github/workflows/seo-cycle.yml`
   for the free GitHub Actions cron.
5. Optional permanence: `FIL_ONE_*` mirrors every report to Filecoin/S3 storage;
   `RESEND_API_KEY` lets Meera actually email the owner report.

Then verify the whole chain end to end:

```bash
npm run seo:cycle      # Check → Search Data → AI → Pooja → Priya → Manager → Report → Verify
npm run seo:verify     # the reports are really readable back from permanent storage
npm run seo:squad      # all 12 agents do their share in one round
```

## Checks after deploying

```bash
curl -i https://your-domain/api/health      # {"ok":true,...}
curl -I https://your-domain/                # 200 (expect content-encoding: gzip, etag, content-security-policy)

# or the same checks as one verdict — PASS / FAIL / BLOCKED, never a guess
SITE_URL=https://your-domain npm run check:live
```

`check:live` deliberately answers **BLOCKED** when the host never answered (Render's free plan
sleeps, and the first request can take a minute to wake it) — an unreachable host is not a pass
and not a failure, and the script says so instead of picking a colour for you.

Then run the member flow once: register → complete profile → search → interest → accept → message →
log out → log in again (data must still be there). Locally `npm test` runs 134 automated assertions
covering exactly this.

```bash
npm run test:all       # 43 files parsed · 134 e2e assertions · 144 Guardian checks · 49 render-contract checks · SEO anti-fake PASS
npm run check:live     # against the deployment itself: 21 routes, gzip, CSP, ETag, noindex, sitemap, admin gate
npm run health         # the Guardian board on its own (design lock, SEO, headers, backup round trip, queue)
npm run seo:status     # every pipeline stage: CONNECTED / BLOCKED, and which key unlocks it
npm run backup         # verifiable snapshot of data/ + storage/
```

Expected shape of a healthy answer: every stage that needs no credential is
`CONNECTED`, the credential-gated ones say `BLOCKED` with the exact variable
name. A `PASS` that appeared without credentials would itself be the bug — the
`seo:selftest` suite exists to prove the pipeline cannot invent one.
