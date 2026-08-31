#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — SEO Center Agent Squad
 * ============================================
 *
 *   node scripts/seo-agent-squad.mjs
 *
 * Ek command se POORA agent team SEO Center ke kaam pe lag jata hai:
 *
 *   Manager (coordinator)
 *     ├─ Guardian (Sardar)   → full health check + design lock
 *     ├─ Pooja               → SEO research (SEO Center pipeline)
 *     ├─ Priya               → verification (SEO Center pipeline)
 *     ├─ Arjun               → backlink targets for SEO keyword clusters
 *     ├─ Kavita              → SEO content briefs for public pages
 *     ├─ Rahul               → reachability samples (/seo-center.html, robots.txt)
 *     ├─ Sneha               → noindex/security checks for the SEO Center page
 *     ├─ Amit                → profile-quality → SEO landing-page ideas
 *     ├─ Nisha               → SEO Center FAQ entries in the knowledge base
 *     ├─ Vikram              → squad + SEO scorecard rollup
 *     └─ Meera               → owner email from verified outcomes
 *
 * Har assignment teen jagah record hota hai (proof):
 *   1. Mailbox message (manager → worker)
 *   2. Per-agent task list (meta.source = "seo-center")
 *   3. Shared durable job queue
 *
 * Sab agents ke run results unki PERMANENT memory mein record hote hain
 * (state/metrics/log/ledger) aur squad report
 * reports/agents/seo-squad-latest.json + .md mein likha jaata hai.
 *
 * Rules: no fake PASS, no external posting, missing credentials → BLOCKED.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as store from '../agents/storage.mjs';
import { AGENTS } from '../agents/roster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(ROOT, 'reports', 'agents');

/* ------------------------------------------------------------- squad plan
 * Har worker ke liye ek REAL, SEO-Center-scoped assignment. */

const ASSIGNMENTS = {
  arjun: {
    subject: 'SEO Center: backlink research — keyword clusters',
    task: 'Verify 10 community-directory backlink targets for SEO Center keyword clusters (from knowledge/seo-baseline). Reject paid/spam/link-farm targets.',
    priority: 'high'
  },
  kavita: {
    subject: 'SEO Center: content briefs — public pages',
    task: 'Draft SEO content briefs (title/meta/H1) for public pages: /, /about.html, /contact.html, /login.html — aligned with Search Console query themes. Drafts only, UI untouched.',
    priority: 'normal'
  },
  rahul: {
    subject: 'SEO Center: reachability samples',
    task: 'Record reachability samples for /seo-center.html and /robots.txt; track response-time trend from stored history.',
    priority: 'normal'
  },
  sneha: {
    subject: 'SEO Center: noindex + secrets audit',
    task: 'Verify seo-center.html carries noindex + is robots-blocked; verify no API keys/secret tokens are committed anywhere in the repo.',
    priority: 'critical'
  },
  amit: {
    subject: 'SEO Center: profile-quality → landing-page ideas',
    task: 'Map aggregate profile-completeness signals to SEO landing-page ideas (aggregate only — no private data).',
    priority: 'normal'
  },
  nisha: {
    subject: 'SEO Center: FAQ knowledge base',
    task: 'Add SEO Center FAQ entries to the shared knowledge base: how cycles work, what BLOCKED means, how to connect Search Console.',
    priority: 'normal'
  },
  vikram: {
    subject: 'SEO Center: scorecard rollup',
    task: 'Roll up SEO Center cycles + this squad round into the weekly scorecard (streaks, failure rates, throughput).',
    priority: 'normal'
  },
  meera: {
    subject: 'SEO Center: owner email composer',
    task: 'Compose the owner email from verified SEO cycle outcomes (sends only when RESEND_API_KEY is configured — otherwise BLOCKED, never fake "sent").',
    priority: 'high'
  }
};

/* ------------------------------------------------------------ dispatch */

function runCommand(args, timeoutMs = 10 * 60 * 1000) {
  const started = Date.now();
  try {
    const out = execFileSync(process.execPath, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs
    });
    return { ok: true, ms: Date.now() - started, out };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      out: String(err.stdout || '') + String(err.stderr || err.message || '')
    };
  }
}

const squad = {
  type: 'seo-agent-squad',
  started_at: store.now(),
  finished_at: null,
  duration_ms: 0,
  assignments: {},
  workers: {},
  guardian: null,
  manager: null
};

const started = Date.now();

/* 1 ─ Manager assigns work: mailbox + task list + shared queue. */
for (const workerId of Object.keys(ASSIGNMENTS)) {
  const a = ASSIGNMENTS[workerId];
  store.sendMessage({
    from: 'manager',
    to: workerId,
    subject: a.subject,
    body: a.task,
    priority: a.priority
  });
  const task = store.addTask(workerId, {
    title: a.task,
    priority: a.priority,
    meta: { source: 'seo-center', squad: 'seo-agent-squad' }
  });
  store.enqueue({
    type: 'seo-center.assignment',
    payload: { worker: workerId, subject: a.subject },
    priority: a.priority
  });
  squad.assignments[workerId] = { subject: a.subject, task_id: task.id };
}

/* 2 ─ Guardian (Sardar): full site health check + design lock. */
const guardianRun = runCommand(['scripts/health-check.mjs']);
squad.guardian = {
  status: guardianRun.ok ? 'PASS' : 'FAIL',
  ms: guardianRun.ms,
  tail: String(guardianRun.out).split('\n').filter((l) => /passed|failed/i.test(l)).join(' ').trim()
};
store.recordRun('guardian', {
  status: guardianRun.ok ? 'OK' : 'FAIL',
  summary: guardianRun.ok
    ? 'Health check executed during the SEO Center squad round.'
    : 'Health check FAILED during the SEO Center squad round.',
  duration_ms: guardianRun.ms,
  details: { squad: true, ok: guardianRun.ok }
});

/* 3 ─ Workers (Arjun … Meera): har ek apna run khud record karta hai. */
const workerIds = Object.keys(ASSIGNMENTS);
for (const id of workerIds) {
  const run = runCommand(['agents/worker.mjs', id]);
  const state = store.getState(id);
  squad.workers[id] = {
    script_ok: run.ok,
    ms: run.ms,
    status: state && state.last_status ? state.last_status : (run.ok ? 'OK' : 'FAIL'),
    runs: state && state.runs ? state.runs : null,
    summary: state && state.last_summary ? String(state.last_summary).slice(0, 300) : ''
  };
  const inbox = store.readInbox(id, { unreadOnly: false });
  squad.workers[id].assignment_received = Boolean(
    (inbox || []).some((m) => m.from === 'manager' && /seo center/i.test(m.subject || ''))
  );
  const metrics = store.readAgentDoc(id, 'metrics.json', { history: [] });
  const hist = (metrics.history || []).slice(-1)[0];
  if (hist && hist.summary) squad.workers[id].summary = String(hist.summary).slice(0, 300);
}

/* 4 ─ Manager (coordinator) ka apna run record. */
const fails = Object.values(squad.workers).filter((w) => w.status === 'FAIL').length;
store.recordRun('manager', {
  status: fails ? 'FAIL' : 'OK',
  summary: `SEO squad dispatched: 8 workers assigned, guardian=${squad.guardian.status}, failures=${fails}.`,
  duration_ms: Date.now() - started,
  details: { squad: true, workers: workerIds.length, fails }
});
squad.manager = {
  status: fails ? 'FAIL' : 'OK',
  summary: `8 workers assigned via mailbox + task list + queue; guardian=${squad.guardian.status}; failures=${fails}.`
};

/* 5 ─ Ledger + KV proof. */
store.ledgerAppend({
  type: 'seo-center.squad',
  guardian: squad.guardian.status,
  workers: workerIds.length,
  failures: fails
});
store.kvSet('seo-center', 'squad-last', {
  at: store.now(),
  workers: Object.fromEntries(Object.entries(squad.workers).map(([k, v]) => [k, v.status]))
});

squad.finished_at = store.now();
squad.duration_ms = Date.now() - started;
squad.verdict = fails || !guardianRun.ok ? 'FAIL' : 'PASS';

/* 6 ─ Squad report (permanent). */
fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(path.join(REPORT_DIR, 'seo-squad-latest.json'), JSON.stringify(squad, null, 2) + '\n');

const L = [];
L.push('# PANIKA JEEVAN SATHI — SEO Center Agent Squad Report');
L.push('');
L.push(`- **Started:** ${squad.started_at} · **Duration:** ${squad.duration_ms} ms`);
L.push(`- **Verdict:** ${squad.verdict} · **Guardian:** ${squad.guardian.status}`);
L.push('');
L.push('| Agent | Role | Assignment (SEO Center) | Result |');
L.push('| --- | --- | --- | --- |');
L.push(`| Guardian (Sardar) | Safety & health | Full site health check + design lock | **${squad.guardian.status}** |`);
for (const id of workerIds) {
  const w = squad.workers[id];
  const agent = AGENTS.find((x) => x.id === id);
  const got = w.assignment_received ? 'mailbox ✓' : 'mailbox ✗';
  L.push(`| ${agent ? agent.name : id} | ${agent ? agent.role : '—'} | ${ASSIGNMENTS[id].task} (${got}) | **${w.status}** (run #${w.runs}) |`);
}
L.push(`| Manager | Coordinator | Dispatched the full squad + recorded the round | **${squad.manager.status}** |`);
L.push('');
L.push('## Worker details');
L.push('');
for (const id of workerIds) {
  const w = squad.workers[id];
  L.push(`- **${id}** → ${w.status} — ${w.summary}`);
}
L.push('');
L.push('> Missing credentials (Search Console / Gemini / Router / Fil One / RESEND)');
L.push('> report BLOCKED, never PASS. No deployment, git push or social posting happened.');
fs.writeFileSync(path.join(REPORT_DIR, 'seo-squad-latest.md'), L.join('\n') + '\n');

console.log(JSON.stringify(squad, null, 2));
console.log(`\n[seo-agent-squad] verdict ${squad.verdict} — 8 workers + guardian + manager dispatched in ${squad.duration_ms} ms.`);
process.exitCode = squad.verdict === 'PASS' ? 0 : 1;
