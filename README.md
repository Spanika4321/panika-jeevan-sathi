# PANIKA JEEVAN SATHI

A complete, production-ready **matrimonial website** for the Panika, Manikpuri, Kabirpanthi and Adivasi
communities — **100% free for members**: no payment gateway, no subscription plans, no premium tiers,
no locked profiles, no paid messaging.

Built as a single self-contained Node.js application with **zero npm dependencies**.

---

## Run it

```bash
node server.js          # http://localhost:3000
PORT=8080 node server.js
```

Requirements: **Node.js 22.5 or newer** (uses the built-in `node:sqlite` driver). No `npm install` needed.

On first start the **site-owner administrator** is created (default email
`sukulpanika939@gmail.com`, or `ADMIN_EMAIL`). The password is taken from `ADMIN_PASSWORD` or
generated and printed once in the console / `data/admin-credentials.txt` (git-ignored). Log in at
`/admin.html` and change it. Existing member accounts whose email is in `ADMIN_EMAIL` /
`OWNER_EMAILS` are promoted to administrator on boot.

```bash
npm start          # run the site
npm run dev        # run with auto-reload while editing
npm test           # syntax check + full end-to-end test suite
npm run check      # syntax check only
npm run health     # 99 automated availability / SEO / design-lock checks
npm run backup     # gzip the whole data folder (safe on a live site)
npm run restore    # node scripts/restore.mjs <archive> --yes
```

> **GitHub Pages cannot host this site.** Pages serves static files only — there is no Node process and
> no database, so registration, login, search, interests and messaging cannot work there, and no member
> data can exist at all. `https://<user>.github.io/panika-jeevan-sathi/` currently shows the README;
> unpublish it (Settings → Pages) so nobody mistakes that link for the real website.

### Environment variables (all optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `PJS_DATA_DIR` | `./data` | Database + uploaded photos — **must be on persistent storage** |
| `SESSION_SECRET` | auto-generated in `data/` | Session signing key |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | generated | First administrator (password never hardcoded) |
| `OWNER_EMAILS` | — | Extra emails always promoted to admin |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | — | Real email delivery (needs `npm i nodemailer`) |
| `PJS_STORAGE` | `sqlite` | Set to `json` to force the JSON file store |
| `PJS_AUTO_BACKUP` | on | `off` disables the site's own snapshots |
| `PJS_BACKUP_INTERVAL_HOURS` | `12` | automatic backup frequency |
| `PJS_BACKUP_KEEP` | `14` | archives retained |
| `PJS_BACKUP_DIR` | `<data>/backups` | put it on other storage for a true second copy |
| `PJS_BACKUP_MIRROR` | — | second folder each archive is copied to |

If SMTP is not configured, verification / reset emails are written to `data/outbox/` and the secure link
is also shown on screen to the member, so the flow always works. Add SMTP later without code changes.

---

## Features

**Accounts & security**
- Register with email + password, log in, log out, forgot password, reset password, change password
- Optional email verification (`require_email_verification` in the admin panel)
- scrypt password hashing, HMAC-signed expiring session cookies, server-side logout invalidation
- Rate limiting on login, registration, interests and messaging; account suspension by admin

**Matrimonial profile**
- Create / edit profile: photo, name, age, gender, height, marital status, religion, community,
  sub-community, gotra, mother tongue, city / state / country, education, occupation, employer,
  income, diet, habits, about me, full family details
- Partner preferences: age range, gender, location, education, occupation, marital status, community
- Privacy: profile visibility (everyone / members / hidden), hide photo, hide contact number,
  switch off search visibility
- Profile-strength score; everything is saved to the database and reloaded on every visit

**Matchmaking**
- Search with filters: keyword, gender, age range, community, religion, state, city, education,
  occupation, marital status, mother tongue, photo-only; sorting and pagination
- Recommended matches scored against your partner preferences, with the reason shown
- Profile detail page · Send interest with a note · Accept / decline · Shortlist (toggle)

**Messaging (real, database-backed)**
- Private 1:1 conversations, full history, unread counts, read receipts, 5-second live refresh
- Messaging opens automatically once an interest is accepted (keeps conversations respectful)
- Notifications for new messages, interests received and interests accepted

**Member dashboard**
My profile · Edit profile · Recommended matches · Interests sent / received · Shortlist · Messages ·
Notifications · Account settings · Delete account

**Contact**
WhatsApp button and floating chat bubble that open a chat with **+91 80998 34725**
(`https://wa.me/918099834725`), plus a contact form that lands in the admin inbox.

**Data safety**
- Everything lives in one folder (`PJS_DATA_DIR`) — copy it, move the site
- Automatic verified snapshots every 12 hours + Admin → **Backup** tab (back up now / download / verify)
- Loud “data loss looks like it just happened” alarm when the host reboots without its disk
- `npm run backup` / `npm run restore` — one portable `.tar.gz` for the whole site
- GitHub Pages will not work (static only, no database) — see [DEPLOY.md](DEPLOY.md)

**Admin panel** (`/admin.html`, administrator role required, server-side checks on every API)
- Live dashboard: accounts, active/suspended, new members, reports, contact queue, recent activity
- Members: search, role/status filters, details, edit, hide profile, remove photo, suspend, delete
- Reported users: review, resolve, dismiss, suspend or delete the reported member
- Success stories, contact inbox, website content, email outbox, **backups**
- Activity / audit log (no passwords or tokens)
- Admin account + password change
- Last remaining administrator cannot be demoted, suspended or deleted

---

## Project layout

```
server.js               HTTP server: static files + API + uploads
lib/db.js               storage layer (node:sqlite, JSON fallback) + schema
lib/auth.js             scrypt hashing, signed session cookies
lib/api.js              all REST endpoints
lib/profiles.js         profile validation, privacy, search filters, match scoring
lib/settings.js         editable website content
lib/mailer.js           optional SMTP / outbox mailer
lib/owner.js            site-owner emails that must stay administrators
lib/backup.js           whole-folder .tar.gz backups, verification, restore
public/                 the website (HTML + CSS + JS, no build step, no CDN)
public/assets/css/app.css
public/assets/js/app.js     shared client: API, auth, chrome, helpers
public/assets/js/cards.js   profile cards + member actions
scripts/backup.mjs      CLI backup (safe on a live site)
scripts/restore.mjs     CLI restore, with a safety copy of what it replaces
scripts/e2e-test.mjs    full end-to-end test (boots a real server)
scripts/check-syntax.mjs    syntax check for every shipped script
data/                   database, uploaded photos, outbox, backups/ (git-ignored)
```

---

## API overview

```
POST /api/auth/register | /api/auth/login | /api/auth/logout
POST /api/auth/forgot | /api/auth/reset | /api/auth/resend-verification
GET  /api/auth/verify?token=…
GET  /api/me                     GET/PUT /api/profile
POST /api/profile/photo          DELETE /api/profile/photo
POST /api/me/password | /api/me/name      DELETE /api/me
GET  /api/profiles (filters)     GET /api/profiles/:id      GET /api/matches
POST /api/interests              GET /api/interests?direction=sent|received
POST /api/interests/:id/respond  POST /api/shortlist        GET /api/shortlist
GET  /api/conversations          GET /api/conversations/:id POST /api/messages
POST /api/conversations/:id/read GET /api/unread
GET  /api/notifications          POST /api/notifications/:id/read
POST /api/reports                POST /api/contact          GET /api/site | /api/stories
GET/POST /api/admin/backup           GET /api/admin/backup/download|/verify
GET/POST/PATCH/DELETE /api/admin/…   (administrators only)
```

---

## Tests

`npm test` boots a real server on a temporary database and runs the full assertion suite covering:

registration, duplicate email, weak password, profile save/validation, photo upload + serving,
rejection of non-images, every search filter, match scoring, interest flow (send → receive → accept,
duplicate/self/twice rejected), messaging permissions and delivery, unread counts, read receipts,
shortlist toggle, privacy (hidden profile, hidden photo), reports, contact form, admin rights and
admin actions, logout, wrong password, re-login, persistence, forgot/reset password, password change,
all pages and assets returning 200, security headers, 404 handling, path-traversal blocking,
**157 assertions** including backup → download → verify → **restore onto a brand-new install** (which
boots and lets a restored member log in) — and finally that **all data survives a full server restart**.

The same suite passes on the JSON fallback store: `npm run test:json-store`.

---

## Deploying

Full instructions (Render, Railway, Docker, VPS + systemd, backups, environment variables) are in
**[DEPLOY.md](DEPLOY.md)**. Note: **GitHub Pages cannot host this app** — it needs a Node process and a
database, not static files.

**VPS / shared Node hosting**

```bash
git clone <your repo> && cd panika-jeevan-sathi
PORT=3000 SESSION_SECRET="a-long-random-string" node server.js
```

Keep it alive with `pm2`, `systemd` or your host's Node manager, and put nginx/Caddy in front for TLS.
Back up by copying the `data/` folder (or `npm run backup:verify`) — it contains the database and every
uploaded photo.

**cPanel / hosting without Node 22.5+**: the site automatically falls back to the JSON file store, but
Node 22.5+ with SQLite is strongly recommended for a live site.

---

## Will member data disappear?

All member data is one folder: `PJS_DATA_DIR` (default `./data`). Whether it survives depends only on
where that folder sits:

* **On a persistent disk / volume** (Render Disk, Railway Volume, Docker `-v pjs-data:/app/data`,
  any VPS folder) → restarts, redeploys and crashes are harmless.
* **On an ephemeral free host** (Render free without a disk, GitHub Pages) → **the entire site is wiped
  on every restart or redeploy.** Render only allows a disk on a paid instance type, which is why
  `render.yaml` uses `plan: starter`.

Defense in depth, already wired in:

1. Every 12 hours (and once ~45 s after boot) the server writes `data/backups/pjs-backup-<when>.tar.gz`
   containing the database, the WAL, every photo, the mail outbox, the settings and the session secret,
   then re-opens that archive and runs `PRAGMA integrity_check` so a broken backup is reported, not
   trusted. Last 14 are kept.
2. **Admin → Backup** shows the size, the member count inside the newest copy and the schedule, offers
   **Back up now**, **Download** (your off-server copy) and **Verify**. Those routes are administrators
   only and reject any file name that is not a backup archive.
3. If the data folder comes back empty while a backup clearly had more members, boot prints
   `⚠ DATA LOSS LOOKS LIKE IT JUST HAPPENED` plus the exact restore command — instead of quietly
   starting an empty site next to the real one.

```bash
npm run backup -- --list                 # what exists on this server
npm run backup:verify                    # write one now and open it again
npm run restore -- pjs-backup-….tar.gz --yes
```

A restore first copies whatever is currently in the data folder to `pjs-data-before-restore-<when>`, and
refuses archives that contain no database. Keep **one downloaded copy off the server** — a backup on the
same disk survives a corrupt file, not a deleted disk.

---

## Notes

- No third-party CDNs, fonts or trackers — the site is fast and works offline.
- `panika-jeevan-sathi-website-prompt.zip` is the original project brief archive; it is not used by the site.
