#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — ARENA ↔ TERMUX TWO-WAY BATCH PROTOCOL (runner + validator)
 * ==================================================================================
 *
 * Arena (coordinator) writes an ordered TASK BATCH. Termux (execution
 * environment) runs it and returns a RESULT BATCH. This CLI makes both sides
 * machine-checkable, so no status in a report is ever a guess.
 *
 *   node scripts/termux-batch.mjs list
 *   node scripts/termux-batch.mjs show   BATCH-01     # human-readable batch
 *   node scripts/termux-batch.mjs template BATCH-01   # manual result template
 *   node scripts/termux-batch.mjs preflight [--json]  # environment ground truth
 *   node scripts/termux-batch.mjs run      BATCH-01   # Termux: execute + write results
 *   node scripts/termux-batch.mjs validate BATCH-01   # Arena: honesty/schema check
 *   node scripts/termux-batch.mjs render   BATCH-01   # rebuild markdown from results JSON
 *
 * Non-negotiable rules this tool enforces mechanically:
 *   • A PASS is only allowed when the recorded command actually exited 0.
 *   • Every command in a task's `verify` block must appear in the result.
 *   • Missing credential / unreachable dependency => BLOCKED, never PASS.
 *   • public/** fingerprint must be unchanged unless ui_change_approved.
 *   • Results must be for the batch's base_commit (no stale batch execution).
 *
 * Safety: verifiers are argv arrays (no shell), limited to a read-only command
 * allowlist, and only run repo-local node entrypoints. Deploy / git push /
 * database writes / password or private-message access are refused outright.
 *
 * Exit codes: 0 = nothing failed · 1 = FAIL present or invalid batch
 *             2 = BLOCKED only (dependency missing, nothing broken)
 *
 * Requires nothing but Node.js (works on 18+, so it can report a too-old Node).
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BATCH_DIR = path.join(ROOT, 'ops', 'batches');
const REPORT_DIR = path.join(ROOT, 'reports', 'agents');
const PROTOCOL = 'arena-termux-batch/1';
const RUNNER_VERSION = '1.0.0';
const OK_STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED']);

/* Result-batch fields every worker must return (protocol §TERMUX → ARENA). */
const REQUIRED_RESULT_FIELDS = [
  'task_id',
  'worker',
  'action_performed',
  'status',
  'evidence',
  'files_changed',
  'tests_performed',
  'report_path',
  'remaining_dependency'
];

/* Task-batch fields Arena must fill in (protocol §ARENA → TERMUX). */
const REQUIRED_TASK_FIELDS = [
  'id',
  'worker',
  'objective',
  'allowed',
  'verify',
  'expected_report',
  'stop_condition'
];

/* --------------------------------------------------------------- utilities */

const now = () => new Date().toISOString();

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function rel(file) {
  return path.relative(ROOT, file) || '.';
}

function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function tail(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return `…(truncated ${s.length - max} chars)…\n${s.slice(-max)}`;
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch {
    return '';
  }
}

/** Stable fingerprint of everything under public/ (the approved UI). */
function publicFingerprint() {
  const dir = path.join(ROOT, 'public');
  if (!fs.existsSync(dir)) return { files: 0, sha256: 'absent' };
  const walk = (d, out = []) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  };
  const lines = walk(dir)
    .sort()
    .map((f) => `${rel(f)}\0${sha256(fs.readFileSync(f))}`)
    .join('\n');
  return { files: lines ? lines.split('\n').length : 0, sha256: sha256(lines) };
}

function diskFreeMb() {
  try {
    const out = execFileSync('df', ['-Pk', ROOT], { encoding: 'utf8' });
    const last = out.trim().split('\n').pop().split(/\s+/);
    const kb = Number(last[3] ?? last[4] ?? NaN);
    return Number.isFinite(kb) ? Math.round(kb / 1024) : null;
  } catch {
    return null;
  }
}

function nodeAtLeast(major, minor = 0) {
  const m = process.versions.node.match(/^(\d+)\.(\d+)/);
  if (!m) return false;
  return Number(m[1]) > major || (Number(m[1]) === major && Number(m[2]) >= minor);
}

/* ------------------------------------------------------- command allowlist */

const ALLOWED_BIN = new Set([
  'node',
  'git',
  'curl',
  'grep',
  'find',
  'ls',
  'cat',
  'head',
  'wc',
  'sort',
  'uniq',
  'sha256sum',
  'md5sum',
  'df',
  'du',
  'uname',
  'hostname',
  'date',
  'which',
  'command',
  'printenv'
]);

const SAFE_GIT = new Set([
  'status',
  'log',
  'rev-parse',
  'diff',
  'show',
  'ls-files',
  'ls-tree',
  'grep',
  'check-ignore',
  'blame',
  'branch',
  'remote',
  'describe',
  'hash-object',
  'cat-file',
  'config'
]);

/** curl: GET-only inspection, output may only go to /dev/null. */
const CURL_FLAGS = new Set([
  '-s',
  '-S',
  '-sS',
  '--silent',
  '--show-error',
  '-I',
  '--head',
  '-i',
  '-w',
  '--write-out',
  '-o',
  '--output',
  '--max-time',
  '--connect-timeout',
  '--retry',
  '--retry-delay'
]);

/**
 * Every verifier must pass this gate. It is deliberately conservative: read-only
 * inspection of this repository and of the two documented production hosts.
 */
function checkCommand(argv, siteHosts) {
  if (!Array.isArray(argv) || argv.length === 0) return 'command must be a non-empty argv array';
  const [bin, ...args] = argv.map(String);
  const joined = args.join(' ');

  // Verifiers are spawned by execFile with an argv array — never through a
  // shell — so glob/regex/pipe characters inside a token are inert data. What
  // *is* rejected: line breaks and NULs (they would forge extra evidence lines
  // in the captured report), and any token that smuggles an inline shell call.
  if (argv.some((a) => /[\n\r\u0000]/.test(String(a)))) {
    return 'verifier arguments may not contain newlines or NUL bytes (evidence must stay one-command-per-line)';
  }
  if (!ALLOWED_BIN.has(bin)) return `binary "${bin}" is not in the read-only allowlist`;

  if (bin === 'git') {
    if (!SAFE_GIT.has(args[0])) return `git subcommand "${args[0] ?? ''}" is not read-only`;
    if (/^(push|commit|checkout|switch|reset|clean|merge|rebase|apply|rm|mv|restore|stash|worktree)$/i.test(args[0] ?? '')) {
      return 'git mutation commands are forbidden in a batch';
    }
    if (args[0] === 'config' && !args.includes('--get')) return 'git config writes are forbidden';
  }

  if (bin === 'node') {
    if (args.some((a) => /^(-e|--eval|--print|-p)$/i.test(a))) {
      return 'node -e inline code is not allowed in a batch';
    }
    const entry = args.find((a) => !a.startsWith('-'));
    if (!entry) return 'node needs a repo-local script path';
    const full = path.resolve(ROOT, entry);
    const inside = full.startsWith(`${ROOT}${path.sep}`);
    const allowedArea = /^(scripts|lib|agents)[/]|^(server\.js)$/.test(rel(full));
    if (!inside || !allowedArea) return `node entrypoint "${entry}" is outside scripts|lib|agents`;
  }

  if (bin === 'curl') {
    const urls = [];
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i];
      if (/^https?:\/\//i.test(a)) {
        urls.push(a);
        continue;
      }
      if (!a.startsWith('-')) continue;
      const flag = a.split('=')[0];
      if (!CURL_FLAGS.has(flag)) return `curl flag "${a}" is not allowed (GET-only, no uploads, no redirects)`;
      if (flag === '-o' || flag === '--output') {
        const value = a.includes('=') ? a.split('=')[1] : args[i + 1];
        if (value !== os.devNull && value !== '/dev/null') {
          return 'curl output may only go to /dev/null';
        }
        if (!a.includes('=')) i += 1;
      }
      if (['-w', '--write-out', '--max-time', '--connect-timeout', '--retry', '--retry-delay'].includes(flag) && !a.includes('=')) {
        i += 1;
      }
    }
    if (!urls.length) return 'curl needs an http(s) URL';
    const allowed = new Set([...siteHosts, '127.0.0.1', 'localhost']);
    for (const url of urls) {
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        return 'curl URL is unparseable';
      }
      if (!allowed.has(host)) return `curl to "${host}" is not an approved host`;
    }
  }

  if (bin === 'find' && /-delete|-exec|-ok|-fprint/i.test(joined)) {
    return 'find mutation flags are forbidden';
  }

  return null;
}

/* ------------------------------------------------------------------ probes */

function buildExecutor(extraId) {
  const fp = publicFingerprint();
  return {
    id: extraId || process.env.PJS_BATCH_EXECUTOR || defaultExecutorId(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    node: process.version,
    node_ok_22_5: nodeAtLeast(22, 5),
    npm: probeVersion('npm'),
    git: probeVersion('git'),
    curl: probeVersion('curl'),
    python: probeVersion('python3'),
    uname: runCapture('uname', ['-a']),
    shell: process.env.SHELL || 'unknown',
    termux_detected:
      !!process.env.PREFIX && String(process.env.PREFIX).includes('com.termux'),
    termux_android_release: readText('/system/build.prop').match(/ro\.build\.version\.release=(.*)/)?.[1]?.trim() ?? null,
    cwd: ROOT,
    git_head: git(['rev-parse', 'HEAD']),
    git_branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    tree_dirty: git(['status', '--porcelain']).length > 0,
    disk_free_mb: diskFreeMb(),
    cpus: os.cpus().length,
    mem_total_mb: Math.round(os.totalmem() / 1024 / 1024),
    public_ui_fingerprint: fp.sha256,
    public_ui_files: fp.files
  };
}

function defaultExecutorId() {
  if (process.env.GITHUB_ACTIONS === 'true') return 'github-actions-runner';
  if (process.env.PREFIX && String(process.env.PREFIX).includes('com.termux')) return 'termux-device';
  return `${os.platform()}-${os.hostname()}`;
}

function probeVersion(bin) {
  const out = runCapture(bin, ['--version']);
  return out ? out.split('\n')[0].slice(0, 80) : null;
}

function runCapture(bin, args) {
  try {
    return execFileSync(bin, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000
    }).toString().trim();
  } catch {
    return '';
  }
}

/** Short, credential-free reachability probe of the production hosts. */
function probeHost(url, ms = 20000) {
  try {
    const out = execFileSync(
      'curl',
      ['-sS', '-o', os.devNull, '--max-time', String(Math.round(ms / 1000)), '-w', '%{http_code} %{time_total} %{errormsg}', url],
      { cwd: ROOT, encoding: 'utf8', timeout: ms + 8000 }
    ).trim();
    const [code, time] = out.split(' ');
    return { url, http_code: Number(code) || 0, time_total_s: Number(time) || null, error: null };
  } catch (e) {
    return { url, http_code: 0, time_total_s: null, error: String(e.message || e).slice(0, 200) };
  }
}

/* --------------------------------------------------------------- batch I/O */

function batchFile(id, suffix) {
  return path.join(BATCH_DIR, `${id}.${suffix}.json`);
}

function listBatches() {
  if (!fs.existsSync(BATCH_DIR)) return [];
  return fs
    .readdirSync(BATCH_DIR)
    .filter((f) => f.endsWith('.tasks.json'))
    .map((f) => f.replace(/\.tasks\.json$/, ''))
    .sort();
}

function loadBatch(id) {
  const file = batchFile(id, 'tasks');
  const batch = readJSON(file);
  if (!batch) throw new Error(`batch not found / unreadable: ${rel(file)}`);
  return { file, batch };
}

/* ------------------------------------------------- validation (both sides) */

function validateBatchShape(batch) {
  const errors = [];
  if (batch.protocol !== PROTOCOL) errors.push(`protocol must be "${PROTOCOL}"`);
  if (!batch.batch_id) errors.push('batch_id missing');
  if (!batch.base_commit) errors.push('base_commit missing');
  if (!Array.isArray(batch.tasks) || batch.tasks.length === 0) errors.push('tasks[] missing/empty');
  const siteHosts = new Set((batch.approved_hosts ?? []).map((h) => new URL(h).hostname));
  const seen = new Set();
  (batch.tasks ?? []).forEach((task, index) => {
    const where = `task[${index}]${task?.id ? ` ${task.id}` : ''}`;
    for (const field of REQUIRED_TASK_FIELDS) {
      if (task?.[field] === undefined) errors.push(`${where}: required field "${field}" missing`);
    }
    if (task?.order !== index + 1) errors.push(`${where}: order must be ${index + 1} (strict ordering)`);
    if (task?.id) {
      if (seen.has(task.id)) errors.push(`${where}: duplicate task id ${task.id}`);
      seen.add(task.id);
    }
    if (task?.allowed?.files && !Array.isArray(task.allowed.files)) errors.push(`${where}: allowed.files must be an array`);
    const cmds = task?.verify?.commands;
    const manualMode = task?.verify?.mode === 'manual';
    if (manualMode ? !Array.isArray(task?.verify?.manual_commands) || !task.verify.manual_commands.length
                   : !Array.isArray(cmds) || cmds.length === 0) {
      errors.push(
        `${where}: ${manualMode ? 'verify.manual_commands[] missing — a manual task must still name the exact commands' : 'verify.commands[] missing (a task without a runnable check cannot be verified)'}`
      );
    } else {
      for (const argv of cmds) {
        const problem = checkCommand(argv, siteHosts);
        if (problem) errors.push(`${where}: refused verifier ${JSON.stringify(argv)} — ${problem}`);
      }
    }
    if (task?.verify?.expect && task.verify.expect.length < 10) {
      errors.push(`${where}: verify.expect must state an objective pass criterion`);
    }
    const mode = task?.verify?.mode;
    if (mode !== undefined && !['runner', 'manual'].includes(mode)) {
      errors.push(`${where}: verify.mode must be "runner" or "manual"`);
    }
    if (mode === 'manual' && !Array.isArray(task?.verify?.manual_commands)) {
      errors.push(`${where}: manual tasks must list the exact manual_commands to run`);
    }
    for (const key of ['require_lines', 'require_absent_lines', 'blocked_exit_codes', 'require_empty']) {
      if (task?.verify?.[key] !== undefined && !Array.isArray(task.verify[key])) {
        errors.push(`${where}: verify.${key} must be an array`);
      }
    }
    if (task?.requires !== undefined && !Array.isArray(task.requires)) {
      errors.push(`${where}: requires must be an array of {env,why} / {tool}`);
    }
    if (task?.env !== undefined && (typeof task.env !== 'object' || task.env === null)) {
      errors.push(`${where}: env must be an object of environment overrides`);
    }
  });
  if (batch.protected?.public_ui_fingerprint) {
    const current = publicFingerprint();
    if (current.sha256 !== batch.protected.public_ui_fingerprint && batch.ui_change_approved !== true) {
      errors.push(
        `public UI fingerprint drift: batch says ${batch.protected.public_ui_fingerprint.slice(0, 12)}…, this box says ${current.sha256.slice(0, 12)}… — UI changed without approval`
      );
    }
  }
  return { errors, siteHosts };
}

function cmdShow(id) {
  const { batch } = loadBatch(id);
  const { errors, siteHosts } = validateBatchShape(batch);
  console.log(renderBatchMarkdown(batch));
  if (errors.length) {
    console.error('\nBATCH SHAPE PROBLEMS:');
    for (const e of errors) console.error(`  ✗ ${e}`);
    return 1;
  }
  console.log(`\nallowlist check: all ${batch.tasks.reduce((n, t) => n + (t.verify.commands ?? []).length, 0)} verifier commands are read-only and approved-host clean (${[...siteHosts].join(', ') || 'no external hosts'}).`);
  return 0;
}

function cmdList() {
  const ids = listBatches();
  if (!ids.length) {
    console.log('no batches in ops/batches/');
    return 0;
  }
  for (const id of ids) {
    const batch = readJSON(batchFile(id, 'tasks'), {});
    const res = readJSON(batchFile(id, 'results'), null);
    const sum = res?.summary
      ? `→ results: ${res.summary.pass} PASS / ${res.summary.fail} FAIL / ${res.summary.blocked} BLOCKED (by ${res.executor?.id ?? '?'})`
      : '→ no result batch yet';
    console.log(`${id.padEnd(12)} ${String(batch.tasks?.length ?? 0).padStart(2)} tasks  ${sum}`);
  }
  return 0;
}

/* ------------------------------------------------------------- preflight */

async function cmdPreflight({ json }) {
  const executor = buildExecutor();
  const hosts = [
    'https://panikajeevansathi.onrender.com/api/health',
    'https://panikajeevansathi.onrender.com/',
    'https://panikajeevansathi.coolstore.in/'
  ];
  const probes = await Promise.all(hosts.map((u) => probeHost(u)));
  const requiredFiles = [
    'server.js',
    'lib/api.js',
    'lib/db.js',
    'scripts/health-check.mjs',
    'scripts/e2e-test.mjs',
    'reports/ui-baseline-body.md5',
    'agents/config.json'
  ];
  const missingFiles = requiredFiles.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  const report = {
    protocol: PROTOCOL,
    runner_version: RUNNER_VERSION,
    generated_at: now(),
    executor,
    git_head_short: executor.git_head.slice(0, 12),
    missing_files: missingFiles,
    live_probes: probes,
    capability: {
      node_ge_22_5_sqlite: executor.node_ok_22_5,
      sqlite_fallback: 'PJS_STORAGE=json works on Node < 22.5',
      git: !!executor.git,
      curl: !!executor.curl,
      disk_ok: executor.disk_free_mb === null ? null : executor.disk_free_mb > 200
    },
    notes: [
      'Read-only probe. No deploy, no git push, no database change, no credential read.',
      'A live host that is unreachable here must be reported BLOCKED with the exact error — never PASS.'
    ]
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log('==============================================');
  console.log(' PANIKA JEEVAN SATHI — BATCH PREFLIGHT');
  console.log('==============================================');
  console.log(`executor        : ${executor.id} (${executor.platform}/${executor.arch})`);
  console.log(`hostname        : ${executor.hostname}`);
  console.log(`node            : ${executor.node}${executor.node_ok_22_5 ? '  (>= 22.5 → node:sqlite available)' : '  (OLDER than 22.5 → JSON store fallback only)'}`);
  console.log(`git / curl      : ${executor.git ?? 'MISSING'} | ${executor.curl ?? 'MISSING'}`);
  console.log(`termux detected : ${executor.termux_detected ? 'YES' : 'no'} (android ${executor.termux_android_release ?? '?'})`);
  console.log(`repo            : ${rel(ROOT)}`);
  console.log(`branch @ head   : ${executor.git_branch} @ ${executor.git_head.slice(0, 12)}`);
  console.log(`worktree        : ${executor.tree_dirty ? 'DIRTY' : 'clean'}`);
  console.log(`disk free       : ${executor.disk_free_mb ?? '?'} MB`);
  console.log(`public UI       : ${executor.public_ui_files} files, fingerprint ${executor.public_ui_fingerprint.slice(0, 16)}…`);
  console.log(`missing files   : ${missingFiles.length ? missingFiles.join(', ') : 'none'}`);
  console.log('\nlive probes (network truth, not assumed):');
  for (const p of probes) {
    const line = p.http_code ? `HTTP ${p.http_code} in ${p.time_total_s}s` : `UNREACHABLE — ${p.error}`;
    console.log(`  ${p.http_code === 200 ? '✓' : '✗'} ${p.url} → ${line}`);
  }
  console.log('\n==============================================');
  console.log(`REAL STATUS ONLY — no command above was assumed to have worked.`);
  console.log('==============================================');
  return 0;
}

/* ---------------------------------------------------------------- run */

async function cmdRun(id, opts) {
  const { batch } = loadBatch(id);
  const { errors, siteHosts } = validateBatchShape(batch);
  if (errors.length) {
    console.error('BATCH REJECTED BEFORE EXECUTION (fix the batch, not the code):');
    for (const e of errors) console.error(`  ✗ ${e}`);
    return 1;
  }

  const executor = buildExecutor(opts.executor);
  if (executor.git_head !== batch.base_commit) {
    console.log(`! head ${executor.git_head.slice(0, 12)} != batch base ${batch.base_commit.slice(0, 12)} — recording as stale/branch-drift, continuing without faking anything.`);
  }

  const started = now();
  const manual = opts.import ? readJSON(path.resolve(ROOT, opts.import)) : null;
  const manualById = new Map((manual?.results ?? []).map((r) => [r.task_id, r]));

  /* --only: partial re-run. Untouched tasks must carry their previous result
     forward verbatim — a task is never allowed to simply disappear. */
  const only = Array.isArray(opts.only) && opts.only.length ? new Set(opts.only) : null;
  let carried = new Map();
  if (only) {
    const previous = readJSON(batchFile(id, 'results'));
    carried = new Map((previous?.results ?? []).map((r) => [r.task_id, r]));
    const unknown = [...only].filter((t) => !batch.tasks.some((x) => x.id === t));
    if (unknown.length) {
      console.error(`✗ --only names tasks that are not in ${id}: ${unknown.join(', ')}`);
      return 1;
    }
    if (!previous) {
      console.error(`✗ --only needs a previous ${id}.results.json to carry the other tasks over; run the full batch first`);
      return 1;
    }
    const missing = batch.tasks.filter((t) => !only.has(t.id) && !carried.has(t.id)).map((t) => t.id);
    if (missing.length) {
      console.error(`✗ --only would silently drop tasks with no prior result: ${missing.join(', ')} — refuse (no silent skips)`);
      return 1;
    }
  }

  const results = [];
  let prevPorcelain = new Set(git(['status', '--porcelain']).split('\n').filter(Boolean));

  console.log('==============================================');
  console.log(` ${id} — EXECUTION START (${executor.id})`);
  console.log('==============================================');

  for (const task of batch.tasks) {
    const label = `${task.id} [${task.worker}]`;
    if (only && !only.has(task.id)) {
      const prev = carried.get(task.id);
      results.push({ ...prev, carried_over: true });
      console.log(`\n──── ${label} ────`);
      console.log(`  ↷ not re-run: previous ${prev.status} carried over verbatim (--only partial run)`);
      continue;
    }
    console.log(`\n──── ${label} ────`);
    console.log(`objective: ${task.objective}`);

    const entry = {
      task_id: task.id,
      worker: task.worker,
      action_performed: [],
      status: null,
      evidence: '',
      files_changed: [],
      tests_performed: [],
      report_path: task.verify?.report_path ?? `reports/agents/${id.toLowerCase()}-${task.id.toLowerCase()}.log`,
      remaining_dependency: null,
      started_at: now(),
      finished_at: null,
      duration_ms: 0,
      provenance: 'runner'
    };

    /* 1. Hard dependency gate — missing credential/deps => BLOCKED, never PASS. */
    const missing = (task.requires ?? []).filter(
      (dep) => dep.env && !process.env[dep.env]
    );
    if (missing.length) {
      entry.status = 'BLOCKED';
      entry.remaining_dependency = missing.map((d) => `env ${d.env} (${d.why ?? 'required'})`).join('; ');
      entry.evidence = `Dependency gate: not executed because ${entry.remaining_dependency}. No substitute was invented and no PASS was claimed.`;
      entry.tests_performed = (task.verify?.commands ?? []).map((c) => c.join(' '));
      results.push(entry);
      console.log(`  ✗ BLOCKED — ${entry.remaining_dependency}`);
      continue;
    }

    /* 2. Manual tasks: the runner will not pretend. Either imported evidence or BLOCKED. */
    if (task.verify.mode === 'manual') {
      const imported = manualById.get(task.id);
      if (!imported) {
        entry.status = 'BLOCKED';
        entry.remaining_dependency = 'this task is manual on Termux — run the exact commands in verify.instructions, then feed them back with --import <file.json> (see: node scripts/termux-batch.mjs template ' + id + ')';
        entry.evidence = `Not executed by the runner by design. Commands to run:\n${(task.verify?.manual_commands ?? []).map((c) => `  $ ${c}`).join('\n') || '  (none listed)'}`;
        results.push(entry);
        console.log('  ✗ BLOCKED — manual task without imported evidence');
        continue;
      }
      Object.assign(entry, {
        action_performed: imported.action_performed ?? [],
        status: imported.status,
        evidence: imported.evidence ?? '',
        files_changed: imported.files_changed ?? [],
        tests_performed: imported.tests_performed ?? [],
        report_path: imported.report_path ?? entry.report_path,
        remaining_dependency: imported.remaining_dependency ?? null,
        provenance: 'manual'
      });
      results.push(entry);
      console.log(`  ↷ imported manual result: ${entry.status}`);
      continue;
    }

    /* 3. Execute each verifier, capture real exit codes. */
    let verdict = 'PASS';
    const evidence = [];
    const failures = [];
    const rawLog = [];
    let allFullOut = '';
    const envOverride = { ...(task.env ?? {}), ...(task.verify?.env ?? {}) };
    const envPrefix = Object.keys(envOverride).length
      ? `${Object.entries(envOverride).map(([k, v]) => `${k}=${v}`).join(' ')} `
      : '';
    for (const argv of task.verify.commands) {
      const problem = checkCommand(argv, siteHosts);
      const cmdText = argv.join(' ');
      if (problem) {
        entry.action_performed.push({ cmd: argv, exit: null, refused: problem });
        evidence.push(`REFUSED ${cmdText} — ${problem}`);
        verdict = 'BLOCKED';
        entry.remaining_dependency = `verifier refused by the safety allowlist: ${problem}`;
        console.log(`  ! refused: ${cmdText} (${problem})`);
        continue;
      }
      const t0 = Date.now();
      let exit = 0;
      let out = '';
      let err = '';
      const childEnv = Object.keys(envOverride).length ? { ...process.env, ...envOverride } : process.env;
      try {
        out = execFileSync(argv[0], argv.slice(1), {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: (task.timeout_seconds ?? 240) * 1000,
          maxBuffer: 32 * 1024 * 1024,
          env: childEnv
        });
      } catch (e) {
        exit = typeof e.status === 'number' ? e.status : 1;
        out = String(e.stdout ?? '');
        err = String(e.stderr ?? e.message ?? '');
        if (e.code === 'ETIMEDOUT' || /timed out/i.test(String(e.message))) {
          exit = 124;
          err += `\ntimeout after ${task.timeout_seconds ?? 240}s`;
        }
      }
      const dur = Date.now() - t0;
      const expected = task.verify.allow_exit?.[cmdText] ?? [0];
      const okExit = expected.includes(exit);
      allFullOut += `${out ?? ''}\n${err ?? ''}\n`;
      rawLog.push(`$ ${envPrefix}${cmdText}\n(exit ${exit}, ${dur}ms)\n--- stdout ---\n${out || '(none)'}\n--- stderr ---\n${err || '(none)'}\n`);
      entry.action_performed.push({
        cmd: argv,
        cmd_display: `${envPrefix}${cmdText}`,
        exit,
        expected_exit: expected,
        ok: okExit,
        duration_ms: dur,
        stdout_tail: tail(out, 2600),
        stderr_tail: tail(err, 900)
      });
      const flag = okExit ? '✓' : '✗';
      console.log(`  ${flag} $ ${envPrefix}${cmdText}  → exit ${exit} (${dur}ms)`);
      const summary = summarizeOutput(out, err);
      evidence.push(`$ ${envPrefix}${cmdText}\n  exit ${exit} in ${dur}ms  ${okExit ? '(expected ' + expected.join('/') + ')' : '(UNEXPECTED)'}\n${summary}`);
      if (!okExit) {
        failures.push({ cmdText, exit });
        verdict = 'FAIL';
        if (!entry.remaining_dependency) {
          entry.remaining_dependency = `${task.id}: "${cmdText}" exited ${exit} — see evidence; no repair applied by the executor.`;
        }
      }
      entry.tests_performed.push(cmdText);
    }

    /* 3b. A dependency that is simply unreachable is BLOCKED, not a code FAIL. */
    if (verdict === 'FAIL' && Array.isArray(task.verify.blocked_exit_codes) && failures.length) {
      const blockedOnly = failures.every((f) => task.verify.blocked_exit_codes.includes(f.exit));
      const blockedSignals = task.verify.blocked_match
        ? new RegExp(task.verify.blocked_match, 'i').test(allFullOut)
        : true;
      if (blockedOnly && blockedSignals) {
        verdict = 'BLOCKED';
        entry.remaining_dependency = `${task.verify.blocked_reason ?? 'external dependency unreachable from this executor'} — ${failures
          .map((f) => `"${f.cmdText}" exited ${f.exit}`)
          .join('; ')}. Reported as BLOCKED, not fixed, not passed.`;
        evidence.push(`BLOCKED (dependency): ${entry.remaining_dependency}`);
        console.log('  ↯ reclassified FAIL → BLOCKED (dependency unreachable, not a code failure)');
      }
    }

    /* 4. Objective criterion must hold on top of exit codes. */
    if (verdict === 'PASS' && task.verify.require_lines) {
      const allOut = allFullOut;
      for (const line of task.verify.require_lines) {
        if (!allOut.includes(line)) {
          const dependencyBlocked =
            task.verify.blocked_match && new RegExp(task.verify.blocked_match, 'i').test(allOut);
          if (dependencyBlocked) {
            verdict = 'BLOCKED';
            entry.remaining_dependency = `${task.verify.blocked_reason ?? 'external dependency unreachable from this executor'} — expected line "${line}" never appeared and the output shows a network/permission failure. Not a code bug, not a PASS.`;
            evidence.push(`BLOCKED (dependency): ${entry.remaining_dependency}`);
            console.log(`  ↯ expected line "${line}" missing because the dependency is unreachable → BLOCKED`);
          } else {
            verdict = 'FAIL';
            entry.remaining_dependency = `expected evidence line not found: "${line}" — the check did not actually report success.`;
            evidence.push(`MISSING EXPECTED LINE: "${line}"`);
            console.log(`  ✗ expected line missing: ${line}`);
          }
          break;
        }
      }
    }

    /* 4b. Forbidden evidence (e.g. a tracked secret, a guessed route treated as a bug). */
    if (verdict === 'PASS' && Array.isArray(task.verify.require_absent_lines)) {
      const allOut = allFullOut;
      for (const line of task.verify.require_absent_lines) {
        if (allOut.includes(line)) {
          verdict = 'FAIL';
          entry.remaining_dependency = `forbidden evidence present: "${line}" must not exist in this tree.`;
          evidence.push(`FORBIDDEN EVIDENCE PRESENT: "${line}"`);
          console.log(`  ✗ forbidden evidence present: ${line}`);
        }
      }
    }

    /* 4c. Some checks prove themselves by printing NOTHING (drift/duplicate scans). */
    if (verdict === 'PASS' && Array.isArray(task.verify.require_empty)) {
      for (const cmdText of task.verify.require_empty) {
        const action = entry.action_performed.find((a) => (a.cmd ?? []).join(' ') === cmdText);
        if (!action) continue;
        const printed = `${action.stdout_tail ?? ''}\n${action.stderr_tail ?? ''}`.trim();
        if (printed) {
          verdict = 'FAIL';
          entry.remaining_dependency = `"${cmdText}" had to print nothing, but printed: ${printed.split('\n').slice(0, 4).join(' | ')}`;
          evidence.push(`EXPECTED EMPTY OUTPUT, GOT:\n${printed.slice(0, 600)}`);
          console.log('  ✗ expected empty output, got something');
        }
      }
    }

    /* 4d. Per-task raw log — the report_path a result must point at. */
    const logRel = /^reports\/agents\/[\w.-]+\.(log|md)$/.test(entry.report_path ?? '')
      ? entry.report_path
      : `reports/agents/${id.toLowerCase()}-${task.id.toLowerCase()}.evidence.md`;
    entry.report_path = logRel;
    try {
      fs.mkdirSync(path.join(ROOT, 'reports', 'agents'), { recursive: true });
      fs.writeFileSync(
        path.join(ROOT, logRel),
        [
          `# ${id} / ${task.id} — raw execution log`,
          `executor : ${executor.id} (${executor.platform}/${executor.arch}, node ${executor.node})`,
          `head     : ${executor.git_head}`,
          `objective: ${task.objective}`,
          `verdict  : ${verdict}`,
          '',
          ...rawLog
        ].join('\n')
      );
    } catch (e) {
      console.log(`  ! could not write ${logRel}: ${e.message}`);
    }


    const nextPorcelain = new Set(git(['status', '--porcelain']).split('\n').filter(Boolean));
    const dirty = [...nextPorcelain].filter((l) => !prevPorcelain.has(l));
    prevPorcelain = nextPorcelain;
    entry.files_changed = dirty
      .map((l) => l.replace(/^..\s*/, '').trim())
      .filter((f) => !isRunnerOutput(f, id));
    entry.status = verdict;
    entry.evidence = evidence.join('\n\n').slice(0, 12000);
    entry.finished_at = now();
    entry.duration_ms = entry.action_performed.reduce((n, a) => n + (a.duration_ms ?? 0), 0);
    if (entry.status === 'PASS') entry.remaining_dependency = null;
    results.push(entry);
    console.log(`  → ${entry.status}${entry.files_changed.length ? ` (files: ${entry.files_changed.join(', ')})` : ' (no tracked files touched)'}`);
  }

  /* UI preservation guard: public/** must be byte-identical unless approved. */
  const uiDrift =
    batch.ui_change_approved !== true &&
    publicFingerprint().sha256 !== executor.public_ui_fingerprint;
  if (uiDrift) {
    console.log('\n  ✗ PUBLIC UI DRIFT DETECTED during this batch — that is not allowed without explicit owner approval.');
  }

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    blocked: results.filter((r) => r.status === 'BLOCKED').length
  };

  const payload = {
    protocol: PROTOCOL,
    runner_version: RUNNER_VERSION,
    batch_id: id,
    base_commit: batch.base_commit,
    executor,
    head_matches_base: executor.git_head === batch.base_commit,
    public_ui_fingerprint_before: executor.public_ui_fingerprint,
    public_ui_fingerprint_after: publicFingerprint().sha256,
    public_ui_drift: uiDrift,
    started_at: started,
    finished_at: now(),
    summary,
    results,
    not_done: {
      production_deploy: 'NOT ATTEMPTED',
      git_push: 'NOT ATTEMPTED',
      database_change: 'NOT ATTEMPTED',
      password_or_private_message_access: 'NOT ATTEMPTED',
      social_posting: 'NOT ATTEMPTED'
    },
    verification_token: null
  };
  payload.verification_token = token(payload);

  const outSuffix = opts.outSuffix ?? '';
  const jsonOut = batchFile(id, `results${outSuffix}`);
  const mdOut = path.join(BATCH_DIR, `${id}.results${outSuffix}.md`);
  writeJSON(jsonOut, payload);
  fs.writeFileSync(mdOut, renderResultsMarkdown(payload, batch));
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, `${id.toLowerCase()}-results${outSuffix}.md`), renderResultsMarkdown(payload, batch));

  console.log('\n==============================================');
  console.log(` ${id} RESULT BATCH — PASS ${summary.pass} / FAIL ${summary.fail} / BLOCKED ${summary.blocked}`);
  console.log(`ui drift        : ${uiDrift ? 'YES — NOT ALLOWED' : 'none (approved design intact)'}`);
  console.log(`result json     : ${rel(jsonOut)}`);
  console.log(`result report   : ${rel(mdOut)}`);
  console.log('send both files back to ARENA; Arena decides the next batch from them.');
  console.log('==============================================');
  console.log(`exit code: ${payload.summary.fail ? 1 : payload.summary.blocked ? 2 : 0} (0 green · 1 FAIL · 2 blocked-only)`);

  return payload.summary.fail || uiDrift ? 1 : payload.summary.blocked ? 2 : 0;
}

function isRunnerOutput(file, id) {
  return (
    file.startsWith(`ops/batches/${id}.results`) ||
    file.startsWith(`reports/agents/${id.toLowerCase()}-t-`) ||
    file.startsWith('ops/batches/') && file.includes('.results') ||
    file.startsWith('reports/agents/') && file.includes('-results') ||
    file.startsWith('storage/snapshots/')
  );
}

/** Pull the decisive lines out of a run so a report shows facts, not vibes. */
function summarizeOutput(out, err) {
  const text = `${out ?? ''}\n${err ?? ''}`;
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean);
  const keep = lines.filter((l) =>
    /(passed|failed|✓|✗|OK|FAIL|BLOCKED|ERROR|Error:|report:|Status|status:|not found|missing|unreachable|refus)/i.test(l)
  );
  const picked = (keep.length ? keep : lines).slice(-14);
  return picked.map((l) => `    ${l}`).join('\n');
}

/**
 * Integrity token: sha256 over the canonical evidence + executor fingerprint.
 * Not a security boundary — it lets Arena detect a result file that was
 * hand-edited after execution (e.g. a FAIL quietly typed over with PASS).
 */
function token(payload) {
  const canon = JSON.stringify({
    runner_version: payload.runner_version,
    batch_id: payload.batch_id,
    base_commit: payload.base_commit,
    head_matches_base: payload.head_matches_base,
    public_ui_fingerprint_before: payload.public_ui_fingerprint_before,
    public_ui_fingerprint_after: payload.public_ui_fingerprint_after,
    started_at: payload.started_at,
    finished_at: payload.finished_at,
    summary: payload.summary,
    executor: {
      id: payload.executor.id,
      hostname: payload.executor.hostname,
      node: payload.executor.node,
      uname: payload.executor.uname,
      git_head: payload.executor.git_head
    },
    results: payload.results.map((r) => ({
      task_id: r.task_id,
      status: r.status,
      exit_codes: (r.action_performed ?? []).map((a) => a.exit),
      evidence_sha: sha256(String(r.evidence ?? ''))
    }))
  });
  return sha256(canon);
}

/* ------------------------------------------------------------- validate */

function cmdValidate(id, opts) {
  const violations = [];
  const warnings = [];
  let batch = null;
  try {
    ({ batch } = loadBatch(id));
  } catch (e) {
    console.error(`✗ cannot load batch: ${e.message}`);
    return 1;
  }
  const file = batchFile(id, `results${opts.suffixPart ?? ''}`);
  const res = readJSON(file);
  if (!res) {
    console.error(`✗ cannot read result batch: ${rel(file)}`);
    return 1;
  }

  console.log('==============================================');
  console.log(` ${id} — RESULT BATCH VALIDATION`);
  console.log('==============================================');
  const localBox = executorMatches(res, opts);
  console.log(`result file : ${rel(file)}`);
  console.log(`executor    : ${res.executor?.id ?? '?'} (node ${res.executor?.node ?? '?'}, ${res.executor?.platform ?? '?'})`);
  console.log(`git head    : ${String(res.executor?.git_head).slice(0, 12)}`);

  if (res.protocol !== PROTOCOL) violations.push(`protocol mismatch: ${res.protocol}`);
  if (res.batch_id !== id) violations.push(`batch_id mismatch: ${res.batch_id}`);
  if (!res.summary) violations.push('summary{} missing');

  if (batch.base_commit && res.executor?.git_head && res.executor.git_head !== batch.base_commit) {
    warnings.push(
      `executed on head ${res.executor.git_head.slice(0, 12)} but batch was cut for ${batch.base_commit.slice(0, 12)} — results describe a different tree (stale or post-repair head).`
    );
  }

  /* 1. Shape of the batch itself. */
  const { errors } = validateBatchShape(batch);
  for (const e of errors) violations.push(`batch: ${e}`);

  /* 2. Shape + honesty of every result. */
  const byId = new Map((res.results ?? []).map((r) => [r.task_id, r]));
  const taskIds = (batch.tasks ?? []).map((t) => t.id);
  const extra = [...byId.keys()].filter((k) => !taskIds.includes(k));
  if (extra.length) violations.push(`results for unknown tasks: ${extra.join(', ')}`);

  for (const task of batch.tasks ?? []) {
    const r = byId.get(task.id);
    if (!r) {
      violations.push(`${task.id}: NO RESULT RETURNED — a task may never be silently skipped`);
      continue;
    }
    for (const field of REQUIRED_RESULT_FIELDS) {
      if (r[field] === undefined) violations.push(`${task.id}: required result field "${field}" missing`);
    }
    if (!OK_STATUSES.has(r.status)) violations.push(`${task.id}: status "${r.status}" is not PASS/FAIL/BLOCKED`);
    if (r.worker !== task.worker) violations.push(`${task.id}: worker "${r.worker}" != assigned "${task.worker}"`);

    const ev = String(r.evidence ?? '').trim();
    if (ev.length < 20) violations.push(`${task.id}: evidence is empty/too thin (${ev.length} chars) — exact evidence is required`);
    if (/^(ok|done|pass|passed|fine|all good|sab theek|ho gaya)\.?$/i.test(ev)) violations.push(`${task.id}: evidence is a placeholder, not evidence`);

    const actions = r.action_performed ?? [];
    if (!actions.length) violations.push(`${task.id}: action_performed[] empty — nothing was actually run`);

    const ran = new Set(actions.map((a) => (Array.isArray(a.cmd) ? a.cmd.join(' ') : String(a.cmd)).trim()));
    const refused = actions.filter((a) => a.refused);
    for (const argv of task.verify?.commands ?? []) {
      const cmd = argv.join(' ');
      if (!ran.has(cmd.trim())) {
        violations.push(`${task.id}: required verifier never ran: "${cmd}"`);
      }
    }

    const badExit = actions.filter((a) => a.ok === false || (a.exit !== null && a.exit !== undefined && !(task.verify?.allow_exit?.[a.cmd.join(' ')] ?? [0]).includes(a.exit)));
    if (r.status === 'PASS') {
      if (badExit.length) violations.push(`${task.id}: PASS claimed but ${badExit.length} command(s) did not exit as expected — FAKE PASS`);
      if (r.provenance === 'runner' && refused.length) violations.push(`${task.id}: PASS despite refused verifier(s)`);
      const alarming = ev
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => !l.startsWith('✓') && !/not reachable over HTTP|0 failed|no .*error|0 problem/i.test(l))
        .filter((l) => /UNREACHABLE|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|SSL_ERROR|Could not resolve|could not\b|Permission denied|command not found|Operation not permitted|BLOCKED/i.test(l));
      if (alarming.length && r.provenance === 'runner') {
        warnings.push(`${task.id}: PASS but this evidence line reads like a failure — Arena must eyeball it: "${alarming[0].slice(0, 140)}"`);
      }
    }
    if ((r.status === 'FAIL' || r.status === 'BLOCKED') && !String(r.remaining_dependency ?? '').trim()) {
      violations.push(`${task.id}: ${r.status} without naming the exact remaining dependency`);
    }
    if (!String(r.report_path ?? '').trim()) {
      violations.push(`${task.id}: report_path missing — every result must point at a real report`);
    } else if (localBox && !fs.existsSync(path.resolve(ROOT, r.report_path))) {
      violations.push(`${task.id}: report_path "${r.report_path}" does not exist on the executor box — the result cites a file that is not there`);
    } else if (!localBox) {
      warnings.push(`${task.id}: report_path "${r.report_path}" not checked (Arena does not have the Termux filesystem — Arena re-runs its own copy)`);
    }
    if (r.status === 'PASS' && r.remaining_dependency) {
      warnings.push(`${task.id}: PASS carries remaining_dependency "${r.remaining_dependency}" — is it really done?`);
    }
    if (r.provenance === 'manual') {
      warnings.push(`${task.id}: manual provenance — Arena should spot-check by re-running one command`);
    }
    if (r.carried_over) {
      warnings.push(`${task.id}: carried over from an earlier run (--only partial batch) — its ${r.status} was not re-measured in this pass`);
    }
  }

  /* 3. UI preservation + summary arithmetic + runner token. */
  const drift = res.public_ui_drift === true ||
    (res.public_ui_fingerprint_before && res.public_ui_fingerprint_after &&
      res.public_ui_fingerprint_before !== res.public_ui_fingerprint_after);
  if (drift && batch.ui_change_approved !== true) {
    violations.push('public UI changed during the batch without explicit approval — unauthorized design change');
  }
  const counts = {
    pass: (res.results ?? []).filter((r) => r.status === 'PASS').length,
    fail: (res.results ?? []).filter((r) => r.status === 'FAIL').length,
    blocked: (res.results ?? []).filter((r) => r.status === 'BLOCKED').length
  };
  if (res.summary && (res.summary.pass !== counts.pass || res.summary.fail !== counts.fail || res.summary.blocked !== counts.blocked)) {
    violations.push(`summary arithmetic wrong: claims ${res.summary.pass}/${res.summary.fail}/${res.summary.blocked}, actual ${counts.pass}/${counts.fail}/${counts.blocked}`);
  }
  if (res.runner_version === RUNNER_VERSION && res.verification_token) {
    const expected = token(res);
    if (expected !== res.verification_token) {
      violations.push('verification_token mismatch — the result file was edited after the runner wrote it (or hand-written); re-run the batch');
    }
  } else if (!res.verification_token) {
    warnings.push('no verification_token — hand-written result batch; treat every PASS as unproven until re-verified');
  }

  /* 4. Local re-check (only meaningful on the box that ran the batch). */
  if (localBox) {
    const fp = publicFingerprint();
    if (res.public_ui_fingerprint_after && fp.sha256 !== res.public_ui_fingerprint_after) {
      warnings.push(`public UI now differs from the post-batch fingerprint recorded by the executor (${fp.sha256.slice(0, 12)}… vs ${String(res.public_ui_fingerprint_after).slice(0, 12)}…)`);
    }
    const porcelain = git(['status', '--porcelain']).split('\n').filter(Boolean);
    console.log(`worktree now : ${porcelain.length ? `${porcelain.length} modified file(s)` : 'clean'}`);
  } else {
    console.log('local re-check: SKIPPED (this box is not the executor — validating the returned evidence only)');
  }

  const mdPath = path.join(REPORT_DIR, `${id.toLowerCase()}-validation.md`);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    mdPath,
    [
      `# ${id} — Result Batch Validation`,
      '',
      `Time: ${now()}`,
      `Executor: ${res.executor?.id ?? '?'} · head ${String(res.executor?.git_head).slice(0, 12)}`,
      `Tasks: ${(batch.tasks ?? []).length} · PASS ${counts.pass} · FAIL ${counts.fail} · BLOCKED ${counts.blocked}`,
      '',
      violations.length ? `## VIOLATIONS (${violations.length})` : '## VIOLATIONS: none',
      ...violations.map((v) => `- ✗ ${v}`),
      '',
      warnings.length ? `## WARNINGS (${warnings.length})` : '## WARNINGS: none',
      ...warnings.map((w) => `- ! ${w}`),
      '',
      `Verdict: ${violations.length ? 'REJECTED — batch result not accepted' : 'ACCEPTED'}`
    ].join('\n') + '\n'
  );

  console.log('');
  if (violations.length) {
    console.log(`VIOLATIONS (${violations.length}) — result batch REJECTED:`);
    for (const v of violations) console.log(`  ✗ ${v}`);
  } else {
    console.log('VIOLATIONS: none — every PASS has a real exit-0 verifier behind it.');
  }
  if (warnings.length) {
    console.log(`\nWARNINGS (${warnings.length}):`);
    for (const w of warnings) console.log(`  ! ${w}`);
  }
  console.log(`\nvalidation report: ${rel(mdPath)}`);
  console.log(`VERDICT: ${violations.length ? 'REJECTED' : 'ACCEPTED'}`);
  return violations.length ? 1 : 0;
}

function executorMatches(res, opts) {
  if (opts.forceLocalCheck === false) return false;
  const mine = buildExecutor();
  return (
    res.executor?.hostname === mine.hostname &&
    res.executor?.cwd === mine.cwd
  );
}

/* ---------------------------------------------------------------- render */

/** Generated reports must stay `git diff --check` clean: no trailing spaces. */
function cleanMarkdown(lines) {
  return lines.map((l) => String(l).replace(/[ \t]+$/, '')).join('\n');
}

function renderBatchMarkdown(batch) {
  const L = [];
  L.push(`# ${batch.batch_id} — TASK BATCH (ARENA → TERMUX)`);
  L.push('');
  L.push(`**Protocol:** ${batch.protocol} · **Issued:** ${batch.issued_at} · **By:** ${batch.issued_by}`);
  L.push(`**Execute on:** ${batch.execute_on} · **Base commit:** \`${batch.base_commit}\` · **Branch:** \`${batch.branch}\``);
  L.push('');
  if (batch.context) {
    L.push(`## Why this batch`);
    L.push('');
    for (const line of batch.context) L.push(`- ${line}`);
    L.push('');
  }
  L.push('## Ground rules for this batch');
  L.push('');
  for (const r of batch.rules ?? []) L.push(`1. ${r}`);
  L.push('');
  for (const [index, t] of (batch.tasks ?? []).entries()) {
    L.push(`## ${t.id} — ${t.title ?? t.objective.slice(0, 70)}`);
    L.push('');
    L.push(`| Field | Value |`);
    L.push(`| --- | --- |`);
    L.push(`| 1. Task ID | \`${t.id}\` (order ${t.order}) |`);
    L.push(`| 2. Assigned worker | ${t.worker} — ${t.worker_name ?? ''} |`);
    L.push(`| 3. Exact objective | ${t.objective} |`);
    L.push(`| 4. Allowed | actions: ${t.allowed.actions.join('; ')} · files: ${t.allowed.files.length ? t.allowed.files.map((f) => `\`${f}\``).join(', ') : 'none (read-only)'} |`);
    L.push(`| 4b. Forbidden | ${t.allowed.forbidden.join('; ')} |`);
    L.push(`| 5. Verification | ${t.verify.expect} |`);
    L.push(`| 6. Expected report | ${t.expected_report} |`);
    L.push(`| 7. Stop condition | ${t.stop_condition} |`);
    if ((t.requires ?? []).length) {
      L.push(`| Needs | ${t.requires.map((d) => d.env ? `\`${d.env}\` (${d.why})` : `\`${d.tool}\``).join(', ')} |`);
    }
    L.push('');
    L.push('```bash');
    for (const c of t.verify.commands ?? []) L.push(`$ ${c.join(' ')}`);
    for (const c of t.verify.manual_commands ?? []) L.push(`$ ${c}`);
    L.push('```');
    if (t.verify.instructions) {
      L.push('');
      L.push(t.verify.instructions);
    }
    L.push('');
  }
  L.push('## How to return the RESULT BATCH');
  L.push('');
  L.push('```bash');
  L.push(`node scripts/termux-batch.mjs run ${batch.batch_id}`);
  L.push(`node scripts/termux-batch.mjs validate ${batch.batch_id}`);
  L.push('```');
  L.push('');
  L.push('That writes `ops/batches/' + batch.batch_id + '.results.json` + `.md`. Send both to ARENA (paste, or push the branch and say "batch done"). ARENA validates before deciding the next batch.');
  L.push('');
  L.push(`Task count: ${(batch.tasks ?? []).length}. Do not reorder, split or skip a task; if blocked, report it and continue with the next one.`);
  return cleanMarkdown(L);
}

function renderResultsMarkdown(res, batch) {
  const byId = new Map((batch?.tasks ?? []).map((t) => [t.id, t]));
  const L = [];
  L.push(`# ${res.batch_id} — RESULT BATCH (TERMUX → ARENA)`);
  L.push('');
  L.push(`**Protocol:** ${res.protocol} · **Finished:** ${res.finished_at}`);
  L.push(`**Executor:** ${res.executor.id} on ${res.executor.platform}/${res.executor.arch} · Node ${res.executor.node}`);
  L.push(`**Head:** \`${res.executor.git_head}\` · **Branch:** ${res.executor.git_branch} · **Worktree:** ${res.executor.tree_dirty ? 'dirty' : 'clean'}`);
  L.push(`**Head matches batch base:** ${res.head_matches_base ? 'yes' : 'NO'} · **Public UI drift:** ${res.public_ui_drift ? 'YES' : 'none'}`);
  L.push(`**Integrity token:** \`${res.verification_token}\``);
  L.push('');
  L.push(`## Summary`);
  L.push('');
  L.push(`| total | PASS | FAIL | BLOCKED |`);
  L.push(`| --- | --- | --- | --- |`);
  L.push(`| ${res.summary.total} | ${res.summary.pass} | ${res.summary.fail} | ${res.summary.blocked} |`);
  L.push('');
  L.push('| Task | Worker | Status | Duration | Decisive evidence |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const r of res.results) {
    const first = String(r.evidence ?? '').split('\n').find((l) => l.trim()) ?? '';
    L.push(`| \`${r.task_id}\` | ${r.worker} | ${r.status} | ${r.duration_ms ?? 0}ms | ${first.trim().slice(0, 90).replace(/\|/g, '\\|')} |`);
  }
  L.push('');
  for (const r of res.results) {
    const task = byId.get(r.task_id);
    L.push(`## ${r.task_id} — ${task?.title ?? ''}  →  **${r.status}**`);
    L.push('');
    L.push(`- **1. Task ID:** ${r.task_id}`);
    L.push(`- **2. Worker:** ${r.worker}${r.provenance === 'manual' ? ' (manually executed, imported)' : ' (runner-executed)'}`);
    L.push(`- **3. Actual command/action performed:**`);
    for (const a of r.action_performed ?? []) {
      L.push(`  - \`${Array.isArray(a.cmd) ? a.cmd.join(' ') : a.cmd}\` → exit ${a.exit ?? 'refused'}${a.ok === false ? ' **(UNEXPECTED)**' : ''}${a.refused ? ` (refused: ${a.refused})` : ''}${a.duration_ms !== undefined ? `, ${a.duration_ms}ms` : ''}`);
    }
    L.push(`- **4. Status:** ${r.status}`);
    L.push(`- **5. Exact evidence:**`);
    L.push('');
    L.push('  ```');
    for (const line of String(r.evidence ?? '').split('\n')) L.push(`  ${line}`);
    L.push('  ```');
    if ((r.action_performed ?? []).some((a) => a.stderr_tail && a.stderr_tail.trim())) {
      L.push('  stderr seen:');
      L.push('  ```');
      for (const a of r.action_performed) {
        if (a.stderr_tail?.trim()) for (const line of a.stderr_tail.split('\n').slice(-6)) L.push(`  ${line}`);
      }
      L.push('  ```');
    }
    L.push('');
    L.push(`- **6. Files changed:** ${r.files_changed?.length ? r.files_changed.map((f) => `\`${f}\``).join(', ') : 'none'}`);
    L.push(`- **7. Tests performed:** ${r.tests_performed?.length ? r.tests_performed.map((t) => `\`${t}\``).join(', ') : 'none'}`);
    L.push(`- **8. Report path:** \`${r.report_path}\``);
    L.push(`- **9. Remaining dependency/problem:** ${r.remaining_dependency ?? 'none'}`);
    L.push('');
  }
  L.push('## Deliberately NOT done');
  L.push('');
  for (const [k, v] of Object.entries(res.not_done ?? {})) L.push(`- ${k}: ${v}`);
  L.push('');
  L.push('_No status above was inferred. PASS lines exist only where a command exited 0 and its output was captured._');
  return cleanMarkdown(L);
}

function cmdRender(id, opts) {
  const { batch } = loadBatch(id);
  const file = batchFile(id, `results${opts.suffixPart ?? ''}`);
  const res = readJSON(file);
  if (!res) {
    console.error(`✗ cannot read ${rel(file)}`);
    return 1;
  }
  const md = renderResultsMarkdown(res, batch);
  const out = path.join(BATCH_DIR, `${id}.results${opts.suffixPart ?? ''}.md`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md);
  console.log(`rendered ${rel(out)} (${md.split('\n').length} lines)`);
  return 0;
}

/* -------------------------------------------------------------- template */

function cmdTemplate(id) {
  const { batch } = loadBatch(id);
  const manual = {
    protocol: PROTOCOL,
    batch_id: id,
    note: 'Fill ONLY tasks whose verify.mode is "manual". One entry per task, all 9 fields required. Do not write PASS unless the command exited 0 — paste the real output.',
    results: (batch.tasks ?? [])
      .filter((t) => t.verify?.mode === 'manual')
      .map((t) => ({
        task_id: t.id,
        worker: t.worker,
        action_performed: (t.verify.manual_commands ?? []).map((c) => ({
          cmd: c.split(/\s+/),
          exit: null,
          note: 'paste real exit code from `echo $?` and the output you saw'
        })),
        status: null,
        evidence: '',
        files_changed: [],
        tests_performed: (t.verify.manual_commands ?? []).slice(),
        report_path: `reports/agents/${id.toLowerCase()}-${t.id.toLowerCase()}-manual.log`,
        remaining_dependency: ''
      }))
  };
  const out = path.join(BATCH_DIR, `${id}.manual-template.json`);
  writeJSON(out, manual);
  console.log(`manual template written: ${rel(out)}`);
  console.log(`commands to run by hand for task ${id} (paste their real output into the template):`);
  for (const t of batch.tasks.filter((x) => x.verify?.mode === 'manual')) {
    console.log(`\n# ${t.id}`);
    for (const c of t.verify.manual_commands ?? []) console.log(`$ ${c}`);
  }
  console.log(`\nthen: node scripts/termux-batch.mjs run ${id} --import ${rel(out)}`);
  return 0;
}

/* -------------------------------------------------------------- decide */

/** Arena's decision helper: which tasks must be re-run/repaired next batch. */
function cmdDecide(id) {
  const { batch } = loadBatch(id);
  const res = readJSON(batchFile(id, 'results'));
  if (!res) {
    console.error('no result batch to decide from yet');
    return 1;
  }
  const requeue = [];
  const owner = [];
  for (const r of res.results) {
    if (r.status === 'PASS') continue;
    const dep = String(r.remaining_dependency ?? '');
    const needsOwner = /env (RESEND_API_KEY|GOOGLE_SEARCH_CONSOLE_TOKEN|GEMINI_API_KEY|META_ACCESS_TOKEN|META_PAGE_ID|CLOUDFLARE|CF_|R2_|DATABASE_URL)|owner|approval|paid/i.test(dep);
    (needsOwner ? owner : requeue).push({ task: r.task_id, worker: r.worker, status: r.status, dep });
  }
  console.log(`# ${id} — ARENA DECISION`);
  console.log('');
  console.log(`accepted: ${res.summary.pass}/${res.summary.total} PASS`);
  console.log('');
  console.log('## Auto-requeue for the next batch (Termux can act on these)');
  console.log(requeue.length ? requeue.map((x) => `- ${x.task} (${x.worker}, ${x.status}): ${x.dep}`).join('\n') : '- nothing');
  console.log('');
  console.log('## Needs owner action (blocked on a human decision or a credential)');
  console.log(owner.length ? owner.map((x) => `- ${x.task} (${x.worker}, ${x.status}): ${x.dep}`).join('\n') : '- nothing');
  console.log('');
  console.log('Queue is not empty while either list has an entry. Arena issues the next batch only after `validate` says ACCEPTED.');
  return 0;
}

/* ------------------------------------------------------------------ main */

function usage() {
  console.log(`ARENA ↔ TERMUX batch tool (${PROTOCOL})

  list                                  batches in ops/batches/
  show   <BATCH>                        print the task batch + its verifiers
  preflight [--json]                    environment ground truth (read-only)
  run    <BATCH> [--only T-01,T-02] [--import f.json]
                                        execute the batch, write <BATCH>.results.{json,md}
  validate <BATCH> [--suffix .sandbox]  reject fake/incomplete/unverified PASSes
  render <BATCH> [--suffix .sandbox]    rebuild the markdown report from JSON
  template <BATCH>                      manual-result template for verify.mode=manual
  decide <BATCH>                        split results into requeue vs needs-owner-action

  env PJS_BATCH_EXECUTOR=<id> labels who ran it (termux-device, arena-sandbox, …)`);
  return 0;
}

async function main() {
  const [, , command = 'help', ...args] = process.argv;
  const get = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (name) => args.includes(name);
  const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
  const id = positional[0];

  const suffixPart = (name) => {
    const v = get(name);
    return v ? `.${String(v).replace(/^\./, '')}` : '';
  };

  switch (command) {
    case 'list':
      return cmdList();
    case 'show':
      return id ? cmdShow(id) : usage();
    case 'preflight':
      return cmdPreflight({ json: has('--json') });
    case 'run':
      return id
        ? cmdRun(id, {
            only: get('--only')?.split(',').map((s) => s.trim()),
            import: get('--import'),
            executor: get('--executor') ?? process.env.PJS_BATCH_EXECUTOR,
            outSuffix: suffixPart('--suffix')
          })
        : usage();
    case 'validate':
      return id ? cmdValidate(id, { suffixPart: suffixPart('--suffix') }) : usage();
    case 'render':
      return id ? cmdRender(id, { suffixPart: suffixPart('--suffix') }) : usage();
    case 'template':
      return id ? cmdTemplate(id) : usage();
    case 'decide':
      return id ? cmdDecide(id) : usage();
    case 'help':
    case '--help':
    case '-h':
    default:
      return usage();
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    console.error(`\n✗ ${error.message}`);
    process.exit(1);
  });
