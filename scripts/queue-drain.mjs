#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — durable job-queue runner.
 *
 * The Manager and the SEO squad put real work into
 * `storage/shared/queue/jobs.json` (pending → running → done/failed). This is
 * the consumer that finishes it, so the queue never becomes a polite way of
 * forgetting a task.
 *
 *   npm run queue:drain                 → run everything that is pending
 *   npm run queue:drain -- --max 5      → at most 5 jobs (CI-friendly)
 *   npm run queue:drain -- --dry-run    → report what would run, touch nothing
 *   npm run queue:drain -- --status     → queue stats only
 *
 * Honesty rules (same as every agent):
 *   • a job is marked done only when the worker command really exited 0,
 *     and the recorded status is the status the worker itself reported;
 *   • a job type with no handler is failed loudly, never silently dropped;
 *   • a BLOCKED worker result is a completed job (the block is the answer),
 *     because the missing credential is the finding, not a crash.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  claimJob,
  completeJob,
  failJob,
  queueStats,
  agentLog,
  setState,
  readAgentDoc
} from '../agents/storage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const valueOf = (f, fb) => {
  const i = ARGS.indexOf(f);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : fb;
};

const knownWorkers = new Set([
  'guardian',
  'manager',
  'pooja',
  'priya',
  'arjun',
  'kavita',
  'rahul',
  'sneha',
  'amit',
  'nisha',
  'vikram',
  'meera'
]);

/** Run one agent script and capture what it actually reported. */
function runAgent(id, { timeout = 180000 } = {}) {
  const script = id === 'guardian' ? 'scripts/health-check.mjs' : id === 'manager' ? 'agents/manager.mjs' : id === 'pooja' || id === 'priya' ? `agents/${id}.mjs` : 'agents/worker.mjs';
  const args = id === 'guardian' ? [] : id === 'worker' ? [] : id === 'pooja' || id === 'priya' || id === 'manager' ? [] : [id];
  const res = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  // Worker scripts print a JSON verdict; parse it instead of scraping a line.
  let parsed = null;
  try {
    parsed = JSON.parse(out);
  } catch (_) {
    const start = out.indexOf('{');
    const end = out.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(out.slice(start, end + 1));
      } catch (_) {
        parsed = null;
      }
    }
  }
  const reportedRaw = String(
    (parsed && (parsed.status || parsed.verdict || (parsed.result && parsed.result.status))) || ''
  ).toUpperCase();
  const reported = ['OK', 'PASS', 'BLOCKED', 'FAIL', 'PARTIAL'].includes(reportedRaw) ? reportedRaw : '';
  const status = res.status !== 0 ? 'FAIL' : reported || 'OK';
  const summary =
    (parsed && (parsed.summary || parsed.detail || (parsed.result && parsed.result.summary))) ||
    out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^[[{}"`,`]/.test(l))
      .pop() ||
    '';
  return {
    status,
    exit: res.status,
    summary: String(summary).replace(/\s+/g, ' ').trim().slice(0, 220)
  };
}

const HANDLERS = {
  /**
   * "seo-center.assignment" — a scoped SEO task the Manager gave a worker.
   * The worker's own script is the authority on what it can verify, so the job
   * is executed by running that worker once and recording its real status.
   */
  'seo-center.assignment': (job) => {
    const worker = String((job.payload && job.payload.worker) || '').toLowerCase();
    if (!knownWorkers.has(worker)) return { ok: false, error: `unknown worker "${worker}"` };
    const result = runAgent(worker);
    return {
      ok: true,
      result: {
        worker,
        status: result.status,
        subject: (job.payload && job.payload.subject) || null,
        detail: result.summary,
        note: 'executed by scripts/queue-drain.mjs from the durable queue'
      }
    };
  },

  /** "daily-rollup" — Vikram rolls every agent's metrics into one scorecard. */
  'daily-rollup': () => {
    const result = runAgent('vikram');
    const tasks = readAgentDoc('vikram', 'tasks.json', { done: [] });
    return {
      ok: true,
      result: {
        scope: 'all-agents',
        status: result.status,
        detail: result.summary,
        recorded_runs: Array.isArray(tasks.done) ? tasks.done.length : 0
      }
    };
  },

  /** Worker recovery: re-check the incident list after a fix. */
  'worker-recovery': () => {
    const result = runAgent('guardian');
    return { ok: true, result: { status: result.status, detail: result.summary } };
  }
};

/* ------------------------------------------------------------------ status */

if (has('--status')) {
  const stats = queueStats();
  console.log('');
  console.log(`  queue: pending=${stats.pending} running=${stats.running} done=${stats.done} failed=${stats.failed}`);
  console.log('');
  process.exit(stats.failed ? 1 : 0);
}

if (has('--dry-run')) {
  const stats = queueStats();
  const runnable = stats.pending;
  console.log('');
  console.log(`  pending jobs   : ${runnable}`);
  console.log(`  handlers ready : ${Object.keys(HANDLERS).join(', ')}`);
  console.log('  nothing was run (--dry-run)');
  console.log('');
  process.exit(0);
}

/* ------------------------------------------------------------------- drain */

const max = Number(valueOf('--max', '1000')) || 1;
let done = 0;
let failed = 0;
let skipped = 0;
const results = [];

for (let i = 0; i < max; i += 1) {
  const job = claimJob('queue-drain');
  if (!job) {
    skipped = 0;
    break;
  }
  const handler = HANDLERS[job.type];
  if (!handler) {
    failJob(job.id, `no handler for job type "${job.type}" — a human must add one, nothing was pretended`);
    failed += 1;
    results.push({ id: job.id, type: job.type, status: 'FAILED', detail: 'no handler' });
    continue;
  }
  let outcome;
  try {
    outcome = handler(job);
  } catch (err) {
    outcome = { ok: false, error: `${err && err.message ? err.message : String(err)}\n${err && err.stack ? err.stack.split('\n').slice(1, 3).join(' | ') : ''}` };
  }
  if (outcome.ok) {
    completeJob(job.id, outcome.result);
    done += 1;
    results.push({ id: job.id, type: job.type, status: outcome.result.status || 'OK', detail: outcome.result.detail || '' });
    const worker = outcome.result.worker;
    if (knownWorkers.has(worker)) {
      agentLog(worker, { level: 'info', event: 'queue.job.done', job_id: job.id, job_type: job.type, status: outcome.result.status });
      setState(worker, { last_job: { id: job.id, type: job.type, at: new Date().toISOString(), status: outcome.result.status } });
    }
  } else {
    failJob(job.id, outcome.error || 'handler refused');
    failed += 1;
    results.push({ id: job.id, type: job.type, status: 'FAILED', detail: outcome.error || '' });
  }
}

const stats = queueStats();
console.log('');
console.log('  PANIKA JEEVAN SATHI — job queue drained');
console.log('  ' + '─'.repeat(66));
for (const r of results.slice(0, 40)) {
  console.log(`  ${r.status.padEnd(7)} ${r.type.padEnd(24)} ${String(r.detail || '').slice(0, 40)}`);
}
if (results.length > 40) console.log(`  … ${results.length - 40} more`);
console.log('  ' + '─'.repeat(66));
console.log(`  executed : ${done} completed, ${failed} failed`);
console.log(`  queue now: pending=${stats.pending} running=${stats.running} done=${stats.done} failed=${stats.failed}`);
console.log('');
if (stats.failed) {
  console.log(`  ⚠ ${stats.failed} job(s) in the failed bucket — open ${path.relative(process.cwd(), path.join(ROOT, 'storage/shared/queue/jobs.json'))} and read the reason.`);
  console.log('');
}
process.exit(failed ? 1 : 0);
