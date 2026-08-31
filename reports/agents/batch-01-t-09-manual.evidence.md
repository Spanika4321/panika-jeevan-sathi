# BATCH-01 / T-09 — manual evidence (internal-link audit)

Run on: arena-coordinator-sandbox (Linux/x64, Node v22.22.3), 2026-08-31T18:58Z
Repo: /home/user/panika-jeevan-sathi @ 8ef92b7b9c62 (branch arena/01a0591c-panika-jeevan-sathi)
Executor: a human/agent shell session, not the batch runner — hence `provenance: manual`.

Commands actually run, in the repo root, and their real output:

```console
$ grep -rhoE 'href="/[^"]+"' public/*.html | sed -E 's/.*href="//; s/[?#].*//; s/"$//' | sort -u > /tmp/pjs-links.txt
  (exit 0, no stdout — output redirected to /tmp/pjs-links.txt)

$ while read -r p; do case "$p" in /api/*) continue;; esac; [ -f "public$p" ] || echo "UNRESOLVED $p"; done < /tmp/pjs-links.txt
  (exit 0, no output at all → zero UNRESOLVED links)

$ wc -l < /tmp/pjs-links.txt
  18
```

The 18 distinct internal hrefs found in the static HTML:

```
/admin.html              /interests.html     /settings.html
/assets/css/app.css      /login.html         /shortlist.html
/assets/img/favicon.svg  /matches.html       /terms.html
/contact.html            /messages.html       /profile.html
/dashboard.html          /notifications.html  /search.html
/edit-profile.html       /privacy.html
/index.html
```

Every one of them resolves to a real file under `public/`. Notably absent — and that is the point of this task:

- `/register.html` — not referenced by any page (registration is the `?tab=register` form inside `/login.html`)
- `/forgot-password.html` — not referenced by any page (reset lives at `/reset-password.html`)

So the two "production failures" recorded in `reports/agents/render-employee-latest.json`
are 404s of routes that `scripts/render-doctor.mjs` **guesses**, not broken UI links.

Scope limit, stated honestly: this pipeline only sees `href="…"` literals written in
`public/*.html`. Links assembled in JavaScript (`/profile.html?id=…`, `/messages.html?with=…`)
are not covered here — they are exercised by T-03 (95 health checks) and T-04 (134 e2e checks).

No file under `public/**` was modified, and `reports/ui-baseline-body.md5` was not regenerated.
