#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — AI Agent Storage CLI
 * ==========================================
 *
 *   node scripts/agent-storage.mjs init       # storage tree + 12 agents
 *   node scripts/agent-storage.mjs status     # saare agents ki table
 *   node scripts/agent-storage.mjs list       # agent roster
 *   node scripts/agent-storage.mjs doctor     # integrity + retention check
 *   node scripts/agent-storage.mjs log pooja 20
 *   node scripts/agent-storage.mjs remember pooja focus keyword "panika shaadi"
 *   node scripts/agent-storage.mjs recall pooja focus
 *   node scripts/agent-storage.mjs task pooja "Verify sitemap.xml"
 *   node scripts/agent-storage.mjs kv set growth/week 2026-W36 on
 *   node scripts/agent-storage.mjs snapshot
 *   node scripts/agent-storage.mjs report     # human-readable markdown
 *   node scripts/agent-storage.mjs seed       # demo tasks + knowledge
 *
 * Env:
 *   PJS_AGENT_STORAGE_DIR      storage root override
 *   PJS_AGENT_STORAGE_BACKEND  file (default) | memory
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from '../agents/storage.mjs';
import { AGENTS, SAFETY, HIERARCHY } from '../agents/roster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(ROOT, 'reports', 'agents');

const [, , command = 'status', ...args] = process.argv;

/* ------------------------------------------------------------- helpers */

function pad(value, width) {
  return String(value ?? '').padEnd(width);
}

function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function dirSize(dir) {
  let total = 0;
  let files = 0;
  if (store.BACKEND === 'memory') {
    return { total: 0, files: 0 };
  }
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        files++;
        total += fs.statSync(full).size;
      }
    }
  };
  walk(dir);
  return { total, files };
}

/* ------------------------------------------------------------ commands */

function cmdInit() {
  const result = store.init({ agents: AGENTS });
  // Seed shared namespaces + knowledge so the store is useful from minute one.
  store.kvSet('project', 'name', 'PANIKA JEEVAN SATHI');
  store.kvSet('project', 'site', 'https://panikajeevansathi.onrender.com');
  store.kvSet('project', 'owner_email_file', '.report-recipient');
  store.kvSet('policy', 'safety', SAFETY);
  store.kvSet('policy', 'hierarchy', HIERARCHY);

  for (const agent of AGENTS) {
    store.remember(agent.id, 'role', agent.role, { longTerm: true });
    store.remember(agent.id, 'workflow', agent.workflow, { longTerm: true });
    store.remember(agent.id, 'requires', agent.requires.join(',') || 'none', { longTerm: true });
  }

  console.log('AI AGENT STORAGE INITIALISED');
  console.log('  dir      :', result.dir);
  console.log('  backend  :', result.backend);
  console.log('  agents   :', result.agents.length);
  for (const id of result.agents) {
    console.log('    •', pad(id, 10), store.agentDir(id).replace(ROOT + path.sep, ''));
  }
  console.log('\nPer-agent files: profile, state, memory, tasks, metrics, log.ndjson, inbox, outbox');
  return 0;
}

function cmdList() {
  console.log('AGENT ROSTER —', AGENTS.length, 'agents');
  console.log('');
  console.log(pad('ID', 10), pad('NAME', 22), pad('ROLE', 36), pad('CADENCE', 34), 'WORKFLOW');
  console.log('-'.repeat(120));
  for (const a of AGENTS) {
    console.log(
      pad(a.id, 10),
      pad(a.name, 22),
      pad(a.role, 36),
      pad(a.cadence, 34),
      a.workflow
    );
  }
  console.log('');
  console.log('Storage locations:');
  for (const a of AGENTS) {
    console.log('  ', pad(a.id, 10), `storage/agents/${a.id}/`);
  }
  return 0;
}

function cmdStatus() {
  const status = store.status();
  const size = dirSize(store.STORAGE_DIR);

  console.log('================================================================');
  console.log(' PANIKA JEEVAN SATHI — AI AGENT STORAGE STATUS');
  console.log('================================================================');
  console.log(' generated :', status.generated_at);
  console.log(' backend   :', status.backend);
  console.log(' dir       :', status.dir.replace(ROOT + path.sep, ''));
  console.log(' size      :', bytes(size.total), `(${size.files} files)`);
  console.log(' agents    :', status.agents.length);
  console.log('');

  console.log(
    pad('AGENT', 10),
    pad('LAST STATUS', 14),
    pad('RUNS', 6),
    pad('PENDING', 9),
    pad('DONE', 6),
    pad('UNREAD', 8),
    'LAST RUN'
  );
  console.log('-'.repeat(100));
  for (const a of status.agents) {
    console.log(
      pad(a.id, 10),
      pad(a.status, 14),
      pad(a.runs, 6),
      pad(a.pending_tasks, 9),
      pad(a.done_tasks, 6),
      pad(a.unread, 8),
      a.last_run_at || 'never'
    );
  }

  console.log('');
  console.log('SHARED STORAGE');
  console.log('  job queue   :', JSON.stringify(status.queue));
  console.log('  kv namespaces:', status.namespaces.join(', ') || '(none)');
  console.log('  knowledge   :', status.knowledge.join(', ') || '(none)');
  console.log('  snapshots   :', status.snapshots.length);
  console.log('  open incidents:', status.open_incidents.length);
  console.log(
    '  ledger      :',
    status.ledger.ok
      ? `OK (${status.ledger.checked} entries)`
      : `BROKEN (${status.ledger.broken} problems)`
  );

  if (status.open_incidents.length) {
    console.log('');
    console.log('OPEN INCIDENTS');
    for (const i of status.open_incidents) {
      console.log(`  [${i.severity}] ${i.id} — ${i.title} (x${i.occurrences})`);
    }
  }
  return 0;
}

function cmdDoctor() {
  const report = store.doctor();
  console.log('AI AGENT STORAGE — DOCTOR');
  console.log('  backend:', report.backend);
  console.log('  dir    :', report.dir);
  console.log('');
  for (const check of report.checks) {
    console.log(`  ${check.ok ? '✓' : '✗'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  console.log('');
  console.log('  agents   :', report.agents);
  console.log('  files    :', report.files);
  console.log('  snapshots:', report.snapshots);
  console.log('  queue    :', JSON.stringify(report.queue));
  console.log('  ledger   :', report.ledger.checked, 'entries /', report.ledger.broken, 'broken');
  console.log('  incidents:', report.openIncidents, 'open');
  console.log('');
  console.log('DOCTOR:', report.ok ? 'PASS' : 'FAIL');
  return report.ok ? 0 : 1;
}

function cmdLog() {
  const [id, countArg] = args;
  if (!id) {
    console.error('Usage: node scripts/agent-storage.mjs log <agent> [count]');
    return 1;
  }
  const count = Number(countArg || 20);
  const entries = store.readLog(id).slice(-count);
  console.log(`${id} — last ${entries.length} log entries`);
  for (const entry of entries) {
    console.log(' ', JSON.stringify(entry));
  }
  return 0;
}

function cmdRemember() {
  const [id, key, ...rest] = args;
  if (!id || !key || !rest.length) {
    console.error('Usage: node scripts/agent-storage.mjs remember <agent> <key> <value...>');
    return 1;
  }
  const longTerm = process.argv.includes('--long');
  store.remember(id, key, rest.join(' '), { longTerm });
  console.log(`stored ${id}.${key} (${longTerm ? 'long_term' : 'short_term'})`);
  return 0;
}

function cmdRecall() {
  const [id, key, longFlag] = args;
  if (!id || !key) {
    console.error('Usage: node scripts/agent-storage.mjs recall <agent> <key> [--long]');
    return 1;
  }
  const value = store.recall(id, key, { longTerm: longFlag === '--long' });
  if (value === undefined) {
    console.log('(not set)');
    return 1;
  }
  console.log(value);
  return 0;
}

function cmdTask() {
  const [id, ...rest] = args;
  if (!id || !rest.length) {
    console.error('Usage: node scripts/agent-storage.mjs task <agent> "<title>"');
    return 1;
  }
  const task = store.addTask(id, { title: rest.join(' ') });
  console.log('task queued:', task.id, '—', task.title);
  return 0;
}

function cmdKv() {
  const [action, ns, key, ...rest] = args;
  if (!action || !ns) {
    console.error('Usage: node scripts/agent-storage.mjs kv <set|get|list|delete> <namespace> [key] [value]');
    return 1;
  }
  if (action === 'set') {
    if (!key) return 1;
    store.kvSet(ns, key, rest.join(' '));
    console.log(`kv:${ns}/${key} set`);
    return 0;
  }
  if (action === 'get') {
    const value = store.kvGet(ns, key);
    console.log(value === undefined ? '(not set)' : value);
    return 0;
  }
  if (action === 'delete') {
    store.kvDelete(ns, key);
    console.log(`kv:${ns}/${key} deleted`);
    return 0;
  }
  if (action === 'list') {
    for (const item of store.kvList(ns)) {
      console.log(` ${pad(item.key, 28)} ${JSON.stringify(item.value)}`);
    }
    return 0;
  }
  console.error('Unknown kv action:', action);
  return 1;
}

function cmdSnapshot() {
  const [label] = args;
  const manifest = store.snapshot(label || null);
  console.log('snapshot created:', manifest.name);
  console.log('  files:', manifest.files.length);
  console.log('  bytes:', bytes(manifest.bytes));
  console.log('  dir  :', path.relative(ROOT, path.join(store.PATHS.snapshots, manifest.name)));
  return 0;
}

function cmdSeed() {
  const planned = {
    pooja: [
      'Review robots.txt for blocked public pages',
      'Validate sitemap.xml entry list',
      'Draft 10 genuine backlink targets (no paid/spam)',
      'Check canonical + meta description on index.html'
    ],
    priya: [
      'Draft this week community campaign (Facebook-safe)',
      'Prepare 5 content-calendar posts',
      'List referral ideas for the Panika community'
    ],
    arjun: [
      'Curate matrimonial/community directory targets',
      'Reject paid link networks from the target list'
    ],
    kavita: [
      'Draft "Panika community matrimony guide" article',
      'Suggest internal links between public pages'
    ],
    rahul: [
      'Sample site reachability',
      'Record response-time trend'
    ],
    sneha: [
      'Verify noindex on every private page',
      'Verify security headers on every response',
      'Scan repo for accidentally committed secrets'
    ],
    amit: [
      'Compute aggregate profile-completeness score',
      'Suggest match-quality improvements'
    ],
    nisha: [
      'Add 5 FAQ entries to the shared knowledge base',
      'Summarise recurring support themes'
    ],
    vikram: [
      'Build daily agent scorecard',
      'Compute queue throughput'
    ],
    meera: [
      'Compose owner email from verified step outcomes'
    ]
  };

  let created = 0;
  for (const [id, titles] of Object.entries(planned)) {
    for (const title of titles) {
      store.addTask(id, { title });
      created++;
    }
  }

  store.putKnowledge('faq', [
    { q: 'Kya site bilkul free hai?', a: 'Haan — registration, search, interests aur messaging sab free hain.', tags: ['pricing'] },
    { q: 'Profile kaise verify hota hai?', a: 'Email verification link se. Admin panel se manual review bhi ho sakta hai.', tags: ['verification'] },
    { q: 'Photo kaise upload karein?', a: 'Edit Profile page se. Photos sirf aapke account se judi hoti hain.', tags: ['photos'] },
    { q: 'Shortlist kya hai?', a: 'Aapki pasand ke profiles ki private list — doosre users ise nahi dekh sakte.', tags: ['privacy'] },
    { q: 'Password bhool gaye?', a: 'Login page par "Forgot password" se reset link bheja ja sakta hai.', tags: ['account'] }
  ]);

  store.putKnowledge('seo-baseline', [
    { page: '/index.html', must_have: ['title', 'meta description', 'canonical', 'lang'], tags: ['seo'] },
    { page: '/about.html', must_have: ['title', 'meta description'], tags: ['seo'] },
    { page: '/contact.html', must_have: ['title', 'meta description'], tags: ['seo'] },
    { file: 'robots.txt', must_have: ['sitemap declaration', 'private pages disallowed'], tags: ['seo'] },
    { file: 'sitemap.xml', must_have: ['public pages only'], tags: ['seo'] }
  ]);

  store.enqueue({ type: 'daily-rollup', payload: { scope: 'all-agents' }, priority: 'high' });

  console.log(`seeded ${created} tasks across ${Object.keys(planned).length} agents`);
  console.log('seeded knowledge: faq, seo-baseline');
  console.log('seeded 1 shared job (daily-rollup)');
  return 0;
}

function cmdReport() {
  const status = store.status();
  const doctor = store.doctor();
  const size = dirSize(store.STORAGE_DIR);
  const roster = new Map(AGENTS.map((a) => [a.id, a]));

  const lines = [];
  lines.push('# PANIKA JEEVAN SATHI — AI Agent Storage Report');
  lines.push('');
  lines.push(`Generated: ${status.generated_at}`);
  lines.push('');
  lines.push('## 1. Overview');
  lines.push('');
  lines.push('| Item | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Storage engine version | ${status.version} |`);
  lines.push(`| Backend | ${status.backend} |`);
  lines.push(`| Location | \`${path.relative(ROOT, status.dir)}/\` |`);
  lines.push(`| Size on disk | ${bytes(size.total)} (${size.files} files) |`);
  lines.push(`| Agents with permanent storage | ${status.agents.length} |`);
  lines.push(`| Shared KV namespaces | ${status.namespaces.length} |`);
  lines.push(`| Knowledge topics | ${status.knowledge.length} |`);
  lines.push(`| Snapshots | ${status.snapshots.length} |`);
  lines.push(`| Open incidents | ${status.open_incidents.length} |`);
  lines.push(`| Ledger integrity | ${status.ledger.ok ? 'OK' : 'BROKEN'} (${status.ledger.checked} entries) |`);
  lines.push('');
  lines.push('## 2. Agent storage inventory');
  lines.push('');
  lines.push('| Agent | Role | Storage path | Runs | Last status | Pending tasks | Unread |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const a of status.agents) {
    const meta = roster.get(a.id) || {};
    lines.push(
      `| **${a.name}** (\`${a.id}\`) | ${a.role} | \`storage/agents/${a.id}/\` | ${a.runs} | ${a.status} | ${a.pending_tasks} | ${a.unread} |`
    );
  }
  lines.push('');
  lines.push('Har agent ke andar ye 8 files hote hain:');
  lines.push('');
  lines.push('| File | Kya rakhta hai |');
  lines.push('| --- | --- |');
  lines.push('| `profile.json` | naam, role, capabilities, requirements |');
  lines.push('| `state.json` | status, run count, last run, failure streak |');
  lines.push('| `memory.json` | short-term + long-term memory, facts |');
  lines.push('| `tasks.json` | pending / running / done / failed task queues |');
  lines.push('| `metrics.json` | counters + pichhle 200 run ka history |');
  lines.push('| `log.ndjson` | append-only run log (500 entries + archive) |');
  lines.push('| `inbox.json` | doosre agents se aaye messages |');
  lines.push('| `outbox.json` | is agent ne bheje messages |');
  lines.push('');
  lines.push('## 3. Shared storage');
  lines.push('');
  lines.push('| Bucket | Path | Kya rakhta hai |');
  lines.push('| --- | --- | --- |');
  lines.push('| KV namespaces | `storage/shared/kv/` | agents ke beech shared values |');
  lines.push('| Job queue | `storage/shared/queue/jobs.json` | durable pending/running/done/failed jobs |');
  lines.push('| Ledger | `storage/shared/ledger/` | append-only hash-chained audit trail |');
  lines.push('| Incidents | `storage/shared/incidents/` | open incidents + history |');
  lines.push('| Knowledge | `storage/shared/knowledge/` | FAQ / SEO baseline docs |');
  lines.push('| Snapshots | `storage/snapshots/` | last 7 full snapshots |');
  lines.push('');
  lines.push(`Job queue: ${JSON.stringify(status.queue)}`);
  lines.push('');
  lines.push('## 4. Integrity check (doctor)');
  lines.push('');
  lines.push('| Check | Result | Detail |');
  lines.push('| --- | --- | --- |');
  for (const check of doctor.checks) {
    lines.push(`| ${check.name} | ${check.ok ? 'PASS' : 'FAIL'} | ${check.detail || '—'} |`);
  }
  lines.push('');
  lines.push(`**Doctor verdict: ${doctor.ok ? 'PASS' : 'FAIL'}**`);
  lines.push('');

  if (status.open_incidents.length) {
    lines.push('## 5. Open incidents');
    lines.push('');
    for (const i of status.open_incidents) {
      lines.push(`- \`[${i.severity}]\` **${i.title}** — agent \`${i.agent}\`, ${i.occurrences}x since ${i.opened_at}`);
      if (i.detail) lines.push(`  - ${i.detail}`);
    }
    lines.push('');
  }

  lines.push('## Safety rules enforced by the storage layer');
  lines.push('');
  lines.push('- Storage sirf `storage/` ke andar likhta hai — path traversal blocked.');
  lines.push('- Password, session token ya private message kabhi store nahi hota.');
  lines.push('- Storage layer khud deploy / git push / social post nahi karta.');
  lines.push('- Corrupt JSON crash nahi karta — doctor use report karta hai.');
  lines.push('- Ledger hash-chained hai: ek line bhi badli to verify FAIL.');
  lines.push('');

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const file = path.join(REPORT_DIR, 'agent-storage-report.md');
  fs.writeFileSync(file, lines.join('\n') + '\n');

  console.log('report written:', path.relative(ROOT, file));
  return 0;
}

function cmdQueue() {
  const stats = store.queueStats();
  const file = path.join(store.PATHS.queue, 'jobs.json');
  const q = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('JOB QUEUE');
  console.log(`  file   : ${path.relative(ROOT, file)}`);
  console.log(`  pending: ${stats.pending}   running: ${stats.running}   done: ${stats.done}   failed: ${stats.failed}`);
  console.log(`  updated: ${stats.updated_at || 'never'}`);
  const show = (label, list) => {
    if (!list || !list.length) return;
    console.log(`\n  ${label}:`);
    for (const job of list) {
      console.log(`    • ${job.id} [${job.type}] ${job.priority || 'normal'} created=${job.created_at}${job.finished_at ? ` finished=${job.finished_at}` : ''}${job.result ? ` → ${job.result.status || 'ok'}` : ''}${job.error ? ` → ERROR: ${job.error}` : ''}`);
    }
  };
  show('pending', q.pending);
  show('running', q.running);
  show('failed', q.failed);
  show('done (last 10)', (q.done || []).slice(-10));
  if (stats.pending > 0) {
    console.log('\n  Pending jobs chalane ke liye: node scripts/agent-queue-worker.mjs');
  }
  return 0;
}

function cmdHelp() {
  console.log(`AI Agent Storage CLI

  node scripts/agent-storage.mjs init      # storage tree + ${AGENTS.length} agents create karo
  node scripts/agent-storage.mjs status    # sab agents ki status table
  node scripts/agent-storage.mjs queue     # shared job queue (pending/running/done/failed)
  node scripts/agent-storage.mjs list      # agent roster
  node scripts/agent-storage.mjs doctor    # integrity + retention check
  node scripts/agent-storage.mjs log <agent> [n]
  node scripts/agent-storage.mjs remember <agent> <key> <value> [--long]
  node scripts/agent-storage.mjs recall <agent> <key> [--long]
  node scripts/agent-storage.mjs task <agent> "<title>"
  node scripts/agent-storage.mjs kv set|get|list|delete <ns> [key] [value]
  node scripts/agent-storage.mjs snapshot [label]
  node scripts/agent-storage.mjs seed      # demo tasks + knowledge base
  node scripts/agent-storage.mjs report    # markdown report
`);
  return 0;
}

/* --------------------------------------------------------------- main */

function main() {
  switch (command) {
    case 'init':
      return cmdInit();
    case 'list':
      return cmdList();
    case 'status':
      return cmdStatus();
    case 'queue':
      return cmdQueue();
    case 'doctor':
      return cmdDoctor();
    case 'log':
      return cmdLog();
    case 'remember':
      return cmdRemember();
    case 'recall':
      return cmdRecall();
    case 'task':
      return cmdTask();
    case 'kv':
      return cmdKv();
    case 'snapshot':
      return cmdSnapshot();
    case 'seed':
      return cmdSeed();
    case 'report':
      return cmdReport();
    case 'help':
    case '--help':
    case '-h':
      return cmdHelp();
    default:
      console.error(`Unknown command: ${command}`);
      cmdHelp();
      return 1;
  }
}

process.exit(main());
