# Deploying SEVA MARKET INDIA on Render (free plan)

Follow this once, top to bottom. Total time: about 15 minutes.
Everything here can be done from a phone browser.

---

## What you are setting up

| Data | Where it lives | If the host wipes its disk |
|---|---|---|
| Catalog — locations, categories, providers, services | Local SQLite, rebuilt at boot from `src/db/seed-data.js` | Rebuilt in ~1 second |
| **Accounts** | **Supabase Postgres** (`seva_users`) | **Untouched** |
| **Customer enquiries** | **Supabase Postgres** (`seva_leads`) | **Untouched** |
| **Audit trail** | **Supabase Postgres** (`seva_audit_logs`) | **Untouched** |

Render's free plan deletes the filesystem on every deploy and every
wake-from-sleep. That is why only regenerable data is allowed to live there.

---

## Step 1 — Create the Postgres tables (Supabase)

1. Open <https://supabase.com/dashboard> and pick your project.
2. Left sidebar → **SQL Editor** → **New query**.
3. Open `seva-market-india/scripts/supabase-storage.sql` in this repo, copy
   the whole file, paste it into the editor.
4. Press **Run**. You should see `Success. No rows returned`.

The script is idempotent — running it twice changes nothing and deletes
nothing. It creates three tables with Row Level Security **on** and all
`anon` / `authenticated` grants revoked, so a leaked public key can read
nothing.

5. Paste `seva-market-india/scripts/supabase-verify.sql` and press Run. That
   message above only means "nothing errored"; this file answers "is the
   schema actually there, and is it locked down?". It is SELECT-only — safe
   to run as often as you like, and every line is independent, so a line
   lost in a phone paste costs one check, not the whole file.

   | Check | Expected |
   |---|---|
   | tables present | 4 rows, `present = t` |
   | RLS on | `rls_enabled = t` on all four |
   | policies | `policy_count = 0` |
   | public-key grants | `can_select = f`, `can_insert = f` on all 8 rows |
   | mirror rows | the counts on the file's `EXPECTED MIRROR ROWS` line (190 in total) |
   | durable tables | `0` until a real signup or enquiry arrives |

### Which paste is which

| Paste | File | Creates |
|---|---|---|
| reference-data mirror | `scripts/supabase-init.sql` | `seva_mirror` (catalog copy, optional) |
| durable storage | `scripts/supabase-storage.sql` | `seva_users`, `seva_leads`, `seva_audit_logs` |

Both are checked by `scripts/supabase-verify.sql`. Step 1 above is the one
this deploy needs; the mirror is documented in `README.md` and only feeds
read-only catalog queries.

## Step 2 — Copy the two Supabase secrets

In the same project: **Project Settings** → **API**.

| Copy this | Into the env var | Looks like |
|---|---|---|
| Project URL | `SUPABASE_URL` | `https://abcdefgh.supabase.co` |
| `service_role` secret | `SUPABASE_SERVICE_ROLE_KEY` | long token, marked *secret* |

> Use the **service_role** key, not `anon`. The anon key is browser-safe and
> cannot write to RLS-protected tables — the app checks the key type at boot
> and refuses to start with the wrong one, so a mistake here is loud, not
> silent.

## Step 3 — Create the Render service

Render drives a workspace from **one** blueprint file: `render.yaml` at the
repository root. This app's service is declared there, and `render.yaml` in
this folder carries a byte-identical copy so the directory still deploys if it
ever becomes its own repository — `tests/blueprint.test.mjs` fails the build if
the two drift apart.

### If a Blueprint already exists for this repo (usual case)

The repo already runs `panikajeevansathi` from a blueprint, so this is a
*change*, not a new resource:

1. Get the change onto the blueprint's branch (`main`). Render starts a **Sync**
   and lists a diff.
2. Expect **Create web service seva-market-india** in that list. Anything else
   in the list refers to the matrimonial service — e.g. *"Update web service
   … build command to `npm ci --omit=dev --ignore-scripts`"* or *"Create
   environment variable `NODE_ENV`"*. Those are the blueprint catching the
   dashboard up with `render.yaml`; read them, then approve. Leaving them
   unapproved just means the file and the dashboard disagree until the next
   sync.
3. Edit (the pencil / **Edit** link) the two `sync: false` rows on the new
   service and paste Step 2's values:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   They have no value in git on purpose; a blueprint cannot invent secrets.
4. **Approve**. Render creates and deploys the service.

### The three Environment rows this service needs

Service **`seva-market-india-tast`** → left sidebar → **Environment**. These
three are the whole manual job; everything else comes from the blueprint:

| Key | Value (exactly) | Where it comes from |
|---|---|---|
| `SUPABASE_URL` | `https://<your-ref>.supabase.co` | Supabase → **Project Settings → API → Project URL** — no trailing `/` |
| `SUPABASE_SERVICE_ROLE_KEY` | the long `eyJhbGciOi…` token | same page → **API Keys → `service_role` → Reveal**. **Never the `anon` key** |
| `SITE_URL` | `https://seva-market-india-tast.onrender.com` | the URL Render shows at the top of the service page — **with the `-tast` suffix**, no trailing `/` |
| `GOOGLE_SITE_VERIFICATION` | *(optional)* Search Console token | Google Search Console → Add property → HTML tag method → the token from `content="…"`. Renders the `<meta name="google-site-verification">` tag so ownership can be verified. See GOOGLE-INDEXING.md |

The "Secret" toggle is optional for each. **Save Changes** redeploys
automatically on Render.

> ⚠️ Never paste the service-role key into chat, email, tickets or a commit —
> it bypasses Row Level Security. It goes only from Supabase's reveal dialog
> straight into Render's Environment box.

*No "Create web service" row?* Then the blueprint is not looking at this file.
**Blueprints → `render.yaml` → Settings → Blueprint file path** can be pointed
at `seva-market-india/render.yaml` to give this app its own, independent
blueprint; otherwise confirm the root `render.yaml` on `main` declares the
service.

### Starting from scratch

1. Open <https://dashboard.render.com> → **New +** → **Blueprint**.
2. Pick the repository `Spanika4321/panika-jeevan-sathi`.
3. Render reads the root `render.yaml` and proposes both services. Approve, and
   fill the two secrets on `seva-market-india`.

Everything else (`NODE_ENV`, `SEVA_STORAGE=supabase`,
`SEVA_REQUIRE_REMOTE=1`, `SESSION_SECRET`, …) is set by the blueprint.

> **Set `SITE_URL` once, after creation.** The blueprint deliberately does
> **not** pin it (`sync: false`, dashboard-owned): if the service name was
> taken Render suffixes the URL — this service is
> `seva-market-india-tast.onrender.com`, not `seva-market-india.onrender.com`
> — and a committed value would keep pointing at the wrong host and get
> reverted by every blueprint sync. So after the service exists:
> **Settings → Environment → Add/Edit `SITE_URL`** → paste the exact URL Render
> shows at the top of the service page, **including any suffix, with no
> trailing slash** (e.g. `https://seva-market-india-tast.onrender.com`).
> A boot guard compares it with the URL the host reports and prints a loud
> `[site] WARNING` in **Logs** if they disagree — fix the env var and the
> warning clears on the next deploy.

> Deploying without a blueprint? Create a Web Service by hand with
> **Root Directory** `seva-market-india`, **Build** `npm install --omit=dev`,
> **Start** `node server.js`, **Health check path** `/api/v1/health`, then add
> the same environment variables listed in `render.yaml`.

## Step 4 — Watch the first boot

Open the service → **Logs**. A healthy boot prints:

```
Catalog seeded: 36 categories, 105 locations, 10 providers, 14 services.
SEVA MARKET INDIA listening on http://0.0.0.0:10000 (production)
```

If Supabase is misconfigured the service **crashes on purpose** with a
message that names the missing variable, for example:

```
StorageConfigError: Storage driver "supabase" needs SUPABASE_SERVICE_ROLE_KEY.
```

Fix the variable in **Settings → Environment** and redeploy. A crash here is
the safety net working: it is what stops customer enquiries from being
written to a disk that is about to be erased.

## Step 5 — Verify durability (do not skip)

Open in a browser:

```
https://<your-service>.onrender.com/api/v1/health
```

You want:

```json
{ "ok": true, "data": { "status": "ok", "storage": { "driver": "supabase", "durable": true } } }
```

`"durable": true` is the whole point. If it says `"driver": "sqlite"`, the
service is storing data on the ephemeral disk — stop and fix Step 2/3.

Then the deep check:

```
https://<your-service>.onrender.com/api/v1/health/deep
```

```json
{ "status": "ok", "catalog": { "ready": true }, "storage": { "ok": true, "latency_ms": 120 } }
```

## Step 6 — Prove it with a real round trip

1. Open the site, submit one enquiry through a provider page.
2. Supabase → **Table Editor** → `seva_leads`. Your row is there.
3. Render → **Manual Deploy** → **Deploy latest commit** (this wipes the disk).
4. Reload `seva_leads`. The row is still there.

That is the data-loss question answered by evidence rather than by promise.

---

## Step 6b — Turn on account email (SMTP)

Signup sends a **verification link** and `/forgot-password` sends a **reset
link**. Both are one-time tokens, stored *hashed* in `seva_account_tokens`
(48 hours to verify, 1 hour to reset, and a newer link always revokes the
older one). Without SMTP the site still serves every page — it just cannot
mail a link, and the signup / reset pages say so instead of pretending.

1. Pick a provider that sends transactional mail from your own domain
   (Resend, Zoho ZeptoMail, Amazon SES, Brevo, Mailgun; Gmail SMTP is fine for
   a trial only). **Verify the sending domain first** — an unverified
   `MAIL_FROM` is the most common reason mail is accepted and then dropped.
2. Render → your service → **Environment** → add:

   | Key | Example | Note |
   |---|---|---|
   | `SMTP_HOST` | `smtp.resend.com` | |
   | `SMTP_PORT` | `587` | `465` only together with `SMTP_SECURE=true` |
   | `SMTP_USER` | `resend` | provider-specific |
   | `SMTP_PASS` | `re_…` | the API key / app password |
   | `MAIL_FROM` | `SEVA MARKET INDIA <no-reply@yourdomain.in>` | a domain the provider lets you send from |

3. **Save changes** → Render redeploys.
4. Prove it: open `/register`, sign up with an address you own, click the link
   in the mail; then do the same through `/forgot-password`.
5. Read **Logs** on failure. A delivery problem appears as a `[mail] …` line
   with the reason — never with a token, a password or a full recipient
   address (`a***a@example.com` is the most a log line shows).

Two things not to do:

* **Do not set `SEVA_MAIL_OUTBOX` in production.** It writes `.eml` files to
  this disk, and Render's free disk is wiped on every deploy: a mail queue
  that deletes itself is worse than no queue. It exists for local debugging.
* **Do not reuse the Supabase key or `SESSION_SECRET` as an SMTP password.**
  They are unrelated secrets; a leaked SMTP password should not cost you the
  database.

If a link expires, the page offers **Resend**, which mints a new token and
revokes the outstanding ones — a mail that arrives late cannot resurrect an
old link.

---

## Business photos

Provider accounts can add up to **five** business photos from **My business**
on phone, tablet or desktop. Each image must be a real JPG, PNG or WebP and
no larger than 2 MB. Image bytes are checked on the server, so renaming a
non-image file to `.jpg` is refused.

On a production Supabase-backed service, the server uses the already required
server-only `SUPABASE_SERVICE_ROLE_KEY` to create the dedicated public
`seva-business-photos` Storage bucket on the first upload, then uploads there
without ever exposing the key to a browser. A listing photo needs to be public
so marketplace visitors can see it; object names are generated server-side and
never use a visitor's filename. Set `SEVA_MEDIA_BUCKET` in Render only if a
different, lowercase-hyphenated bucket name is required.

For local development, images are instead saved beneath ignored
`public/uploads/businesses/`; they are never committed. Provider profile data
is currently part of the regenerable catalog, so use a persistent catalog host
before treating provider-created profiles as long-term records; accounts,
enquiries and production image bytes remain in Supabase.

---

## Step 7 — Enable Google discovery after the deploy

Use the **actual live service URL**, currently
`https://seva-market-india-tast.onrender.com`. The similarly named
`https://seva-market-india.onrender.com` is not this service and may show
Render's loading screen.

1. Check these two URLs in a private browser window or with `curl -I`:

   ```text
   https://seva-market-india-tast.onrender.com/robots.txt
   https://seva-market-india-tast.onrender.com/sitemap.xml
   ```

   Both must be `200`. `robots.txt` must name the same `-tast` sitemap URL,
   and `sitemap.xml` must be XML (not the site's 404 page). The sitemap
   contains only public marketplace, provider, service, category and state
   landing pages; account, login, API and enquiry URLs are intentionally not
   submitted to Google.

2. Sign in to the Google account that owns the site, then open
   <https://search.google.com/search-console/>. Add the exact **URL-prefix**
   property `https://seva-market-india-tast.onrender.com/` (or the custom
   domain once one is connected) and complete Google's ownership verification.
3. In **Sitemaps**, submit `/sitemap.xml`. In **URL inspection**, inspect the
   home page and use **Request indexing** once it is eligible. Google controls
   crawl and indexing timing, so a successful submission is not an immediate
   guarantee that a `site:` search will show a result.
4. Prefer a verified custom domain for long-term SEO. A Render-generated
   hostname can change when a service is recreated; if it changes, update
   `SITE_URL` in Render's Environment screen, wait for redeploy, then repeat
   the two checks above and submit the new sitemap property.

No source-code change can perform Search Console ownership verification or
request indexing on an owner's behalf; those actions require the authorized
Google account.

---

## Checking from a computer, before deploying

```bash
cd seva-market-india

npm run storage:sql        # prints the SQL to paste in Step 1

SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
SEVA_REQUIRE_REMOTE=1 NODE_ENV=production \
npm run storage:verify     # config + tables + a real write, exit 0 = durable
```

`npm run storage:doctor` does the same without writing the canary row.

---

## Environment variables reference

| Variable | Required | Meaning |
|---|---|---|
| `SUPABASE_URL` | yes (production) | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (production) | service-role key; never sent to a browser |
| `SEVA_STORAGE` | no | `supabase` or `sqlite`; auto-detected otherwise |
| `SEVA_REQUIRE_REMOTE` | recommended | `1` = refuse to boot without Supabase (ephemeral hosts) |
| `SEVA_ALLOW_EPHEMERAL` | no | `1` = silence the SQLite-in-production warning (real disk) |
| `SEVA_SEED_ON_BOOT` | no | `0` disables the catalog rebuild at startup |
| `SEVA_DB_FILE` | no | path to the local catalog file |
| `SESSION_SECRET` | recommended | salts the HMAC used by the per-IP enquiry throttle |
| `TRUST_PROXY_HOPS` | on Render: `1` | how many proxy hops to trust for the client IP |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | for account email | SMTP server for verification + password-reset mail. Unset = no mail is sent and the pages say so |
| `SMTP_SECURE` | no | `true` for implicit TLS on `465`; unset means STARTTLS on `587` |
| `MAIL_FROM` | with SMTP | `SEVA MARKET INDIA <no-reply@yourdomain>`; defaults to the `SMTP_USER` address |
| `SMTP_TIMEOUT_MS` | no | per-step SMTP timeout, default `15000` |
| `SEVA_MAIL_OUTBOX`, `SEVA_MAIL_OUTBOX_DIR` | no | development only: write undelivered mail to `data/outbox` instead of dropping it. Never on an ephemeral host |
| `SEVA_TABLE_TOKENS` | no | verification / reset token table, default `seva_account_tokens` |
| `SITE_URL` | set in dashboard | canonical origin; `sync: false` so the blueprint never overwrites it. Paste the exact URL Render gave, including any suffix (e.g. `-tast`), no trailing slash. A boot `[site] WARNING` means it disagrees with the host's real URL |

---

## Local development is unaffected

```bash
npm install
npm run seed
npm start          # storage driver: sqlite, everything in ./data
npm test           # 260 tests (255 offline, 5 gated on real Postgres)
```

The Supabase path only switches on in production or when you set
`SEVA_STORAGE=supabase` explicitly.

---

## Other hosts

* **Railway / Fly / any container host** — same rules: ephemeral filesystem,
  so set `SEVA_STORAGE=supabase`, `SEVA_REQUIRE_REMOTE=1` and the two
  Supabase variables.
* **VPS with a real disk** — `SEVA_STORAGE=sqlite` plus
  `SEVA_ALLOW_EPHEMERAL=1` is fine; back up `data/seva-market.db` yourself.
