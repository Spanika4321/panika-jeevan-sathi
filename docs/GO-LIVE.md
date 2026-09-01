# PANIKA JEEVAN SATHI — कल website public करने से पहले (10 मिनट)

> **अभी की स्थिति:** website चल रही है, लेकिन उसका डेटा Render की **मिटने वाली disk**
> पर है। इसका मतलब — हर बार जब site 15 मिनट खाली रहती है और सो जाती है, या नया
> deploy होता है, **सारे members, profiles, messages और photos मिट जाते हैं।**
>
> **अच्छी खबर:** इसका पूरा code पहले से लिखा और tested है। सिर्फ **7 environment
> variables** भरने हैं। एक भी line code बदलने की जरूरत नहीं।
>
> नीचे के 3 step करने के बाद डेटा कभी नहीं मिटेगा।

---

## Step 1 — Cloudflare account (5 मिनट, मुफ़्त, कोई card नहीं)

1. https://dash.cloudflare.com/sign-up पर account बनाइए (email + password बस)।
2. Email verify कीजिए।

### 1a. D1 database (members का घर)

3. बाएँ menu में **Storage & Databases → D1 SQL Database → Create database**
4. नाम: `panika-jeevan-sathi` → **Create**
5. खुलने के बाद page पर दो चीज़ें दिखेंगी — दोनों copy करके कहीं लिख लीजिए:
   - **Database ID** → यह `CF_D1_DATABASE_ID` है
   - ऊपर दाएँ / URL में **Account ID** → यह `CF_ACCOUNT_ID` है

### 1b. R2 bucket (photos का घर)

6. बाएँ menu में **R2 Object Storage → Create bucket**
7. नाम: `panika-photos` → **Create bucket**
   (R2 पहली बार card माँग सकता है — free tier 10 GB है, पैसा नहीं कटेगा।
   अगर card नहीं देना चाहते तो R2 छोड़ दीजिए: database तो सुरक्षित हो ही
   जाएगा, सिर्फ photos restart पर जाएँगी। बाद में कभी जोड़ सकते हैं।)
8. **R2 → Manage API Tokens → Create API Token**
   - Permission: **Object Read & Write**
   - इस bucket के लिए → **Create**
   - अब दिखेंगे: **Access Key ID** (= `R2_ACCESS_KEY_ID`) और
     **Secret Access Key** (= `R2_SECRET_ACCESS_KEY`)
   - ⚠️ Secret सिर्फ **एक बार** दिखता है — तुरंत copy कीजिए।

### 1c. D1 API token

9. ऊपर दाएँ profile icon → **My Profile → API Tokens → Create Token**
10. **Create Custom Token** चुनिए
    - Name: `panika-d1`
    - Permissions: **Account → D1 → Edit**
    - **Continue → Create Token**
11. जो लंबा token दिखे वो copy कीजिए → यह `CF_D1_API_TOKEN` है
    (यह भी सिर्फ एक बार दिखता है।)

---

## Step 2 — Render पर 7 variables भरिए (2 मिनट) ← **यहीं data loss खत्म होता है**

1. https://dashboard.render.com खोलिए → अपनी service `panikajeevansathi` पर click
2. बाएँ **Environment** → **Add Environment Variable** (हर एक के लिए दोहराइए)

| Key | Value |
|---|---|
| `CF_ACCOUNT_ID` | Step 1a का Account ID |
| `CF_D1_DATABASE_ID` | Step 1a का Database ID |
| `CF_D1_API_TOKEN` | Step 1c का token |
| `R2_ACCOUNT_ID` | वही Account ID |
| `R2_BUCKET` | `panika-photos` |
| `R2_ACCESS_KEY_ID` | Step 1b का Access Key ID |
| `R2_SECRET_ACCESS_KEY` | Step 1b का Secret |

3. **Save Changes** → Render अपने आप redeploy करेगा (~2 मिनट)।

### सही हुआ या नहीं — 10 सेकंड में जाँच

Browser में खोलिए:

```
https://panikajeevansathi.onrender.com/api/health
```

- ✅ सही: `"storage":"d1"` और `"photos":"r2"`
- ❌ अभी बाकी: `"storage":"sqlite"` — तो कोई variable गलत लिखा है
  (सबसे आम गलती: token copy करते समय आगे/पीछे space रह जाना)

---

## Step 3 — रोज़ का backup चालू कीजिए (3 मिनट)

Database सुरक्षित हो गया, पर backup भी चाहिए — गलती से कुछ delete हो जाए तो।

1. GitHub पर repository → **Settings → Secrets and variables → Actions**
2. **New repository secret** से ये डालिए (वही values जो Render पर डालीं):
   `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_D1_API_TOKEN`,
   `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
3. एक और secret बनाइए:
   - Name: `BACKUP_KEY`
   - Value: कोई भी लंबा password, जैसे `panika-2026-backup-suraksha-key`
   - ⚠️ **इसे कहीं लिखकर संभालिए।** इसके बिना backup कभी खुल नहीं पाएगा।

बस। अब हर रात 1:30 बजे अपने आप:
- D1 का पूरा snapshot बनेगा,
- encrypt होकर R2 में जाएगा (30 दिन तक),
- और GitHub artifact के रूप में दूसरी copy भी बनेगी (90 दिन)।

---

## अब आपका डेटा कितनी जगह है?

| कहाँ | क्या | कब तक |
|---|---|---|
| Cloudflare D1 | live database | हमेशा (+ 7 दिन Time Travel) |
| Cloudflare R2 | photos + encrypted backups | हमेशा / 30 snapshots |
| GitHub artifacts | दूसरी, अलग कंपनी की copy | 90 दिन |

तीनों एक साथ खत्म हों — तभी डेटा जाएगा। व्यावहारिक रूप से असंभव।

---

## अपने आप चलने वाले पहरेदार

| Workflow | कब | क्या करता है |
|---|---|---|
| `guardian.yml` | रोज़ + हर push | 134 e2e tests, health, design lock |
| `db-backup.yml` | रोज़ रात | encrypted backup → R2 + artifact |
| `persistence-watch.yml` | हर 6 घंटे | live site से पूछता है "डेटा सुरक्षित है?" — नहीं तो **GitHub issue खोल देता है** और member count गिरने पर तुरंत alert |

`persistence-watch` सबसे ज़रूरी है: अगर कभी गलती से variables हट गए, आपको
website public होने के 6 घंटे के अंदर पता चल जाएगा — members के मिटने से पहले।

---

## अगर कभी डेटा वाकई चला जाए (recovery)

घबराइए मत — एक command:

```bash
# पहले देखिए क्या वापस आएगा (कुछ बदलेगा नहीं):
node scripts/db-restore.mjs --from-r2 latest

# ठीक लगे तो सचमुच restore कीजिए:
node scripts/db-restore.mjs --from-r2 latest --yes
```

ज़रूरी env: वही `CF_*`, `R2_*` और `BACKUP_KEY`.
यह restore process हर रात test होती है (`scripts/backup-test.mjs`, 20 checks) —
यानी backup सिर्फ बनता नहीं, खुलता भी है, यह रोज़ साबित होता है।

---

## Public करने से पहले आखिरी checklist

- [ ] `/api/health` में `"storage":"d1"` दिख रहा है
- [ ] `/api/health` में `"photos":"r2"` दिख रहा है
- [ ] एक test account बनाकर, Render पर **Manual Deploy** दबाकर, फिर उसी
      account से login करके देख लिया — login चला ✅ (यही असली प्रमाण है)
- [ ] GitHub में 8 secrets भरे हैं और `BACKUP_KEY` कहीं सुरक्षित लिखा है
- [ ] `db-backup` workflow एक बार hand से चलाकर हरा देख लिया
      (Actions → Database backup → Run workflow)
- [ ] `persistence-watch` एक बार hand से चलाकर हरा देख लिया

छह टिक = website public करने के लिए तैयार। 🎉
