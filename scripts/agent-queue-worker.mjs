#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Shared Job Queue Worker (the missing consumer)
 * =====================================================================
 *
 *   node scripts/agent-queue-worker.mjs            # queue khaali kar do
 *   node scripts/agent-queue-worker.mjs --once     # ek hi job
 *   node scripts/agent-queue-worker.mjs --max 5
 *   node scripts/agent-queue-worker.mjs --json     # machine-readable
 *   node scripts/agent-queue-worker.mjs --watch 60 # har 60s dobara dekho
 *
 * Pehle `enqueue()` / `claimJob()` storage.mjs mein the, par *koi consumer
 * nahi tha* — isliye diye gaye orders pending mein pade reh jaate the.
 * Ye worker wahi kami poori karta hai: pending job claim karta hai, sahi
 * agent/script ko chalata hai, aur result wapas queue mein likhta hai
 * (done / failed), saath mein agent ke permanent store mein bhi.
 *
 * Supported job types (payload → action):
 *   agent-run   { agent }     → us agent ko chalao
 *   daily-rollup{ scope }     → Vikram (analytics rollup)
 *   orders      {}            → scripts/agent-orders.mjs (BLOCKED agents ke orders)
 *   full-cycle  { quick }     → scripts/agent-storage-cycle.mjs
 *   health      {}            → scripts/health-check.mjs
 *   live-check  { url }       → scripts/render-real-check.mjs
 *
 * Sachchai ke rules:
 *   • Job ka result wahi hota hai jo command ne actually diya (exit code +
 *     uska apna JSON status). Exit 0 + BLOCKED => BLOCKED, "done+OK" nahi.
 *   • Koi job chup-chaap gayab nahi hoti: har claim ka record queue mein.
 *   • Deploy / git push / social post / email — kabhi automatic nahi.
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as store from '../agents/storage.mjs';
import { AGENTS, agentById } from '../agents/roster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = 'queue-worker';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const asJSON = flag('--json');
const maxJobs = Number(value('--max', Infinity));
const once = flag('--once') || Number.isFinite(maxJobs);
const watchSeconds = Number(value('--watch', 0));

/** Agent id → command. Purane dedicated scripts preserve hain. */
function commandFor(agentId) {
  switch (agentId) {
    case 'guardian':
      return ['scripts/health-check.mjs'];
    case 'manager':
      return ['agents/manager.mjs'];
    case 'pooja':
      return ['agents/pooja.mjs'];
    case 'priya':
      return ['agents/priya.mjs'];
    default:
      return agentById(agentId) ? ['agents/worker.mjs', agentId] : null;
  }
}

function statusFromOutput(out) {
  const text = String(out || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const status = parsed && parsed.status;
    return ['OK', 'BLOCKED', 'FAIL'].includes(String(status)) ? String(status) : null;
  } catch {
    return null;
  }
}

function summarise(out) {
  const text = String(out || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && parsed.summary) return String(parsed.summary).slice(0, 220);
      if (parsed && parsed.reason) return String(parsed.reason).slice(0, 220);
    } catch {
      /* fall through */
    }
  }
  const tally = text.match(/(\d+)\s+passed,\s*(\d+) failed/i);
  if (tally) return `${tally[1]} passed, ${tally[2]} failed`;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^[{}[\]\s]*$/.test(l) && !/^[-─=]+$/.test(l));
  return (lines[lines.length - 1] || '(no output)').slice(0, 220);
}

function runCommand(args, env = {}) {
  const started = Date.now();
  try {
    const out = execFileSync(process.execPath, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10 * 60 * 1000,
      env: { ...process.env, ...env }
    });
    return { exit: 0, out, ms: Date.now() - started };
  } catch (err) {
    return {
      exit: typeof err.status === 'number' ? err.status : 1,
      out: String(err.stdout || '') + String(err.stderr || err.message || ''),
      ms: Date.now() - started
    };
  }
}

/** Job type → command. Unknown type => null (job FAIL hoga, chup nahi jaayega). */
function commandForJob(job) {
  const payload = job.payload || {};
  switch (job.type) {
    case 'agent-run': {
      const agent = String(payload.agent || '').toLowerCase();
      return commandFor(agent);
    }
    case 'daily-rollup':
      return commandFor('vikram');
    case 'orders':
      return ['scripts/agent-orders.mjs'];
    case 'full-cycle':
      return payload.quick === false
        ? ['scripts/agent-storage-cycle.mjs']
        : ['scripts/agent-storage-cycle.mjs', '--quick'];
    case 'health':
      return ['scripts/health-check.mjs'];
    case 'live-check':
      return payload.url
        ? ['scripts/render-real-check.mjs', '--url', String(payload.url)]
        : ['scripts/render-real-check.mjs'];
    default:
      return null;
  }
}

function targetAgentFor(job) {
  const payload = job.payload || {};
  if (job.type === 'agent-run') return String(payload.agent || '').toLowerCase();
  if (job.type === 'daily-rollup') return 'vikram';
  return null;
}

function processJob(job) {
  const args = commandForJob(job);
  if (!args) {
    const known = ['agent-run', 'daily-rollup', 'orders', 'full-cycle', 'health', 'live-check'];
    store.failJob(job.id, `unknown job type "${job.type}" (known: ${known.join(', ')})`);
    store.ledgerAppend({
      type: 'queue.failed',
      agent: WORKER,
      status: 'FAIL',
      summary: `unknown job type: ${job.type}`
    });
    return { id: job.id, type: job.type, status: 'FAIL', summary: `unknown job type: ${job.type}` };
  }

  const res = runCommand(args);
  const reported = statusFromOutput(res.out);
  const status = reported || (res.exit === 0 ? 'OK' : 'FAIL');
  const summary = summarise(res.out);
  const agentId = targetAgentFor(job);

  // Agent ka apna run record — worker.mjs PJS_CYCLE_MANAGED nahi dekhta yahan,
  // isliye queue worker khud likhta hai (ek hi source of truth).
  if (agentId && agentById(agentId)) {
    store.recordRun(agentId, {
      status,
      summary: `queue job ${job.id} (${job.type}): ${summary}`.slice(0, 400),
      duration_ms: res.ms,
      details: { job_id: job.id, job_type: job.type, command: args.join(' '), exit_code: res.exit }
    });
  }

  const record = {
    id: job.id,
    type: job.type,
    agent: agentId || null,
    status,
    exit_code: res.exit,
    duration_ms: res.ms,
    summary
  };

  if (status === 'FAIL') {
    store.failJob(job.id, summary);
    store.ledgerAppend({ type: 'queue.failed', agent: WORKER, status: 'FAIL', summary: `${job.type}: ${summary}` });
  } else {
    store.completeJob(job.id, record);
    store.ledgerAppend({ type: 'queue.completed', agent: WORKER, status, summary: `${job.type}: ${summary}` });
  }

  return record;
}

function pass() {
  const before = store.queueStats();
  const processed = [];

  // `--once` / `--max` maane jaate hain; warna queue khaali hone tak chalao.
  const limit = once ? (Number.isFinite(maxJobs) ? maxJobs : 1) : maxJobs;

  while (processed.length < limit) {
    const job = store.claimJob(WORKER);
    if (!job) break;
    processed.push(processJob(job));
  }

  const after = store.queueStats();
  return { before, after, processed };
}

function print(result) {
  if (asJSON) {
    console.log(JSON.stringify({ worker: WORKER, ...result }, null, 2));
    return;
  }
  console.log('==============================================');
  console.log(' PANIKA JEEVAN SATHI — JOB QUEUE WORKER');
  console.log('==============================================');
  console.log(`  queue before: pending=${result.before.pending} running=${result.before.running} done=${result.before.done} failed=${result.before.failed}`);
  if (!result.processed.length) {
    console.log('  koi pending job nahi — kuch nahi karna tha.');
  }
  for (const r of result.processed) {
    const mark = r.status === 'OK' ? '✓' : r.status === 'BLOCKED' ? '⚠' : '✗';
    console.log(`  ${mark} ${String(r.type).padEnd(13)} ${String(r.status).padEnd(8)} ${String(r.duration_ms + 'ms').padEnd(9)} ${String(r.summary).slice(0, 80)}`);
  }
  console.log(`  queue after : pending=${result.after.pending} running=${result.after.running} done=${result.after.done} failed=${result.after.failed}`);
  console.log('==============================================');
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

store.init({ agents: AGENTS });

let last = pass();
print(last);

while (watchSeconds > 0) {
  await sleep(watchSeconds * 1000);
  last = pass();
  print(last);
}

const anyFailure = last.processed.some((r) => r.status === 'FAIL');
process.exit(anyFailure ? 1 : 0);
