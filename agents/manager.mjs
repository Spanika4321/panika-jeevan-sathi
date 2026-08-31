/**
 * PANIKA JEEVAN SATHI — Manager (coordinator).
 *
 *   node agents/manager.mjs
 *
 * Manager teen cheezein chalata hai (Pooja, Priya, Guardian) aur unka
 * *asli* status report karta hai.
 *
 * Sachchai ka rule (repo policy — "bina proof ke ho gaya nahi"):
 *   ek worker ka process exit 0 kar sakta hai aur phir bhi BLOCKED bol sakta
 *   hai (jaise Pooja jab Google/Gemini keys nahi hain). Isliye Manager exit
 *   code se status nahi banata — wo worker ke apne JSON output ka `status`
 *   field padhta hai. Exit 0 + status BLOCKED  =>  report mein BLOCKED.
 *
 * Exit code: 1 sirf tab jab koi worker/guardian sach mein FAIL hua.
 * BLOCKED failure nahi hai — wo "credentials chahiye" hai, aur waise hi
 * report hota hai.
 */

import { execFileSync } from 'node:child_process';
import { CONFIG, now, writeReport, persistRun } from './lib.mjs';

/** Child ka khud report kiya hua status. Exit code sirf fallback hai. */
function run(file, extraEnv = {}) {
  const started = Date.now();
  let output = '';
  let exited = 0;
  try {
    output = execFileSync(process.execPath, [file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv }
    });
  } catch (err) {
    exited = typeof err.status === 'number' ? err.status : 1;
    output = String(err.stdout || '') + String(err.stderr || err.message || '');
  }

  const duration_ms = Date.now() - started;
  const reported = statusFromOutput(output);
  // Worker ne kuch nahi bola => exit code hi saboot hai.
  const status = reported || (exited === 0 ? 'OK' : 'FAIL');

  return {
    status,
    exit_code: exited,
    reported_status: reported || null,
    duration_ms,
    summary: summarise(output, status),
    output
  };
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

function summarise(out, fallback) {
  const text = String(out || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && parsed.reason) return `${fallback} — ${String(parsed.reason).slice(0, 160)}`;
      if (parsed && parsed.summary) return `${fallback} — ${String(parsed.summary).slice(0, 160)}`;
    } catch {
      /* fall through */
    }
  }
  const tally = text.match(/(\d+)\s+passed,\s*(\d+)\s+failed/i);
  if (tally) return `${fallback} — ${tally[1]} passed, ${tally[2]} failed`;
  return fallback;
}

const pooja = run('agents/pooja.mjs');
const priya = run('agents/priya.mjs');

// Manager ke andar Guardian sirf health check chalata hai — full suite rollup
// cycle runner karta hai, isliye yahan double-run (aur recursion) roka jaata hai.
const guardian = run('scripts/health-check.mjs', { PJS_HEALTH_NO_ROLLUP: '1' });

const workers = { pooja, priya };
const outcomes = [pooja.status, priya.status, guardian.status];
const anyFail = outcomes.includes('FAIL');
const blockedList = Object.entries(workers)
  .filter(([, w]) => w.status === 'BLOCKED')
  .map(([name]) => name);
if (guardian.status === 'BLOCKED') blockedList.push('guardian');

// Guardian (Sardar) ka result permanent storage mein — uske apne status ke saath.
persistRun('guardian', {
  status: guardian.status,
  summary: guardian.summary,
  details: { runs: { pooja: pooja.status, priya: priya.status }, duration_ms: guardian.duration_ms }
});

const report = {
  project: CONFIG.project,
  manager: 'Manager',
  generated_at: now(),
  status: anyFail ? 'FAIL' : blockedList.length ? 'BLOCKED' : 'OK',
  hierarchy: {
    sardar: 'Guardian',
    manager: 'Manager',
    workers: ['Pooja', 'Priya']
  },
  workers: {
    pooja: { status: pooja.status, exit_code: pooja.exit_code, duration_ms: pooja.duration_ms, summary: pooja.summary },
    priya: { status: priya.status, exit_code: priya.exit_code, duration_ms: priya.duration_ms, summary: priya.summary }
  },
  guardian: {
    status: guardian.status,
    exit_code: guardian.exit_code,
    duration_ms: guardian.duration_ms,
    summary: guardian.summary
  },
  blocked: blockedList,
  honesty:
    'Worker status uske apne JSON output se liya gaya hai (exit 0 + BLOCKED => BLOCKED, PASS nahi).',
  safety: CONFIG.safety,
  production_deploy: 'NOT_AUTOMATICALLY_TRIGGERED'
};

writeReport('manager-latest.json', JSON.stringify(report, null, 2) + '\n');

// Full output report mein nahi jaata (bahut lamba) — sirf status + summary.
console.log(JSON.stringify(report, null, 2));

// Manager ka apna run bhi storage mein, asli status ke saath.
persistRun('manager', {
  status: anyFail ? 'FAIL' : blockedList.length ? 'BLOCKED' : 'OK',
  summary: `pooja=${pooja.status} priya=${priya.status} guardian=${guardian.status}`,
  details: { blocked: blockedList, production_deploy: report.production_deploy }
});

if (anyFail) process.exitCode = 1;
