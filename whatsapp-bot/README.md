# 📱 WhatsApp Client Bot — Insaan jaisa auto-reply

Aapke **business WhatsApp** par client jo bhi poochhe, ye bot **client ki apni bhasha me**
human-like reply bhejta hai:

**हिंदी · Hinglish · বাংলা · Bhojpuri · ଓଡ଼ିଆ** — language **khud detect** hoti hai!

```
Client: নমস্কার, খরচ কত লাগবে?
Bot:    জি, সব সেবা ১০০% ফ্রি 🙏 রেজিস্ট্রেশন ফি নেই, মাসিক চার্জ নেই...

Client: ka ba, profile kaise banaye?
Bot:    Registration bahut saral ba ji 😊 Website kholi → Register dabai → ...

Client: kitna paisa lagega?
Bot:    Ji, sab kuch 100% FREE hai 🙏 na registration fee, na monthly charge...
```

## Kaun sa option chunein?

| | Option 1: `wa-web` | Option 2: `cloud` (Recommended ✅) |
|---|---|---|
| Kya hai | Aapka apna WhatsApp QR se link | Meta ka **official** WhatsApp Business API |
| Ban ka risk | Thoda hai (unofficial hai) | **Zero** — Meta ka official tareeka |
| Cost | Free | Free (test number + 5 users unlimited; baaki Meta ke free tier me) |
| Setup | Sirf QR scan | Meta developer account banana padta hai |
| Kahan chalega | Apne PC/laptop par | Kisi bhi free host (Render/Railway) par 24×7 |

## Option 1 — QR scan wala (5 minute me chalu)

```bash
cd whatsapp-bot
npm install
npm run wa-web
```
Terminal me QR aayega → **WhatsApp → Linked Devices → Link a Device** → QR scan → done!
Ab har client message ka auto-reply chalu. Band karne ke liye `Ctrl+C`.

## Option 2 — Official Meta Cloud API (ban-safe, 24×7)

1. https://developers.facebook.com → **My Apps → Create App** (type: Business)
2. App me **WhatsApp** product add karo → **API Setup** me free test number milega
3. Wahan se `PHONE_NUMBER_ID` aur `ACCESS_TOKEN` copy karo
4. Webhook server chalao (local test ya free host par):
   ```bash
   VERIFY_TOKEN=panika PHONE_NUMBER_ID=xxxx ACCESS_TOKEN=xxxx npm run cloud
   ```
5. Meta dashboard → WhatsApp → **Configuration → Webhook**:
   - Callback URL: `https://<aapka-host>/webhook`
   - Verify token: `panika`
   - **messages** field subscribe karo

Bas — ab client ka message aayega to brain khud jawab dega! 🎉

## Brain customize karna

Poora reply engine **`brain.js`** me hai — har bhasha ke jawab wahan likhe hain.
Koi jawab badalna ho to `PACK` object me apni language ka text edit karo.
Naye sawal (intent) jodna ho to `detectIntent` me ek regex + har bhasha me jawab jod do.

## Dashboard me test (bina WhatsApp ke)

Repo ke `AI-TEAM-DASHBOARD.html` (Chrome edition) me **"Client Bot 🤝"** chat hai —
client ka message type karo, wahi brain reply dikhata hai. Reply par **click = copy**,
phir WhatsApp me paste karke khud bhej sakte ho!
