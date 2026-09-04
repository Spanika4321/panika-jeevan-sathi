# PANIKA JEEVAN SATHI Agent Team

Hierarchy:
- Guardian = Sardar / existing safety and health authority
- Manager = coordinator
- Pooja = SEO and organic growth worker
- Priya = campaign and community worker
- Rushma = user acquisition & outreach planner (Panika/Manikpuri samaj ko alag-alag platforms se site tak lane ka roz ka plan + Hindi drafts; auto-post kabhi nahi)
- Aman = daily site & member report worker (owner ko daily report bhejta hai)
- Arjun, Kavita, Rahul, Sneha, Amit, Nisha, Vikram, Meera = specialist workers

Rules:
- Never modify public UI/design automatically.
- Never read passwords or private messages.
- Never claim an external action happened without verification.
- Never create spam backlinks or mass-post to communities.
- Missing API credentials must produce BLOCKED, never PASS.
- Production deployment requires all safety tests to pass.

## Storage

Har agent ki permanent memory `storage/` mein hai (committed baseline +
`actions/cache` se run-to-run persistence). Engine: `agents/storage.mjs`,
roster: `agents/roster.mjs`, CLI: `scripts/agent-storage.mjs`.

```bash
npm run storage:init      # 14 agents ki storage banao
npm run storage:status    # sabki status table
npm run storage:doctor    # integrity check
npm run storage:cycle     # sab 14 agents ek saath chalao
```

Detail: [`../storage/README.md`](../storage/README.md)

| Agent | Script |
| --- | --- |
| Guardian (Sardar) | `scripts/health-check.mjs` |
| Manager | `agents/manager.mjs` |
| Pooja | `agents/pooja.mjs` |
| Priya | `agents/priya.mjs` |
| Aman | `agents/aman.mjs` |
| Rushma | `agents/worker.mjs rushma` |
| Arjun / Kavita / Rahul / Sneha / Amit / Nisha / Vikram / Meera | `agents/worker.mjs <id>` |

Har agent ka result `storage/agents/<id>/` mein record hota hai:
state, metrics, append-only log, hash-chained ledger entry, aur FAIL hone par
incident register.
