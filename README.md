# TEERNOVA

[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Coming%20soon-da552f?logo=producthunt&logoColor=white)](https://www.producthunt.com/products?q=TEERNOVA)
[![GitHub](https://img.shields.io/badge/GitHub-Spanika4321%2Fpanika-jeevan-sathi-181717?logo=github)](https://github.com/Spanika4321/panika-jeevan-sathi)

**TEERNOVA — Live Teer Results • Smart Statistics • Trusted Information**

A complete, production-ready **Teer result platform** for Assam Teer results — **100% free**: no payment gateway, no subscription plans, no premium tiers, no real-money betting.

**Product Hunt:** this GitHub repo is the product source. Connect it under [Ship → GitHub](https://www.producthunt.com/ship) and use the copy in **[PRODUCTHUNT.md](PRODUCTHUNT.md)**.

Built as a single self-contained Node.js application with **zero npm dependencies** (except `@supabase/supabase-js` for Supabase support).

---

## Run it

```bash
npm install
node server.js          # http://localhost:3000
PORT=8080 node server.js
```

Requirements: **Node.js 22.5 or newer** (uses the built-in `node:sqlite` driver).

On first start the **admin account** is created (default email from `ADMIN_EMAIL` env, or `admin@teernova.com`). The password is taken from `ADMIN_PASSWORD` or generated and printed once in the console / `data/admin-credentials.txt` (git-ignored). Log in at `/admin.html`.

---

## Environment variables (all optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `PJS_DATA_DIR` | `./data` | Database + uploads |
| `SITE_URL` | request origin | Canonical URL for sitemap/robots |
| `SESSION_SECRET` | auto-generated | Session signing key |
| `ADMIN_EMAIL` | `admin@teernova.com` | Admin account email |
| `ADMIN_PASSWORD` | auto-generated | Admin account password |
| `SUPABASE_URL` | — | Supabase project URL (optional, for cloud database) |
| `SUPABASE_KEY` | — | Supabase anon public key |
| `PJS_FLUSH_INTERVAL_MS` | `5000` | Database flush interval |

---

## Features

**Live Teer Results**
- Display FR (First Round) and SR (Second Round) results
- House and Ending information (derived fields)
- Session-based result organization (Morning, Day, Evening, Night)
- Result verification workflow: FETCHED → PENDING VERIFICATION → VERIFIED → PUBLISHED

**Result Management**
- Admin-configured sessions with custom schedules
- Admin-configurable result sources
- Manual result entry with preview → verify → publish workflow
- Result correction with full audit trail
- Pending results dashboard for admin

**Statistics (Informational Only)**
- Result frequency analysis
- House frequency analysis
- Ending frequency analysis
- Session-wise history
- Date-wise history
- **Disclaimer:** Statistics are for informational purposes only. Past results do not guarantee future outcomes.

**Demo Play (Virtual Credits Only)**
- No real money involved
- No deposits, no withdrawals, no cash prizes
- Virtual credits only for entertainment
- Completely separate from official results

**Admin Panel**
- Dashboard with stats overview
- Session management (create/edit/delete)
- Result management (add/verify/publish/correct)
- Source management (add/edit/delete)
- Announcements management
- Demo session management
- Audit log for all admin actions
- Server-side authorization (never trust frontend alone)

**User Features**
- Registration and login (email + password)
- Session viewing
- Result history browsing
- Demo play (requires login)
- Profile management
- Password reset

---

## Project layout

```
server.js               HTTP server + API + static files
lib/db.js               storage layer (SQLite) + TEERNOVA schema
lib/auth.js             authentication (kept from original)
lib/api.js              all REST endpoints (TEERNOVA APIs)
lib/settings.js         website content (TEERNOVA branding)
lib/supabase-driver.js  Supabase database driver (optional)
lib/agents-db.js        Supabase-backed agents storage (optional)
public/                 website (HTML + CSS + JS, no build step)
  index.html            homepage with sessions, results, stats
  results.html          results page with filters
  history.html          result history with pagination
  statistics.html       statistics page
  sessions.html         sessions page
  demo.html             demo play page (virtual credits only)
  about.html            about page
  admin.html            admin panel
  login.html            login/register page
  404.html              404 page
  assets/css/app.css    TEERNOVA design system
  assets/js/app.js       shared front-end library
scripts/                deployment and utility scripts
```

---

## API overview

```
GET  /api/health                  Health check
GET  /api/site                    Site settings
GET  /api/announcements           Active announcements

POST /api/auth/register           Register new user
POST /api/auth/login              Login
POST /api/auth/logout             Logout
POST /api/auth/forgot             Forgot password
POST /api/auth/reset              Reset password
GET  /api/me                      Current user

GET  /api/sessions                List sessions
GET  /api/sessions/:id            Session details with schedules
POST /api/sessions                (admin) Create session
PATCH /api/sessions/:id           (admin) Update session
GET  /api/session-schedules       List schedules
POST /api/session-schedules       (admin) Create schedule

GET  /api/results                 List results (with filters)
GET  /api/results/:id             Result detail with corrections
POST /api/results                 (admin) Add result
PATCH /api/results/:id            (admin) Update result status
POST /api/results/:id/correct     (admin) Correct result

GET  /api/result-sources          List sources
POST /api/result-sources          (admin) Create source
PATCH /api/result-sources/:id     (admin) Update source

GET  /api/announcements           List announcements
POST /api/announcements           (admin) Create announcement
PATCH /api/announcements/:id      (admin) Update announcement

GET  /api/demo-sessions           List demo sessions
POST /api/demo-sessions           (admin) Create demo session
GET  /api/demo-entries            User's demo entries
POST /api/demo-entries            Submit demo entry
POST /api/demo-results            (admin) Publish demo result

GET  /api/admin/stats             (admin) Dashboard stats
GET  /api/admin/sessions          (admin) All sessions
GET  /api/admin/results           (admin) Results with filters
GET  /api/admin/sources           (admin) All sources
GET  /api/admin/announcements     (admin) All announcements
GET  /api/admin/audit             (admin) Audit logs
GET  /api/admin/demo-sessions     (admin) Demo sessions
GET  /api/admin/demo-results      (admin) Demo results
DELETE /api/admin/sessions/:id    (admin) Delete session
DELETE /api/admin/result-sources/:id  (admin) Delete source
DELETE /api/admin/announcements/:id   (admin) Deactivate announcement
```

---

## Database Transformation

The existing `PANIKA JEEVAN SATHI` matrimonial database has been transformed:

**Kept tables (modified for TEERNOVA):**
- `users` — user accounts (for auth)
- `settings` — website settings
- `audit_logs` — audit trail
- `notifications` — notifications

**Removed tables (matrimonial):**
- `profiles` — matrimonial profiles
- `interests` — marriage interests
- `shortlist` — shortlist
- `reports` — reports
- `contact_messages` — contact form
- `stories` — success stories

**New TEERNOVA tables:**
- `sessions` — session info
- `session_schedules` — session timings
- `official_results` — FR/SR results
- `result_sources` — source configuration
- `result_verifications` — verification workflow
- `result_corrections` — correction history
- `announcements` — admin announcements
- `demo_sessions` — demo sessions
- `demo_entries` — demo entries
- `demo_results` — demo results

---

## Deployment

### Render (Free)
1. Connect GitHub repo to Render
2. Set environment variables (SUPABASE_URL, SUPABASE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET)
3. Deploy

### Railway
Same as Render — set env vars and deploy.

### VPS / cPanel
```bash
git clone <your-repo> && cd panika-jeevan-sathi
npm install
PORT=3000 SESSION_SECRET="a-long-random-string" node server.js
```

---

## Final Build Checklist

Before deployment, verify:

- [ ] Database migration complete (old matrimonial tables removed)
- [ ] Syntax check passes: `node scripts/check-syntax.mjs`
- [ ] All TEERNOVA pages work: Home, Results, History, Statistics, Sessions, Demo, About, Admin, Login
- [ ] Admin auth works
- [ ] Result workflow works (add → verify → publish)
- [ ] Demo play works with virtual credits
- [ ] No "PANIKA JEEVAN SATHI" or matrimonial content remains in active UI
- [ ] TEERNOVA branding appears everywhere
- [ ] Mobile responsiveness works
- [ ] Supabase integration works (if configured)

---

## Notes

- No third-party CDNs, fonts or trackers — the site is fast and works offline.
- Demo play is virtual credits only — no real money, no gambling.
- All results go through verification before publishing.
- Past statistics do not guarantee future outcomes.

---

## License

UNLICENSED — All rights reserved.
