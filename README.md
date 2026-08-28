# PANIKA JEEVAN SATHI — 100% Free Matrimonial Website

A complete, ready-to-run matrimonial website. **Every feature is 100% free** — no payment
gateways, no subscriptions, no paywalls, no locked features.

Built with **Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + Drizzle ORM** on top of
**Node's built-in SQLite** (`node:sqlite`). There are **no native modules, no external
databases, no email/SMTP services and no third-party APIs** — one folder, one command, it runs.

---

## Quick start

Requires **Node.js 22 or newer** (`node -v`).

```bash
npm install
npm run build
npm start            # → http://localhost:3000
```

That's it. On first start the app:

1. Creates the SQLite database at `data/panika.db` (all tables created automatically).
2. Seeds the admin account (below).
3. Seeds 8 sample member profiles (with photos) so search, recommendations and the home
   page work immediately.

For development: `npm run dev`.

### Customising (optional)

Copy `.env.example` to `.env` and adjust:

| Variable | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Used in SEO metadata / sitemap | `http://localhost:3000` |
| `DATA_DIR` | Where the SQLite file lives | `<project>/data` |
| `ADMIN_DEFAULT_PASSWORD` | Password of the auto-created admin account | `Panika@123` |
| `DISABLE_SECURE_COOKIE` | `true` when serving over plain HTTP (local dev) | unset |

Deploying to HTTPS? Leave `DISABLE_SECURE_COOKIE` unset.

## Admin

- **Login:** the admin logs in on the normal `/login` page.
- **Email:** `sukulpanika939@gmail.com` (fixed in `src/lib/constants.ts` → `ADMIN_EMAIL`).
- **Password:** `Panika@123` on first run (change it in **Settings → Change password**,
  or set `ADMIN_DEFAULT_PASSWORD` in `.env` before the first start).
- **Panel:** `/admin` — stats, manage users (suspend/activate/delete/promote), manage
  profiles (approve/suspend/verify), review reports (resolve/dismiss/suspend user),
  website announcements (home-page banner) and contact messages.

## Feature list (all working, all free)

- Email + password registration & login/logout (session cookie, 30 days)
- Create & edit matrimonial profile (details, family, lifestyle, photo)
- **Profile photo upload** — stored locally in `public/uploads/` (JPG/PNG/WebP, ≤ 4 MB)
- Profile search with filters: gender, age range, location, religion, community,
  marital status, education, profession, income, height + sorting and pagination
- View profile details (with privacy: hidden unless approved/visible)
- Send / cancel / accept / reject **Interest** (with personal note)
- **Matches** — created automatically when both sides accept an interest
- **Recommended matches** — automatic scoring from age, location, religion, community,
  mother tongue, marital status, education, profession, verification
- **Shortlist** profiles (private to you)
- User **dashboard** (profile strength, stats, recent conversations & notifications)
- **Notifications** (in-site; header badge)
- **Private messaging** — database-backed inbox & conversations that open once an
  interest is accepted on both sides
- Block & report users (admin-reviewed)
- Contact Us page (messages land in the admin panel) + **WhatsApp button** (+91 8099834725,
  opens WhatsApp chat directly, floating on every page)
- India + Global positioning, success stories, safety guidelines, privacy & terms
- Admin panel (users / profiles / reports / announcements / contact messages / admins)

## Project structure

```
src/
  app/               # pages + API routes
    api/actions/     # single JSON action endpoint used by all forms
    api/upload/      # photo upload (auth required)
  components/        # header/footer, profile card, form helpers, UI kit
  db/                # SQLite schema (Drizzle), connection + auto-migration + seed
  lib/               # auth, data queries, matching, security, constants
vendor/better-sqlite3/  # tiny stub so drizzle's driver resolves; real driver is
                        # src/db/sqlite-shim.ts on Node's built-in node:sqlite
```

## Testing

```bash
npm run typecheck    # TypeScript
bash scripts/e2e.sh  # 60-step end-to-end test (needs a running server + fresh data/)
```

`scripts/e2e.sh` exercises registration, login, duplicate rejection, profile edit, photo
upload, search + filters, profile viewing, interest send/accept, matching, messaging,
shortlist, recommended matches, reporting, blocking, contact form, admin panel
(login, user/profile/report/announcement management), logout, and data persistence.

## Notes

- The database is a single SQLite file in `data/` — back that folder up to back up the
  site. Delete it to reset the whole site (it re-seeds on next start).
- Sample member profiles use the password `Member@123` (for local testing only).
- The Google Fonts stylesheet is loaded in the browser with system-font fallbacks; the
  site works offline (fonts simply fall back).
