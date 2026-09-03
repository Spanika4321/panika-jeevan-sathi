# Google Indexing — PANIKA JEEVAN SATHI

Site ko Google me index karane ka poora, seedha tareeka. (Koi AI / Gemini
involve nahi hai — sab kuch manual + server ka apna robots/sitemap hai.)

Live URL: **https://panikajeevansathi.onrender.com**

---

## 1. Code me kya ready hai

| Cheez | Status |
|---|---|
| `robots.txt` (auto, `/robots.txt`) | ✅ public pages allow, member pages + `/api/` + `/uploads/` block, Googlebot ke liye alag block, `Sitemap:` line |
| `sitemap.xml` (auto, `/sitemap.xml`) | ✅ 6 public URLs, `<lastmod>` (real file date), `<changefreq>`, `<priority>` |
| Canonical URL har public page par | ✅ |
| `robots` meta: `index,follow,max-snippet:-1,max-image-preview:large` | ✅ |
| Open Graph + Twitter card | ✅ |
| Structured data (Organization + WebSite JSON-LD on home, page schema elsewhere) | ✅ |
| Private pages `noindex` | ✅ (13 pages) |

> **Zaroori:** production par env var `SITE_URL=https://panikajeevansathi.onrender.com`
> set hona chahiye, warna robots/sitemap galat host print karenge.
> (GitHub Actions me already set hai.)

---

## 2. Google Search Console setup (ek baar, ~10 min)

1. https://search.google.com/search-console kholein → **Add property** →
   **URL prefix** → `https://panikajeevansathi.onrender.com`
2. Verification method: **HTML tag** chunein. Google ek tag dega:
   `<meta name="google-site-verification" content="XXXX">`
3. Wo line `public/index.html` ke `<head>` me paste karein (canonical line ke
   neeche), commit + deploy karein, phir Search Console me **Verify** dabayein.
4. Verify hone ke baad: **Sitemaps** → `sitemap.xml` daalein → **Submit**.
5. **URL Inspection** me `https://panikajeevansathi.onrender.com/` daalein →
   **Request Indexing**. Yehi `/about.html`, `/contact.html`, `/login.html`
   ke liye bhi karein (roz 10 request ki limit hai).

Bing/Yahoo ke liye same cheez: https://www.bing.com/webmasters

---

## 3. Kitna time lagega

- robots + sitemap read: 1–3 din
- home page index: 3–10 din
- baaki pages: 1–4 hafte

Naya domain hai to sabr zaroori. Roz-roz "Request Indexing" dabane se
speed nahi badhti.

---

## 4. Index tez karne ke asli tareeke (ye spam nahi hain)

1. **Sachche backlinks** — community Facebook page/group, WhatsApp status,
   local news, blogspot post. 5–10 asli link kaafi hain.
2. **Business listing** — Google Business Profile (agar office/pata hai).
3. **Content** — About page par community, service area (Chhattisgarh/MP/
   Assam etc.), aur "free matrimonial" keywords natural bhasha me.
4. **Site sote na rahe** — Render free plan sleep karta hai. Repo me
   `keep-alive` workflow hai; usko chalu rakhein taaki Googlebot ko site
   hamesha 200 mile, timeout nahi.
5. **Speed** — pages already static + light hain, ye theek hai.

## 5. Kya NAHI karna

- Paid/spam backlink, link farm — Google penalty.
- Member profile pages ko index karana — privacy risk, isliye `noindex` hai.
- Har din sitemap resubmit karna — koi fayda nahi.

---

## 6. Check karne ke commands

```bash
# local
node server.js
curl -s localhost:3000/robots.txt
curl -s localhost:3000/sitemap.xml
node scripts/health-check.mjs     # 95 SEO/health checks

# live
curl -s https://panikajeevansathi.onrender.com/robots.txt
curl -s https://panikajeevansathi.onrender.com/sitemap.xml
```

Google me dekhne ke liye: `site:panikajeevansathi.onrender.com` search karein.
