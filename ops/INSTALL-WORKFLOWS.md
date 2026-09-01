# Workflows install karna — 2 minute ka kaam (ek baar)

## ⚠️ Kyun manually?

GitHub **automated tools** (kisi bhi app / bot / agent) ko `.github/workflows/`
**create ya update karne ki permission nahi deta** bina `workflows` scope ke.
Isliye main (ya koi bhi agent) ye files direct install nahi kar sakta.
**Sirf aap — repo owner — ye 5 min mein kar sakte hain, aur phir sab kuch
24×7 automatic chalega.**

Push karte waqt aapko ye error dikhta hai to yahin se copy karein:

```
! [remote rejected] ... refusing to allow a GitHub App to create or update
  workflow `.github/workflows/agent-storage.yml` without `workflows` permission
```

---

## ✅ Tareeka (har file ke liye same 4 steps)

1. GitHub par repo kholein: <https://github.com/Spanika4321/panika-jeevan-sathi>
2. **Add file → Create new file**
3. File name box mein exactly ye path likhein (table ke hisaab se)
4. `ops/` mein rakhi hui corresponding file ka **poora content** paste karein
   → **Commit changes** (green button)

| # | Banayein ye file (GitHub par) | Content yahan se copy karein |
| --- | --- | --- |
| 1 | `.github/workflows/agent-storage.yml` | [`ops/agent-storage.workflow.yml`](agent-storage.workflow.yml) *(naya)* |
| 2 | `.github/workflows/pooja.yml` | [`ops/pooja.workflow.yml`](pooja.workflow.yml) *(replace)* |
| 3 | `.github/workflows/priya.yml` | [`ops/priya.workflow.yml`](priya.workflow.yml) *(replace)* |
| 4 | `.github/workflows/manager.yml` | [`ops/manager.workflow.yml`](manager.workflow.yml) *(replace)* |
| 5 | `.github/workflows/employee-report.yml` | [`ops/employee-report.workflow.yml`](employee-report.workflow.yml) *(replace)* |
| 6 | `.github/workflows/deploy-apps-script.yml` | [`ops/deploy-apps-script.workflow.yml`](deploy-apps-script.workflow.yml) *(naya)* |
| 7 | `.github/workflows/apps-script-authorize.yml` | [`ops/apps-script-authorize.workflow.yml`](apps-script-authorize.workflow.yml) *(naya)* |

**Replace ka matlab:** purani file kholkar (pencil icon) poora content delete
kar ke naya paste kar dein — ya `Add file` se same naam daal kar overwrite.

---

## 🎯 Priority — agar time kam ho to

| Priority | File | Kyun |
| --- | --- | --- |
| **1st** | `agent-storage.yml` | Naya hai — 12 agents ki permanent memory isi se chalti hai |
| **2nd** | `employee-report.yml` | Har 10 min cycle — isme storage save/restore lagana sabse zyada faydemand |
| 3rd | `pooja.yml` / `priya.yml` | Daily SEO + campaign agents ki memory |
| 4th | `manager.yml` | Daily coordinator |
| **5th** | `deploy-apps-script.yml` | `apps-script/Code.gs` badalte hi Google Apps Script project mein auto upload |
| 6th | `apps-script-authorize.yml` | Ek baar — Google ka refresh token paane ke liye (phone se hi ho jaata hai) |

> Jo already installed hain (Guardian, purane Pooja/Priya/Manager/Employee) —
> wo bina in changes ke bhi 24×7 chalte rahenge. Ye update sirf unki
> **memory permanent** karta hai.

---

## 🔍 Install ke baad verify kaise karein

1. Repo → **Actions** tab
2. Left list mein ye names dikhne chahiye:
   - `AI Agent Storage` ← naya
   - `Employee Reports — Every 10 Minutes`
   - `Pooja — SEO Growth Worker`
   - `Priya — Community Growth Worker`
   - `Agent Manager`
   - `Website Guardian`
   - `Deploy Apps Script` ← naya
   - `Authorize Apps Script` ← naya
3. `AI Agent Storage` → **Run workflow** (dropdown se) → green run hona chahiye
4. Run ke andar **"Cycle summary"** step mein 12 agents ki table dikhegi

Turant test karne ke liye har workflow mein `workflow_dispatch` hai —
schedule ka wait karne ki zaroorat nahi.

---

## 📦 Kya kya automatic ho jaata hai (install ke baad)

| Workflow | Kitni baar | Kya karta hai |
| --- | --- | --- |
| `AI Agent Storage` | har 6 ghante | 12 agents + snapshot + storage report |
| `Employee Reports` | har 10 minute | Pooja + Priya + Guardian + Manager + email |
| `Pooja` | daily 04:30 UTC | SEO analysis |
| `Priya` | daily 05:00 UTC | campaign ideas |
| `Manager` | daily 04:00 UTC | coordinator sweep |
| `Guardian` | daily 03:30 UTC + har push | 95 health checks + 134 tests |
| `Deploy Apps Script` | `apps-script/` badalte hi | live Apps Script code ka backup → diff → naya code upload |
| `Authorize Apps Script` | sirf manual (`Run workflow`) | Google device flow se refresh token deta hai |

Aapka phone / data off rahe — sab GitHub ke servers par chalta hai.

---

## ❌ Jo kabhi automatic nahi hota

- Production deploy
- Git push
- Social media posting
- Email bina `RESEND_API_KEY` ke
- Public UI / design badalna
- Password ya private message padhna

Ye repo ki policy hai (`agents/roster.mjs` → `SAFETY`), aur storage layer
(`agents/storage.mjs`) isko code-level enforce karta hai.

---

## 🧩 Apps Script wale 2 workflows — detail

Ye dono **Google Apps Script** project (jo alag standalone hai, is repo mein
nahi) ko is repo ke `apps-script/` folder se sync rakhte hain.

1. `apps-script-authorize.yml` — **ek baar** `Run workflow` karein, client id
   daalein, log mein aaya code `google.com/device` par type karein → refresh
   token mil jaata hai → use `PJS_AS_REFRESH_TOKEN` secret mein daal dein.
2. `deploy-apps-script.yml` — uske baad `apps-script/Code.gs` GitHub par edit
   karte hi (phone se bhi) code aapke Apps Script project mein chala jaata hai.

Secrets (Settings → Secrets and variables → Actions):
`PJS_APPS_SCRIPT_ID`, `PJS_AS_CLIENT_ID`, `PJS_AS_CLIENT_SECRET`,
`PJS_AS_REFRESH_TOKEN`, (optional) `PJS_AS_DEPLOYMENT_ID`.

Poori detail: [`APPS-SCRIPT.md`](../APPS-SCRIPT.md)
