# Deploying SEVA MARKET INDIA

A **Node.js** marketplace. It uses the built-in `node:sqlite` (Node 22.5+) and has
**zero npm runtime dependencies**.

> ⚠️ **GitHub Pages will not work.** Pages serves static files only — there is no Node
> process and no database, so search, provider signup, dashboards, leads and reviews
> cannot run there. Use one of the options below.

## Durable data — important

The marketplace keeps its data in a **SQLite database** (providers, services, leads,
reviews, sessions). Hosts whose filesystem is **ephemeral** — Render Free, any server
that wipes disk on sleep/redeploy — would erase the database. So a durable deployment
**requires a persistent volume**. This is the same reason the related PANIKA JEEVAN
SATHI app moved its data off the free-plan disk.

| What | Where |
| --- | --- |
| Web service | Render (Starter+) / Railway / any VPS |
| Database | SQLite on a **persistent disk / volume** (not the ephemeral root) |
| First boot | `scripts/start.js` copies `db-bootstrap/seva-market.db` to the disk, then runs migrations |

`scripts/start.js` (used by Docker, Render, Railway and the Procfile) bootstraps the
database from the committed snapshot on the first boot and reuses it afterwards, so
signups, providers, leads and reviews survive sleeps and redeploys.

## Option A — Render (recommended)

`render.yaml` creates the service **`seva-market-india`** → public URL
`https://seva-market-india.onrender.com`.

1. Render dashboard → **New + → Blueprint → pick this repository**.
2. It provisions a **Starter** service with a **1 GB persistent disk** mounted at
   `/app/data` (`SEVA_DB_FILE=/app/data/seva-market.db`).
3. `SESSION_SECRET` is auto-generated in Render Settings → Environment.
4. Set `SITE_URL=https://seva-market-india.onrender.com` if it isn't already.

> Free plan has no disk → data resets on sleep. Use Starter+ for a durable site.

## Option B — Railway

1. New project → deploy from this repository (`railway.json` is auto-detected).
2. Add a **Volume** mounted at `/app/data`.
3. Set env `SEVA_DB_FILE=/app/data/seva-market.db`, `SESSION_SECRET`,
   `SITE_URL`, `NODE_ENV=production`, `TRUST_PROXY_HOPS=1`.

## Option C — Any VPS / Docker with a volume

```bash
# one-time build
docker build -t seva-market-india .
# run with a persistent volume for the database
docker run -d -p 3000:3000 \
  -v seva_data:/app/data \
  -e NODE_ENV=production \
  -e SEVA_DB_FILE=/app/data/seva-market.db \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e SITE_URL=https://your-domain.example \
  seva-market-india
```

Health check: `GET /api/v1/health` returns `{ "status": "ok", ... }`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `production` → `Secure` cookies + tighter logs |
| `HOST`, `PORT` | Bind address / port (default `0.0.0.0:3000`) |
| `SESSION_SECRET` | **Pin it.** Signs sessions; resets force re-login |
| `SITE_URL` | Canonical origin for `sitemap.xml` / `robots.txt` |
| `SEVA_DB_FILE` | Path to the durable SQLite file on your volume |
| `TRUST_PROXY_HOPS` | `1` behind Render/Railway/nginx for correct client IPs |
| `REVIEWS_MODERATED` | `1` to hold customer reviews in `pending` for provider approval |

## Local run / dev

```bash
npm ci            # (no runtime deps; safe to skip)
node server.js    # http://localhost:3000  (uses ./data/seva-market.db)
npm run seed      # seed categories/geography/providers into a fresh db
npm test          # test suite
```
