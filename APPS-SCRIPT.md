# Google Apps Script — how the web app and this repository stay in sync

Your Apps Script Web App lives at `script.google.com/macros/s/…/exec` in its own project.
This repository does **not** contain that project — it contains the **source code** of it
(`apps-script/`), plus everything needed to push that source into the existing project
automatically, without opening the Apps Script editor.

Three things, kept separate on purpose:

| Thing | Where it lives | Who changes it |
| --- | --- | --- |
| `apps-script/Code.gs` (the code) | this GitHub repository | you, from GitHub in a browser — even on a phone |
| The Apps Script project (the runtime) | script.google.com — yours, unchanged | GitHub Actions, on every commit |
| The member data | a Google Sheet the script creates | the website, live |

---

## TL;DR — the safest automated way to update `Code.gs`

0. Once (2 minutes, GitHub web UI): add the two workflow files — see “Install the
   workflows” below. GitHub does not allow an app or agent to create files in
   `.github/workflows/`, so they are stored in `ops/` for you to add by hand.
1. Once: authorise Google **one time** with a device code (you type a short code on your
   phone at `google.com/device` — no computer, no copy-paste of code).
2. Store four values as **GitHub repository secrets**.
3. Forever after: edit `apps-script/Code.gs` on github.com (pencil icon → Commit), and the
   workflow **Deploy Apps Script** uploads it. Nothing to install, nothing to type.

Every run first **downloads the code that is live right now** and uploads it as a build
artifact, so a mistake is always recoverable.

That is the recommended path (Option A). Two fallbacks are described further down:
Option B (clasp, if you ever sit at a computer) and Option C (zero tokens, the script
fetches its own code from GitHub).

---

## Option A — GitHub Actions (recommended)

### A0. Install the workflows (one time, from GitHub in a browser)

GitHub refuses to let any app or agent create files inside `.github/workflows/`, so the two
workflow files are kept in `ops/` and you add them once:

1. <https://github.com/Spanika4321/panika-jeevan-sathi> → **Add file → Create new file**
2. Name it exactly `.github/workflows/deploy-apps-script.yml`
3. Paste the whole content of [`ops/deploy-apps-script.workflow.yml`](ops/deploy-apps-script.workflow.yml)
4. **Commit changes**, then repeat with `.github/workflows/apps-script-authorize.yml` from
   [`ops/apps-script-authorize.workflow.yml`](ops/apps-script-authorize.workflow.yml)

(The same pattern is already used for the agent workflows — see
[`ops/INSTALL-WORKFLOWS.md`](ops/INSTALL-WORKFLOWS.md).) After that, everything below runs
by itself.

### A1. Two values you need first

* **Script ID** — Apps Script editor → ⚙ Project Settings → *Script ID*.
  (Also visible in the editor URL: `script.google.com/home/projects/<SCRIPT_ID>/edit`.)
* **Deployment ID** — the `AKfycb…` part of your `/exec` URL. Only needed if the web app is
  pinned to a version (see A5).

### A2. Create a Google Cloud OAuth client (once, ~5 minutes)

This is what lets GitHub call the Apps Script API on your behalf.

1. Open <https://console.cloud.google.com> (in Chrome you can tick *Desktop site* if the
   mobile layout hides menus).
2. Create a project (any name) — or reuse one.
3. **APIs & Services → Library** → search *Apps Script API* → **Enable**.
4. **APIs & Services → OAuth consent screen** → *External* → create → add **your own
   Gmail address** as a test user (otherwise Google refuses the consent).
5. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   Application type **“TVs and Limited Input devices”** (this is the type that works
   without a browser on the machine doing the authorising).
6. Copy the **Client ID** (and the Client secret, if one is shown).

### A3. Get the refresh token (once)

**Preferred (nothing is ever published):** if you can run one command anywhere private —
Termux on Android, a friend’s laptop, GitHub Codespaces —

```bash
node scripts/apps-script-auth.mjs --client-id YOUR_CLIENT_ID
```

It prints a code; open `https://google.com/device` on your phone, type the code, tap
**Allow**; the script then prints the refresh token. Nothing leaves your device.

**Without any computer:** Actions → **Authorize Apps Script** → *Run workflow* → paste the
client id → Run. The job log shows:

```
1. On your phone open      : https://google.com/device
2. Type this code          : XXXX-XXXX
3. Choose your Google account and tap Allow.
```

Approve, and the job prints the refresh token. ⚠ **This repository is public, so Actions
logs are public.** Copy the token straight away; the job deletes its own logs two minutes
later. If you would rather not have it in a log at all, use the Termux option above.

### A4. Add the repository secrets

GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `PJS_APPS_SCRIPT_ID` | the Script ID from A1 |
| `PJS_AS_CLIENT_ID` | OAuth client id from A2 |
| `PJS_AS_CLIENT_SECRET` | its secret (may be empty) |
| `PJS_AS_REFRESH_TOKEN` | the token from A3 |
| `PJS_AS_DEPLOYMENT_ID` | optional — only for pinned mode (A5) |
| `PJS_APPS_SCRIPT_URL` | optional — your `/exec` URL, used by the manual “ping” job |
| `PJS_SHEETS_TOKEN` | optional — the bridge token, also only for “ping” |

### A5. Make sure the `/exec` URL serves the new code

A web app is served by a **deployment**, and a deployment points at either:

* **Latest (Head)** — every code push is live immediately, same URL. ✅ recommended
  Set it once: Apps Script editor → **Deploy → Manage deployments → Edit (pencil) →
  Version → Latest (Head)**. After that you never touch the editor again.
* **a pinned version** — pushes are stored but *not* served until the deployment is moved.
  In that case put the deployment id in `PJS_AS_DEPLOYMENT_ID` and run
  *Deploy Apps Script → action: deploy*, which creates a version and moves the deployment
  to it. (Known Apps Script quirk: the API can drop a deployment’s entry points when
  updating it — the workflow prints the entry points afterwards so you can check.)

### A6. Day to day

Edit `apps-script/Code.gs` on github.com → Commit. The **Deploy Apps Script** workflow:

1. downloads the live code → `apps-script/_remote/` → artifact `apps-script-live-backup`;
2. prints the diff (file, live lines → new lines);
3. uploads the repository version to the Apps Script project.

Nothing is written without `--apply`. Automatic pushes apply; to review first, add the
repository **variable** `PJS_AS_AUTO_APPLY = false` — then commits only print the diff and
you run *Actions → Deploy Apps Script → Run workflow → apply*.

### A7. Before the very first push — keep your existing code

The first push replaces the files of the Apps Script project with the files in
`apps-script/`. To see what is there today:

*Actions → Deploy Apps Script → Run workflow → action: `pull`, import live code: ✅*

That commits a copy into `apps-script/_imported/` (never pushed back). Read it on GitHub,
merge anything you want to keep into `apps-script/Code.gs`, and only then push.

---

## Option B — clasp (if you ever have a computer)

```bash
npx @google/clasp login          # browser opens once
npx @google/clasp clone <SCRIPT_ID>   # or: npx @google/clasp setting scriptId <SCRIPT_ID>
cp apps-script/Code.gs Code.gs
npx @google/clasp push
```

`clasp push` updates the code; the same Head/pinned rule from A5 applies.

## Option C — no Google Cloud, no tokens (script syncs itself)

`apps-script/_optional/SelfSync.gs` lets the Apps Script project **download its own code
from GitHub on a timer** using its built-in token — no OAuth client, no secrets.

* paste that file into the project **once**;
* add the two scopes it lists to `appsscript.json` (`script.external_request`,
  `script.projects`);
* switch the project to a **standard** Google Cloud project and enable the Apps Script API
  there (Project Settings → Google Cloud Platform project) — default hidden projects reject
  the API call;
* run `installSelfSync()` once from the editor; it then checks GitHub every 6 hours.

Still A5: it only takes effect on a **Head** deployment.

---

## Connecting the website to the Sheet

### One-time: install the shared secret

Open this once in any browser (phone is fine), using your own secret:

```
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?action=setup&token=YOUR_SECRET
```

It creates the Google Sheet (“PANIKA JEEVAN SATHI — database”, one tab per table), stores
the token, and answers with the spreadsheet link. **Until you do this, the bridge refuses
every request** — that is deliberate, so nobody else can read your members.

### Then connect the site

*Admin panel → Google Sheets* → paste the `/exec` URL and the token → **Test connection**
→ **Save connection**. (Or set environment variables `PJS_SHEETS_URL` and
`PJS_SHEETS_TOKEN` — on Render: Dashboard → Environment.)

Pick one of two modes (`PJS_STORAGE`):

| `PJS_STORAGE` | Meaning | When to use |
| --- | --- | --- |
| `mirror` (default when only a URL is set) | the site keeps its own database (SQLite / Cloudflare D1) and writes every change into the Sheet too | **safest** — the site keeps working even if Google Sheets is unreachable |
| `sheets` | the Google Sheet *is* the database: loaded at boot, every read/write goes through it | you want to edit members directly in the Sheet |

Restart the service after changing `PJS_STORAGE`. In `sheets` mode the admin panel has
**Reload from Sheet**, which re-reads the Sheet into the site immediately (handy after
editing rows by hand).

You can prove the whole chain locally without touching Google:

```bash
npm run test:sheets     # runs the real Code.gs inside Node + the real website (26 checks)
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `PJS_SHEETS_URL` | the `/exec` URL of the web app |
| `PJS_SHEETS_TOKEN` | the shared secret you set with `?action=setup` |
| `PJS_SHEETS_MODE` | `mirror` or `sheets` (overrides the default above) |
| `PJS_STORAGE=sheets|mirror` | selects the mode |
| `PJS_SHEETS_TIMEOUT_MS` | request timeout (default 20000) |

---

## The protocol (pjs-bridge/1)

Both `GET` (query parameters) and `POST` (JSON body, `Content-Type: text/plain`) work.

| Action | Body / parameters | Answer |
| --- | --- | --- |
| `ping` | — | protocol, bridge version, spreadsheet link, row counts per tab |
| `setup` | `token=NEW` | first run: creates the Sheet and stores the token |
| `dump` | optional `tables=users,profiles` | `{ tables: { users: [...], … } }` |
| `mutate` | `ops: [{type, table, row\|patch, where}]` | `{ applied, touched }` |
| `query` | `table`, `where`, `opts` | `{ rows }` |
| `setToken` | `token` (current), `next` (new) | rotates the secret |
| `reset` | `confirm=DELETE` | empties every table |

`where` mirrors the website’s rules: `{city:'Raipur'}`, `{age:{gte:25,lte:35}}`,
`{id:{in:[1,2,3]}}`, `{photo:null}`, `{name:{like:'%kumar%'}}`.

Inserts are **upserts**: re-sending the same insert updates the row instead of duplicating
it, so a retried write after a network hiccup is harmless.

---

## Safety notes

* The whole database is transferred on boot and on “Reload from Sheet”. Keep it to a few
  thousand rows per tab; Apps Script has a 60-second execution limit per request and
  consumer (gmail) accounts have daily quotas (roughly 90 minutes of script runtime and
  20 000 URL-fetch calls per day). For a large community, keep `PJS_STORAGE=mirror` with
  Cloudflare D1 as the real database and treat the Sheet as a live copy.
* Photos are never stored in the Sheet — only their URLs, as in the normal database.
* If your `appsscript.json` lists `oauthScopes`, it must include
  `https://www.googleapis.com/auth/spreadsheets` or the bridge cannot open the Sheet.
* Rollback: re-run the workflow from an older commit, or restore a previous version in
  Apps Script (Deploy → Manage deployments), or copy the code back out of the
  `apps-script-live-backup` artifact.
* Revoke the deploy token any time at <https://myaccount.google.com/permissions>.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Apps Script API has not been used in project … or it is disabled` | enable the Apps Script API in the Cloud project that owns the OAuth client (A2 step 3) |
| `invalid_client` / “client type is incorrect” | the OAuth client must be type **TVs and Limited Input devices** |
| `invalid_grant` when the workflow runs | the refresh token was revoked or expired — run the authorisation again |
| workflow pushes, `/exec` still serves the old code | the deployment is pinned — switch it to **Latest (Head)** (A5) |
| `bad token` from the website | the site’s `PJS_SHEETS_TOKEN` differs from the one set with `?action=setup`; rotate with `?action=setToken&token=OLD&next=NEW` |
| `The Apps Script web app did not answer with JSON` | the URL is the `/dev` editor URL, or the script threw an error — open `/exec?action=ping` in a browser to see it |
| site refuses to boot in `sheets` mode | the Sheet is unreachable; start with `PJS_STORAGE=mirror` instead |
