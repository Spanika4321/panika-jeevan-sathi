# Agent Orders — kaun kaam nahi kar raha aur kya karna hai

Time: 2026-08-31T16:14:48.249Z · Agents: 12 · Healthy: 7 · Orders: 5

| Agent | Role | Status | Order | Owner ko kya karna hai |
| --- | --- | --- | --- | --- |
| Manager (`manager`) | Coordinator | BLOCKED | blocked-dependency | Agent ne khud ye wajah likhi thi: "manager cycle — pooja=BLOCKED priya=BLOCKED guardian=OK \| blocked: pooja, priya" — koi credential missing nahi hai. |
| Pooja (`pooja`) | SEO / Organic Growth Worker | BLOCKED | credentials-needed | Ye env keys set karein (Render dashboard → Environment, ya GitHub → Secrets): GOOGLE_SEARCH_CONSOLE_TOKEN, GEMINI_API_KEY |
| Priya (`priya`) | Campaign / Community Growth Worker | BLOCKED | credentials-needed | Ye env keys set karein (Render dashboard → Environment, ya GitHub → Secrets): META_ACCESS_TOKEN, META_PAGE_ID |
| Rahul (`rahul`) | Uptime & Performance Worker | BLOCKED | blocked-dependency | Agent ne khud ye wajah likhi thi: "BLOCKED — Network se https://panikajeevansathi.onrender.com reach nahi ho paya (4 attempts) — koi fake status nahi diya gaya." — koi credential missing nahi hai. |
| Meera (`meera`) | Email & Notification Composer | BLOCKED | credentials-needed | Ye env keys set karein (Render dashboard → Environment, ya GitHub → Secrets): RESEND_API_KEY |

## Credentials jo chahiye (BLOCKED agents)

- `GOOGLE_SEARCH_CONSOLE_TOKEN` — Google Search Console → API token (SEO data ke liye) → Pooja
- `GEMINI_API_KEY` — Google AI Studio → GEMINI_API_KEY (AI analysis ke liye) → Pooja
- `META_ACCESS_TOKEN` — Meta for Developers → page access token → Priya
- `META_PAGE_ID` — Meta → Facebook page ID → Priya
- `RESEND_API_KEY` — Resend.com → API key (owner email reports ke liye) → Meera

Queue: pending=6 · Orders queue mein: 5

Next: `node scripts/agent-queue-worker.mjs`
