# Google Indexing — PANIKA JEEVAN SATHI

Google Search Central ke official rules padh kar site par apply kiye gaye hain.
Search Console account: **sukulpanika939@gmail.com**
Live URL: **https://panikajeevansathi.onrender.com**

Verify: `node scripts/health-check.mjs` → **118 passed, 0 failed**

---

## 1. Google ke rules aur unka status

| # | Google ka rule (source) | Status | Kahan |
|---|---|---|---|
| 1 | robots.txt site ke **root** par ho, UTF-8 plain text | ✅ | `/robots.txt` (server generate karta hai) |
| 2 | Sirf `user-agent` / `allow` / `disallow` / `sitemap` supported hain. `Host:`, `Crawl-delay:` Google **ignore** karta hai | ✅ **fix kiya** — `Host:` line hata di | `server.js` |
| 3 | **Jis page ko `Disallow` karoge, Google uska `noindex` padh hi nahi payega** → page phir bhi URL-form mein index ho sakta hai | ✅ **bada fix** — 13 member pages ab crawlable hain, `noindex` par bharosa | neeche §2 |
| 4 | Non-HTML files (photos) meta tag nahi le sakte → `X-Robots-Tag` header use karo | ✅ **naya** — `/uploads/` par `X-Robots-Tag: noindex, noimageindex, nofollow` | `server.js` |
| 5 | Sitemap mein **absolute URL** ho, relative nahi | ✅ | `<loc>https://…</loc>` |
| 6 | Google `<changefreq>` aur `<priority>` **ignore** karta hai | ✅ **hata diye** — sirf `<loc>` + `<lastmod>` | `server.js` |
| 7 | `<lastmod>` tabhi use hota hai jab wo **sach me verify ho** | ✅ asli file mtime se, banaayi hui date nahi | `siteLastMod()` |
| 8 | XML tag values **entity-escaped** hone chahiye | ✅ `xmlEscape()` | `server.js` |
| 9 | Sitemap limit: 50MB / 50,000 URL | ✅ sirf 6 URL |
| 10 | Sitemap mein **canonical URL hi** daalo | ✅ 6 public URL, sab canonical |
| 11 | Canonical **absolute** ho, `<head>` ke andar ho | ✅ har public page par |
| 12 | Duplicate URL consolidate karo | ✅ **naya** — `/index.html` → `301` → `/`, aur saare internal links bhi `/` par |
| 13 | Private content ke liye `noindex` (robots.txt nahi) | ✅ 13 pages par `noindex,nofollow` |
| 14 | Har page par unique `<title>` + meta description | ✅ 6/6 |
| 15 | `<html lang>` + viewport (mobile-first indexing) | ✅ 6/6 |
| 16 | Structured data (JSON-LD) | ✅ Organization + WebSite home par, page schema baaki par |
| 17 | robots.txt sitemap advertise kare | ✅ `Sitemap:` line |

---

## 2. Sabse important fix — samjhiye

**Pehle (galat):**
```
Disallow: /dashboard.html      ← Google page kholega hi nahi
```
`dashboard.html` ke andar `noindex` likha tha, par Google use **padh hi nahi sakta tha**
kyunki fetch karna hi mana tha. Google ka apna doc kehta hai — aisi URL Search me
"Indexed, though blocked by robots.txt" ke roop me **aa jaati hai**.

**Ab (sahi):**
```
User-agent: *
Allow: /
Disallow: /api/
Disallow: /uploads/
```
Member pages crawlable hain → Google unka `<meta name="robots" content="noindex,nofollow">`
padhta hai → page Search se **poori tarah** bahar. Yehi Google ka recommended tareeka hai.

**Chinta mat karein:** crawlable ≠ public. Login ke bina data API se hi nahi milta,
aur `/api/` + `/uploads/` (member photos) dono blocked + `X-Robots-Tag: noindex` hain.

---

## 3. Aapko manually karna hai (Search Console — sukulpanika939@gmail.com)

1. https://search.google.com/search-console → is email se login
2. **Add property** → **URL prefix** → `https://panikajeevansathi.onrender.com`
3. Verification: **HTML tag** chunein. Google dega:
   `<meta name="google-site-verification" content="XXXXXXXX">`
   → **ye line mujhe bhej dein**, main `public/index.html` ke `<head>` me daal dunga.
4. Deploy hone ke baad Search Console me **Verify** dabayein.
5. **Sitemaps** → `sitemap.xml` type karein → **Submit** → "Success" dikhna chahiye
6. **URL Inspection** → `https://panikajeevansathi.onrender.com/` → **Request Indexing**
   (`/about.html`, `/contact.html`, `/login.html` ke liye bhi — roz 10 ki limit)

> ⚠️ **Render par ye env var zaroor set karein:**
> `SITE_URL=https://panikajeevansathi.onrender.com`
> Warna robots.txt aur sitemap.xml galat host print karenge aur Search Console
> "Sitemap could not be read" ya wrong-domain error dega.

---

## 4. Search Console me kya dekhna hai

| Report | Kya theek hai |
|---|---|
| **Sitemaps** | Status "Success", Discovered URLs = **6** |
| **Pages → Indexed** | Dheere-dheere 6 tak jaana chahiye |
| **Pages → Not indexed** | "Excluded by noindex tag" me member pages dikhenge — **ye sahi hai**, ghabrayen nahi |
| **Page indexing** | "Indexed, though blocked by robots.txt" **nahi** aana chahiye (yehi to fix kiya) |
| **Mobile Usability / Core Web Vitals** | Pages static + light hain, theek rahega |
| **Manual actions** | Khali hona chahiye |

**Timeline:** robots+sitemap read 1–3 din · home index 3–10 din · baaki pages 1–4 hafte.
Naya domain hai, sabr rakhein. Roz Request Indexing dabane se speed nahi badhti.

---

## 5. Index tez karne ke halal tareeke

1. **Asli backlinks** — community Facebook page/group, WhatsApp status, local news blog. 5–10 kaafi.
2. **Google Business Profile** banayein (agar office/pata hai).
3. **Content** — About page par community, service area (Chhattisgarh, MP, Assam), natural bhasha.
4. **Site sote na rahe** — Render free plan sleep karta hai. Repo ka `keep-alive` workflow chalu rakhein,
   warna Googlebot ko timeout milega aur crawl rate gir jaayega.

**Kya NAHI karna:** paid/spam backlink, link farm, member profiles ko index karana,
roz sitemap resubmit karna.

---

## 6. Khud check karne ke commands

```bash
node scripts/health-check.mjs            # 118 SEO/indexing checks

# live
curl -s https://panikajeevansathi.onrender.com/robots.txt
curl -s https://panikajeevansathi.onrender.com/sitemap.xml
curl -sI https://panikajeevansathi.onrender.com/index.html | head -3   # 301 -> /
curl -s https://panikajeevansathi.onrender.com/ | grep canonical
```

Google me: `site:panikajeevansathi.onrender.com`
Rich results test: https://search.google.com/test/rich-results
