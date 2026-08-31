# Agent Orders — kaun kaam nahi kar raha aur kya karna hai

Time: 2026-08-31T12:16:09.856Z · Agents: 12 · Healthy: 7 · Orders: 5

| Agent | Role | Status | Order | Owner ko kya karna hai |
| --- | --- | --- | --- | --- |
| Manager (`manager`) | Coordinator | BLOCKED | blocked-dependency | Iska reason uske report mein hai (reports/agents/*-latest.json). Queue worker dobara chala kar taaza status laayega. |
| Pooja (`pooja`) | SEO / Organic Growth Worker | BLOCKED | credentials-needed | Ye env keys set karein (Render dashboard → Environment, ya GitHub → Secrets): GOOGLE_SEARCH_CONSOLE_TOKEN, GEMINI_API_KEY |
| Priya (`priya`) | Campaign / Community Growth Worker | BLOCKED | credentials-needed | Ye env keys set karein (Render dashboard → Environment, ya GitHub → Secrets): META_ACCESS_TOKEN, META_PAGE_ID |
| Rahul (`rahul`) | Uptime & Performance Worker | BLOCKED | credentials-needed | Ye env keys set karein (Render dashboard → Environment, ya GitHub → Secrets): SITE_URL |
| Meera (`meera`) | Email & Notification Composer | BLOCKED | credentials-needed | Ye env keys set karein (Render dashboard → Environment, ya GitHub → Secrets): RESEND_API_KEY |

## Credentials jo chahiye (BLOCKED agents)

- `GOOGLE_SEARCH_CONSOLE_TOKEN` — Google Search Console → API token (SEO data ke liye) → Pooja
- `GEMINI_API_KEY` — Google AI Studio → GEMINI_API_KEY (AI analysis ke liye) → Pooja
- `META_ACCESS_TOKEN` — Meta for Developers → page access token → Priya
- `META_PAGE_ID` — Meta → Facebook page ID → Priya
- `SITE_URL` — Production URL (default: https://panikajeevansathi.onrender.com) → Rahul
- `RESEND_API_KEY` — Resend.com → API key (owner email reports ke liye) → Meera

Queue: pending=5 · Orders queue mein: 5

Next: `node scripts/agent-queue-worker.mjs`
