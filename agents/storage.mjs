#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — AI Agent Storage Engine
 * =============================================
 *
 * Har AI agent (Guardian, Manager, Pooja, Priya …) ko ek apni *permanent*
 * memory chahiye hoti hai, warna wo har run par "bhool" jaate hain ki pichhli
 * baar kya hua tha. GitHub Actions ka runner har baar naya (ephemeral) hota
 * hai, isliye state ko disk par likhna + run ke beech preserve karna zaroori
 * hai (workflow mein `actions/cache` se hota hai).
 *
 * Ye engine deta hai:
 *
 *   • PER-AGENT STORE  — state / memory / tasks / log / metrics / inbox / outbox
 *   • SHARED KV        — agents ke beech shared key-value namespaces
 *   • JOB QUEUE        — durable queue (pending → running → done/failed)
 *   • LEDGER           — append-only, hash-chained audit trail (tamper-evident)
 *   • INCIDENTS        — open/close incident register
 *   • SNAPSHOTS        — periodic full snapshots with retention
 *   • MAILBOX          — agent-to-agent messaging (inbox/outbox)
 *   • DOCTOR           — integrity check + retention/GC
 *
 * Safety (repo policy — kabhi nahi toota):
 *   - Storage sirf apne project ke andar likhta hai (path traversal blocked).
 *   - Kabhi password / private message store nahi karta.
 *   - Kabhi khud production deploy / git push / social post nahi karta.
 *   - Memory backend (read-only filesystem) par bhi crash nahi karta.
 *
 * Usage:
 *   import * as store from './storage.mjs';
 *   store.agentLog('pooja', { event: 'run', status: 'BLOCKED' });
 *
 * Env:
 *   PJS_AGENT_STORAGE_DIR   storage root (default: <repo>/storage)
 *   PJS_AGENT_STORAGE_BACKEND  'file' (default) | 'memory'
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

export const STORAGE_DIR =
  process.env.PJS_AGENT_STORAGE_DIR || path.join(ROOT, 'storage');

export const BACKEND =
  process.env.PJS_AGENT_STORAGE_BACKEND === 'memory' ? 'memory' : 'file';

export const PATHS = {
  root: STORAGE_DIR,
  agents: path.join(STORAGE_DIR, 'agents'),
  shared: path.join(STORAGE_DIR, 'shared'),
  kv: path.join(STORAGE_DIR, 'shared', 'kv'),
  queue: path.join(STORAGE_DIR, 'shared', 'queue'),
  ledger: path.join(STORAGE_DIR, 'shared', 'ledger'),
  incidents: path.join(STORAGE_DIR, 'shared', 'incidents'),
  knowledge: path.join(STORAGE_DIR, 'shared', 'knowledge'),
  snapshots: path.join(STORAGE_DIR, 'snapshots')
};

export const LIMITS = {
  logEntries: 500,        // per-agent log entries kept hot
  logArchive: 5,          // archived log files kept per agent
  metricsHistory: 200,    // recent run outcomes kept per agent
  outboxEntries: 200,
  inboxEntries: 200,
  queueDone: 300,         // finished jobs retained before pruning
  snapshots: 7,
  ledgerLinesPerFile: 5000
};

export const VERSION = '1.0.0';

/* --------------------------------------------------------------- utils */

export function now() {
  return new Date().toISOString();
}

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Monday-anchored ISO week label, e.g. 2026-W36. */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/* ------------------------------------------------------- safe path guard
 * Storage se bahar kuch bhi likhne/padhne ki koshish -> error.
 * Ye security guard hai: agent kisi bhi tarah repo ya system files ko
 * touch nahi kar sakta.
 */
function safeJoin(base, ...parts) {
  const target = path.resolve(base, ...parts);
  const baseResolved = path.resolve(base);
  if (target !== baseResolved && !target.startsWith(baseResolved + path.sep)) {
    throw new Error(`Storage path escapes root: ${target}`);
  }
  return target;
}

function safeId(id) {
  const clean = String(id || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(clean)) {
    throw new Error(`Invalid id: ${id}`);
  }
  return clean;
}

export function ensureDir(dir) {
  // `fs` ke liye bhi guard: dir hamesha STORAGE_DIR ke andar hona chahiye.
  const target = path.resolve(dir);
  const rootResolved = path.resolve(STORAGE_DIR);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error(`Refusing to create directory outside storage: ${target}`);
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}

/* ------------------------------------------------------------ backends */

const MEMORY = new Map();

function readRaw(file) {
  if (BACKEND === 'memory') {
    return MEMORY.has(file) ? MEMORY.get(file) : null;
  }
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function writeRaw(file, data) {
  if (BACKEND === 'memory') {
    MEMORY.set(file, data);
    return;
  }
  ensureDir(path.dirname(file));
  // Atomic write: temp file -> fsync -> rename. Runner beech mein mare to
  // bhi purana file intact rehta hai (kabhi aadha-likha JSON nahi banta).
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data);
    try { fs.fsyncSync(fd); } catch { /* some FSes disallow fsync */ }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function readJSON(file, fallback = null) {
  const raw = readRaw(file);
  if (raw === null || raw.trim() === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupt file -> fallback, par storage ko silently chhupaate nahi hain:
    // doctor() isko report karta hai.
    return fallback;
  }
}

export function writeJSON(file, value) {
  writeRaw(file, JSON.stringify(value, null, 2) + '\n');
  return file;
}

export function exists(file) {
  if (BACKEND === 'memory') return MEMORY.has(file);
  return fs.existsSync(file);
}

export function remove(file) {
  if (BACKEND === 'memory') return MEMORY.delete(file);
  try { fs.unlinkSync(file); return true; } catch { return false; }
}

export function listDir(dir) {
  if (BACKEND === 'memory') {
    const prefix = path.resolve(dir) + path.sep;
    return [...MEMORY.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => path.basename(k));
  }
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function listFilesRecursive(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of listDir(d)) {
      const full = path.join(d, entry);
      if (BACKEND === 'memory') {
        out.push(full);
        continue;
      }
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  if (BACKEND !== 'memory' && !fs.existsSync(dir)) return out;
  walk(dir);
  return out;
}

/* -------------------------------------------------------- agent registry */

const REGISTRY_FILE = () => path.join(PATHS.agents, 'index.json');

export function readRegistry() {
  return readJSON(REGISTRY_FILE(), { version: 1, agents: [] });
}

export function writeRegistry(registry) {
  return writeJSON(REGISTRY_FILE(), registry);
}

export function listAgents() {
  const registry = readRegistry();
  return (registry.agents || []).map((a) => safeId(a.id));
}

export function getAgent(id) {
  const clean = safeId(id);
  const registry = readRegistry();
  return (registry.agents || []).find((a) => safeId(a.id) === clean) || null;
}

export function registerAgent(agent) {
  const clean = safeId(agent.id);
  const registry = readRegistry();
  const list = registry.agents || [];
  const record = {
    id: clean,
    name: agent.name || clean,
    role: agent.role || 'worker',
    reports_to: agent.reports_to || 'manager',
    cadence: agent.cadence || 'on-demand',
    capabilities: agent.capabilities || [],
    requires: agent.requires || [],
    autonomous: agent.autonomous !== false,
    created_at: agent.created_at || now(),
    updated_at: now()
  };
  const index = list.findIndex((a) => safeId(a.id) === clean);
  if (index >= 0) record.created_at = list[index].created_at || record.created_at;
  if (index >= 0) list[index] = record;
  else list.push(record);

  registry.agents = list;
  registry.version = registry.version || 1;
  registry.updated_at = now();
  writeRegistry(registry);
  ensureAgentStore(clean, record);
  return record;
}

/* ------------------------------------------------------- per-agent store */

const AGENT_FILES = [
  'profile.json',
  'state.json',
  'memory.json',
  'tasks.json',
  'metrics.json',
  'log.ndjson',
  'inbox.json',
  'outbox.json'
];

export function agentDir(id) {
  return safeJoin(PATHS.agents, safeId(id));
}

/** Har agent ke liye poori storage skeleton banata hai (idempotent). */
export function ensureAgentStore(id, profile = null) {
  const clean = safeId(id);
  const dir = agentDir(clean);
  ensureDir(dir);

  const defaults = {
    'profile.json': profile
      ? { ...profile, id: clean, storage_version: VERSION }
      : { id: clean, storage_version: VERSION },
    'state.json': {
      agent: clean,
      status: 'INIT',
      last_run_at: null,
      last_status: null,
      runs: 0,
      consecutive_failures: 0,
      updated_at: now()
    },
    'memory.json': {
      agent: clean,
      short_term: {},
      long_term: {},
      facts: [],
      updated_at: now()
    },
    'tasks.json': {
      agent: clean,
      pending: [],
      running: [],
      done: [],
      failed: [],
      updated_at: now()
    },
    'metrics.json': {
      agent: clean,
      counters: {},
      history: [],
      updated_at: now()
    },
    'inbox.json': { agent: clean, messages: [] },
    'outbox.json': { agent: clean, messages: [] }
  };

  for (const [file, value] of Object.entries(defaults)) {
    if (!exists(path.join(dir, file))) writeJSON(path.join(dir, file), value);
  }
  const logFile = path.join(dir, 'log.ndjson');
  if (!exists(logFile)) writeRaw(logFile, '');
  return dir;
}

export function agentFile(id, file) {
  return safeJoin(agentDir(id), file);
}

export function readAgentDoc(id, file, fallback = null) {
  return readJSON(agentFile(id, file), fallback);
}

export function writeAgentDoc(id, file, value) {
  return writeJSON(agentFile(id, file), value);
}

/** Agent ki state update (merge). */
export function setState(id, patch) {
  const doc = readAgentDoc(id, 'state.json', {});
  const next = { ...doc, ...patch, agent: safeId(id), updated_at: now() };
  return writeAgentDoc(id, 'state.json', next);
}

export function getState(id) {
  return readAgentDoc(id, 'state.json', null);
}

/* ------------------------------------------------------------- memory */

export function remember(id, key, value, { longTerm = false } = {}) {
  const clean = safeId(id);
  const doc = readAgentDoc(clean, 'memory.json', { short_term: {}, long_term: {}, facts: [] });
  const bucket = longTerm ? 'long_term' : 'short_term';
  doc[bucket] = doc[bucket] || {};
  doc[bucket][key] = { value, at: now() };
  doc.updated_at = now();
  writeAgentDoc(clean, 'memory.json', doc);
  return doc;
}

export function recall(id, key, { longTerm = false } = {}) {
  const doc = readAgentDoc(id, 'memory.json', { short_term: {}, long_term: {} });
  const bucket = longTerm ? 'long_term' : 'short_term';
  const hit = (doc[bucket] || {})[key];
  return hit ? hit.value : undefined;
}

export function addFact(id, fact, { tags = [] } = {}) {
  const clean = safeId(id);
  const doc = readAgentDoc(clean, 'memory.json', { short_term: {}, long_term: {}, facts: [] });
  doc.facts = doc.facts || [];
  doc.facts.push({ id: uid('fact'), text: String(fact), tags, at: now() });
  if (doc.facts.length > LIMITS.logEntries) {
    doc.facts = doc.facts.slice(-LIMITS.logEntries);
  }
  doc.updated_at = now();
  writeAgentDoc(clean, 'memory.json', doc);
  return doc;
}

/* --------------------------------------------------------------- logs */

export function readLog(id, file = 'log.ndjson') {
  const raw = readRaw(agentFile(id, file));
  if (!raw || !raw.trim()) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return { corrupt: true, raw: line }; }
    });
}

/**
 * Append-only run log. Retention ke baad purana log archive ho jaata hai,
 * delete nahi — taaki history kabhi silently loss na ho.
 */
export function agentLog(id, entry, { rotate = true } = {}) {
  const clean = safeId(id);
  ensureAgentStore(clean);
  const file = agentFile(clean, 'log.ndjson');
  const line = JSON.stringify({ ts: now(), ...entry });
  const existing = readRaw(file) || '';
  const lines = existing.split('\n').filter(Boolean);
  lines.push(line);

  if (rotate && lines.length > LIMITS.logEntries) {
    const keep = lines.slice(-LIMITS.logEntries);
    const overflow = lines.slice(0, lines.length - LIMITS.logEntries);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveDir = path.join(agentDir(clean), 'archive');
    ensureDir(archiveDir);
    writeRaw(path.join(archiveDir, `log-${stamp}.ndjson`), overflow.join('\n') + '\n');
    writeRaw(file, keep.join('\n') + '\n');
    pruneArchives(clean);
    return { ts: JSON.parse(line).ts, rotated: true };
  }

  writeRaw(file, lines.join('\n') + '\n');
  return { ts: JSON.parse(line).ts, rotated: false };
}

function pruneArchives(id) {
  const dir = path.join(agentDir(id), 'archive');
  const files = listDir(dir).filter((f) => f.startsWith('log-')).sort();
  while (files.length > LIMITS.logArchive) {
    remove(path.join(dir, files.shift()));
  }
}

/* ------------------------------------------------------------- metrics */

export function bumpMetric(id, name, by = 1) {
  const clean = safeId(id);
  const doc = readAgentDoc(clean, 'metrics.json', { counters: {}, history: [] });
  doc.counters = doc.counters || {};
  doc.counters[name] = (doc.counters[name] || 0) + by;
  doc.updated_at = now();
  writeAgentDoc(clean, 'metrics.json', doc);
  return doc.counters;
}

export function recordRun(id, { status = 'OK', summary = '', duration_ms = 0, details = null } = {}) {
  const clean = safeId(id);
  ensureAgentStore(clean);

  const state = readAgentDoc(clean, 'state.json', {});
  const runs = (state.runs || 0) + 1;
  const failed = status === 'FAIL';
  setState(clean, {
    status,
    last_run_at: now(),
    last_status: status,
    runs,
    consecutive_failures: failed ? (state.consecutive_failures || 0) + 1 : 0
  });

  bumpMetric(clean, 'runs');
  bumpMetric(clean, `status_${String(status).toLowerCase()}`);

  const metrics = readAgentDoc(clean, 'metrics.json', { counters: {}, history: [] });
  metrics.history = metrics.history || [];
  metrics.history.push({ at: now(), status, duration_ms, summary });
  if (metrics.history.length > LIMITS.metricsHistory) {
    metrics.history = metrics.history.slice(-LIMITS.metricsHistory);
  }
  metrics.updated_at = now();
  writeAgentDoc(clean, 'metrics.json', metrics);

  agentLog(clean, { event: 'run', status, duration_ms, summary, details });
  ledgerAppend({ type: 'agent.run', agent: clean, status, summary });

  if (failed) {
    openIncident({
      id: `run-fail-${clean}`,
      agent: clean,
      severity: 'warning',
      title: `${clean} run failed`,
      detail: summary || 'Run reported FAIL.'
    });
  } else {
    closeIncident(`run-fail-${clean}`, { note: 'Recovered — next run passed.' });
  }

  return { agent: clean, status, runs };
}

/* --------------------------------------------------------------- tasks */

export function addTask(id, task) {
  const clean = safeId(id);
  ensureAgentStore(clean);
  const doc = readAgentDoc(clean, 'tasks.json', { pending: [], running: [], done: [], failed: [] });
  const record = {
    id: task.id || uid('task'),
    title: String(task.title || 'untitled task'),
    priority: task.priority || 'normal',
    created_at: now(),
    status: 'pending',
    meta: task.meta || {}
  };
  doc.pending = doc.pending || [];
  if (!doc.pending.some((t) => t.id === record.id)) doc.pending.push(record);
  doc.updated_at = now();
  writeAgentDoc(clean, 'tasks.json', doc);
  return record;
}

export function claimTask(id) {
  const clean = safeId(id);
  const doc = readAgentDoc(clean, 'tasks.json', { pending: [], running: [], done: [], failed: [] });
  doc.pending = doc.pending || [];
  doc.running = doc.running || [];
  const task = doc.pending.shift();
  if (!task) return null;
  task.status = 'running';
  task.started_at = now();
  doc.running.push(task);
  doc.updated_at = now();
  writeAgentDoc(clean, 'tasks.json', doc);
  return task;
}

export function finishTask(id, taskId, { ok = true, result = null, error = null } = {}) {
  const clean = safeId(id);
  const doc = readAgentDoc(clean, 'tasks.json', { pending: [], running: [], done: [], failed: [] });
  doc.running = doc.running || [];
  const index = doc.running.findIndex((t) => t.id === taskId);
  if (index < 0) return null;
  const [task] = doc.running.splice(index, 1);
  task.status = ok ? 'done' : 'failed';
  task.finished_at = now();
  task.result = result;
  task.error = error;
  const bucket = ok ? 'done' : 'failed';
  doc[bucket] = doc[bucket] || [];
  doc[bucket].push(task);
  for (const key of ['done', 'failed']) {
    if ((doc[key] || []).length > LIMITS.logEntries) {
      doc[key] = doc[key].slice(-LIMITS.logEntries);
    }
  }
  doc.updated_at = now();
  writeAgentDoc(clean, 'tasks.json', doc);
  return task;
}

export function getTasks(id) {
  return readAgentDoc(id, 'tasks.json', { pending: [], running: [], done: [], failed: [] });
}

/* ------------------------------------------------------------- mailbox */

export function sendMessage({ from, to, subject = '', body = '', priority = 'normal' }) {
  const cleanFrom = safeId(from);
  const cleanTo = safeId(to);
  ensureAgentStore(cleanFrom);
  ensureAgentStore(cleanTo);

  const message = {
    id: uid('msg'),
    from: cleanFrom,
    to: cleanTo,
    subject,
    body,
    priority,
    at: now(),
    read: false
  };

  const outbox = readAgentDoc(cleanFrom, 'outbox.json', { messages: [] });
  outbox.messages = outbox.messages || [];
  outbox.messages.push(message);
  if (outbox.messages.length > LIMITS.outboxEntries) {
    outbox.messages = outbox.messages.slice(-LIMITS.outboxEntries);
  }
  writeAgentDoc(cleanFrom, 'outbox.json', outbox);

  const inbox = readAgentDoc(cleanTo, 'inbox.json', { messages: [] });
  inbox.messages = inbox.messages || [];
  inbox.messages.push(message);
  if (inbox.messages.length > LIMITS.inboxEntries) {
    inbox.messages = inbox.messages.slice(-LIMITS.inboxEntries);
  }
  writeAgentDoc(cleanTo, 'inbox.json', inbox);

  return message;
}

export function readInbox(id, { unreadOnly = false } = {}) {
  const doc = readAgentDoc(id, 'inbox.json', { messages: [] });
  const messages = doc.messages || [];
  return unreadOnly ? messages.filter((m) => !m.read) : messages;
}

export function markRead(id, messageId = null) {
  const clean = safeId(id);
  const doc = readAgentDoc(clean, 'inbox.json', { messages: [] });
  doc.messages = (doc.messages || []).map((m) =>
    messageId === null || m.id === messageId ? { ...m, read: true } : m
  );
  writeAgentDoc(clean, 'inbox.json', doc);
  return doc.messages.length;
}

/* --------------------------------------------------------- shared KV */

export function kvFile(namespace) {
  return safeJoin(PATHS.kv, `${safeId(namespace)}.json`);
}

export function kvSet(namespace, key, value) {
  const ns = safeId(namespace);
  const doc = readJSON(kvFile(ns), { namespace: ns, values: {}, updated_at: now() });
  doc.values = doc.values || {};
  doc.values[key] = { value, at: now() };
  doc.updated_at = now();
  writeJSON(kvFile(ns), doc);
  return doc.values[key];
}

export function kvGet(namespace, key, fallback = undefined) {
  const doc = readJSON(kvFile(namespace), { values: {} });
  const hit = (doc.values || {})[key];
  return hit ? hit.value : fallback;
}

export function kvDelete(namespace, key) {
  const doc = readJSON(kvFile(namespace), { values: {} });
  if (doc.values && key in doc.values) delete doc.values[key];
  doc.updated_at = now();
  writeJSON(kvFile(namespace), doc);
  return true;
}

export function kvList(namespace) {
  const doc = readJSON(kvFile(namespace), { values: {} });
  return Object.entries(doc.values || {}).map(([key, v]) => ({ key, value: v.value, at: v.at }));
}

export function kvNamespaces() {
  return listDir(PATHS.kv)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

/* ---------------------------------------------------------- job queue */

const QUEUE_FILE = () => path.join(PATHS.queue, 'jobs.json');

function readQueue() {
  return readJSON(QUEUE_FILE(), { pending: [], running: [], done: [], failed: [] });
}

function writeQueue(q) {
  q.updated_at = now();
  return writeJSON(QUEUE_FILE(), q);
}

export function enqueue(job) {
  const q = readQueue();
  const record = {
    id: job.id || uid('job'),
    type: job.type || 'generic',
    payload: job.payload || {},
    priority: job.priority || 'normal',
    created_at: now(),
    attempts: 0
  };
  q.pending = q.pending || [];
  if (!q.pending.some((j) => j.id === record.id)) q.pending.push(record);
  writeQueue(q);
  return record;
}

export function claimJob(worker = 'unknown') {
  const q = readQueue();
  q.pending = q.pending || [];
  const order = { high: 0, normal: 1, low: 2 };
  q.pending.sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));
  const job = q.pending.shift();
  if (!job) return null;
  job.attempts += 1;
  job.claimed_by = safeId(worker);
  job.claimed_at = now();
  q.running = q.running || [];
  q.running.push(job);
  writeQueue(q);
  return job;
}

export function completeJob(jobId, result = null) {
  return settleJob(jobId, true, result, null);
}

export function failJob(jobId, error = 'unknown error') {
  return settleJob(jobId, false, null, String(error));
}

function settleJob(jobId, ok, result, error) {
  const q = readQueue();
  q.running = q.running || [];
  const index = q.running.findIndex((j) => j.id === jobId);
  if (index < 0) return null;
  const [job] = q.running.splice(index, 1);
  job.finished_at = now();
  job.result = result;
  job.error = error;
  const bucket = ok ? 'done' : 'failed';
  q[bucket] = q[bucket] || [];
  q[bucket].push(job);
  if (q[bucket].length > LIMITS.queueDone) q[bucket] = q[bucket].slice(-LIMITS.queueDone);
  writeQueue(q);
  return job;
}

export function queueStats() {
  const q = readQueue();
  return {
    pending: (q.pending || []).length,
    running: (q.running || []).length,
    done: (q.done || []).length,
    failed: (q.failed || []).length,
    updated_at: q.updated_at || null
  };
}

/* ------------------------------------------------------------- ledger
 * Append-only, hash-chained: har line me pichhli line ka hash hota hai.
 * Isse koi bhi line badli/gayab hui to verify() pakad leta hai.
 */

function ledgerFile() {
  const d = new Date();
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return path.join(PATHS.ledger, `${month}.ndjson`);
}

const GENESIS = '0'.repeat(64);

export function ledgerLastHash() {
  const files = listDir(PATHS.ledger).filter((f) => f.endsWith('.ndjson')).sort();
  if (!files.length) return GENESIS;
  const raw = readRaw(path.join(PATHS.ledger, files[files.length - 1])) || '';
  const lines = raw.split('\n').filter(Boolean);
  if (!lines.length) return GENESIS;
  try {
    return JSON.parse(lines[lines.length - 1]).hash || GENESIS;
  } catch {
    return GENESIS;
  }
}

export function ledgerAppend(entry) {
  const file = ledgerFile();
  const prev = ledgerLastHash();
  const seq = ((readLedger().length) || 0) + 1;
  const record = {
    ts: now(),
    seq,
    prev,
    ...entry
  };
  record.hash = sha256(prev + JSON.stringify({ ...record, hash: null }));
  const existing = readRaw(file) || '';
  const lines = existing.split('\n').filter(Boolean);
  lines.push(JSON.stringify(record));
  writeRaw(file, lines.join('\n') + '\n');
  return record;
}

export function readLedger(file = null) {
  const target = file || ledgerFile();
  const raw = readRaw(target);
  if (!raw || !raw.trim()) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { corrupt: true, raw: line }; }
  });
}

export function ledgerFiles() {
  return listDir(PATHS.ledger).filter((f) => f.endsWith('.ndjson')).sort();
}

export function ledgerVerify() {
  const files = ledgerFiles();
  let checked = 0;
  let broken = 0;
  const problems = [];
  let prev = GENESIS;

  for (const file of files) {
    const entries = readLedger(path.join(PATHS.ledger, file));
    for (const entry of entries) {
      checked++;
      if (entry.corrupt) {
        broken++;
        problems.push(`${file}: unparseable line`);
        continue;
      }
      if (entry.prev !== prev) {
        broken++;
        problems.push(`${file}: chain break at seq ${entry.seq}`);
      }
      const { hash, ...rest } = entry;
      const expected = sha256(entry.prev + JSON.stringify({ ...rest, hash: null }));
      if (hash !== expected) {
        broken++;
        problems.push(`${file}: hash mismatch at seq ${entry.seq}`);
      }
      prev = entry.hash || prev;
    }
  }
  return { ok: broken === 0, checked, broken, problems, files };
}

/* ---------------------------------------------------------- incidents */

const INCIDENT_FILE = () => path.join(PATHS.incidents, 'open.json');
const INCIDENT_LOG = () => path.join(PATHS.incidents, 'history.ndjson');

export function openIncident({ id, agent = 'system', severity = 'warning', title, detail = '' }) {
  const doc = readJSON(INCIDENT_FILE(), { open: [] });
  doc.open = doc.open || [];
  const cleanId = safeId(id || uid('inc'));
  const existing = doc.open.find((i) => i.id === cleanId);
  if (existing) {
    existing.occurrences = (existing.occurrences || 1) + 1;
    existing.last_seen_at = now();
    existing.detail = detail || existing.detail;
    writeJSON(INCIDENT_FILE(), doc);
    return existing;
  }
  const incident = {
    id: cleanId,
    agent: safeId(agent),
    severity,
    title: String(title || cleanId),
    detail,
    opened_at: now(),
    last_seen_at: now(),
    occurrences: 1
  };
  doc.open.push(incident);
  writeJSON(INCIDENT_FILE(), doc);
  appendIncidentLog({ action: 'open', ...incident });
  return incident;
}

export function closeIncident(id, { note = '' } = {}) {
  const doc = readJSON(INCIDENT_FILE(), { open: [] });
  doc.open = doc.open || [];
  const index = doc.open.findIndex((i) => i.id === safeId(id));
  if (index < 0) return null;
  const [incident] = doc.open.splice(index, 1);
  incident.closed_at = now();
  incident.close_note = note;
  writeJSON(INCIDENT_FILE(), doc);
  appendIncidentLog({ action: 'close', ...incident });
  return incident;
}

function appendIncidentLog(entry) {
  const file = INCIDENT_LOG();
  const existing = readRaw(file) || '';
  const lines = existing.split('\n').filter(Boolean);
  lines.push(JSON.stringify({ ts: now(), ...entry }));
  if (lines.length > LIMITS.logEntries) {
    lines.splice(0, lines.length - LIMITS.logEntries);
  }
  writeRaw(file, lines.join('\n') + '\n');
}

export function openIncidents() {
  return readJSON(INCIDENT_FILE(), { open: [] }).open || [];
}

/* ------------------------------------------------------- knowledge base */

export function putKnowledge(topic, entries) {
  const clean = safeId(topic);
  const file = safeJoin(PATHS.knowledge, `${clean}.json`);
  const doc = readJSON(file, { topic: clean, entries: [] });
  doc.entries = doc.entries || [];
  for (const entry of entries) {
    doc.entries.push({ id: uid('kb'), at: now(), ...entry });
  }
  if (doc.entries.length > LIMITS.logEntries) {
    doc.entries = doc.entries.slice(-LIMITS.logEntries);
  }
  doc.updated_at = now();
  writeJSON(file, doc);
  return doc;
}

export function getKnowledge(topic) {
  return readJSON(safeJoin(PATHS.knowledge, `${safeId(topic)}.json`), { topic, entries: [] });
}

export function knowledgeTopics() {
  return listDir(PATHS.knowledge).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

/* ---------------------------------------------------------- snapshots */

export function snapshot(label = null) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = label ? `${stamp}-${safeId(label)}` : stamp;
  const dir = safeJoin(PATHS.snapshots, name);
  ensureDir(dir);

  const files = listFilesRecursive(PATHS.agents)
    .concat(listFilesRecursive(PATHS.shared));
  const manifest = { name, created_at: now(), version: VERSION, files: [], bytes: 0 };

  for (const file of files) {
    if (file.includes(`${path.sep}snapshots${path.sep}`)) continue;
    const rel = path.relative(STORAGE_DIR, file);
    const raw = readRaw(file) || '';
    const target = safeJoin(dir, rel);
    writeRaw(target, raw);
    manifest.files.push({ path: rel, bytes: Buffer.byteLength(raw), sha256: sha256(raw) });
    manifest.bytes += Buffer.byteLength(raw);
  }

  writeJSON(safeJoin(dir, 'manifest.json'), manifest);

  // Retention: purane snapshots hata do (sirf snapshots/ ke andar).
  const snaps = listDir(PATHS.snapshots).sort();
  while (snaps.length > LIMITS.snapshots) {
    const old = snaps.shift();
    if (BACKEND === 'memory') {
      for (const key of [...MEMORY.keys()]) {
        if (key.startsWith(path.join(PATHS.snapshots, old))) MEMORY.delete(key);
      }
    } else {
      fs.rmSync(path.join(PATHS.snapshots, old), { recursive: true, force: true });
    }
  }

  return manifest;
}

export function listSnapshots() {
  return listDir(PATHS.snapshots)
    .sort()
    .map((name) => {
      const manifest = readJSON(safeJoin(PATHS.snapshots, `${name}/manifest.json`), null);
      return {
        name,
        created_at: manifest?.created_at || null,
        files: manifest?.files?.length || 0,
        bytes: manifest?.bytes || 0
      };
    });
}

/* -------------------------------------------------------------- doctor */

export function doctor() {
  const results = [];
  let ok = true;

  const push = (name, pass, detail = '') => {
    results.push({ name, ok: pass, detail });
    if (!pass) ok = false;
  };

  const relDir = path.relative(process.cwd(), STORAGE_DIR) || STORAGE_DIR;
  push('storage root exists', BACKEND === 'memory' || fs.existsSync(STORAGE_DIR), relDir);

  const registry = readRegistry();
  const agents = (registry.agents || []).map((a) => safeId(a.id));
  push('agent registry readable', Array.isArray(registry.agents), `${agents.length} agents`);

  let missing = 0;
  for (const id of agents) {
    for (const file of AGENT_FILES) {
      if (!exists(agentFile(id, file))) missing++;
    }
  }
  push('agent stores complete', missing === 0, `${missing} missing file(s)`);

  // JSON parse check on every storage file.
  let corrupt = 0;
  const files = listFilesRecursive(PATHS.agents).concat(listFilesRecursive(PATHS.shared));
  for (const file of files) {
    if (file.endsWith('.ndjson')) continue;
    if (!file.endsWith('.json')) continue;
    const raw = readRaw(file);
    if (raw === null) continue;
    if (raw.trim() === '') { corrupt++; continue; }
    try { JSON.parse(raw); } catch { corrupt++; }
  }
  push('json files parse', corrupt === 0, `${corrupt} corrupt`);

  const chain = ledgerVerify();
  push('ledger chain intact', chain.ok, `${chain.checked} entries, ${chain.broken} problem(s)`);

  const incidents = openIncidents();
  push('incident register readable', Array.isArray(incidents), `${incidents.length} open`);

  return {
    ok,
    backend: BACKEND,
    dir: STORAGE_DIR,
    agents: agents.length,
    files: files.length,
    snapshots: listSnapshots().length,
    queue: queueStats(),
    openIncidents: incidents.length,
    ledger: { checked: chain.checked, broken: chain.broken },
    checks: results
  };
}

/* ---------------------------------------------------------------- init */

/**
 * Poora storage tree banata/ensure karta hai + registry agents ke liye
 * per-agent store. Idempotent — baar baar chalane se data delete nahi hota.
 */
export function init({ agents = [] } = {}) {
  ensureDir(STORAGE_DIR);
  for (const dir of [
    PATHS.agents,
    PATHS.shared,
    PATHS.kv,
    PATHS.queue,
    PATHS.ledger,
    PATHS.incidents,
    PATHS.knowledge,
    PATHS.snapshots
  ]) {
    ensureDir(dir);
  }

  if (!exists(REGISTRY_FILE())) {
    writeRegistry({ version: 1, project: 'PANIKA JEEVAN SATHI', created_at: now(), agents: [] });
  }
  if (!exists(QUEUE_FILE())) {
    writeQueue({ pending: [], running: [], done: [], failed: [] });
  }
  if (!exists(INCIDENT_FILE())) {
    writeJSON(INCIDENT_FILE(), { open: [] });
  }

  for (const agent of agents) registerAgent(agent);

  for (const id of listAgents()) ensureAgentStore(id, getAgent(id));

  return { dir: STORAGE_DIR, backend: BACKEND, agents: listAgents() };
}

/* -------------------------------------------------------------- summary */

export function status() {
  const agents = listAgents().map((id) => {
    const state = getState(id) || {};
    const tasks = getTasks(id);
    const metrics = readAgentDoc(id, 'metrics.json', { counters: {} });
    return {
      id,
      name: (getAgent(id) || {}).name || id,
      role: (getAgent(id) || {}).role || 'worker',
      status: state.last_status || 'NEVER_RUN',
      runs: state.runs || 0,
      last_run_at: state.last_run_at,
      consecutive_failures: state.consecutive_failures || 0,
      pending_tasks: (tasks.pending || []).length,
      done_tasks: (tasks.done || []).length,
      unread: readInbox(id, { unreadOnly: true }).length,
      counters: metrics.counters || {}
    };
  });

  return {
    project: 'PANIKA JEEVAN SATHI',
    generated_at: now(),
    version: VERSION,
    backend: BACKEND,
    dir: STORAGE_DIR,
    agents,
    queue: queueStats(),
    namespaces: kvNamespaces(),
    knowledge: knowledgeTopics(),
    snapshots: listSnapshots(),
    open_incidents: openIncidents(),
    ledger: ledgerVerify()
  };
}

export default {
  ROOT,
  STORAGE_DIR,
  PATHS,
  VERSION,
  init,
  status,
  doctor,
  snapshot,
  listSnapshots,
  registerAgent,
  listAgents,
  getAgent,
  ensureAgentStore,
  setState,
  getState,
  remember,
  recall,
  addFact,
  agentLog,
  readLog,
  bumpMetric,
  recordRun,
  addTask,
  claimTask,
  finishTask,
  getTasks,
  sendMessage,
  readInbox,
  markRead,
  kvSet,
  kvGet,
  kvDelete,
  kvList,
  kvNamespaces,
  enqueue,
  claimJob,
  completeJob,
  failJob,
  queueStats,
  ledgerAppend,
  readLedger,
  ledgerVerify,
  openIncident,
  closeIncident,
  openIncidents,
  putKnowledge,
  getKnowledge,
  knowledgeTopics
};
