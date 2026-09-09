# GROWTH PLAYBOOK — PANIKA JEEVAN SATHI + SEVA MARKET INDIA

Real users kaise aayenge: ek free community website ke liye sabse bada channel
**WhatsApp forwarding** hai, uske baad **Google search** aur **samaj ke offline
network**. Ye document do cheezein deta hai:

1. **Jo features ab code mein hain** (invite link, share buttons, tracking) —
   inhe on kaise karna hai.
2. **Ready-to-paste messages + 30-day plan** — copy karke bhej dijiye.

> Sach pehle: main (AI) aapke liye social media par post nahi kar sakta, ads
> nahi chala sakta, aur na hi members bana sakta. Ye playbook + built-in
> features aapke bhejne par kaam karte hain.

---

## 1. Site mein ab kya bana hai

| Feature | Kahan | Kya karta hai |
| --- | --- | --- |
| **Personal invite link** | Dashboard → *Apne parivaar ko bulaiye* (`/dashboard.html#invite`) | Har member ka permanent link (`/?ref=CODE`). Jo us link se register karta hai, wo usi member ke naam se judta hai. |
| **Invite notification** | Inviter ke notifications | "A new member joined with your invite link" — naye member ki koi detail share nahi hoti (privacy). |
| **Share buttons** | Home hero, home share band, footer, dashboard, seva provider pages | WhatsApp / Facebook / Copy link / native Share — ek tap mein forward. |
| **Invite attribution** | `referrals` table (`lib/referral.js`) | Ek member sirf ek baar attribute hota hai; forged code credit nahi leta. |
| **Admin rollup** | Admin → Overview → *Invite growth* | Total invites, kitne members invite bhej rahe hain, top inviters. |
| **Seva share row** | Provider profile + site footer | "Recommend this business" — provider pages WhatsApp group mein forward hote hain. |

### Production par ek zaroori step (Supabase)

`referrals` table **optional** hai — table na ho to bhi site chalti hai aur
registration kabhi fail nahi hoti, sirf ginati record nahi hoti. Ginati chahiye
to Supabase SQL editor mein `supabase/schema.sql` ek baar chala dijiye
(`create table if not exists` hai — existing data par koi asar nahi).
SQLite / Cloudflare D1 par table apne aap ban jaata hai.

---

## 2. Ready-to-paste WhatsApp messages

### A. Samaj / community group ke liye (Hindi)

```
🙏 Namaskar sabhi ko,

Humari Panika / Manikpuri / Kabirpanthi / Adivasi community ke liye ek
100% FREE matrimonial website chalu hai:

https://panikajeevansathi.onrender.com/

✅ Registration free
✅ Profile banana free
✅ Search aur messaging free
❌ Koi payment nahi, koi subscription nahi, koi locked profile nahi

Ghar mein vivah yogya beti/beta hai to 2 minute mein free profile banaiye.
Aage bhejkar kisi ka rishta banne mein madad karein. 🙏
```

### B. Family / rishtedaar ke liye (chhota)

```
Namaste 🙏 Humari community ki FREE matrimonial site —
profile banana, search karna, baat karna sab free:
https://panikajeevansathi.onrender.com/
Kisi rishtedaar ke liye dekhna ho to batana, main madad kar dunga/dungi.
```

### C. Existing members ke liye (invite link maangne ka message)

```
Aapka profile PANIKA JEEVAN SATHI par ready hai 🎉
Ek chhota sa kaam: dashboard kholiye → "Apne parivaar ko bulaiye" →
apna invite link WhatsApp par bhej dijiye.
Jitne log judenge, utne zyada rishte banenge. Sab free hai. 🙏
```

### D. Success story maangne ke liye

```
Kya aapka rishta PANIKA JEEVAN SATHI se tay hua? 🎊
2 line aur ek photo bhej dijiye — humari community ke liye ye sabse bada
bharosa hota hai, aur naye parivaar judne ki himmat karte hain.
```

### E. SEVA MARKET INDIA (providers ke liye)

```
🧰 Apne kaam ko Google par laaiye — bilkul free.
SEVA MARKET INDIA par apni service list karein (plumber, electrician,
tutor, photographer, AC repair…): customer aapko PIN code se dhundhta hai
aur seedha call karta hai. Koi commission nahi.
List karein: <your-seva-site-url>/providers/new
```

**Bhejne ka tareeka:** har group mein **hafta mein 1-2 baar** — roz spam karne
se log group se nikal dete hain. Shaadi ki photo/story ke saath bhejenge to
response 3-4 guna zyada milta hai.

---

## 3. Facebook / Instagram post copy

```
Humari community ka apna FREE matrimonial platform 🙏
Panika · Manikpuri · Kabirpanthi · Adivasi
Registration free · Search free · Messaging free · Koi subscription nahi

👉 https://panikajeevansathi.onrender.com/

#PanikaSamaj #Manikpuri #Kabirpanthi #FreeMatrimonial #CommunityFirst
```

Post ke saath **ek asli photo** (site ka screenshot ya ek safal jodi ki photo,
permission ke saath) lagaiye — sirf text posts ki reach 5-10 guna kam hoti hai.

---

## 4. Pehle 30 din ka plan

| Din | Kaam | Time |
| --- | --- | --- |
| 1 | Apna khud ka + 5 parivaar ke profile banaiye (photo ke saath) | 2 ghante |
| 2 | Samaj ke 10 WhatsApp groups mein Message A bhejiye | 1 ghanta |
| 3 | Google Search Console mein sitemap submit (`/sitemap.xml`) — [GOOGLE-INDEXING.md](GOOGLE-INDEXING.md) | 30 min |
| 4 | 5 members ko invite link bhejne ke liye kahein (Message C) | 30 min |
| 5 | Facebook page + 3 local community pages par post | 1 ghanta |
| 7 | Pehle hafte ka review: Admin → Overview → *Invite growth* + `/api/analytics/daily` | 20 min |
| 8-14 | Roz 1 success story / 1 tip post; 20 naye profiles ka target | 30 min/din |
| 15 | Samaj ki baithak mein 5 minute ka demo + QR code (invite link ka) | — |
| 21 | Jo profile 30% se kam complete hain unhe WhatsApp par personally kahein | 1 ghanta |
| 30 | Numbers dekhiye: total members, invites se aaye members, kitne verified | 30 min |

**Target (realistic):** mahine 1 → 50-100 profile, mahine 3 → 300-500 profile.
Matrimonial site par 100+ profile hone ke baad hi search results "zinda" lagte
hain, aur tabhi log rukte hain.

---

## 5. Offline channels (ye sabse zyada kaam karte hain)

1. **Samaj baithak / panchayat** — 5 minute demo, wahin 10 profile banwaiye.
2. **Shaadi card par QR** — invite link ka QR code chapwaiye (koi bhi free QR
   generator se ban jaata hai, link `https://…/?ref=CODE` dein).
3. **Mandir / community board** — ek A4 poster: "Free vivah registry — QR scan
   karein".
4. **Local cable TV / newspaper** — 2 line ka free classified aksar mil jaata hai.
5. **School/college alumni groups** — 25+ age group ke liye WhatsApp groups.

---

## 6. Google se traffic (SEO)

Technical side pehle se ready hai: `robots.txt`, `sitemap.xml`, canonical URLs,
Open Graph + JSON-LD structured data, mobile-first pages.

Bacha hua kaam:
- [ ] Search Console verify + sitemap submit ([GOOGLE-INDEXING.md](GOOGLE-INDEXING.md))
- [ ] `SITE_URL` production domain par pin karein (abhi `onrender.com` hai) — custom
      domain par 301 redirect, phir sitemap dobara submit
- [ ] Google Business Profile banaiye (free) — "Panika Jeevan Sathi" ke naam se
- [ ] Har success story ko ek page ki tarah treat karein (title mein community +
      city) — long-tail search se traffic aata hai

---

## 7. Launch channels

- **Product Hunt** — copy ready hai: [PRODUCTHUNT.md](PRODUCTHUNT.md)
- **GitHub** — repo public hai, README mein badge + screenshot add karein
- **Local news / community YouTube channels** — "free matrimonial site for
  Panika community" ek chhoti news ban sakti hai

---

## 8. Numbers kaise naapein

| Metric | Kahan |
| --- | --- |
| Roz ke visits / visitors | `GET /api/analytics/daily` (admin) |
| Total members, new (24h / 7d) | Admin → Overview |
| Invites se aaye members | Admin → Overview → *Invite growth* |
| Kaun member sabse zyada laa raha hai | wahi panel (top inviters) |
| Kitne profiles complete hain | Admin → Members (completeness) |

Har hafta ek screenshot save kijiye — 4 hafte mein saaf dikhega kaun sa channel
kaam kar raha hai, aur wahi double kijiye.

---

## 9. Jo nahi karna hai

- ❌ Fake members ya dummy profiles mat banaiye — asli parivaar bharosa kho
  dete hain.
- ❌ Kisi ka number/email bina permission share mat karein (site ki privacy
  policy bhi yahi kehti hai).
- ❌ "Paid premium" ke naam par paise mat maangiye — ye site ka core promise hai:
  **100% free**.
- ❌ Roz ek hi message 20 groups mein spam mat karein — group se nikal diye
  jaayenge.

---

## 10. Chhote changes jo conversion badhate hain

- Registration ke baad turant invite card dikhayein (abhi dashboard par hai).
- Profile completeness 70%+ hone par hi "searchable" badge dein — log profile
  complete karte hain.
- Har success story ke neeche "Share this story" — kahani sabse zyada forward
  hoti hai.
- Har 15 din mein members ko ek WhatsApp status: "Is hafte 23 naye profile jude".
