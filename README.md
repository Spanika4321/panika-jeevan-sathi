# PANIKA JEEVAN SATHI

[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Coming%20soon-da552f?logo=producthunt&logoColor=white)](https://www.producthunt.com/products?q=PANIKA%20JEEVAN%20SATHI)
[![GitHub](https://img.shields.io/badge/GitHub-Spanika4321%2Fpanika-jeevan-sathi-181717?logo=github)](https://github.com/Spanika4321/panika-jeevan-sathi)

A complete, production-ready **matrimonial website** for the Panika, Manikpuri, Kabirpanthi and Adivasi
communities — **100% free for members**: no payment gateway, no subscription plans, no premium tiers,
no locked profiles, no paid messaging.

**Product Hunt:** this GitHub repo is the product source. Connect it under [Ship → GitHub](https://www.producthunt.com/ship) and use the copy in **[PRODUCTHUNT.md](PRODUCTHUNT.md)**.

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
npm run test:cloud # the same suite against Cloudflare D1 + R2 (local mocks)
npm run verify:cloud   # check real D1/R2 credentials and a deployed site
```

### Environment variables (all optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `PJS_DATA_DIR` | `./data` | Database + uploaded photos |
| `SITE_URL` | request origin | Canonical production URL used in `robots.txt` / `sitemap.xml` (pin it in production) |
| `SESSION_SECRET` | auto-generated in `data/` | Session signing key |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | generated | First administrator (password never hardcoded) |
| `OWNER_EMAILS` | — | Extra emails always promoted to admin |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | — | Real email delivery (needs `npm i nodemailer`) |
| `PJS_STORAGE` | `auto` | `auto` = Cloudflare D1 when `CF_*` is set, else local SQLite; `sqlite`/`json`/`d1` force one |
| `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_API_TOKEN` | — | Cloudflare D1 holds the member database (free tier, no expiry) |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | — | Cloudflare R2 holds profile photos (free tier, 10 GB) |

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

**Admin panel** (`/admin.html`, administrator role required, server-side checks on every API)
- Live dashboard: accounts, active/suspended, new members, reports, contact queue, recent activity
- Members: search, role/status filters, details, edit, hide profile, remove photo, suspend, delete
- Reported users: review, resolve, dismiss, suspend or delete the reported member
- Success stories, contact inbox, website content, email outbox
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
public/                 the website (HTML + CSS + JS, no build step, no CDN)
public/assets/css/app.css
public/assets/js/app.js     shared client: API, auth, chrome, helpers
public/assets/js/cards.js   profile cards + member actions
scripts/e2e-test.mjs    full end-to-end test (boots a real server)
scripts/e2e-cloud-test.mjs   member journey + cold-start test against D1 & R2
scripts/test-sigv4.mjs  AWS SigV4 conformance (the official AWS test vectors)
scripts/verify-cloud.mjs     check real Cloudflare credentials + a live site
scripts/deploy-render.mjs    create/update the Render service and deploy it
scripts/cloud-setup.mjs      create the D1 database and print the Render env vars
scripts/check-syntax.mjs    syntax check for every shipped script
scripts/agent-storage.mjs   CLI for the AI agent storage (init/status/doctor/report)
scripts/agent-storage-cycle.mjs  runs all 12 agents and records every run
agents/                 AI agent team (Guardian, Manager, Pooja, Priya + 8 workers)
agents/storage.mjs      agent storage engine (state, memory, tasks, ledger, queue)
agents/roster.mjs       the 12-agent roster, hierarchy and safety rules
storage/                permanent memory of all 12 AI agents (committed baseline)
data/                   database, uploaded photos, outbox (git-ignored)
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
all pages and assets returning 200, security headers, 404 handling, path-traversal blocking — and
finally that **all data survives a full server restart**.

The same suite passes on the JSON fallback store: `npm run test:json-store`.

---

## Deploying

Full instructions (Render, cPanel, Railway, Docker, VPS + systemd, backups, environment variables)
are in **[DEPLOY.md](DEPLOY.md)**. The production target is:

- **Render (free) — one-click Blueprint → `https://panikajeevansathi.onrender.com`**
  (`render.yaml` creates the service named `panikajeevansathi`; pair it with free
  Cloudflare D1 + R2 so members & photos survive Render's free sleep/redeploys).
- The previous production URL `https://panikajeevansathi.coolstore.in` can be restored on the same
  cPanel account by running *this* app (see DEPLOY.md § 1c) — its storage is already persistent.
- **Railway is not used:** its free sandbox no longer exists, which produced the
  “Sandbox Not Found” / 502 errors. Use Render or cPanel instead.

Note: **GitHub Pages cannot host this app** — it needs a Node process and a database, not static files.

**VPS / shared Node hosting**

```bash
git clone <your repo> && cd panika-jeevan-sathi
PORT=3000 SESSION_SECRET="a-long-random-string" node server.js
```

Keep it alive with `pm2`, `systemd` or your host's Node manager, and put nginx/Caddy in front for TLS.
Back up by copying the `data/` folder — it contains the database and every uploaded photo.

**cPanel / hosting without Node 22.5+**: the site automatically falls back to the JSON file store, but
Node 22.5+ with SQLite is strongly recommended for a live site.

---

## AI agent storage

Twelve AI agents run on GitHub Actions, 24×7, and each one keeps a **permanent
memory** in `storage/`:

| | |
| --- | --- |
| `storage/agents/<id>/` | state, memory, tasks, metrics, log, inbox, outbox — one folder per agent |
| `storage/shared/` | shared KV namespaces, durable job queue, hash-chained ledger, incidents, knowledge base |

```bash
npm run storage:init      # create the storage tree + register all 12 agents
npm run storage:status    # status table for every agent
npm run storage:doctor    # integrity check (corrupt JSON? ledger intact?)
npm run storage:cycle     # run all 12 agents, snapshot, write the report
npm run storage:report    # reports/agents/agent-storage-report.md
```

Agents: **Guardian (Sardar)** → **Manager** → Pooja, Priya, Arjun, Kavita,
Rahul, Sneha, Amit, Nisha, Vikram, Meera.

The ledger is hash-chained (`sha256(prevHash + entry)`), so a single edited
line makes `doctor` fail. On GitHub Actions the storage is preserved between
runs with `actions/cache`; if the cache is ever evicted, the committed
baseline restores it.

Full documentation: [`storage/README.md`](storage/README.md).

---

## Notes

- No third-party CDNs, fonts or trackers — the site is fast and works offline.
- `panika-jeevan-sathi-website-prompt.zip` is the original project brief archive; it is not used by the site.
