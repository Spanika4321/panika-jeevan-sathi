# Deploying PANIKA JEEVAN SATHI

This app is a **Node.js server + SQLite database**. It needs a host that can run a Node process
and keep files on disk (database + uploaded photos).

> ⚠️ **GitHub Pages will not work.** Pages serves static files only — there is no Node process and no
> database, so registration, login, search, interests and messaging cannot run there. Use one of the
> options below.

Requirements: **Node.js 22.5+** (uses the built-in `node:sqlite`). No `npm install` — zero dependencies.

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

### B. Deploy on Render

**Option 1 — Blueprint (one click):**

1. Merge this branch to `main`.
2. Open: `https://dashboard.render.com/blueprint/new?repo=https://github.com/Spanika4321/panika-jeevan-sathi`
3. Render reads `render.yaml`, creates the **Free** web service (Singapore region,
   `node server.js`, health check `/api/health`) and asks you to fill in the seven
   blank values — paste the Cloudflare values from step A.
4. Click **Apply**. `SESSION_SECRET` and `ADMIN_PASSWORD` are generated for you.

**Option 2 — from this repo's automation (no clicking):** copy
`ops/deploy-render.workflow.yml` to `.github/workflows/deploy-render.yml`
(GitHub does not let tools install workflows), then go to
*Actions → “Deploy to Render” → Run workflow*, fill in the Render API key and the
Cloudflare values; they are masked in the log and never stored in git.

### C. Check it

```bash
node scripts/verify-cloud.mjs --url https://panika-jeevan-sathi.onrender.com
```

That checks D1, R2 **and** the live site (pages, health endpoint, storage driver,
unsaved-change count). Then log in at `/admin.html` — the administrator password
was generated at first boot; it is printed once in the deploy log
(Render → your service → **Logs**). Change it under **Admin → Account**.

> **Note on the free plan:** the first request after 15 minutes of inactivity
> wakes the service and takes up to a minute (Render shows a loading page).
> Everything else is identical to a paid plan. Upgrading to **Starter** later
> removes the sleep and lets you add a disk — no code change needed.

## 2. Railway

1. New Project → Deploy from GitHub repo → this repository.
2. Add a **Volume** mounted at `/data` and set `PJS_DATA_DIR=/data`.
3. Set `SESSION_SECRET` to a long random string. Start command is `node server.js` (`railway.json`).

## 3. Docker (any host: VPS, Fly.io, ECS…)

```bash
docker build -t panika-jeevan-sathi .
docker run -d --name pjs -p 3000:3000 \
  -e SESSION_SECRET="a-long-random-string" \
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

Everything lives in `PJS_DATA_DIR`: the SQLite database, uploaded photos (`uploads/`) and the mail
outbox. Back up by copying that folder; restore by copying it back and restarting.

## Checks after deploying

```bash
curl -i https://your-domain/api/health      # {"ok":true,...}
curl -I https://your-domain/                # 200
```

Then run the member flow once: register → complete profile → search → interest → accept → message →
log out → log in again (data must still be there). Locally `npm test` runs 120 automated assertions
covering exactly this.
