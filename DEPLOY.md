# Deploying PANIKA JEEVAN SATHI to a public URL

This is a **dynamic** website (Node server + SQLite database + photo storage). It cannot run
on static hosts like GitHub Pages — it needs a host that runs a Node.js 22+ server with a
writable disk. The repo is prepared for one-click deploys:

| File | Purpose |
|---|---|
| `Dockerfile` | Builds the app into an image (works everywhere) |
| `render.yaml` | Render one-click Blueprint |
| `railway.json` | Railway one-click deploy config |
| `Procfile` | `node server.js` start command (Heroku-style / cPanel) |

**Requirements on the host:** Node 22.13+ (the app uses Node's built-in SQLite).

---

## Option 1 — Render (easiest, ~2 minutes)

1. (One-time) Create a free account at **https://render.com** and sign in with GitHub.
2. Open **https://dashboard.render.com** → **New → Blueprint**.
3. Select the repo `Spanika4321/panika-jeevan-sathi` (branch `main` — or the
   `arena/01a049b8-panika-jeevan-sathi` branch) and press **Create**.
4. Render builds the Dockerfile and gives you a public URL, e.g.
   `https://panika-jeevan-sathi.onrender.com`.

Free-tier notes: the service sleeps after ~15 idle minutes — the first visit after sleep
takes ~30 s to wake. The free disk is **ephemeral** (wiped on each deploy), so for real
long-term member data use Option 3 or attach a paid disk.

## Option 2 — Railway (~2 minutes)

1. Create a free account at **https://railway.app** (GitHub sign-in).
2. **New Project → Deploy from GitHub repo** → pick `panika-jeevan-sathi`.
3. Railway detects `railway.json` (Docker) and deploys; add a **Volume** mounted at
   `/app/data` to keep member data between redeploys.
4. Open **Settings → Networking → Generate Domain** for your public URL.

## Option 3 — Your existing cPanel hosting (best for permanent use + your own domain)

The project already ships a cPanel/Passenger entry point (`app.js` → `server.js`).

1. On your cPanel (e.g. LCSHost): upload/pull this repo's files (or connect the Git repo
   in **Git Version Control**), excluding `node_modules`, `.next`, `.git`, `data`.
2. In **Node.js Selector / Setup Node.js App**: create an app with
   - Application mode: Production
   - Application root: the repo folder
   - Application URL: your domain
   - Start file: `server.js` (or `app.js` for Passenger)
   - Node version: **22** (must be 22.13+ for built-in SQLite)
3. Run `npm install` (the cPanel terminal or the app's package manager), then
   `npm run build`, then start/restart the app.
4. Point your domain at it. Data lives in `data/` on your hosting disk — **persistent**,
   so registrations, profiles and messages are kept forever. Set
   `ADMIN_DEFAULT_PASSWORD` in a `.env` before first start if you want a custom admin
   password (default: `Panika@123`).

---

## After deploying (any option)

- Health check: `https://YOUR-URL/api/health` → `{"ok":true,"database":"connected"}`
- Admin: `https://YOUR-URL/admin` → `sukulpanika939@gmail.com` / `Panika@123`
  (change the password in Settings right after first login)
- Set `NEXT_PUBLIC_SITE_URL=https://YOUR-URL` (optional; improves SEO metadata/sitemap)
  and redeploy.
