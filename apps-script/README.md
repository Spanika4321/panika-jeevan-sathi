# Google Apps Script → Google Sheet connector

Jab koi naya member PANIKA JEEVAN SATHI par register karta hai, uski row
automatically ek Google Sheet mein chali jaati hai.

**Direction:** sirf push (website → Sheet). Apps Script kabhi site ka data
padhta nahi, aur Sheet se site par kuch wapas nahi aata.

**Agar setup nahi kiya:** site bilkul normal chalti hai. Kuch bhi bheja nahi
jaata, koi error nahi. Ye feature poori tarah optional hai.

---

## Setup — 5 minute

### 1. Sheet banao

[sheets.new](https://sheets.new) → naam do, jaise `PJS Registrations`.

URL se **Sheet ID** copy karo:

```
https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit
                                      └────────── ye ID hai ──────────┘
```

### 2. Apps Script mein code paste karo

Sheet ke andar: **Extensions → Apps Script**.
Jo sample code hai use delete karo, aur is repo ki `apps-script/Code.gs`
file ka poora content paste kar do. Save (Ctrl+S).

### 3. Secret generate karo

Apne server/Termux par:

```bash
npm run gsheet:secret
```

Ye ek lamba random string dega. **Ise kahin chat/commit mein mat daalna.**

### 4. Script Properties set karo

Apps Script mein: **⚙ Project Settings → Script Properties → Add script property**

| Property        | Value                                     |
| --------------- | ----------------------------------------- |
| `SHARED_SECRET` | step 3 wala string                        |
| `SHEET_ID`      | step 1 wali ID (bound script ho to optional) |

### 5. Web App deploy karo

**Deploy → New deployment → ⚙ → Web app**

| Field           | Value                    |
| --------------- | ------------------------ |
| Execute as      | **Me**                   |
| Who has access  | **Anyone**               |

Pehli baar Google permission maangega → **Authorize** → apna account chuno →
"Advanced" → "Go to (project)" → **Allow**.

> **"Anyone" se darna mat.** URL public zaroor hai, par har request par
> HMAC-SHA256 signature check hota hai. Bina sahi `SHARED_SECRET` ke koi bhi
> Sheet mein ek row tak nahi likh sakta.

Deploy hone par **Web app URL** copy karo — ye `/exec` par khatam hona chahiye:

```
https://script.google.com/macros/s/AKfycb.../exec
```

`/dev` wala URL **kaam nahi karega**.

### 6. Server par env vars set karo

```bash
export GAS_WEBAPP_URL="https://script.google.com/macros/s/AKfycb.../exec"
export GAS_SHARED_SECRET="step-3-wala-secret"
```

Render / Railway par ye dono **Environment Variables** mein daalo — kabhi git
mein commit mat karna (`.env*` pehle se `.gitignore` mein hai).

### 7. Verify karo

```bash
npm run gsheet:status   # config theek hai ya nahi
npm run gsheet:ping     # asli signed request bhejta hai
```

`OK - Apps Script accepted the signed request.` aane par connection live hai.
Ab ek test registration karo — row Sheet mein aa jaani chahiye.

---

## Environment variables

| Variable            | Zaroori | Matlab                                              |
| ------------------- | ------- | --------------------------------------------------- |
| `GAS_WEBAPP_URL`    | haan    | Web App ka `/exec` URL                              |
| `GAS_SHARED_SECRET` | haan    | `SHARED_SECRET` script property se exactly same      |
| `GAS_TIMEOUT_MS`    | nahi    | request timeout, default `8000`                      |
| `GAS_DISABLED`      | nahi    | `1` set karo to connector band, URL rehne par bhi   |

## Commands

```bash
npm run gsheet:status   # config + kitni rows queue mein pending hain
npm run gsheet:secret   # naya strong secret banao
npm run gsheet:ping     # connection test
npm run gsheet:flush    # outage ke baad pending rows dobara bhejo
npm run test:gsheet     # 25 offline tests (Google account ki zaroorat nahi)
```

---

## Sheet mein kya jaata hai

`Registrations` sheet apne aap ban jaati hai, in columns ke saath:

Received At · Registered At · User ID · Name · Email · Gender · Looking For ·
City · State · Community · Religion · Phone · Email Verified · Role · Status

**Jo kabhi nahi jaata:** password, password hash, session cookie, verification
token, reset token, photos. Bhejne wale fields `lib/gsheet.js` ke `buildRow()`
mein hard-coded whitelist hain — usme jo nahi likha, wo server se bahar nahi
ja sakta.

## Reliability

- **Fire-and-forget.** Registration Sheet ka intezaar nahi karti. Google down
  ho to bhi signup normal speed se complete hota hai.
- **Kuch kho'ta nahi.** Failed push `data/gsheet-queue.jsonl` mein likha jaata
  hai aur agli successful push par apne aap chala jaata hai (ya
  `npm run gsheet:flush` se manually).
- **Queue bounded hai** — max 500 rows, taki lambi outage disk na bhare.
- **Zero dependencies.** Sirf built-in Node `fetch` aur `crypto`.

## Troubleshooting

| Error                    | Wajah                                                       |
| ------------------------ | ----------------------------------------------------------- |
| `bad signature`          | `SHARED_SECRET` aur `GAS_SHARED_SECRET` match nahi kar rahe   |
| `non-JSON response`      | Deployment access "Anyone" par set nahi hai                  |
| `HTTP 404`               | Galat URL, ya `/exec` ki jagah `/dev` copy kar liya          |
| `timeout`                | Google slow — row queue ho gayi, `gsheet:flush` se bhej do   |
| `SHARED_SECRET ... not set` | Script property Apps Script mein add nahi hui              |

> Code.gs badalne ke baad **naya deployment** banana zaroori hai
> (Deploy → Manage deployments → ✏️ → Version: New version), warna purana
> version hi chalta rehta hai.
