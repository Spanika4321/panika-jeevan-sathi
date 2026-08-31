#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Order Desk (jo agent kaam nahi kar raha, usse order)
 * ==========================================================================
 *
 *   node scripts/agent-orders.mjs            # orders banao + queue mein daalo
 *   node scripts/agent-orders.mjs --dry-run  # sirf dikhao, kuch likho mat
 *   node scripts/agent-orders.mjs --json
 *
 * Ye script *andaaza* nahi lagata. Wo agents ke apne recorded runs
 * (`storage/agents/<id>/state.json`) aur roster ki `requires` list padhta hai,
 * phir har non-working agent ke liye ek concrete order banata hai:
 *
 *   BLOCKED (credentials chahiye) → order = "ye exact env keys chahiye"
 *                                   + owner ke liye clear instruction.
 *                                   Local kaam jo ho sakta hai wo queue mein.
 *   FAIL                          → order = dobara chalao + incident khula hai.
 *   NEVER_RUN                     → order = pehla run queue mein.
 *   OK                            → koi order nahi (agent kaam kar raha hai).
 *
 * Har order do jagah jaata hai:
 *   1. agent ke apne task list mein  (storage/agents/<id>/tasks.json)
 *   2. shared job queue mein         (storage/shared/queue/jobs.json)
 *      → `node scripts/agent-queue-worker.mjs` unhe actually chalata hai.
 *
 * Kya automatic NAHI hota: deploy, git push, social posting, email, payment.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from '../agents/storage.mjs';
import { AGENTS, HIERARCHY, missingRequirements, agentById } from '../agents/roster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(ROOT, 'reports', 'agents');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const asJSON = argv.includes('--json');

/** Owner ke liye exact instruction — kaunsi key, kahan set karni hai. */
const KEY_HELP = {
  GOOGLE_SEARCH_CONSOLE_TOKEN: 'Google Search Console → API token (SEO data ke liye)',
  GEMINI_API_KEY: 'Google AI Studio → GEMINI_API_KEY (AI analysis ke liye)',
  META_ACCESS_TOKEN: 'Meta for Developers → page access token',
  META_PAGE_ID: 'Meta → Facebook page ID',
  RESEND_API_KEY: 'Resend.com → API key (owner email reports ke liye)',
  SITE_URL: 'Production URL (default: https://panikajeevansathi.onrender.com)'
};

function orderFor(agent, state) {
  const missing = missingRequirements(agent);
  // NOTE: store.status() ka summary field `status` hai (state file ka
  // `last_status` usme map ho jaata hai) — `last_status` yahan undefined hota.
  const status = state.status || state.last_status || 'NEVER_RUN';

  if (status === 'OK') return null;

  const base = {
    agent: agent.id,
    name: agent.name,
    role: agent.role,
    reports_to: agent.reports_to,
    current_status: status,
    last_run_at: state.last_run_at || null,
    created_at: new Date().toISOString(),
    source: 'agent-orders.mjs'
  };

  if (missing.length) {
    return {
      ...base,
      kind: 'credentials-needed',
      title: `${agent.name} BLOCKED — ${missing.length} credential(s) chahiye`,
      needs: missing.map((key) => ({ env: key, how: KEY_HELP[key] || 'project secret / env variable' })),
      owner_action: `Ye env keys set karein (Render dashboard → Environment, ya GitHub → Secrets): ${missing.join(', ')}`,
      local_work_possible: true,
      queue: { type: 'agent-run', payload: { agent: agent.id }, priority: agent.priority === 'critical' ? 'high' : 'normal' },
      note: 'Keys milne tak agent local analysis karta rahega aur BLOCKED hi report karega — fake PASS kabhi nahi.'
    };
  }

  if (status === 'FAIL') {
    return {
      ...base,
      kind: 'repair',
      title: `${agent.name} FAIL hua — dobara chalao aur incident band karo`,
      owner_action: 'Neeche ka order queue worker se chalega; FAIL repeat ho to incident register dekhein.',
      local_work_possible: true,
      queue: { type: 'agent-run', payload: { agent: agent.id }, priority: 'high' }
    };
  }

  if (status === 'BLOCKED') {
    // Credentials ki kami nahi — kisi aur wajah se BLOCKED (jaise Manager, jo
    // apne workers ke BLOCKED hone par khud BLOCKED report karta hai).
    // Ise "chala hi nahi" mat bolo — wo chala tha, aur usne sach bataya tha.
    return {
      ...base,
      kind: 'blocked-dependency',
      title: `${agent.name} BLOCKED — dependents/wajah dekhni hai (run hua tha, ${state.last_run_at || 'time unknown'})`,
      owner_action: 'Iska reason uske report mein hai (reports/agents/*-latest.json). Queue worker dobara chala kar taaza status laayega.',
      local_work_possible: true,
      queue: { type: 'agent-run', payload: { agent: agent.id }, priority: 'normal' }
    };
  }

  return {
    ...base,
    kind: 'first-run',
    title: `${agent.name} abhi tak chala hi nahi — pehla run queue mein`,
    owner_action: 'Kuch nahi karna — queue worker pehla run khud karega.',
    local_work_possible: true,
    queue: { type: 'agent-run', payload: { agent: agent.id }, priority: 'normal' }
  };
}

function main() {
  store.init({ agents: AGENTS });
  const status = store.status();
  const stateById = new Map(status.agents.map((a) => [a.id, a]));

  const orders = [];
  const healthy = [];

  for (const agent of AGENTS) {
    const state = stateById.get(agent.id) || {};
    const order = orderFor(agent, state);
    if (order) orders.push(order);
    else healthy.push(agent.id);
  }

  const enqueued = [];
  const tasksAdded = [];

  if (!dryRun) {
    for (const order of orders) {
      // 1) Agent ke apne task list mein.
      store.addTask(order.agent, {
        title: order.title,
        priority: order.queue ? order.queue.priority : 'normal',
        source: 'order-desk',
        needs: (order.needs || []).map((n) => n.env)
      });
      tasksAdded.push(order.agent);

      // 2) Shared job queue mein — queue worker ise actually chalata hai.
      if (order.queue) {
        const job = store.enqueue({
          ...order.queue,
          id: `order_${order.agent}_${order.kind}`,
          payload: { ...order.queue.payload, order_kind: order.kind, ordered_by: 'owner-via-agent-orders' }
        });
        enqueued.push(job.id);
      }

      // 3) Manager ko message — hierarchy ke hisaab se escalation.
      store.sendMessage({
        from: 'guardian',
        to: order.reports_to === 'guardian' ? 'guardian' : 'manager',
        subject: order.title,
        body: order.owner_action,
        priority: order.kind === 'repair' ? 'high' : 'normal'
      });
    }

    store.ledgerAppend({
      type: 'orders.issued',
      agent: 'guardian',
      status: orders.length ? 'OK' : 'OK',
      summary: `${orders.length} order(s) issued; ${healthy.length} agent(s) already OK`
    });
  }

  const doc = {
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    hierarchy: HIERARCHY,
    totals: {
      agents: AGENTS.length,
      healthy: healthy.length,
      ordered: orders.length,
      blocked_on_credentials: orders.filter((o) => o.kind === 'credentials-needed').length,
      blocked_on_dependency: orders.filter((o) => o.kind === 'blocked-dependency').length,
      needs_repair: orders.filter((o) => o.kind === 'repair').length,
      never_run: orders.filter((o) => o.kind === 'first-run').length
    },
    healthy,
    orders,
    enqueued_jobs: enqueued,
    tasks_added_for: tasksAdded,
    queue: dryRun ? store.queueStats() : store.queueStats(),
    next_step: dryRun
      ? 'node scripts/agent-orders.mjs   (phir: node scripts/agent-queue-worker.mjs)'
      : 'node scripts/agent-queue-worker.mjs'
  };

  if (!dryRun) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'orders.json'), JSON.stringify(doc, null, 2) + '\n');

    const md = [];
    md.push('# Agent Orders — kaun kaam nahi kar raha aur kya karna hai');
    md.push('');
    md.push(`Time: ${doc.generated_at} · Agents: ${doc.totals.agents} · Healthy: ${doc.totals.healthy} · Orders: ${doc.totals.ordered}`);
    md.push('');
    md.push('| Agent | Role | Status | Order | Owner ko kya karna hai |');
    md.push('| --- | --- | --- | --- | --- |');
    for (const o of orders) {
      md.push(`| ${o.name} (\`${o.agent}\`) | ${o.role} | ${o.current_status} | ${o.kind} | ${o.owner_action.replace(/\|/g, '\\|')} |`);
    }
    md.push('');
    if (doc.totals.blocked_on_credentials) {
      md.push('## Credentials jo chahiye (BLOCKED agents)');
      md.push('');
      for (const o of orders.filter((x) => x.kind === 'credentials-needed')) {
        for (const n of o.needs) md.push(`- \`${n.env}\` — ${n.how} → ${o.name}`);
      }
      md.push('');
    }
    md.push(`Queue: pending=${doc.queue.pending} · Orders queue mein: ${enqueued.length}`);
    md.push('');
    md.push('Next: `node scripts/agent-queue-worker.mjs`');
    md.push('');
    fs.writeFileSync(path.join(REPORT_DIR, 'orders.md'), md.join('\n'));
  }

  if (asJSON) {
    console.log(JSON.stringify(doc, null, 2));
  } else {
    console.log('==============================================');
    console.log(' PANIKA JEEVAN SATHI — ORDER DESK');
    console.log('==============================================');
    console.log(`  agents      : ${doc.totals.agents} (${doc.totals.healthy} healthy)`);
    console.log(`  orders      : ${doc.totals.ordered}`);
    for (const o of orders) {
      console.log(`  • ${String(o.agent).padEnd(9)} ${o.current_status.padEnd(9)} ${o.kind.padEnd(20)} ${o.title}`);
    }
    if (healthy.length) console.log(`  healthy     : ${healthy.join(', ')}`);
    console.log(`  queue       : pending=${doc.queue.pending} running=${doc.queue.running} done=${doc.queue.done} failed=${doc.queue.failed}`);
    if (!dryRun) {
      console.log(`  reports     : reports/agents/orders.json · orders.md`);
      console.log(`  next        : ${doc.next_step}`);
    }
    console.log('==============================================');
  }

  // Orders hona failure nahi hai — ye system ka kaam hai.
  return 0;
}

process.exit(main());
