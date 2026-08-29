# Deploying PANIKA JEEVAN SATHI

This app is a **Node.js server + SQLite database**. It needs a host that can run a Node process
and keep files on disk (database + uploaded photos).

> ⚠️ **GitHub Pages will not work — and no member data can ever exist there.** Pages serves static
> files only: there is no Node process and no database, so registration, login, search, interests
> and messaging cannot run. `https://<user>.github.io/panika-jeevan-sathi/` shows the README, not the
> site. **Disable Pages** (Settings → Pages → Unpublish site) so nobody mistakes that link for the
> real website.

Requirements: **Node.js 22.5+** (uses the built-in `node:sqlite`). No `npm install` — zero dependencies.

---

## Will member data disappear? (read this before going live)

Every member, profile, photo, interest, message and admin setting lives in **one folder**:
`PJS_DATA_DIR`. Nothing is stored in GitHub, and nothing is stored in the browser.

* That folder is on a **persistent disk / volume** → data survives restarts, redeploys and crashes. ✅
* That folder is on the host's **normal (ephemeral) filesystem** → **every restart or redeploy wipes the
  entire site back to zero members.** ❌ This is the single most common way a small community site dies.

So the rule is simple: **attach storage, and keep a copy off the server.**

| Host | Persistent storage? | What to do |
| --- | --- | --- |
| Render (Blueprint, as configured here) | ✅ 1 GB disk, but only on a **paid** instance type (`starter`) | Deploy `render.yaml`. A disk cannot be attached to the free plan. |
| Render, manually on the **free** plan | ❌ none | Not acceptable for real members — data is erased on each deploy/sleep. |
| Railway | ✅ Volume (added in the dashboard, `PJS_DATA_DIR=/data`) | Add the volume **before** inviting members. |
| Docker on a VPS | ✅ `-v pjs-data:/app/data` | Use the volume, never a bare container. |
| Fly.io / Coolify / Oracle free VM | ✅ attached volume or the VM's own disk | Point `PJS_DATA_DIR` at it. |
| GitHub Pages | ❌ no server at all | Only useful as a repo README. |

### Built-in protection (already in this codebase)

1. **Automatic backups** — the server writes a gzipped copy of the whole data folder every 12 hours
   into `PJS_DATA_DIR/backups` (last 14 kept), verifies the archived database opens cleanly, and can
   mirror each copy to a second location (`PJS_BACKUP_MIRROR`). One extra snapshot is taken at boot, and
   another on shutdown when the backups (or their mirror) live outside the data folder.
2. **Admin → Backup tab** — status, “Back up now”, **Download** (this is your off-server copy: put it in
   Google Drive or on your laptop), and **Verify**, which re-opens the archived database and reports
   `integrity_check`.
3. **A data-loss alarm in the server log.** If the folder comes back empty at boot while the newest
   backup contains many more members, the log screams before anything else can write:

   ```
   ⚠  DATA LOSS LOOKS LIKE IT JUST HAPPENED — PLEASE READ
      The data folder (/data) was empty at boot, so the site started with a fresh database (1 account).
      Your newest backup holds 137 members: pjs-backup-2026-08-29T03-30-00Z.tar.gz
      1. STOP answering on the site so nobody registers into the empty database.
      2. Point PJS_DATA_DIR at the mounted volume (Render: Disks, Railway: Volumes).
      3. node scripts/restore.mjs pjs-backup-2026-08-29T03-30-00Z.tar.gz --yes
   ```

   **Never ignore that block** — it means the host rebooted without its disk, and the sooner you restore,
   the fewer duplicate registrations you have to clean up.

---

## 1. Render (recommended)

1. Merge this branch to `main`.
2. Render → **New +** → **Blueprint** → pick this repository. `render.yaml` creates the service, the
   health check (`/api/health`), `PJS_DATA_DIR=/var/data/pjs` and a **1 GB persistent disk** at that path.
3. Deploy. Render generates `SESSION_SECRET` for you.
4. Open the site, log in at `/admin.html`, change the password, then
   **Admin → Backup → “Back up now” → Download** and keep that file as your safety copy.

> Render only allows a persistent disk on a **paid** instance type, so `render.yaml` uses `plan: starter`
> (about $7/month). **The free plan cannot have a disk** — on the free plan the site works, looks fine,
> and then erases every member on the next deploy or sleep. If the cost is impossible right now, test on
> the free plan, then move to a paid instance (or a free-tier VM with real disk, e.g. an Oracle Cloud
> Always Free ARM VM) *before* you tell people the site is open.

## 2. Railway

1. New Project → Deploy from GitHub repo → this repository.
2. Service → right click → **Attach volume**, mount it at `/data`, **then** set `PJS_DATA_DIR=/data`.
   Railway has no `railway.json` key for volumes — if you did not see the volume in the dashboard, the
   data is not persistent.
3. Set `SESSION_SECRET` to a long random string. Start command is `node server.js` (`railway.json`).
4. Railway is usage-based with a small trial credit, which is usually a few dollars a month for a
   community site — and unlike a free ephemeral host, its volume keeps the data.
5. Optional: mount a second volume (or an S3-compatible fuse folder) and set `PJS_BACKUP_MIRROR=/mirror`
   so every automatic backup is copied off the data disk too.

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
| `PJS_STORAGE` | `sqlite` | `json` forces the JSON file store (only for hosts without Node 22.5+) |
| `PJS_AUTO_BACKUP` | on | `off` disables the automatic snapshots |
| `PJS_BACKUP_INTERVAL_HOURS` | `12` | how often the site backs itself up |
| `PJS_BACKUP_KEEP` | `14` | how many archives are retained |
| `PJS_BACKUP_DIR` | `<PJS_DATA_DIR>/backups` | put it on different storage for a true second copy |
| `PJS_BACKUP_MIRROR` | — | extra folder (mounted drive/S3 fuse) each archive is copied to |
| `PJS_BACKUP_MAX_FILE_MB` | `256` | files larger than this are skipped and reported |

Without SMTP the verification / reset links are shown on screen to the member and copied to
`data/outbox/` (visible in the admin panel → **Emails**), so nothing is ever lost.

## Backups and restore

The whole site is one folder, so a backup is that folder compressed.

```bash
npm run backup                 # → <PJS_DATA_DIR>/backups/pjs-backup-<when>.tar.gz
npm run backup:verify          # also re-opens the archived database and checks integrity
npm run backup -- --list       # what is on the server right now
npm run restore -- pjs-backup-2026-08-29T03-30-00Z.tar.gz --yes
```

* `npm run backup` is safe on a **live** site: SQLite is checkpointed first, the database files are read
  in one pass, and the archive is renamed into place only when complete.
* `restore` refuses archives with no database inside, and first copies whatever is currently in the data
  folder to `pjs-data-before-restore-<when>` — so a restore can itself be undone.
* Restore onto a brand-new host from a downloaded copy:
  `node scripts/restore.mjs <file>.tar.gz --from=/path/to/downloads --data-dir=/data --yes`
* Retention and schedule: `PJS_AUTO_BACKUP` (`off` to disable), `PJS_BACKUP_INTERVAL_HOURS` (default 12),
  `PJS_BACKUP_KEEP` (default 14), `PJS_BACKUP_DIR` (else `PJS_DATA_DIR/backups`),
  `PJS_BACKUP_MIRROR` (a second folder/device to copy each archive to).
* Cron on a VPS, if you prefer it outside the app:
  `0 3 * * * cd /opt/panika-jeevan-sathi && node scripts/backup.mjs --verify >> /var/log/pjs-backup.log 2>&1`
* On Render, the disk itself also gets encrypted daily snapshots (dashboard → Disks → Restore snapshot),
  which is a second, independent safety net.

A backup on the same disk protects you from a corrupt file or an accidental deletion — it does **not**
protect you from the disk going away. Keep at least one downloaded copy off the server.

## Checks after deploying

```bash
curl -i https://your-domain/api/health      # {"ok":true,...}
curl -I https://your-domain/                # 200
```

Then run the member flow once: register → complete profile → search → interest → accept → message →
log out → log in again (data must still be there). Locally `npm test` runs 157 automated assertions
covering exactly this — including backup, download, verification and a full restore onto a fresh install.

Finally, prove the storage is real:

```bash
# 1. restart the service (Render: Manual Deploy / Railway: Redeploy) and log in as the test member again
#    → the profile must still be there
# 2. Admin → Backup → Back up now → Download   → the file must exist and be > 1 KB
# 3. server log at boot must NOT contain "DATA LOSS LOOKS LIKE IT JUST HAPPENED"
```
