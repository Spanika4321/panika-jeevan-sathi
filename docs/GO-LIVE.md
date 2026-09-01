# PANIKA JEEVAN SATHI — R2 के बिना 3–4 महीने का storage plan

> **फैसला:** अभी R2 bucket की जरूरत नहीं है। जो Cloudflare **D1 database**
> members के लिए है, वही compressed profile photos भी रखेगा। Code, backup,
> restore और alarm इसी mode के लिए तैयार हैं। बाद में R2 जोड़ना optional है।

## अभी क्या कहाँ रहेगा

| Data | Storage | Restart / deploy के बाद |
|---|---|---|
| Members, profiles, messages, settings | Cloudflare D1 | सुरक्षित |
| Profile photos (हर photo अधिकतम 512 KB) | उसी D1 का `photo_blobs` table | सुरक्षित |
| रोज़ का encrypted snapshot | GitHub Actions artifact | newest 3 (हर copy max 90 दिन) |
| Local Render folder | सिर्फ disposable cache | मिटे तो D1 से वापस बनता है |

Browser upload से पहले photo को 640 px / JPEG quality 0.78 पर छोटा करता है। D1
का 500 MB free database 3–4 महीने की शुरुआती usage संभालने के लिए पर्याप्त है,
लेकिन यह permanent object-storage replacement नहीं है। `persistence-watch` D1
photos 120 MB पर पहुँचते ही GitHub issue खोल देगा, ताकि समय रहते R2 या दूसरा
photo store जोड़ा जा सके।

---

## सिर्फ एक बार: Render में 3 D1 values

अगर `/api/health` में पहले से `"storage":"d1"` आता है तो यह step पूरा है।
वरना:

1. Cloudflare dashboard → **Storage & Databases → D1 SQL Database**
2. अपना existing database खोलें (या `panika-jeevan-sathi` बनाएँ)
3. Cloudflare profile → **API Tokens → Create Custom Token**
   - Permission: **Account → D1 → Edit**
4. Render → service `panikajeevansathi` → **Environment** में ये तीन values:

| Key | Value |
|---|---|
| `CF_ACCOUNT_ID` | Cloudflare Account ID |
| `CF_D1_DATABASE_ID` | D1 Database ID |
| `CF_D1_API_TOKEN` | D1 Edit token |

`PJS_STORAGE=auto` पहले से `render.yaml` में है। **कोई `R2_*` variable नहीं
चाहिए।** Save करते ही Render redeploy करेगा।

### सही result

खोलें:

```text
https://panikajeevansathi.onrender.com/api/health
```

इसमें यह होना चाहिए:

```json
{
  "storage": "d1",
  "photos": "d1+cache",
  "remote": {
    "photos": {
      "backend": "d1",
      "remote": true
    }
  }
}
```

पुराना `"storage":"sqlite"` या `"photos":"local"` दिखे तो Render ने तीन
D1 values नहीं लीं। Public registrations उस हालत में सुरक्षित नहीं हैं।

---

## रोज़ का backup: R2 के बिना

GitHub repository → **Settings → Secrets and variables → Actions** में वही तीन
secrets डालें:

- `CF_ACCOUNT_ID`
- `CF_D1_DATABASE_ID`
- `CF_D1_API_TOKEN`

Recommended चौथा secret:

- `BACKUP_KEY` — लंबा password; इसे offline लिखकर रखें।

अगर `BACKUP_KEY` अभी नहीं डालते, workflow अपने आप `CF_D1_API_TOKEN` को encryption
key की तरह इस्तेमाल करेगा। उस हालत में token बदलने से पहले पुराना token संभालकर
रखें, वरना पुराने backup नहीं खुलेंगे। Plaintext member data artifact में कभी
नहीं जाएगा।

हर रात **Database backup** workflow:

1. सभी D1 tables पढ़ता है — `photo_blobs` सहित;
2. AES-256-GCM से snapshot encrypt करता है;
3. `pjs-db-backup` GitHub artifact बनाता है;
4. newest 3 daily snapshots रखकर पुराने artifacts delete करता है, ताकि D1
   photos GitHub का free storage quota न भरें (हर बची copy max 90 दिन);
5. local mock पर backup + wipe + restore test भी चलाता है।

Service 3–4 महीने लगातार चल सकती है और हमेशा पिछली तीन healthy daily copies
रहेंगी। इसका मतलब तीन दिन की recovery history है, 90 दिन की पूरी history नहीं।

---

## Phone से restore (R2 नहीं चाहिए)

अगर कभी data वापस लाना हो:

1. GitHub → **Actions**
2. **Database restore**
3. **Run workflow**
4. confirmation में exactly `RESTORE`
5. **Run workflow**

Workflow retained `pjs-db-backup` artifacts में सबसे बड़ा healthy snapshot चुनता
है, पहले dry-run plan दिखाता है, फिर D1 में `INSERT OR REPLACE` करता है। Existing
नई rows delete नहीं होतीं और दो बार restore करने से duplicate member नहीं बनता।
किसी exact backup को चुनना हो तो Actions artifact page का ID optional field में
डाल सकते हैं।

Command line से downloaded artifact भी restore हो सकता है:

```bash
# पहले plan; कोई बदलाव नहीं
node scripts/db-restore.mjs --file backups/pjs-backup-....json.enc

# फिर actual restore
node scripts/db-restore.mjs --file backups/pjs-backup-....json.enc --yes
```

Environment में तीन `CF_*` और उसी snapshot की `BACKUP_KEY` चाहिए।

---

## Automatic guard

`Persistence watch` हर 6 घंटे जाँचता है:

- website reachable है;
- member database D1 पर है;
- photos D1 bridge या R2 पर durable हैं;
- D1 write queue अटकी नहीं है;
- member count पिछली reading से कम नहीं हुआ;
- D1 photos 120 MB safety line के नीचे हैं।

Problem पर GitHub में `persistence-alert` issue अपने आप खुलेगा और ठीक होने पर
अपने आप बंद होगा। R2 न होने पर alarm **red नहीं होगा**, क्योंकि D1 photo bridge
अब supported temporary mode है।

---

## Public करने से पहले चार checks

- [ ] `/api/health` → `"storage":"d1"`
- [ ] `/api/health` → `"photos":"d1+cache"` और `"backend":"d1"`
- [ ] Test account + photo बनाकर Render **Manual Deploy** के बाद login/photo फिर दिखे
- [ ] GitHub **Database backup** workflow एक बार manually green हो

बस। अगले 3–4 महीने R2 के बिना यही supported setup है।
