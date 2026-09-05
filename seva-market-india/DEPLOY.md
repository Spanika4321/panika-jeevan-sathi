# Deploying SEVA MARKET INDIA

The application is one Node process with one SQLite file. Anything that can run
`node server.js` on Node 22.5+ can host it.

> **The one thing that matters:** the database lives in `SMI_DATA_DIR` (default `./data`).
> If that folder sits on an ephemeral disk, it is recreated when the host restarts. On
> Render Free and similar platforms, attach a persistent disk or move the data directory
> to one — otherwise members and bookings disappear on restart.

---

## 1. Any VPS / VM (Ubuntu, ₹300–500/month)

```bash
sudo apt update && sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

sudo mkdir -p /opt/seva-market-india
cd /opt/seva-market-india
# copy the project files here (git clone, rsync or scp)

mkdir -p /opt/seva-market-india/data
sudo tee /etc/systemd/system/seva-market.service >/dev/null <<'EOF'
[Unit]
Description=SEVA MARKET INDIA
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/seva-market-india
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=SMI_DATA_DIR=/opt/seva-market-india/data
Environment=SITE_URL=https://your-domain.com
Environment=ADMIN_EMAIL=you@example.com
Environment=ADMIN_PASSWORD=change-this-now
Environment=SMI_DEMO_ACCOUNTS=0
Environment=TRUST_PROXY_HOPS=1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
User=www-data

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now seva-market
```

Reverse proxy (nginx):

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}
```

Then `sudo certbot --nginx -d your-domain.com` for free HTTPS.

---

## 2. Render

Two options — pick one:

**A. Docker / native web service with a disk (paid plan)**
1. New → Web Service → connect the repository (root directory: `seva-market-india`).
2. Build command: *(empty)* · Start command: `node server.js`.
3. Add a **Disk**: mount path `/var/data`, size 1 GB.
4. Environment:
   - `SMI_DATA_DIR` = `/var/data`
   - `SITE_URL` = `https://your-service.onrender.com`
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`
   - `SMI_DEMO_ACCOUNTS` = `0`
   - `TRUST_PROXY_HOPS` = `1`
   - `NODE_VERSION` = `22.22.3`
5. Deploy. Health check path: `/api/health`.

**B. Free plan (no disk)** — works, but the database is rebuilt on every restart. Fine for a
demo; not for real members.

---

## 3. Railway / Fly.io / Koyeb

Same idea: one process, one volume.

- Start command: `node server.js`
- Volume mounted at `/data`, `SMI_DATA_DIR=/data`
- `PORT` is provided by the platform
- `TRUST_PROXY_HOPS=1`

---

## 4. After deploying — checklist

```bash
curl https://your-domain.com/api/health
# {"ok":true,"service":"seva-market-india","storage":"sqlite", ...}

curl https://your-domain.com/robots.txt
curl https://your-domain.com/sitemap.xml
```

- [ ] `/api/health` returns `ok: true`
- [ ] `SITE_URL` is set (correct canonical URLs in `robots.txt` / `sitemap.xml`)
- [ ] HTTPS is on and `ADMIN_PASSWORD` is not the generated default
- [ ] `SMI_DEMO_ACCOUNTS=0` in production
- [ ] Log in as the administrator, then delete the demo accounts from the admin panel
- [ ] `data/` is **not** in the git repository (it is git-ignored) and is backed up
- [ ] Confirm the data directory survives a restart: create a booking, restart, check it is still there

## 5. Backups

The whole database is one file: `$SMI_DATA_DIR/seva-market.sqlite`. Copy it (with the `-wal`
and `-shm` files, or after a clean shutdown) to back everything up.

```bash
systemctl stop seva-market
tar czf backup-$(date +%F).tar.gz /opt/seva-market-india/data
systemctl start seva-market
```

## 6. Moving to Postgres later

Every database call lives in `lib/db.js`. Replacing the SQLite driver with `pg` (or Supabase
PostgREST) touches that file only — the API, pages and tests stay as they are. Keep the method
names (`get`, `all`, `exec`, and the domain helpers such as `searchProviders` and
`createBooking`) and the rest of the application is unchanged.
