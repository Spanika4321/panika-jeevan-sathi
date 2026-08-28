# Deploying PANIKA JEEVAN SATHI

This app is a **Node.js server + SQLite database**. It needs a host that can run a Node process
and keep files on disk (database + uploaded photos).

> ⚠️ **GitHub Pages will not work.** Pages serves static files only — there is no Node process and no
> database, so registration, login, search, interests and messaging cannot run there. Use one of the
> options below.

Requirements: **Node.js 22.5+** (uses the built-in `node:sqlite`). No `npm install` — zero dependencies.

---

## 1. Render (easiest, free tier)

1. Push this branch to GitHub (already done) and merge it to `main`.
2. Render → **New +** → **Blueprint** → pick this repository. `render.yaml` is included, so the service,
   health check (`/api/health`) and a **1 GB persistent disk** for the database are created automatically.
3. Deploy. Render generates `SESSION_SECRET` for you.
4. Open the site, log in with the administrator account and change the password.

The persistent disk is mounted at `/var/data/pjs` (`PJS_DATA_DIR`). **Without a disk the data is lost on
every restart** — do not skip it.

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

On the very first start the server prints the administrator credentials and also writes them to
`data/admin-credentials.txt` (mode 600):

```
  Administrator account created
  Email    : admin@panikajeevansathi.com
  Password : <generated>
  Panel    : /admin.html
```

Log in at `/admin.html` and change the password immediately. To set your own instead, start the server
once with `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='YourStrongPass1'`.

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `HOST` | `0.0.0.0` | keep as-is on containers/PaaS |
| `PJS_DATA_DIR` | `./data` | **must be on persistent storage** |
| `SESSION_SECRET` | generated in `data/` | set a fixed value so sessions survive restarts/multi-instance |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | generated | first administrator only |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | — | real email; needs `npm i nodemailer` |
| `PJS_STORAGE` | `sqlite` | `json` forces the JSON file store (only for hosts without Node 22.5+) |

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
