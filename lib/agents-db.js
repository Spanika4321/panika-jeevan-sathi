'use strict';
/**
 * TEER WALE — Supabase-backed AI Agent Storage
 *
 * Ye storage engine agents ke data ko local filesystem ke bajaye
 * Supabase PostgreSQL mein save karta hai — jisse agents 24/7 chal
 * sakte hain aur data kabhi lost nahi hoga.
 *
 * Har agent ka apna store hota hai:
 *   - state, memory, tasks, metrics, log, inbox, outbox
 *
 * Shared:
 *   - KV namespaces
 *   - Job queue
 *   - Hash-chained ledger (tamper-evident)
 *   - Incidents
 *   - Knowledge base
 *   - Snapshots
 */

const { createSupabaseDriver, loadSupabaseTables, computeSequences } = require('./supabase-driver');

/* -------------------------------------------------------------------- tables */

const AGENTS_SCHEMA = `
-- Per-agent profile (metadata)
CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'worker',
  reports_to TEXT NOT NULL DEFAULT 'manager',
  cadence TEXT NOT NULL DEFAULT 'on-demand',
  capabilities TEXT NOT NULL DEFAULT '[]',
  requires TEXT NOT NULL DEFAULT '[]',
  autonomous INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Agent state (status, runs, failures, etc.)
CREATE TABLE IF NOT EXISTS agent_states (
  agent_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'INIT',
  last_run_at TEXT,
  last_status TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Per-agent memory (short-term + long-term, facts)
CREATE TABLE IF NOT EXISTS agent_memory (
  id INTEGER PRIMARY KEY,
  agent_id TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'short_term', -- 'short_term' | 'long_term' | 'facts'
  key TEXT,
  value TEXT NOT NULL,
  at TEXT NOT NULL,
  UNIQUE(agent_id, bucket, key)
);

-- Per-agent tasks
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  result TEXT,
  error TEXT
);

-- Per-agent metrics (counters + history)
CREATE TABLE IF NOT EXISTS agent_metrics (
  id INTEGER PRIMARY KEY,
  agent_id TEXT NOT NULL,
  counters_key TEXT NOT NULL,
  counters_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(agent_id, counters_key)
);

CREATE TABLE IF NOT EXISTS agent_metrics_history (
  id INTEGER PRIMARY KEY,
  agent_id TEXT NOT NULL,
  at TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  summary TEXT
);

-- Per-agent run log (append-only NDJSON-style)
CREATE TABLE IF NOT EXISTS agent_logs (
  id INTEGER PRIMARY KEY,
  agent_id TEXT NOT NULL,
  at TEXT NOT NULL,
  event TEXT NOT NULL,
  status TEXT,
  duration_ms INTEGER,
  summary TEXT,
  details TEXT
);

-- Per-agent mailbox (inbox/outbox)
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0 -- 0 = unread, 1 = read
);

-- Shared KV namespaces
CREATE TABLE IF NOT EXISTS shared_kv (
  id INTEGER PRIMARY KEY,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  at TEXT NOT NULL,
  UNIQUE(namespace, key)
);

-- Job queue
CREATE TABLE IF NOT EXISTS job_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'generic',
  payload TEXT NOT NULL DEFAULT '{}',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'done' | 'failed'
  created_at TEXT NOT NULL,
  claimed_by TEXT,
  claimed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT,
  result TEXT,
  error TEXT
);

-- Hash-chained audit ledger (tamper-evident)
CREATE TABLE IF NOT EXISTS audit_ledger (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  seq INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  type TEXT NOT NULL,
  agent TEXT NOT NULL,
  status TEXT,
  summary TEXT,
  hash TEXT NOT NULL -- sha256(prev_hash + entry_without_hash)
);

-- Incidents
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL DEFAULT 'system',
  severity TEXT NOT NULL DEFAULT 'warning',
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'closed'
  opened_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  closed_at TEXT,
  close_note TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1
);

-- Knowledge base
CREATE TABLE IF NOT EXISTS knowledge_base (
  id INTEGER PRIMARY KEY,
  topic TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL,
  UNIQUE(topic, entry_id)
);

-- Snapshots metadata
CREATE TABLE IF NOT EXISTS snapshots (
  name TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  version TEXT NOT NULL,
  files_count INTEGER NOT NULL DEFAULT 0,
  bytes_total INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT -- full manifest JSON
);
`;

const AGENTS_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_agent_states_status ON agent_states(status)',
  'CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(agent_id)',
  'CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status)',
  'CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_id)',
  'CREATE INDEX IF NOT EXISTS idx_agent_logs_at ON agent_logs(at)',
  'CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON agent_messages(to_agent)',
  'CREATE INDEX IF NOT EXISTS idx_agent_messages_read ON agent_messages(read)',
  'CREATE INDEX IF NOT EXISTS idx_shared_kv_ns ON shared_kv(namespace)',
  'CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status)',
  'CREATE INDEX IF NOT EXISTS idx_audit_ledger_seq ON audit_ledger(seq)',
  'CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)',
  'CREATE INDEX IF NOT EXISTS idx_incidents_agent ON incidents(agent)',
  'CREATE INDEX IF NOT EXISTS idx_knowledge_topic ON knowledge_base(topic)'
];

/* -------------------------------------------------------------------- engine */

/**
 * Create a Supabase-backed agents storage engine.
 *
 *   supabase  — a Supabase client (from @supabase/supabase-js)
 *
 * Returns the same interface as agents/storage.mjs, but all reads/writes
 * go to Supabase PostgreSQL instead of the local filesystem.
 */
function createAgentsDb(supabase) {
  if (!supabase) {
    throw new Error('createAgentsDb needs a Supabase client.');
  }

  // In-memory mirror for reads (instant). Writes queued + flushed async.
  const tables = {
    agent_profiles: [],
    agent_states: [],
    agent_memory: [],
    agent_tasks: [],
    agent_metrics: [],
    agent_metrics_history: [],
    agent_logs: [],
    agent_messages: [],
    shared_kv: [],
    job_queue: [],
    audit_ledger: [],
    incidents: [],
    knowledge_base: [],
    snapshots: []
  };
  const seq = {
    agent_memory: 0,
    agent_metrics: 0,
    agent_metrics_history: 0,
    agent_logs: 0,
    shared_kv: 0,
    audit_ledger: 0,
    knowledge_base: 0,
    snapshots: 0
  };

  function matchRow(row, col, value) {
    return row[col] == value;
  }

  function findById(table, id) {
    return tables[table].find((r) => r.id == id);
  }

  function findByAgent(table, agentId) {
    return tables[table].filter((r) => r.agent_id == agentId);
  }

  function findFirstByAgent(table, agentId) {
    return tables[table].find((r) => r.agent_id == agentId);
  }

  function updateInPlace(table, rowId, patch) {
    const idx = tables[table].findIndex((r) => r.id == rowId);
    if (idx < 0) return false;
    Object.assign(tables[table][idx], patch);
    return true;
  }

  function upsertUnique(table, uniqueCols, row) {
    const existing = tables[table].find((r) =>
      uniqueCols.every((c) => r[c] == row[c])
    );
    if (existing) {
      Object.assign(existing, row);
      return existing;
    }
    tables[table].push(row);
    return row;
  }

  function enqueueWrite(op) {
    // op = { type, table, data? }
    // Pending writes flushed before response + timer + shutdown
    pendingWrites.push(op);
  }

  let pendingWrites = [];
  let flushChain = Promise.resolve();
  let lastFlushAt = 0;

  async function flushWrites() {
    if (!pendingWrites.length) return 0;
    const ops = pendingWrites;
    pendingWrites = [];
    let flushed = 0;
    for (const op of ops) {
      try {
        if (op.type === 'insert') {
          const { error } = await supabase.from(op.table).insert([op.data]);
          if (!error) flushed += 1;
          else throw error;
        } else if (op.type === 'update') {
          const { error } = await supabase.from(op.table).update(op.data).eq('id', op.id);
          if (!error) flushed += 1;
          else throw error;
        } else if (op.type === 'upsert') {
          // Use onConflict for upsert
          const { error } = await supabase.from(op.table).upsert(op.data, { onConflict: op.onConflict });
          if (!error) flushed += 1;
          else throw error;
        }
      } catch (err) {
        pendingWrites.unshift(op);
        console.error(`[agents-db] flush error: ${err.message}`);
        break;
      }
    }
    lastFlushAt = Date.now();
    return flushed;
  }

  function queueFlush() {
    const run = flushChain.then(() => flushWrites());
    flushChain = run.then(() => {}, () => {});
    return run;
  }

  // ---- Agent profile CRUD ----

  function registerAgent(profile) {
    const record = {
      id: profile.id,
      name: profile.name || profile.id,
      role: profile.role || 'worker',
      reports_to: profile.reports_to || 'manager',
      cadence: profile.cadence || 'on-demand',
      capabilities: JSON.stringify(profile.capabilities || []),
      requires: JSON.stringify(profile.requires || []),
      autonomous: profile.autonomous !== false ? 1 : 0,
      created_at: profile.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Upsert into in-memory + queue write
    upsertUnique('agent_profiles', ['id'], record);
    enqueueWrite({ type: 'upsert', table: 'agent_profiles', data: record, onConflict: 'id' });
    return record;
  }

  function getAgent(id) {
    return findById('agent_profiles', id) || null;
  }

  function listAgents() {
    return tables.agent_profiles.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      reports_to: a.reports_to,
      cadence: a.cadence,
      capabilities: JSON.parse(a.capabilities || '[]'),
      requires: JSON.parse(a.requires || '[]'),
      autonomous: Boolean(a.autonomous),
      created_at: a.created_at,
      updated_at: a.updated_at
    }));
  }

  function updateAgent(id, patch) {
    const record = findById('agent_profiles', id);
    if (!record) return null;
    Object.assign(record, patch, { updated_at: new Date().toISOString() });
    enqueueWrite({ type: 'update', table: 'agent_profiles', data: record, id });
    return record;
  }

  // ---- Agent state ----

  function setState(agentId, patch) {
    let record = findById('agent_states', agentId);
    const now = new Date().toISOString();
    if (!record) {
      record = {
        agent_id: agentId,
        status: patch.status || 'INIT',
        last_run_at: patch.last_run_at || null,
        last_status: patch.last_status || null,
        runs: patch.runs || 0,
        consecutive_failures: patch.consecutive_failures || 0,
        updated_at: now
      };
      tables.agent_states.push(record);
      enqueueWrite({ type: 'insert', table: 'agent_states', data: record });
    } else {
      Object.assign(record, patch, { updated_at: now });
      enqueueWrite({ type: 'update', table: 'agent_states', data: record, id: agentId });
    }
    return record;
  }

  function getState(agentId) {
    return findById('agent_states', agentId) || null;
  }

  function getAllStates() {
    return tables.agent_states.map((s) => ({ ...s }));
  }

  // ---- Memory (short-term, long-term, facts) ----

  function remember(agentId, key, value, { longTerm = false } = {}) {
    const bucket = longTerm ? 'long_term' : 'short_term';
    const now = new Date().toISOString();
    const record = {
      agent_id: agentId,
      bucket,
      key,
      value: JSON.stringify(value),
      at: now
    };

    // Upsert by (agent_id, bucket, key)
    const existing = tables.agent_memory.find(
      (r) => r.agent_id === agentId && r.bucket === bucket && r.key === key
    );
    if (existing) {
      existing.value = record.value;
      existing.at = now;
      enqueueWrite({ type: 'update', table: 'agent_memory', data: existing, id: existing.id });
    } else {
      seq.agent_memory += 1;
      record.id = seq.agent_memory;
      tables.agent_memory.push(record);
      enqueueWrite({ type: 'insert', table: 'agent_memory', data: record });
    }
    return record;
  }

  function recall(agentId, key, { longTerm = false } = {}) {
    const bucket = longTerm ? 'long_term' : 'short_term';
    const record = tables.agent_memory.find(
      (r) => r.agent_id === agentId && r.bucket === bucket && r.key === key
    );
    if (!record) return undefined;
    try {
      return JSON.parse(record.value);
    } catch {
      return record.value;
    }
  }

  function getAllMemory(agentId, bucket = null) {
    let rows = tables.agent_memory.filter((r) => r.agent_id === agentId);
    if (bucket) rows = rows.filter((r) => r.bucket === bucket);
    return rows.map((r) => ({
      id: r.id,
      agent_id: r.agent_id,
      bucket: r.bucket,
      key: r.key,
      value: JSON.parse(r.value || 'null'),
      at: r.at
    }));
  }

  function addFact(agentId, fact, { tags = [] } = {}) {
    const now = new Date().toISOString();
    const record = {
      agent_id: agentId,
      bucket: 'facts',
      key: `fact_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      value: JSON.stringify({ text: String(fact), tags, at: now }),
      at: now
    };
    seq.agent_memory += 1;
    record.id = seq.agent_memory;
    tables.agent_memory.push(record);
    enqueueWrite({ type: 'insert', table: 'agent_memory', data: record });
    return record;
  }

  // ---- Tasks ----

  function addTask(agentId, task) {
    const id = task.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const record = {
      id,
      agent_id: agentId,
      title: String(task.title || 'untitled'),
      priority: task.priority || 'normal',
      status: 'pending',
      meta: JSON.stringify(task.meta || {}),
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      result: null,
      error: null
    };
    tables.agent_tasks.push(record);
    enqueueWrite({ type: 'insert', table: 'agent_tasks', data: record });
    return record;
  }

  function getTasks(agentId) {
    const tasks = findByType(agentId, 'agent_tasks');
    return tasks.map((t) => ({
      id: t.id,
      agent_id: t.agent_id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      meta: JSON.parse(t.meta || '{}'),
      created_at: t.created_at,
      started_at: t.started_at,
      finished_at: t.finished_at,
      result: t.result ? JSON.parse(t.result) : null,
      error: t.error
    }));
  }

  function claimTask(agentId) {
    const tasks = findByType(agentId, 'agent_tasks')
      .filter((t) => t.status === 'pending')
      .sort((a, b) => {
        const order = { high: 0, normal: 1, low: 2 };
        return (order[a.priority] ?? 1) - (order[b.priority] ?? 1);
      });

    const task = tasks[0];
    if (!task) return null;

    task.status = 'running';
    task.started_at = new Date().toISOString();
    enqueueWrite({ type: 'update', table: 'agent_tasks', data: task, id: task.id });
    return {
      id: task.id,
      agent_id: task.agent_id,
      title: task.title,
      priority: task.priority,
      status: task.status,
      meta: JSON.parse(task.meta || '{}'),
      created_at: task.created_at,
      started_at: task.started_at
    };
  }

  function finishTask(agentId, taskId, { ok = true, result = null, error = null } = {}) {
    const tasks = findByType(agentId, 'agent_tasks');
    const task = tasks.find((t) => t.id === taskId && t.status === 'running');
    if (!task) return null;

    task.status = ok ? 'done' : 'failed';
    task.finished_at = new Date().toISOString();
    task.result = result ? JSON.stringify(result) : null;
    task.error = error || null;
    enqueueWrite({ type: 'update', table: 'agent_tasks', data: task, id: task.id });

    return {
      id: task.id,
      agent_id: task.agent_id,
      title: task.title,
      priority: task.priority,
      status: task.status,
      meta: JSON.parse(task.meta || '{}'),
      created_at: task.created_at,
      started_at: task.started_at,
      finished_at: task.finished_at,
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error
    };
  }

  function findByType(agentId, table) {
    return tables[table].filter((r) => r.agent_id === agentId);
  }

  // ---- Metrics ----

  function bumpMetric(agentId, name, by = 1) {
    const now = new Date().toISOString();
    const existing = tables.agent_metrics.find(
      (r) => r.agent_id === agentId && r.counters_key === name
    );
    if (existing) {
      existing.counters_value += by;
      existing.updated_at = now;
      enqueueWrite({ type: 'update', table: 'agent_metrics', data: existing, id: existing.id });
    } else {
      seq.agent_metrics += 1;
      const record = {
        id: seq.agent_metrics,
        agent_id: agentId,
        counters_key: name,
        counters_value: by,
        updated_at: now
      };
      tables.agent_metrics.push(record);
      enqueueWrite({ type: 'insert', table: 'agent_metrics', data: record });
    }
    return tables.agent_metrics.find((r) => r.agent_id === agentId && r.counters_key === name);
  }

  function recordRun(agentId, { status = 'OK', summary = '', duration_ms = 0, details = null } = {}) {
    const now = new Date().toISOString();

    // Update state
    const state = getState(agentId);
    const runs = (state?.runs || 0) + 1;
    const failed = status === 'FAIL';
    setState(agentId, {
      status,
      last_run_at: now,
      last_status: status,
      runs,
      consecutive_failures: failed ? (state?.consecutive_failures || 0) + 1 : 0
    });

    bumpMetric(agentId, 'runs');
    bumpMetric(agentId, `status_${String(status).toLowerCase()}`);

    // Add to history
    seq.agent_metrics_history += 1;
    const historyRecord = {
      id: seq.agent_metrics_history,
      agent_id: agentId,
      at: now,
      status,
      duration_ms,
      summary
    };
    tables.agent_metrics_history.push(historyRecord);
    enqueueWrite({ type: 'insert', table: 'agent_metrics_history', data: historyRecord });

    // Log
    seq.agent_logs += 1;
    const logRecord = {
      id: seq.agent_logs,
      agent_id: agentId,
      at: now,
      event: 'run',
      status,
      duration_ms,
      summary,
      details: details ? JSON.stringify(details) : null
    };
    tables.agent_logs.push(logRecord);
    enqueueWrite({ type: 'insert', table: 'agent_logs', data: logRecord });

    // Ledger
    const ledgerRecord = createLedgerEntry({
      type: 'agent.run',
      agent: agentId,
      status,
      summary
    });
    tables.audit_ledger.push(ledgerRecord);
    enqueueWrite({ type: 'insert', table: 'audit_ledger', data: ledgerRecord });

    // Incident handling
    if (failed) {
      openIncident({
        id: `run-fail-${agentId}`,
        agent: agentId,
        severity: 'warning',
        title: `${agentId} run failed`,
        detail: summary || 'Run reported FAIL.'
      });
    } else {
      closeIncident(`run-fail-${agentId}`, { note: 'Recovered — next run passed.' });
    }

    return { agent: agentId, status, runs };
  }

  // ---- Mailbox (inbox/outbox) ----

  function sendMessage({ from, to, subject = '', body = '', priority = 'normal' } = {}) {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();
    const record = {
      id,
      from_agent: from,
      to_agent: to,
      subject,
      body,
      priority,
      at: now,
      read: 0
    };

    // To recipient's inbox
    tables.agent_messages.push({ ...record, to_agent: to });
    enqueueWrite({ type: 'insert', table: 'agent_messages', data: { ...record, to_agent: to } });

    // From sender's outbox
    enqueueWrite({ type: 'insert', table: 'agent_messages', data: { ...record, from_agent: from } });

    return {
      id,
      from_agent: from,
      to_agent: to,
      subject,
      body,
      priority,
      at: now,
      read: false
    };
  }

  function readInbox(agentId, { unreadOnly = false } = {}) {
    const messages = tables.agent_messages
      .filter((m) => m.to_agent === agentId)
      .sort((a, b) => (a.at || '').localeCompare(b.at || ''));

    if (unreadOnly) return messages.filter((m) => !m.read);
    return messages.map((m) => ({
      id: m.id,
      from_agent: m.from_agent,
      to_agent: m.to_agent,
      subject: m.subject,
      body: m.body,
      priority: m.priority,
      at: m.at,
      read: Boolean(m.read)
    }));
  }

  function markRead(agentId, messageId = null) {
    const messages = tables.agent_messages.filter((m) => m.to_agent === agentId);
    let count = 0;
    for (const m of messages) {
      if (messageId === null || m.id === messageId) {
        if (!m.read) {
          m.read = 1;
          enqueueWrite({ type: 'update', table: 'agent_messages', data: m, id: m.id });
          count++;
        }
      }
    }
    return count;
  }

  // ---- Shared KV ----

  function kvSet(namespace, key, value) {
    const now = new Date().toISOString();
    const existing = tables.shared_kv.find(
      (r) => r.namespace === namespace && r.key === key
    );
    const record = {
      namespace,
      key,
      value: JSON.stringify(value),
      at: now
    };

    if (existing) {
      existing.value = record.value;
      existing.at = now;
      enqueueWrite({ type: 'update', table: 'shared_kv', data: existing, id: existing.id });
      return JSON.parse(existing.value);
    }

    seq.shared_kv += 1;
    record.id = seq.shared_kv;
    tables.shared_kv.push(record);
    enqueueWrite({ type: 'insert', table: 'shared_kv', data: record });
    return value;
  }

  function kvGet(namespace, key, fallback = undefined) {
    const record = tables.shared_kv.find(
      (r) => r.namespace === namespace && r.key === key
    );
    if (!record) return fallback;
    try {
      return JSON.parse(record.value);
    } catch {
      return record.value;
    }
  }

  function kvDelete(namespace, key) {
    const idx = tables.shared_kv.findIndex(
      (r) => r.namespace === namespace && r.key === key
    );
    if (idx >= 0) {
      tables.shared_kv.splice(idx, 1);
      return true;
    }
    return false;
  }

  function kvList(namespace) {
    return tables.shared_kv
      .filter((r) => r.namespace === namespace)
      .map((r) => ({
        key: r.key,
        value: JSON.parse(r.value || 'null'),
        at: r.at
      }));
  }

  function kvNamespaces() {
    const ns = new Set(tables.shared_kv.map((r) => r.namespace));
    return [...ns];
  }

  // ---- Job Queue ----

  function enqueue(job) {
    const id = job.id || `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const record = {
      id,
      type: job.type || 'generic',
      payload: JSON.stringify(job.payload || {}),
      priority: job.priority || 'normal',
      status: 'pending',
      created_at: new Date().toISOString(),
      claimed_by: null,
      claimed_at: null,
      attempts: 0,
      finished_at: null,
      result: null,
      error: null
    };
    tables.job_queue.push(record);
    enqueueWrite({ type: 'insert', table: 'job_queue', data: record });
    return record;
  }

  function claimJob(worker = 'unknown') {
    const order = { high: 0, normal: 1, low: 2 };
    const pending = tables.job_queue
      .filter((j) => j.status === 'pending')
      .sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));

    const job = pending[0];
    if (!job) return null;

    job.status = 'running';
    job.claimed_by = worker;
    job.claimed_at = new Date().toISOString();
    job.attempts += 1;
    enqueueWrite({ type: 'update', table: 'job_queue', data: job, id: job.id });

    return {
      id: job.id,
      type: job.type,
      payload: JSON.parse(job.payload || '{}'),
      priority: job.priority,
      status: job.status,
      created_at: job.created_at,
      claimed_by: job.claimed_by,
      claimed_at: job.claimed_at,
      attempts: job.attempts
    };
  }

  function completeJob(jobId, result = null) {
    return settleJob(jobId, true, result, null);
  }

  function failJob(jobId, error = 'unknown error') {
    return settleJob(jobId, false, null, String(error));
  }

  function settleJob(jobId, ok, result, error) {
    const jobs = tables.job_queue;
    const job = jobs.find((j) => j.id === jobId && j.status === 'running');
    if (!job) return null;

    job.status = ok ? 'done' : 'failed';
    job.finished_at = new Date().toISOString();
    job.result = result ? JSON.stringify(result) : null;
    job.error = error || null;
    enqueueWrite({ type: 'update', table: 'job_queue', data: job, id: job.id });

    return {
      id: job.id,
      type: job.type,
      payload: JSON.parse(job.payload || '{}'),
      priority: job.priority,
      status: job.status,
      created_at: job.created_at,
      claimed_by: job.claimed_by,
      claimed_at: job.claimed_at,
      attempts: job.attempts,
      finished_at: job.finished_at,
      result: job.result ? JSON.parse(job.result) : null,
      error: job.error
    };
  }

  function queueStats() {
    const counts = { pending: 0, running: 0, done: 0, failed: 0 };
    for (const j of tables.job_queue) {
      if (counts[j.status] !== undefined) counts[j.status]++;
    }
    return {
      ...counts,
      updated_at: new Date().toISOString()
    };
  }

  // ---- Ledger (hash-chained audit trail) ----

  const GENESIS = '0'.repeat(64);

  function createLedgerEntry(entry) {
    const prev = getLastLedgerHash();
    const seq = getLedgerLength() + 1;
    const ts = new Date().toISOString();
    const withoutHash = { ts, seq, prev, ...entry };
    const hash = sha256(prev + JSON.stringify(withoutHash));
    return {
      ts,
      seq,
      prev_hash: prev,
      type: entry.type,
      agent: entry.agent,
      status: entry.status,
      summary: entry.summary,
      hash
    };
  }

  function getLastLedgerHash() {
    const ledger = tables.audit_ledger;
    if (!ledger.length) return GENESIS;
    return ledger[ledger.length - 1].hash;
  }

  function getLedgerLength() {
    return tables.audit_ledger.length;
  }

  function ledgerAppend(entry) {
    const record = createLedgerEntry(entry);
    tables.audit_ledger.push(record);
    enqueueWrite({ type: 'insert', table: 'audit_ledger', data: record });
    return record;
  }

  function readLedger() {
    return tables.audit_ledger.map((l) => ({
      id: l.id,
      ts: l.ts,
      seq: l.seq,
      prev_hash: l.prev_hash,
      type: l.type,
      agent: l.agent,
      status: l.status,
      summary: l.summary,
      hash: l.hash
    }));
  }

  function ledgerVerify() {
    const ledger = tables.audit_ledger;
    let checked = 0;
    let broken = 0;
    const problems = [];
    let prev = GENESIS;

    for (const entry of ledger) {
      checked++;
      if (entry.prev_hash !== prev) {
        broken++;
        problems.push(`chain break at seq ${entry.seq}`);
      }
      const withoutHash = { ts: entry.ts, seq: entry.seq, prev: entry.prev_hash, type: entry.type, agent: entry.agent, status: entry.status, summary: entry.summary };
      const expected = sha256(entry.prev_hash + JSON.stringify(withoutHash));
      if (entry.hash !== expected) {
        broken++;
        problems.push(`hash mismatch at seq ${entry.seq}`);
      }
      prev = entry.hash;
    }

    return {
      ok: broken === 0,
      checked,
      broken,
      problems,
      total: ledger.length
    };
  }

  function sha256(value) {
    const crypto = require('node:crypto');
    return crypto.createHash('sha256').update(String(value)).digest('hex');
  }

  // ---- Incidents ----

  function openIncident({ id, agent = 'system', severity = 'warning', title, detail = '' } = {}) {
    const now = new Date().toISOString();
    const cleanId = id || `inc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const existing = tables.incidents.find((i) => i.id === cleanId);

    if (existing) {
      existing.occurrences += 1;
      existing.last_seen_at = now;
      if (detail) existing.detail = detail;
      enqueueWrite({ type: 'update', table: 'incidents', data: existing, id: cleanId });
      return {
        ...existing,
        occurrences: existing.occurrences,
        last_seen_at: now
      };
    }

    const incident = {
      id: cleanId,
      agent,
      severity,
      title: String(title || cleanId),
      detail,
      status: 'open',
      opened_at: now,
      last_seen_at: now,
      closed_at: null,
      close_note: null,
      occurrences: 1
    };
    tables.incidents.push(incident);
    enqueueWrite({ type: 'insert', table: 'incidents', data: incident });
    return incident;
  }

  function closeIncident(id, { note = '' } = {}) {
    const now = new Date().toISOString();
    const idx = tables.incidents.findIndex((i) => i.id === id);
    if (idx < 0) return null;

    const incident = tables.incidents[idx];
    incident.status = 'closed';
    incident.closed_at = now;
    incident.close_note = note;
    enqueueWrite({ type: 'update', table: 'incidents', data: incident, id: id });

    return {
      ...incident,
      closed_at: now,
      close_note: note
    };
  }

  function openIncidents() {
    return tables.incidents
      .filter((i) => i.status === 'open')
      .map((i) => ({
        id: i.id,
        agent: i.agent,
        severity: i.severity,
        title: i.title,
        detail: i.detail,
        opened_at: i.opened_at,
        last_seen_at: i.last_seen_at,
        occurrences: i.occurrences
      }));
  }

  // ---- Knowledge Base ----

  function putKnowledge(topic, entries) {
    const now = new Date().toISOString();
    let records = entries.map((entry) => ({
      topic,
      entry_id: entry.id || `kb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      data: JSON.stringify(entry),
      at: now
    }));

    for (const rec of records) {
      const existing = tables.knowledge_base.find(
        (r) => r.topic === topic && r.entry_id === rec.entry_id
      );
      if (existing) {
        existing.data = rec.data;
        existing.at = now;
        enqueueWrite({ type: 'update', table: 'knowledge_base', data: existing, id: existing.id });
      } else {
        seq.knowledge_base += 1;
        rec.id = seq.knowledge_base;
        tables.knowledge_base.push(rec);
        enqueueWrite({ type: 'insert', table: 'knowledge_base', data: rec });
      }
    }

    return getKnowledge(topic);
  }

  function getKnowledge(topic) {
    return tables.knowledge_base
      .filter((r) => r.topic === topic)
      .map((r) => ({
        id: r.id,
        topic: r.topic,
        entry_id: r.entry_id,
        data: JSON.parse(r.data || '{}'),
        at: r.at
      }));
  }

  function knowledgeTopics() {
    const topics = new Set(tables.knowledge_base.map((r) => r.topic));
    return [...topics];
  }

  // ---- Snapshots ----

  function createSnapshot(label = null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = label ? `${stamp}-${label}` : stamp;

    // Collect all data
    const manifest = {
      name,
      created_at: new Date().toISOString(),
      version: '1.0.0',
      agents: listAgents().map((a) => ({
        id: a.id,
        state: getState(a.id),
        memory: getAllMemory(a.id),
        tasks: getTasks(a.id),
        metrics: kvList(`metrics_${a.id}`),
        inbox: readInbox(a.id),
        outbox: readInbox(a.id) // simplified
      })),
      shared: {
        kv: kvNamespaces().reduce((acc, ns) => {
          acc[ns] = kvList(ns);
          return acc;
        }, {}),
        queue: queueStats(),
        ledger: readLedger(),
        incidents: openIncidents(),
        knowledge: knowledgeTopics().reduce((acc, topic) => {
          acc[topic] = getKnowledge(topic);
          return acc;
        }, {})
      }
    };

    // Save to snapshots table
    seq.snapshots += 1;
    const record = {
      name,
      created_at: new Date().toISOString(),
      version: '1.0.0',
      files_count: manifest.agents.length + Object.keys(manifest.shared.kv).length,
      bytes_total: JSON.stringify(manifest).length,
      manifest_json: JSON.stringify(manifest)
    };
    tables.snapshots.push(record);
    enqueueWrite({ type: 'insert', table: 'snapshots', data: record });

    // Keep only last 7
    const allSnaps = [...tables.snapshots].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    while (allSnaps.length > 7) {
      const old = allSnaps.shift();
      const idx = tables.snapshots.indexOf(old);
      if (idx >= 0) {
        tables.snapshots.splice(idx, 1);
        enqueueWrite({ type: 'delete', table: 'snapshots', id: old.id });
      }
    }

    return {
      name,
      created_at: new Date().toISOString(),
      files: manifest.agents.length,
      bytes: JSON.stringify(manifest).length,
      manifest
    };
  }

  function listSnapshots() {
    return [...tables.snapshots]
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      .map((s) => ({
        name: s.name,
        created_at: s.created_at,
        files: s.files_count,
        bytes: s.bytes_total,
        manifest: s.manifest_json ? JSON.parse(s.manifest_json) : null
      }));
  }

  // ---- Doctor (integrity check) ----

  function doctor() {
    const issues = [];

    // Check agent profiles
    const profiles = listAgents();
    for (const p of profiles) {
      if (!getState(p.id)) {
        issues.push(`Agent ${p.id}: state missing`);
      }
      if (getState(p.id)?.status === 'INIT' && p.autonomous) {
        issues.push(`Agent ${p.id}: never run`);
      }
    }

    // Check ledger
    const ledgerCheck = ledgerVerify();
    if (!ledgerCheck.ok) {
      issues.push(`Ledger: ${ledgerCheck.broken} problem(s)`);
    }

    // Check queue
    const queue = queueStats();
    if (queue.running > 0) {
      issues.push(`Queue: ${queue.running} job(s) stuck in running`);
    }

    // Check incidents
    const incidents = openIncidents();
    if (incidents.length > 0) {
      issues.push(`Incidents: ${incidents.length} open`);
    }

    return {
      ok: issues.length === 0,
      backend: 'supabase',
      agents: profiles.length,
      queue,
      openIncidents: incidents.length,
      ledger: { ...ledgerCheck, total: getLedgerLength() },
      issues,
      issues_count: issues.length
    };
  }

  // ---- Status (for reports) ----

  function status() {
    const agents = listAgents().map((a) => {
      const state = getState(a.id) || {};
      const tasks = getTasks(a.id);
      const metricsRows = tables.agent_metrics.filter((m) => m.agent_id === a.id);
      const inbox = readInbox(a.id, { unreadOnly: true });

      return {
        id: a.id,
        name: a.name,
        role: a.role,
        status: state?.status || 'NEVER_RUN',
        runs: state?.runs || 0,
        last_run_at: state?.last_run_at,
        consecutive_failures: state?.consecutive_failures || 0,
        pending_tasks: tasks.filter((t) => t.status === 'pending').length,
        done_tasks: tasks.filter((t) => t.status === 'done').length,
        failed_tasks: tasks.filter((t) => t.status === 'failed').length,
        unread_messages: inbox.length,
        metrics: metricsRows.reduce((acc, m) => {
          acc[m.counters_key] = m.counters_value;
          return acc;
        }, {})
      };
    });

    return {
      project: 'TEER WALE',
      generated_at: new Date().toISOString(),
      version: '1.0.0',
      backend: 'supabase',
      agents,
      queue: queueStats(),
      namespaces: kvNamespaces(),
      knowledge: knowledgeTopics(),
      snapshots: listSnapshots(),
      open_incidents: openIncidents(),
      ledger: ledgerVerify()
    };
  }

  return {
    // Agent profile
    registerAgent,
    getAgent,
    listAgents,
    updateAgent,

    // State
    setState,
    getState,
    getAllStates,

    // Memory
    remember,
    recall,
    getAllMemory,
    addFact,

    // Tasks
    addTask,
    getTasks,
    claimTask,
    finishTask,

    // Metrics
    bumpMetric,
    recordRun,

    // Mailbox
    sendMessage,
    readInbox,
    markRead,

    // Shared KV
    kvSet,
    kvGet,
    kvDelete,
    kvList,
    kvNamespaces,

    // Job queue
    enqueue,
    claimJob,
    completeJob,
    failJob,
    queueStats,

    // Ledger
    ledgerAppend,
    readLedger,
    ledgerVerify,

    // Incidents
    openIncident,
    closeIncident,
    openIncidents,

    // Knowledge
    putKnowledge,
    getKnowledge,
    knowledgeTopics,

    // Snapshots
    createSnapshot,
    listSnapshots,

    // Integrity
    doctor,

    // Reports
    status,

    // Flush queue
    flush: queueFlush,

    // Close
    async close() {
      await flushWrites();
      await supabase.close();
    }
  };
}

/* -------------------------------------------------------------------- exports */

module.exports = {
  AGENTS_SCHEMA,
  AGENTS_INDEXES,
  createAgentsDb
};
