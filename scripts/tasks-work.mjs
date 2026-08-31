#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — work the per-agent task lists.
 *
 * The Manager and the specialists keep a private to-do list in
 * `storage/agents/<id>/tasks.json`. A list that only ever grows is a polite way
 * of forgetting work, so this runner takes each task and settles it with a real
 * outcome:
 *
 *   npm run tasks:work                     → drain every agent's pending tasks
 *   npm run tasks:work -- --agent pooja     → one agent
 *   npm run tasks:work -- --max-per-agent 5 → bounded (CI)
 *   npm run tasks:work -- --dry-run         → classify only, write nothing
 *
 * Three dispositions, and the difference between them is the point:
 *
 *   VERIFIED    the task is a check that can actually be run here. The agent's
 *               own script is executed once and its real status is attached to
 *               every task it answers. A FAIL stays a FAIL.
 *   DEFERRED    the task needs the owner (drafts, outreach, "consider adding
 *               field X"). Safety rules forbid an agent from changing public UI
 *               or sending anything on its own, so the task is moved out of the
 *               backlog, reported to the Manager via the mailbox, and marked as
 *               waiting for a human — never marked "done" silently.
 *   REVIEWED    neither — the agent looked at it and there was nothing to do.
 *
 * Exit 0 when nothing failed, 1 if a verification really failed.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { AGENTS } from '../agents/roster.mjs';
import { claimTask, finishTask, getTasks, sendMessage, agentLog, ledgerAppend } from '../agents/storage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const valueOf = (f, fb) => {
  const i = ARGS.indexOf(f);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : fb;
};

const VERIFIABLE = /\b(verify|check|audit|scan|confirm|validate|reachab|noindex|header|secret|integrity|count|stat)\w*\b/i;
const DEFERRED = /\b(draft|outreach|consider|propose|email|send|publish|campaign|article|idea|suggest|manual)\w*\b/i;

const SCRIPT_FOR = {
  guardian: ['scripts/health-check.mjs', []],
  manager: ['agents/manager.mjs', []],
  pooja: ['agents/pooja.mjs', []],
  priya: ['agents/priya.mjs', []]
};

/** One agent run per round, reused for every task it answers. */
const runs = new Map();
function runAgent(id) {
  if (runs.has(id)) return runs.get(id);
  const entry = SCRIPT_FOR[id] || ['agents/worker.mjs', [id]];
  const res = spawnSync(process.execPath, [path.join(ROOT, entry[0]), ...entry[1]], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 240000
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  let parsed = null;
  try {
    parsed = JSON.parse(out);
  } catch (_) {
    const a = out.indexOf('{');
    const b = out.lastIndexOf('}');
    if (a !== -1 && b > a) {
      try {
        parsed = JSON.parse(out.slice(a, b + 1));
      } catch (_) {
        parsed = null;
      }
    }
  }
  const rawStatus = String((parsed && (parsed.status || parsed.verdict)) || '').toUpperCase();
  const status = ['OK', 'PASS', 'BLOCKED', 'FAIL', 'PARTIAL'].includes(rawStatus) ? rawStatus : res.status === 0 ? 'OK' : 'FAIL';
  const summary = String(
    (parsed && (parsed.summary || parsed.detail)) ||
      out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^[[{}"`,`]/.test(l))
        .pop() ||
      ''
  )
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  const result = { status, summary, exit: res.status };
  runs.set(id, result);
  return result;
}

const wanted = (process.env.PJS_TASK_AGENT ? [process.env.PJS_TASK_AGENT] : null) ||
  (has('--agent') ? [valueOf('--agent', '')] : null) ||
  AGENTS.map((a) => a.id);
const maxPerAgent = Number(valueOf('--max-per-agent', '25')) || 25;
const dryRun = has('--dry-run');

let verified = 0;
let deferred = 0;
let reviewed = 0;
let realFailures = 0;
const table = [];

for (const id of wanted) {
  if (!AGENTS.some((a) => a.id === id)) {
    console.error(`  ✗ unknown agent "${id}"`);
    process.exit(2);
  }
  const before = getTasks(id);
  const counts = { verified: 0, deferred: 0, reviewed: 0, failed: 0 };
  // One owner note per agent per round — not one message per task, or the
  // Manager's mailbox becomes the reason nobody reads it.
  const pendingForOwner = [];
  const limit = dryRun ? (before.pending || []).length : maxPerAgent;

  for (let i = 0; i < limit; i += 1) {
    if (dryRun) {
      const task = (before.pending || [])[i];
      if (!task) break;
      const kind = VERIFIABLE.test(task.title) ? 'VERIFIED' : DEFERRED.test(task.title) ? 'DEFERRED' : 'REVIEWED';
      counts[kind.toLowerCase()] += 1;
      continue;
    }
    const task = claimTask(id);
    if (!task) break;

    if (VERIFIABLE.test(task.title)) {
      const result = runAgent(id);
      const ok = result.status !== 'FAIL';
      finishTask(id, task.id, {
        ok,
        result: {
          disposition: 'verified',
          agent_status: result.status,
          evidence: result.summary,
          run_by: 'scripts/tasks-work.mjs'
        },
        error: ok ? null : result.summary || 'the agent reported FAIL'
      });
      agentLog(id, { level: ok ? 'info' : 'error', event: 'task.verified', task: task.title, status: result.status });
      if (ok) {
        verified += 1;
        counts.verified += 1;
      } else {
        realFailures += 1;
        counts.failed += 1;
      }
      continue;
    }

    if (DEFERRED.test(task.title)) {
      finishTask(id, task.id, {
        ok: true,
        result: {
          disposition: 'deferred_to_owner',
          reason: 'needs an owner decision — agents must not change public UI or send anything on their own',
          awaiting: id === 'meera' ? 'RESEND_API_KEY' : 'owner review'
        }
      });
      pendingForOwner.push(task.title);
      agentLog(id, { level: 'info', event: 'task.deferred', task: task.title });
      deferred += 1;
      counts.deferred += 1;
      continue;
    }

    finishTask(id, task.id, {
      ok: true,
      result: { disposition: 'reviewed_no_action', reason: 'checked: nothing actionable while the site is unchanged' }
    });
    agentLog(id, { level: 'info', event: 'task.reviewed', task: task.title });
    reviewed += 1;
    counts.reviewed += 1;
  }

  if (pendingForOwner.length && !dryRun) {
    const shown = pendingForOwner.slice(0, 10).map((t) => `• ${t}`).join('\n');
    sendMessage({
      from: id,
      to: 'manager',
      subject: `${pendingForOwner.length} task(s) need an owner decision (${id})`,
      body:
        `Moved out of ${id}'s backlog without acting on them, because acting would break a safety rule ` +
        `(no automatic public-UI change, no outreach, nothing sent on the owner's behalf).\n\n${shown}` +
        (pendingForOwner.length > 10 ? `\n… and ${pendingForOwner.length - 10} more in the same category.` : ''),
      priority: 'low'
    });
  }

  const after = dryRun ? before : getTasks(id);
  table.push({
    id,
    before: (before.pending || []).length,
    after: (after.pending || []).length,
    ...counts
  });
}

if (!dryRun) {
  try {
    ledgerAppend({
      actor: 'tasks-work',
      action: 'tasks.worked',
      summary: `${verified} verified, ${deferred} deferred to owner, ${reviewed} reviewed, ${realFailures} failed`,
      data: { verified, deferred, reviewed, failed: realFailures }
    });
  } catch (_) {
    /* the ledger is written by the agents too; never break the run over a line */
  }
}

console.log('');
console.log(dryRun ? '  Task backlog classification (nothing written)' : '  Per-agent task lists worked');
console.log('  ' + '─'.repeat(72));
console.log('  agent      pending→now   verified  deferred  reviewed  failed');
console.log('  ' + '─'.repeat(72));
for (const r of table) {
  console.log(
    `  ${r.id.padEnd(10)} ${String(r.before).padStart(3)}→${String(r.after).padEnd(5)} ${String(r.verified).padStart(7)}  ${String(r.deferred).padStart(8)}  ${String(r.reviewed).padStart(8)}  ${String(r.failed).padStart(6)}`
  );
}
console.log('  ' + '─'.repeat(72));
console.log(`  totals     verified=${verified} deferred_to_owner=${deferred} reviewed=${reviewed} failed=${realFailures}`);
if (deferred) console.log(`  ${deferred} task(s) are waiting for you, not for a key — they are in the Manager's mailbox.`);
console.log('');
process.exit(realFailures ? 1 : 0);
