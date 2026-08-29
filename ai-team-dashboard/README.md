# 🤖 AI TEAM DASHBOARD — "4 AI Employees"

WhatsApp-style chat dashboard for **PANIKA JEEVAN SATHI**. You are the Boss 👑 —
your 4 AI employees chat with you like real humans and do the daily growth work.

## The Team

| Employee | Role | Powers (type in chat) |
| --- | --- | --- |
| 👨‍💻 RAHUL | SEO & Research Engineer | `audit` → **real website audit + report** (score /100) · `keyword` → 2 new SEO keywords from live trends |
| 👩‍💻 PRIYA | Social Media Manager | `post` / `aaj ke posts` → reels, captions, hashtags, timing · `design idea` → website design suggestions |
| 🧑‍💻 AMIT | Automation & Workflow Manager | `workload` → live workload report · high load par **3 sub-agents clone** karta hai |
| 👩‍💼 SNEHA | Growth & Virality Analyst | `viral analysis` → virality score + ad hook · peak par **`LAUNCH_ADS`** code deti hai |
| 🚀 Team Group | All 4 together | `daily email` → full Daily Growth Update email (subject + body + secret code) |

## Run

```bash
node server.js            # dashboard → http://localhost:8080
AUDIT_URL=http://... node server.js   # kisi bhi site ka audit
```

The **Website Audit is real**: it fetches the live site (default
`http://127.0.0.1:3000`) and checks uptime, response time, SEO title,
meta description, robots.txt, sitemap.xml, viewport, H1, favicon,
Open Graph tags, canonical URL and image alt texts — then scores it
out of 100 with fixes. If the site is offline it falls back to a
static file audit of the repo.

Zero npm dependencies. Node.js >= 18. Chat history saves in your browser (localStorage).

## Daily Email

Click 📧 (top-left) or type `daily email` in the team group:

- Subject: `Daily Growth Update - <date>`
- Body starts: *"Hello Good Morning Boss! Here is our action plan for today…"*
- Each employee reports: RAHUL keywords → PRIYA campaign → AMIT workload
  (clones sub-agents when trends are many) → SNEHA potential
  (recommends Ads at peak + gives Ad Hook)
- If Sneha recommends Ads → secret code **`LAUNCH_ADS`** at the bottom.

Preview ke liye matrimonial site bhi chalana ho to: repo root me `node server.js` (port 3000).
