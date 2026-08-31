#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Agent Storage Cycle
 * =========================================
 *
 *   node scripts/agent-storage-cycle.mjs            # poora cycle
 *   node scripts/agent-storage-cycle.mjs --quick     # sirf storage agents
 *
 * Ye script saare agents ko storage-aware banata hai:
 *   1. Storage init (agar nahi hai to ban jaata hai)
 *   2. Har agent chalta hai — pooja/priya/guardian apne purane scripts se,
 *      baaki workers agents/worker.mjs se
 *   3. Har run ka result storage mein record hota hai
 *      (state + metrics + log + ledger + incident register)
 *   4. End mein snapshot + markdown/JSON report
 *
 * GitHub Actions par storage `actions/cache` se run ke beech preserve hota
 * hai, isliye agents ki memory har run ke saath badhti rehti hai.
 *
 * Kya ye khud nahi karta: deploy, git push, social posting, email.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as store from '../agents/storage.mjs';
import { AGENTS, agentById } from '../agents/roster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(ROOT, 'reports', 'agents');

const quick = process.argv.includes('--quick');

/** Har agent ka command. Purane agents ke scripts hamesha preserve rahte hain. */
function commandFor(agent) {
  switch (agent.id) {
    case 'guardian':
      return ['scripts/health-check.mjs'];
    case 'manager':
      return ['agents/manager.mjs'];
    case 'pooja':
      return ['agents/pooja.mjs'];
    case 'priya':
      return ['agents/priya.mjs'];
    default:
      return ['agents/worker.mjs', agent.id];
  }
}

function runCommand(id, args) {
  const started = Date.now();
  try {
    const out = execFileSync(process.execPath, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10 * 60 * 1000,
      // Child agents ko batao ki cycle runner record karega (double-entry avoid).
      env: { ...process.env, PJS_CYCLE_MANAGED: '1' }
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

/** Agent ke JSON output se uska khud report kiya hua status nikalo. */
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

function summarise(id, out) {
  const text = String(out || '').trim();
  if (!text) return '(no output)';

  // 1) JSON output (Pooja / Priya / workers) — status + summary field.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object') {
        if (parsed.status && parsed.summary) {
          return `${parsed.status} — ${String(parsed.summary).slice(0, 180)}`;
        }
        // Alag-alag agents alag field naam use karte hain — sab ko samjho.
        const reasonField = parsed.summary || parsed.reason || parsed.detail || parsed.message;
        if (reasonField) {
          const text = String(reasonField).slice(0, 180);
          return parsed.status ? `${parsed.status} — ${text}` : text;
        }
        // Manager report: workers + guardian ka status jodo.
        // NOTE: ye branch pehle `if (parsed.status) return parsed.status` ke
        // *baad* tha, isliye Manager ka recorded summary sirf "BLOCKED" ban
        // jaata tha — jisse kisi ko wajah pata hi nahi chalti thi (aur
        // agent-team-check ka "stated reason" check FAIL hota tha).
        if (parsed.workers || parsed.guardian) {
          const w = parsed.workers || {};
          const parts = Object.entries(w).map(([id, v]) => `${id}=${v?.status || '?'}`);
          if (parsed.guardian) parts.push(`guardian=${parsed.guardian.status || '?'}`);
          const blockedNote = Array.isArray(parsed.blocked) && parsed.blocked.length
            ? ` | blocked: ${parsed.blocked.map((b) => (typeof b === 'string' ? b : b.agent || b.id || '?')).join(', ')}`
            : '';
          return `manager cycle — ${parts.join(' ')}${blockedNote}`.slice(0, 200);
        }
        // Bare status word ("BLOCKED") wajah nahi hai — usse summary mat banao.
        if (parsed.status) return `${parsed.status} — (report mein alag summary nahi thi)`;
      }
    } catch {
      /* fall through */
    }
  }

  // 2) Guardian style: "95 passed, 0 failed".
  const tally = text.match(/(\d+)\s+passed,\s*(\d+)\s+failed/i);
  if (tally) return `${tally[1]} passed, ${tally[2]} failed`;

  // 3) Fallback: last meaningful line (braces / separators chhod kar).
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^[{}[\]\s]*$/.test(l) && !/^[-─=]+$/.test(l));
  return (lines[lines.length - 1] || '(no summary)').slice(0, 200);
}

function main() {
  console.log('================================================================');
  console.log(' PANIKA JEEVAN SATHI — AI AGENT STORAGE CYCLE');
  console.log('================================================================');

  const init = store.init({ agents: AGENTS });
  console.log('storage  :', init.dir.replace(ROOT + path.sep, ''));
  console.log('backend  :', init.backend);
  console.log('agents   :', init.agents.length);
  console.log('');

  const order = quick
    ? AGENTS.filter((a) => !['guardian', 'manager', 'pooja', 'priya'].includes(a.id))
    : [...AGENTS].sort((a, b) => {
        const rank = { guardian: 0, pooja: 1, priya: 2 };
        if (a.id === 'manager') return 1; // manager last
        if (b.id === 'manager') return -1;
        return (rank[a.id] ?? 3) - (rank[b.id] ?? 3);
      });

  const results = [];

  for (const agent of order) {
    const meta = agentById(agent.id) || agent;
    const args = commandFor(agent);
    const res = runCommand(agent.id, args);
    // Agent khud jo status bole wo sabse pehle — exit code sirf fallback hai.
    const reported = statusFromOutput(res.out);
    const status = reported || (res.ok ? 'OK' : 'FAIL');
    const summary =
      summarise(agent.id, res.out) + (res.ok ? '' : ' [non-zero exit]');

    store.recordRun(agent.id, {
      status,
      summary: String(summary).slice(0, 400),
      duration_ms: res.ms,
      details: { command: args.join(' '), workflow: meta.workflow }
    });

    results.push({
      id: agent.id,
      name: meta.name,
      role: meta.role,
      status,
      duration_ms: res.ms,
      summary
    });

    console.log(`  ${res.ok ? '✓' : '✗'} ${String(agent.id).padEnd(9)} ${status.padEnd(5)} ${String(res.ms + 'ms').padEnd(9)} ${String(summary).slice(0, 90)}`);
  }

  store.kvSet('cycle', 'last', {
    at: new Date().toISOString(),
    agents: results.length,
    ok: results.filter((r) => r.status === 'OK').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    results
  });

  const snapshot = store.snapshot('cycle');
  const status = store.status();
  const doctor = store.doctor();

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonFile = path.join(REPORT_DIR, 'agent-storage-cycle.json');
  fs.writeFileSync(
    jsonFile,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        storage_version: store.VERSION,
        quick,
        results,
        snapshot: { name: snapshot.name, files: snapshot.files.length, bytes: snapshot.bytes },
        doctor,
        status
      },
      null,
      2
    ) + '\n'
  );

  const md = [];
  md.push('# AI Agent Storage Cycle — Result');
  md.push('');
  md.push(`Time: ${new Date().toISOString()}`);
  md.push('');
  md.push('| Agent | Role | Status | Duration | Summary |');
  md.push('| --- | --- | --- | --- | --- |');
  for (const r of results) {
    md.push(`| ${r.name} (\`${r.id}\`) | ${r.role} | ${r.status} | ${r.duration_ms}ms | ${String(r.summary).replace(/\|/g, '\\|').slice(0, 120)} |`);
  }
  md.push('');
  md.push(`Snapshot: \`${snapshot.name}\` (${snapshot.files.length} files)`);
  md.push('');
  md.push(`Doctor: **${doctor.ok ? 'PASS' : 'FAIL'}**`);
  md.push('');
  md.push('Automated actions NOT performed: deploy / git push / social posting / email.');
  md.push('');
  const mdFile = path.join(REPORT_DIR, 'agent-storage-cycle.md');
  fs.writeFileSync(mdFile, md.join('\n'));

  console.log('');
  console.log('----------------------------------------------------------------');
  console.log(`runs     : ${results.length}`);
  console.log(`ok       : ${results.filter((r) => r.status === 'OK').length}`);
  console.log(`fail     : ${results.filter((r) => r.status === 'FAIL').length}`);
  console.log(`snapshot : ${snapshot.name} (${snapshot.files.length} files)`);
  console.log(`doctor   : ${doctor.ok ? 'PASS' : 'FAIL'}`);
  console.log(`open incidents: ${status.open_incidents.length}`);
  console.log(`ledger   : ${status.ledger.ok ? 'OK' : 'BROKEN'} (${status.ledger.checked} entries)`);
  console.log('');
  console.log('JSON report :', path.relative(ROOT, jsonFile));
  console.log('Markdown    :', path.relative(ROOT, mdFile));
  console.log('================================================================');

  return doctor.ok && results.every((r) => r.status === 'OK') ? 0 : 1;
}

process.exit(main());
