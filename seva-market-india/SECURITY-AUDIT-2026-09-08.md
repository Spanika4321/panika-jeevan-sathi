# SEVA MARKET INDIA — Security Audit Report

**Date:** 2026-09-08
**Scope:** `seva-market-india/` (marketplace web app: accounts, provider listings, services, enquiry leads, business photos, Supabase + SQLite storage)
**Method:** Full manual source audit (all routes, models, stores, session/auth, HTTP layer, views, client JS, migrations, Supabase schema, deploy config) + automated test suite + targeted exploit-style probes against a local sandbox instance.
**Result:** 🔴 **Koi critical/code execution/data-loss vulnerability nahi mila.** Code quality security-wise kaafi acchi hai. Total 2 code-level gaps mile — **dono fix kar diye hain** — aur kuch hardening/product-level recommendations neeche hain.

---

## 1. Jo pehle se sahi hai (verified)

| Area | Status |
|---|---|
| **SQL Injection** | ✅ Sab queries parameterized; sirf whitelisted column constants/sets interpolate hote hain; LIKE ke liye `ESCAPE '\'` + escaping; PostgREST filters URL-encoded + op-whitelist (`eq/gt/gte/lt/lte/ne/like/in`) |
| **XSS (stored/reflected/DOM)** | ✅ Har dynamic output `esc()` gate se pass (text + attributes + URL params + error messages). Client JS (`main.js`) sirf `textContent` use karta hai — koi `innerHTML` sink nahi. Strict CSP inline handlers rokta hai |
| **CSRF** | ✅ Har state-changing route pe `assertSameOrigin` (Origin check). Cookies `HttpOnly` + `SameSite=Lax`, prod mein `Secure` |
| **Sessions** | ✅ Stateless HMAC-SHA256-signed cookies, `timingSafeEqual` verify, 30-day expiry, role/status har request pe store se re-read hota hai (cookie sirf display claim hai, authority nahi) |
| **Passwords** | ✅ scrypt (N=16384, per-user 16-byte salt), constant-time compare, min 8 chars; `password_hash` kabhi API/HTML response mein nahi jaata (`publicUser`/`publicLead` strip karte hain) |
| **Auth brute-force** | ✅ Login: 8 fails → 15-min IP block; enquiry: 5/hr/IP |
| **Authorization (IDOR)** | ✅ Provider profile/services/leads — sab `ownedProvider(user)` + `provider_id` checks; leads sirf owner ko dikhte hain. Tests bhi cover karte hain ("a provider cannot manage another provider's services") |
| **File uploads** | ✅ Magic-byte validation (jpg/png/webp), server-side random filenames, per-file 2 MB + total 11 MB + 5-photo caps, multipart parser bounded; serve content-type extension se, filenames kabhi user-controlled nahi |
| **Path traversal** | ✅ Static files: `path.normalize` + prefix check; router params segment-encoded; `/../`, `/.git`, `/data/` sab 404 |
| **Open redirect** | ✅ `safePath`/`safeBackPath` sirf same-site paths allow karte hain |
| **Headers** | ✅ CSP (`script-src 'self'`, no inline), `X-Content-Type-Options`, `X-Frame-Options` + `frame-ancestors 'none'`, `Referrer-Policy`, `COOP same-origin`, `Permissions-Policy`; JSON pe `no-store` |
| **Error handling** | ✅ 500s internal details leak nahi karte (random reference id); unhandled errors logged server-side |
| **Secrets hygiene** | ✅ Koi API key/password committed nahi (repo-wide scan). Credentials sirf env se; anon key / plaintext-http Supabase URL pe boot-time guard fail-closed; storage guard ephemeral-disk data loss rokta hai |
| **Schema** | ✅ CHECK constraints, FKs, unique indexes (email unique on `lower(email)`), RLS enabled on Supabase tables |
| **Privacy by design** | ✅ Enquiry IPs hash hoke store hote hain (raw nahi), robots.txt/sitemap accounts-API expose nahi karte, search-noise pages `noindex` |
| **Test suite** | ✅ 215 tests (211 pass, 0 fail; 4 skip = real-Postgres tests) — XFF spoofing, traversal, CSP, cross-origin POSTs, rate limits, ownership sab covered |

---

## 2. Findings — FIXED (aaj isi session mein)

### 🔸 F-1 (Medium) — Public JSON API provider data leak: `email`, `address_line`, `contact_name`
**Kya tha:** `GET /api/v1/providers` aur `GET /api/v1/providers/:slug` bina kisi mapping ke **poori provider row** return kar rahe the — including `email`, `address_line` (street address jise edit form **"shown only to you"** bolta hai) aur `contact_name`. HTML pages ye fields deliberately hide karte hain; API unauthenticated public expose kar raha tha. (Seed data mein null the, lekin real providers bharne ke baad ye kabhi-kabhi publically available ho jaata.) Empirically sandbox mein confirm kiya.
**Fix:** `publicProvider()` gate add kiya — teeno private fields JSON API se hata diye; phone/alt_phone (by-design public), photos, about, coverage sab intact.
**Files:** `src/routes/api/providers.js`, `tests/http.test.mjs` (regression test: private fields DB mein set karke assert kiye gaye ki API pe kabhi nahi aate).

### 🔸 F-2 (Medium) — API enquiry throttle/ip_hash proxy-aware nahi tha
**Kya tha:** `POST /api/v1/leads` rate-limit aur stored `ip_hash` `req.socket.remoteAddress` use kar raha tha — jabki HTML `/contact` form `ctx.ip` (proxy-aware, `TRUST_PROXY_HOPS=1`) use karta hai. Render pe iska matlab: **sab API callers ek hi edge-IP ki tarah dikhte** → (a) ek visitor ka 5-enquiry burst poore API ko 1 ghante ke liye block kar sakta hai, (b) DB mein store hone wala ip_hash har user ke liye same → audit value khatam.
**Fix:** Route ab `ctx.ip` use karta hai — throttle aur stored hash dono ab per-client-IP hain.
**Files:** `src/routes/api/providers.js`, `tests/helpers.mjs` (trustProxyHops config), `tests/http.test.mjs` (regression: 2 clients behind same edge alag-alag count hote hain, alag hashes store hote hain).

---

## 3. Findings — Recommendation (code abhi bhi safe, product/hardening level)

### 🟠 R-1 (Medium — sabse important remaining) — Provider verification nahi; enquiry PII harvest possible
Registration pe na email verify, na phone OTP — account turant active aur provider profile bina review ke **live** (`status: 'active'`) ho jaata hai. Marketplace ka core flow customer → provider enquiry hai jisme **name, phone, email, message** jaata hai. Koi bhi attacker 1 minute mein fake provider account bana ke public listing khol sakta hai aur real customers ka PII collect kar sakta hai. **Recommendation:** provider signup pe phone/email OTP verify; naye providers ke liye manual/moderation approval ya "unverified" state (badge ke alawa listing se pehle check); naye provider ke liye daily lead cap + spam flagging. (Email verification milestone mein aana likha hai — live site pe isko priority dena.)

### 🟡 R-2 (Low) — Register endpoint pe koi rate-limit/bot protection nahi
Enquiry (5/hr/IP) aur login (8/15min) throttled hain, `/register` nahi. Supabase free tier pe unlimited account creation = storage/quota abuse + spam providers (R-1 ke saath milke). **Fix:** per-IP+per-email signup cap, honeypot field ya basic proof-of-work.

### 🟡 R-3 (Low) — `/api/v1/health/deep` internal details batata hai
Driver, durability, **SQLite file path**, table list, storage error messages — bina auth ke. Public health endpoint ho sakta hai, lekin path/raw errors hatao (sirf `ok/degraded` + status). `/api/v1/health` pe bhi `env` na dikhao.

### 🟡 R-4 (Low) — HSTS missing
Responses mein `Strict-Transport-Security` nahi. Render TLS terminate karta hai (aur http→https redirect), isliye practical risk kam — lekin header add kar dena free hardening hai. Sath mein `Cross-Origin-Resource-Policy: same-origin` bhi.

### 🟢 R-5 (Info) — Login throttle in-memory hai
Map per-process hai: restart pe reset, ek se zyada instance pe shared nahi. Free single-instance pe chalega; scale karte waqt shared store (ya DB-backed) chahiye. Map unbounded grow hota hai (unique IPs) — ek `maxEntries` cap + periodic cleanup add karo.

### 🟢 R-6 (Info) — Chhoti robustness baatein
- Malformed cookie (bad `%`-encoding) → `decodeURIComponent` throw → us request pe 500 (crash nahi, sirf cosmetic). 400/ignore better.
- `/register` pe "An account with this email already exists" — email enumeration mild (login already generic message use karta hai — achha). Agar strict chahiye to generic message.
- Sessions 30-day stateless — logout client-side only (code mein documented tradeoff). Suspension login + protected pages dono pe turant enforce hota hai ✅.
- `SESSION_SECRET` missing ho to production boot random secret generate karta hai (har restart pe logout — safe but annoying, warning deta hai); blueprint mein `generateValue: true` set hai ✅. IP-hash salt ka fallback public constant `'seva-market'` hai agar secret set hi na ho — DB-leak scenario mein IPs brute-force ho sakte hain (low risk; env set karke close ho jaata hai).

---

## 4. Scope notes / jo check nahi hua
- **Live site (`seva-market-india-tast.onrender.com`) sandbox se reachable nahi tha** (network egress block) — isliye live probe nahi ho paya. Deploy config (`render.yaml`, `DEPLOY.md`, root blueprint sync test) review kar liya hai: `SEVA_REQUIRE_REMOTE=1`, `TRUST_PROXY_HOPS=1`, `SESSION_SECRET` generated, anon-key guard — production setup theek hai.
- 4 skipped tests real Supabase Postgres maangte hain — storage backend prod-equivalent mein unhe chala lena (existing `npm run test:storage`/deploy workflows mein).
- Dependency supply-chain: zero npm dependencies (built-ins only) — attack surface minimal ✅.

## 5. Verdict
Codebase intentionally security-hardened hai — headers, escaping, parameterization, origin checks, storage guards har jagah consistently applied hain aur tests enforce karte hain. Dono code-level gaps (API data leak + proxy-aware throttling) **aaj fix + regression-test ho chuke hain**. Aage ki priority: **R-1 (provider verification)** jab bhi verification milestone aaye — live customer-PII isi par depend karti hai.

*Files changed this session:* `src/routes/api/providers.js`, `tests/http.test.mjs`, `tests/helpers.mjs` — suite: 215 tests, 211 pass, 0 fail.
