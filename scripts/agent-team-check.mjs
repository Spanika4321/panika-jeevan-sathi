#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Agent Team Contract Check
 * ===============================================
 *
 *   node scripts/agent-team-check.mjs
 *
 * Purana version sirf 6 files ka existence dekhta tha aur "PASS" bol deta tha —
 * matlab roster mein naya agent add ho jaaye, uska handler bhool jaaye, ya
 * storage toot jaaye, tab bhi PASS.
 *
 * Ab ye *contract* verify karta hai:
 *   1. Zaroori files maujood hain
 *   2. Safety switches on hain (UI preserve, no private-message reading)
 *   3. Roster aur worker handlers ek doosre se match karte hain
 *      (roster ka har generic worker actually chal sakta hai)
 *   4. Har agent ki permanent storage poori hai (state/tasks/log/metrics/…)
 *   5. Storage engine khud integrity check pass karta hai (doctor)
 *   6. Hierarchy wahi hai: Guardian (Sardar) → Manager → Workers
 *   7. Runtime state (streaks/incidents) sirf INFO — guardian ka scope,
 *      warna guardian↔team-check ka deadlock ban jaata hai
 *
 * Exit 0 = PASS, 1 = FAIL.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import * as store from '../agents/storage.mjs';
import { AGENTS, HIERARCHY, SAFETY, agentById, missingRequirements } from '../agents/roster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failed = false;
let passed = 0;

function ok(name, detail = '') {
  passed += 1;
  console.log(`PASS: ${name}${detail ? ` — ${detail}` : ''}`);
}

function bad(name, detail = '') {
  failed = true;
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Runtime observation — na PASS gina jaata hai, na FAIL karta hai. */
function info(name, detail = '') {
  console.log(`INFO: ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------- 1. required files present */

const required = [
  'agents/README.md', 'agents/config.json', 'agents/lib.mjs', 'agents/manager.mjs',
  'agents/pooja.mjs', 'agents/priya.mjs', 'agents/roster.mjs', 'agents/storage.mjs',
  'agents/worker.mjs', 'agents/recovery-policy.json'
];
const missingFiles = required.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missingFiles.length) bad('agent files present', `missing: ${missingFiles.join(', ')}`);
else ok('agent files present', `${required.length} files`);

/* ------------------------------------------------------ 2. safety switches */

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'agents/config.json'), 'utf8'));

if (config.safety?.preserve_public_ui !== true) bad('public UI preservation enabled');
else ok('public UI preservation enabled');

if (config.safety?.no_private_message_reading !== true) bad('private message protection enabled');
else ok('private message protection enabled');

if (config.daily?.backlink_opportunities !== 10) bad('backlink target is 10', `got ${config.daily?.backlink_opportunities}`);
else ok('backlink target is 10');

const safetyOff = Object.entries(SAFETY).filter(([, v]) => v !== true).map(([k]) => k);
if (safetyOff.length) bad('roster SAFETY flags all true', `off: ${safetyOff.join(', ')}`);
else ok('roster SAFETY flags all true', `${Object.keys(SAFETY).length} rules`);

/* ------------------------------------------------- 3. roster ↔ handlers match */

const DEDICATED = { guardian: 'scripts/health-check.mjs', manager: 'agents/manager.mjs', pooja: 'agents/pooja.mjs', priya: 'agents/priya.mjs' };
const genericWorkers = AGENTS.filter((a) => !DEDICATED[a.id]);

const workerSource = fs.readFileSync(path.join(ROOT, 'agents/worker.mjs'), 'utf8');
const handlerBlock = workerSource.slice(workerSource.indexOf('const HANDLERS'));
const withoutHandler = genericWorkers.filter((a) => !new RegExp(`\\b${a.id}\\b\\s*:`).test(handlerBlock));

if (withoutHandler.length) bad('every generic worker has a handler in agents/worker.mjs', withoutHandler.map((a) => a.id).join(', '));
else ok('every generic worker has a handler in agents/worker.mjs', `${genericWorkers.length} workers`);

for (const [id, file] of Object.entries(DEDICATED)) {
  if (!fs.existsSync(path.join(ROOT, file))) bad(`${id} has its dedicated script`, `missing ${file}`);
}
ok('dedicated agents keep their own scripts', Object.values(DEDICATED).join(', '));

/* --------------------------------------- 4. every agent's storage is complete */

store.init({ agents: AGENTS });
const listed = store.listAgents();
const notListed = AGENTS.map((a) => a.id).filter((id) => !listed.includes(id));
if (notListed.length) bad('every roster agent is registered in storage', notListed.join(', '));
else ok('every roster agent is registered in storage', `${listed.length} agents`);

const STORE_FILES = ['profile.json', 'state.json', 'memory.json', 'tasks.json', 'metrics.json', 'inbox.json', 'outbox.json', 'log.ndjson'];
const incomplete = listed.filter((id) =>
  STORE_FILES.some((f) => !fs.existsSync(path.join(store.agentDir(id), f)))
);
if (incomplete.length) bad('agent stores are complete', `incomplete: ${incomplete.join(', ')}`);
else ok('agent stores are complete', `${STORE_FILES.length} files × ${listed.length} agents`);

/* ------------------------------------------------------ 5. storage integrity */

const doctor = store.doctor();
if (!doctor.ok) bad('storage doctor passes', (doctor.checks || []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; '));
else ok('storage doctor passes', `ledger ${doctor.ledger.checked} entries / ${doctor.ledger.broken} broken`);

const ledger = store.ledgerVerify();
if (!ledger.ok) bad('ledger hash-chain verifies', `${ledger.problems || 0} problem(s)`);
else ok('ledger hash-chain verifies', `${ledger.checked} entries`);

/* ----------------------------------------------------------- 6. hierarchy */

const hierarchyOk =
  HIERARCHY.sardar === 'guardian' &&
  HIERARCHY.manager === 'manager' &&
  Array.isArray(HIERARCHY.workers) &&
  HIERARCHY.workers.length > 0 &&
  !HIERARCHY.workers.includes('guardian') &&
  !HIERARCHY.workers.includes('manager') &&
  AGENTS.length === 2 + HIERARCHY.workers.length &&
  AGENTS.every((a) => agentById(a.id));

if (!hierarchyOk) bad('hierarchy is Guardian → Manager → Workers', `${AGENTS.length} agents declared`);
else ok('hierarchy is Guardian → Manager → Workers', `1 sardar + 1 manager + ${HIERARCHY.workers.length} workers`);

/* ------------------------------------------ 7. runtime state (INFO, not PASS/FAIL)
 *
 * DEADLOCK jo yahan tha:
 *   guardian (health-check) khud is script ko section 11 rollup mein chalata hai.
 *   Ye script pehle "koi agent failure streak mein nahi hai" ko FAIL banati thi.
 *   Ek baar guardian ka run fail hua ⇒ uska recorded streak 1 ho gaya ⇒
 *   team-check FAIL ⇒ guardian FAIL ⇒ streak 2 … kabhi clear hi nahi hota,
 *   chahe code bilkul theek ho.
 *
 * Isliye: *contract* (code/roster/storage/hierarchy) PASS/FAIL deta hai;
 * *runtime state* (streaks, incidents, blocked agents ki ginti) sirf INFO hai.
 * Runtime health guardian ka kaam hai, team-check ka nahi — warna do checks
 * ek doosre ko fail karte rehte hain.
 */

const status = store.status();
const failing = status.agents.filter((a) => a.consecutive_failures > 0);
info('failure streaks (runtime state, guardian ka scope)',
  failing.length ? failing.map((a) => `${a.id}(${a.consecutive_failures})`).join(', ') : `none — ${status.agents.length} agents checked`);

const incidents = store.openIncidents();
info('open incidents (runtime state)',
  incidents.length ? `${incidents.length} open: ${incidents.map((i) => i.id).join(', ')}` : 'none');

/* --------------------------------------- 8. blocked agents name their blocker */

const blockedAgents = status.agents.filter((a) => a.status === 'BLOCKED');

/** Agent ne apne aakhri run mein khud koi wajah likhi thi? */
function statedReason(agentId) {
  const metrics = store.readAgentDoc(agentId, 'metrics.json', { history: [] });
  const history = Array.isArray(metrics.history) ? metrics.history : [];
  const last = history[history.length - 1];
  const summary = last && typeof last.summary === 'string' ? last.summary.trim() : '';
  // Sirf "BLOCKED" jaisa khaali status wajah nahi hai — pehle Manager wahi
  // likhta tha, aur usse koi ye nahi samajh paata tha ki karna kya hai.
  if (summary.length < 12) return '';
  if (/^blocked\.?$/i.test(summary)) return '';
  return summary;
}

const blockedWithoutReason = blockedAgents.filter((a) => {
  const agent = agentById(a.id);
  if (!agent) return false;
  // Wajah do tarah se valid hai:
  //   (a) roster kehta hai ki koi credential missing hai, ya
  //   (b) agent ne khud apne recorded run mein wajah likhi hai
  //       (jaise Rahul: "Network se … reach nahi ho paya (4 attempts)").
  if (missingRequirements(agent).length > 0) return false;
  if (statedReason(a.id)) return false;
  return true;
});
if (blockedWithoutReason.length) bad('every BLOCKED agent has a stated reason', blockedWithoutReason.map((a) => a.id).join(', '));
else ok('every BLOCKED agent has a stated reason', blockedAgents.length ? `${blockedAgents.length} blocked: ${blockedAgents.map((a) => a.id).join(', ')}` : 'none blocked right now');

/* ------------------------------------------- 9. each generic worker executes */

const brokenWorkers = [];
for (const agent of genericWorkers) {
  try {
    execFileSync(process.execPath, ['agents/worker.mjs', agent.id], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      env: { ...process.env, PJS_CYCLE_MANAGED: '1' } // double entry mat likho
    });
  } catch (err) {
    // BLOCKED worker exit 0 deta hai; FAIL exit 1 — dono yahan pakde jaate hain.
    brokenWorkers.push(`${agent.id} (exit ${err.status ?? '?'})`);
  }
}
if (brokenWorkers.length) bad('every generic worker executes', brokenWorkers.join(', '));
else ok('every generic worker executes', `${genericWorkers.length}/${genericWorkers.length}`);

/* ------------------------------------------- 10. unknown agent is rejected */

let unknownRejected = false;
try {
  execFileSync(process.execPath, ['agents/worker.mjs', 'no-such-agent'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  });
} catch (err) {
  unknownRejected = err.status === 2;
}
if (!unknownRejected) bad('unknown agent id is rejected with exit 2');
else ok('unknown agent id is rejected with exit 2');

/* ------------------------------------------------------------------ verdict */

console.log('');
console.log(`AGENT TEAM CHECK: ${failed ? 'FAIL' : 'PASS'} (${passed} passed)`);
process.exit(failed ? 1 : 0);
