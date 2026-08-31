# PANIKA JEEVAN SATHI Agent Team

Hierarchy:
- Guardian = Sardar / existing safety and health authority
- Manager = coordinator
- Pooja = SEO and organic growth worker
- Priya = campaign and community worker
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
npm run storage:init      # 12 agents ki storage banao
npm run storage:status    # sabki status table
npm run storage:doctor    # integrity check
npm run storage:cycle     # sab 12 agents ek saath chalao
```

Detail: [`../storage/README.md`](../storage/README.md)

## Batches (ARENA ↔ TERMUX)

Workers are also handed ordered work batches: Arena issues `ops/batches/BATCH-NN.tasks.json`, the
execution environment runs it with `node scripts/termux-batch.mjs run BATCH-NN` and returns
`BATCH-NN.results.{json,md}`. Arena only accepts a result batch whose every PASS sits on top of a
command that really exited 0 — see [`../ops/TERMUX-BATCH-PROTOCOL.md`](../ops/TERMUX-BATCH-PROTOCOL.md)
and the live backlog in [`../ops/batches/QUEUE.md`](../ops/batches/QUEUE.md).

| Agent | Script |
| --- | --- |
| Guardian (Sardar) | `scripts/health-check.mjs` |
| Manager | `agents/manager.mjs` |
| Pooja | `agents/pooja.mjs` |
| Priya | `agents/priya.mjs` |
| Arjun / Kavita / Rahul / Sneha / Amit / Nisha / Vikram / Meera | `agents/worker.mjs <id>` |

Har agent ka result `storage/agents/<id>/` mein record hota hai:
state, metrics, append-only log, hash-chained ledger entry, aur FAIL hone par
incident register.
