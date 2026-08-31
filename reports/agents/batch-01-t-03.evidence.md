# BATCH-01 / T-03 — raw execution log
executor : arena-coordinator-sandbox (linux/x64, node v22.22.3)
head     : eb84dba5ab3f629f7a79ae4858aaca79af38d68d
objective: Boot the real server on a temporary data folder and run the guardian health check: page/asset availability, 404 handling, path-traversal block, robots.txt, sitemap.xml, SEO tags, noindex on private pages, security headers, /api/health, and the approved-design baseline lock. Writes only a dated report under reports/.
verdict  : PASS

$ node scripts/health-check.mjs
(exit 0, 277ms)
--- stdout ---

1. Availability — public pages
  ✓ / → 200
  ✓ /about.html → 200
  ✓ /contact.html → 200
  ✓ /login.html → 200
  ✓ /privacy.html → 200
  ✓ /terms.html → 200

2. Availability — member pages & assets
  ✓ /admin.html → 200
  ✓ /settings.html → 200
  ✓ /dashboard.html → 200
  ✓ /matches.html → 200
  ✓ /messages.html → 200
  ✓ /notifications.html → 200
  ✓ /interests.html → 200
  ✓ /shortlist.html → 200
  ✓ /edit-profile.html → 200
  ✓ /profile.html → 200
  ✓ /search.html → 200
  ✓ /reset-password.html → 200
  ✓ /verify-email.html → 200
  ✓ /assets/css/app.css → 200
  ✓ /assets/js/app.js → 200
  ✓ /assets/js/cards.js → 200
  ✓ /assets/img/logo.svg → 200
  ✓ /assets/img/favicon.svg → 200
  ✓ /404.html → 200

3. Error handling
  ✓ unknown page returns 404
  ✓ 404 page is branded
  ✓ path traversal blocked

4. robots.txt
  ✓ robots.txt → 200
  ✓ robots.txt allows public crawl
  ✓ robots.txt blocks /admin.html
  ✓ robots.txt blocks /dashboard.html
  ✓ robots.txt blocks /messages.html
  ✓ robots.txt blocks /profile.html
  ✓ robots.txt blocks /api/
  ✓ robots.txt blocks /uploads/ (member photos)
  ✓ robots.txt advertises sitemap

5. sitemap.xml
  ✓ sitemap.xml → 200
  ✓ sitemap is valid XML urlset
  ✓ sitemap lists /
  ✓ sitemap lists /about.html
  ✓ sitemap lists /contact.html
  ✓ sitemap lists /login.html
  ✓ sitemap lists /privacy.html
  ✓ sitemap lists /terms.html
  ✓ sitemap does NOT list private pages

6. SEO tags on public pages
  ✓ /index.html has <title>
  ✓ /index.html has meta description
  ✓ /index.html has viewport
  ✓ /index.html has lang attribute
  ✓ /index.html is indexable (no noindex)
  ✓ /about.html has <title>
  ✓ /about.html has meta description
  ✓ /about.html has viewport
  ✓ /about.html has lang attribute
  ✓ /about.html is indexable (no noindex)
  ✓ /contact.html has <title>
  ✓ /contact.html has meta description
  ✓ /contact.html has viewport
  ✓ /contact.html has lang attribute
  ✓ /contact.html is indexable (no noindex)
  ✓ /login.html has <title>
  ✓ /login.html has meta description
  ✓ /login.html has viewport
  ✓ /login.html has lang attribute
  ✓ /login.html is indexable (no noindex)
  ✓ /privacy.html has <title>
  ✓ /privacy.html has meta description
  ✓ /privacy.html has viewport
  ✓ /privacy.html has lang attribute
  ✓ /privacy.html is indexable (no noindex)
  ✓ /terms.html has <title>
  ✓ /terms.html has meta description
  ✓ /terms.html has viewport
  ✓ /terms.html has lang attribute
  ✓ /terms.html is indexable (no noindex)

7. Private pages are noindex
  ✓ /admin.html has noindex
  ✓ /settings.html has noindex
  ✓ /dashboard.html has noindex
  ✓ /matches.html has noindex
  ✓ /messages.html has noindex
  ✓ /notifications.html has noindex
  ✓ /interests.html has noindex
  ✓ /shortlist.html has noindex
  ✓ /edit-profile.html has noindex
  ✓ /profile.html has noindex
  ✓ /search.html has noindex
  ✓ /reset-password.html has noindex
  ✓ /verify-email.html has noindex

8. Security headers
  ✓ header x-content-type-options
  ✓ header x-frame-options
  ✓ header referrer-policy
  ✓ header permissions-policy

9. API health
  ✓ /api/health responds ok

10. UI baseline (design lock)
  ✓ approved design unchanged (bodies, CSS, JS, images match baseline)

──────────────────────────────────────────────────────────
  95 passed, 0 failed — report: reports/health-report-2026-08-31.md
──────────────────────────────────────────────────────────

--- stderr ---
(none)
