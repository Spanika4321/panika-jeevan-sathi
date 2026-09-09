# Google Indexing — SEVA MARKET INDIA

Google Search Central ke official rules padh kar site par apply kiye gaye hain.
Live URL: **https://seva-market-india-tast.onrender.com**
(Panika Jeevan Sathi pehle se indexed hai — ye document sirf Seva Market India ke liye hai.)

Verify: `cd seva-market-india && npm test` → **268 tests, 263 pass, 0 fail**
(5 skip sirf real-PostgreSQL wale hain)

---

## 1. Google ke rules aur unka status

| # | Google ka rule | Status | Kahan |
|---|---|---|---|
| 1 | robots.txt root par ho, sirf Google-supported directives (`user-agent`, `allow`, `disallow`, `sitemap`) | ✅ | `/robots.txt` — `src/routes/seo.js` |
| 2 | Jo page `Disallow` ho, uska `noindex` padha hi nahi ja sakta | ✅ sirf accounts/auth blocked; search/listing pages crawlable | `robotsText()` |
| 3 | Sitemap me **absolute URL** | ✅ `SITE_URL` se banta hai | `canonicalOrigin()` |
| 4 | Google `<changefreq>` / `<priority>` **ignore** karta hai | ✅ **hata diye** — ab sirf `<loc>` + `<lastmod>` | `entry()` |
| 5 | `<lastmod>` sach ho, banaya hua nahi | ✅ har service/provider ke **apne `updated_at`** se | `isoDate()` |
| 6 | Sitemap limit 50MB / 50,000 URL | ✅ cap 20,000 | `MAX_LISTING_URLS` |
| 7 | Private/parameter pages sitemap me nahi | ✅ sirf curated pages — arbitrary `q=`/`pin=` URLs nahi | `sitemapUrls()` |
| 8 | XML values entity-escaped | ✅ | `escapeXml()` |
| 9 | Canonical absolute, har page par | ✅ | `views/layout.js` |
| 10 | Private pages `noindex` (robots.txt se nahi) | ✅ `/account`, `/login`, `/register` etc. par `noindex,nofollow` | routes |
| 11 | Unique `<title>` + meta description har page par | ✅ dynamic (service/provider/category/state) | routes |
| 12 | Title ~50–60 chars, **keyword pehle** | ✅ **fix** — home: "Find local service providers by city & PIN code" | `pages.js` |
| 13 | Meta description ~150–160 chars, unique, action word ke saath | ✅ har page par | routes |
| 14 | **Meta keywords tag — Google 2009 se use karta hi nahi** | ✅ **daala hi nahi**; keywords naturally title/description/H1/URL me | — |
| 15 | Structured data **JSON-LD** format me (Google ka recommended) | ✅ **naya** — neeche §2 dekho | layout + routes |
| 16 | Structured data = page par **sach me dikhane wala content** | ✅ rating tabhi jab page pe ho; invisible markup nahi | `localBusinessJsonLd()` |
| 17 | `<html lang>` + viewport (mobile-first indexing) | ✅ `lang="en-IN"` | `views/layout.js` |
| 18 | Open Graph complete | ✅ **naya** — `og:url`, `og:site_name`, `og:locale` + `twitter:card` | `views/layout.js` |
| 19 | Search Console verification meta tag | ✅ **naya** — `GOOGLE_SITE_VERIFICATION` env se | `config.js` |
| 20 | robots.txt sitemap advertise kare | ✅ `Sitemap:` line | `robotsText()` |

---

## 2. Structured data (JSON-LD) — naya add kiya

Google JSON-LD ko hi recommended format maanta hai. Ab har page par:

| Page | Schema | Kya-kya |
|---|---|---|
| Home `/` | **WebSite** + **Organization** | WebSite me `SearchAction` (sitelinks search box ke liye) — `/search?q={search_term_string}` |
| Provider `/providers/:slug` | **LocalBusiness** + **BreadcrumbList** | name, telephone (`+91…`), PostalAddress (locality, region, PIN, IN), areaServed PINs, url; **aggregateRating sirf tab jab page pe rating dikh rahi ho** |
| Service `/services/:slug` | **Service** + **BreadcrumbList** | name, serviceType (category), provider ref, areaServed, offers (₹ price range) |

Important: JSON-LD `<script type="application/ld+json">` block **executable script nahi**
hai — browser use run nahi karta, Google raw HTML se parse karta hai. Isliye strict
CSP (`script-src 'self'`) ke saath bhi ye bilkul safe hai.

---

## 3. Aapko manually karna hai (Google Search Console)

Ek baar site deploy hone ke baad:

1. **https://search.google.com/search-console** kholo (wahi account jisse PJS verified hai).
2. **Add property** → `https://seva-market-india-tast.onrender.com`
   (agar Render ne URL ka suffix badla ho to Render dashboard ka exact URL lo).
3. Verification method: **HTML tag** choose karo. Google ek token dega jaise
   `content="google-site-verification: AbCdEf…"`.
4. Wo token Render me daalo:
   - Render dashboard → seva-market-india service → **Environment**
   - Key: `GOOGLE_SITE_VERIFICATION` — Value: Google ka **pura token** (jaisa Google ne diya)
   - **Save & Deploy** (auto-redeploy ho jayega)
5. Wapas Search Console me **Verify** dabao.
6. **Sitemaps** → `sitemap.xml` submit karo (poora path aise hi milega:
   `https://seva-market-india-tast.onrender.com/sitemap.xml`).
7. **URL Inspection** → `https://seva-market-india-tast.onrender.com/` → **Request Indexing**.
   Bas — Google khud sitemap se saare category/state/service/provider pages dhoondh lega.

### Deploy se pehle (Render env vars — checklist)

| Variable | Value | Kyun |
|---|---|---|
| `SITE_URL` | `https://seva-market-india-tast.onrender.com` (trailing `/` nahi) | canonical, sitemap, JSON-LD URLs isi se bante hain |
| `GOOGLE_SITE_VERIFICATION` | Search Console ka token | verification meta tag |
| `NODE_ENV` | `production` | production mode |
| `SEVA_STORAGE` / `SUPABASE_*` | pehle se set hain | data durability (DEPLOY.md dekho) |

---

## 4. Kya jaan-boojh kar NAHI kiya

- **Meta keywords tag nahi daala.** Google ne September 2009 me officially announce
  kiya tha ki wo keywords meta tag ko ranking me use karta hi nahi (spam ki wajah se).
  Keywords asli jagah hain: **title, meta description, H1, URL slugs, page content** —
  wahan naturally place hain (`plumber`, `electrician`, `PIN code`, city names…).
- **Sitemap me har search combination nahi daala.** Arbitrary `?q=…&pin=…` pages
  Google ke liye duplicate/low-value hote hain — sirf curated category/state
  landing pages + listing pages hain, aur free-text search results `noindex,follow`
  hain (canonical `/search` par). Yahi Google ka guidance hai.
- **Fake `lastmod` nahi likha.** Sirf wahi date jo database me hai.
