# PANIKA JEEVAN SATHI — AI Agent Storage

Ye folder **14 AI agents ki permanent memory** hai. GitHub Actions ka runner
har baar naya (ephemeral) hota hai, isliye bina storage ke agents har run par
sab kuch bhool jaate hain. Is system se unki memory, tasks, metrics, log aur
audit trail run ke beech preserve rehti hai.

**Sirf ye folder agents ka data hai.** `reports/` sirf human-readable reports
ke liye hai.

---

## 1. Structure

```
storage/
├── agents/
│   ├── index.json              ← registry: 14 agents, roles, capabilities
│   └── <agent-id>/             ← har agent ki apni storage (13 folders)
│       ├── profile.json        ← naam, role, capabilities, requirements
│       ├── state.json          ← status, run count, last run, failure streak
│       ├── memory.json         ← short-term + long-term memory, facts
│       ├── tasks.json          ← pending / running / done / failed
│       ├── metrics.json        ← counters + pichhle 200 runs ka history
│       ├── log.ndjson          ← append-only run log (500 entries hot)
│       ├── archive/            ← purane logs (rotation, git-ignored)
│       ├── inbox.json          ← doosre agents se aaye messages
│       └── outbox.json         ← is agent ne bheje messages
└── shared/
    ├── kv/                     ← shared key–value namespaces
    ├── queue/jobs.json         ← durable job queue
    ├── ledger/YYYY-MM.ndjson   ← append-only hash-chained audit trail
    ├── incidents/              ← open incidents + history
    └── knowledge/              ← FAQ, SEO baseline docs

storage/snapshots/              ← last 7 full snapshots (git-ignored)
```

## 2. Agents (13)

| ID | Naam | Role | Kab chalta hai | Workflow |
| --- | --- | --- | --- | --- |
| `guardian` | Guardian (Sardar) | Safety & Health Authority | daily 03:30 UTC + har push | `guardian.yml` |
| `manager` | Manager | Coordinator | daily 04:00 UTC | `manager.yml` |
| `pooja` | Pooja | SEO / Organic Growth | daily 04:30 UTC | `pooja.yml` |
| `priya` | Priya | Campaign / Community Growth | daily 05:00 UTC | `priya.yml` |
| `aman` | Aman | Daily Site & Member Report | daily 13:05 UTC (18:35 IST) | `aman.yml` |
| `arjun` | Arjun | Backlink & Directory Research | daily 05:30 UTC | `agent-storage.yml` |
| `kavita` | Kavita | Content & Blog Drafting | daily 06:00 UTC | `agent-storage.yml` |
| `rahul` | Rahul | Uptime & Performance | har 6 ghante | `agent-storage.yml` |
| `sneha` | Sneha | Security & Compliance | daily 06:30 UTC | `agent-storage.yml` |
| `amit` | Amit | Profile Quality & Match Data | daily 07:00 UTC | `agent-storage.yml` |
| `nisha` | Nisha | Support & FAQ Knowledge | daily 07:30 UTC | `agent-storage.yml` |
| `vikram` | Vikram | Analytics & Reporting | daily 08:00 UTC | `agent-storage.yml` |
| `meera` | Meera | Email & Notification Composer | har 10 minute | `employee-report.yml` |

Hierarchy (kabhi nahi badalti): **Guardian (Sardar) → Manager → Workers**

Aman owner ko directly report karta hai (reports_to: owner) — daily 13:05 UTC. Wo
anonymous aggregate analytics (site_stats/site_visitors) se report banata hai;
koi raw IP ya private member data store nahi hota.

## 3. CLI

```bash
npm run storage:init       # storage tree + 14 agents create karo
npm run storage:status     # sab agents ki status table
npm run storage:doctor     # integrity check (JSON corrupt? ledger intact?)
npm run storage:report     # markdown report: reports/agents/agent-storage-report.md
npm run storage:cycle      # poora cycle: 14 agents + snapshot + report
npm run storage -- list    # agent roster
npm run storage -- seed    # demo tasks + knowledge base
```

Aur commands:

```bash
node scripts/agent-storage.mjs log pooja 20
node scripts/agent-storage.mjs remember pooja focus "panika shaadi" --long
node scripts/agent-storage.mjs recall pooja focus
node scripts/agent-storage.mjs task pooja "Verify sitemap.xml"
node scripts/agent-storage.mjs kv set growth/week 2026-W36 on
node scripts/agent-storage.mjs snapshot manual
```

## 4. Har run par kya hota hai

1. **State** update — status, `runs++`, `last_run_at`, failure streak
2. **Metrics** — counters + history (last 200 runs)
3. **Log** — append-only entry, 500 se upar hone par archive
4. **Ledger** — hash-chained audit entry (tamper-evident)
5. **Incident** — FAIL par incident khulta hai, agle pass par automatically band

## 5. Ledger — kyun bharosa safe hai

Har ledger line me pichhli line ka SHA-256 hash hota hai:

```
hash = sha256(prevHash + entry-without-hash)
```

Ek line bhi badli ya hatai gayi to `doctor` / `ledgerVerify()` turant FAIL
karega. Matlab agent history silently edit nahi ho sakti.

## 6. Persistence (24×7)

| Layer | Kya karta hai |
| --- | --- |
| Git | committed baseline — cache miss hone par yahin se restore hota hai |
| `actions/cache` | har workflow run ke beech live state preserve |
| Artifacts | `agent-storage` (90 din) + `agent-storage-report` |

Cache key pattern: `agent-storage-${{ github.run_id }}`,
restore-keys: `agent-storage-` → hamesha sabse recent state milti hai.

### Workflow install kaise hota hai

GitHub automated tools (app/bot/agent) ko `.github/workflows/` create ya
update karne ki permission nahi hoti, isliye workflow files `ops/` mein
copy-paste templates ke roop mein rakhi hain:

👉 **`ops/INSTALL-WORKFLOWS.md`** — 2 minute ka guide (kaunsi file kahan paste karni hai).

| Template | Banayein |
| --- | --- |
| `ops/agent-storage.workflow.yml` | `.github/workflows/agent-storage.yml` *(naya)* |
| `ops/pooja.workflow.yml` | `.github/workflows/pooja.yml` |
| `ops/priya.workflow.yml` | `.github/workflows/priya.yml` |
| `ops/manager.workflow.yml` | `.github/workflows/manager.yml` |
| `ops/employee-report.workflow.yml` | `.github/workflows/employee-report.yml` |

Agar install na ho to bhi agents 24×7 chalte rahenge (GitHub ke servers par) —
bas unki memory har run par committed baseline se shuru hogi.

## 7. Safety rules (storage layer enforce karta hai)

- Storage sirf `storage/` ke andar likhta hai — **path traversal blocked**.
- Password, session token ya private message **kabhi store nahi hota**.
- Storage layer khud **deploy / git push / social post / email nahi karta**.
- Corrupt JSON par crash nahi — `doctor` use report karta hai.
- `PJS_AGENT_STORAGE_BACKEND=memory` — read-only filesystem par bhi chalta hai.
- Missing credential → **BLOCKED**, kabhi PASS nahi.

## 8. Env overrides

| Variable | Default | Matlab |
| --- | --- | --- |
| `PJS_AGENT_STORAGE_DIR` | `<repo>/storage` | storage root kahan hai |
| `PJS_AGENT_STORAGE_BACKEND` | `file` | `file` = disk, `memory` = ephemeral |
| `SITE_URL` | `https://panikajeevansathi.onrender.com` | Rahul isko ping karta hai |
| `PJS_CYCLE_MANAGED` | unset | cycle runner set karta hai (double-entry avoid) |

## 9. Retention

| Cheez | Limit |
| --- | --- |
| Per-agent log (hot) | 500 entries, 5 archives |
| Metrics history | 200 runs |
| Task done/failed | 500 each |
| Inbox / Outbox | 200 each |
| Queue done/failed | 300 each |
| Snapshots | 7 |
| Ledger | 1 file per month |

Puraani cheezein **archive** hoti hain, delete nahi — history kabhi silently
loss nahi hoti.
