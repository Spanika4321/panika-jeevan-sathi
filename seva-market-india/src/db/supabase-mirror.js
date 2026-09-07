'use strict';
/**
 * SEVA MARKET INDIA — pack local SQLite rows as seva_mirror documents
 * and (optionally) upsert them to Supabase PostgREST.
 *
 * The Postgres table itself is created by scripts/supabase-init.sql in the
 * SQL editor. This module never sends DDL through PostgREST.
 */

const fs = require('node:fs');
const path = require('node:path');

const INIT_SQL_FILE = path.join(__dirname, '..', '..', 'scripts', 'supabase-init.sql');

/** Tables copied into the mirror, in parent-before-child order. */
const MIRROR_TABLES = [
  'schema_migrations',
  'users',
  'locations',
  'categories',
  'providers',
  'services',
  'service_areas',
  'leads',
  'audit_logs',
];

const DEFAULTS = {
  timeoutMs: 20000,
  chunkSize: 200,
};

/** SQL that must be run once in the Supabase SQL Editor. */
function initSql() {
  return fs.readFileSync(INIT_SQL_FILE, 'utf8');
}

/** The executable statements only — no comment header, safe to paste. */
function initStatements() {
  return initSql()
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('--');
    })
    .join('\n')
    .trim();
}

/**
 * Stable document id for one SQLite row.
 * Composite-key tables are encoded as a single text id.
 */
function documentId(table, row) {
  if (!row || typeof row !== 'object') throw new Error(`mirror: empty row for ${table}`);
  if (table === 'service_areas') return `${row.provider_id}:${row.pin_code}`;
  if (table === 'schema_migrations') return String(row.version);
  if (row.id === undefined || row.id === null || row.id === '') {
    throw new Error(`mirror: ${table} row is missing id`);
  }
  return String(row.id);
}

/** True when PostgREST has not yet heard of public.seva_mirror. */
function isMissingTableError(err) {
  if (!err) return false;
  const status = Number(err.status) || 0;
  const body = String(err.body || err.message || '');
  if (status === 404) return true;
  if (status === 406) return /seva_mirror/i.test(body);
  return /PGRST205|could not find the table/i.test(body) && /seva_mirror/i.test(body);
}

function tableExists(db, name) {
  return Boolean(
    db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]),
  );
}

/**
 * Pack every local domain row into {tbl, id, doc} documents.
 * `doc` is the SQLite row as a plain object (jsonb on the Postgres side).
 */
function collectDocuments(db, now = new Date()) {
  const syncedAt = now instanceof Date ? now.toISOString() : String(now);
  const documents = [];
  for (const tbl of MIRROR_TABLES) {
    if (!tableExists(db, tbl)) continue;
    const rows = db.all(`SELECT * FROM "${tbl}"`);
    for (const row of rows) {
      documents.push({
        tbl,
        id: documentId(tbl, row),
        doc: row,
        synced_at: syncedAt,
      });
    }
  }
  return documents;
}

function summarise(documents) {
  const byTable = {};
  for (const doc of documents) {
    byTable[doc.tbl] = (byTable[doc.tbl] || 0) + 1;
  }
  return { total: documents.length, byTable };
}

function chunk(items, size) {
  const out = [];
  const n = Math.max(1, Number(size) || DEFAULTS.chunkSize);
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

class MirrorError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'MirrorError';
    Object.assign(this, extra);
  }
}

function configFromEnv(env = process.env) {
  const url = String(env.SUPABASE_URL || env.SEVA_SUPABASE_URL || env.PJS_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const key = String(
    env.SUPABASE_SERVICE_ROLE_KEY || env.SEVA_SUPABASE_KEY || env.SUPABASE_KEY || env.PJS_SUPABASE_KEY || '',
  ).trim();
  if (!url || !key) return null;
  return { url, key };
}

function createMirrorClient(config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || DEFAULTS.timeoutMs;
  const chunkSize = options.chunkSize || DEFAULTS.chunkSize;
  const restBase = `${config.url}/rest/v1`;

  function headers(extra) {
    return Object.assign(
      {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
      },
      extra || {},
    );
  }

  async function send(url, init) {
    const res = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new MirrorError(`Supabase HTTP ${res.status}: ${text.slice(0, 300)}`, {
        status: res.status,
        body: text,
      });
    }
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (_) {
        json = text;
      }
    }
    return { res, json, text };
  }

  return {
    kind: 'seva-mirror',
    url: config.url,

    async ping() {
      try {
        const { json } = await send(`${restBase}/seva_mirror?select=tbl,id&limit=1`, {
          method: 'GET',
          headers: headers(),
        });
        return Array.isArray(json);
      } catch (err) {
        if (isMissingTableError(err)) return false;
        throw err;
      }
    },

    async upsert(documents) {
      if (!documents.length) return { upserted: 0, chunks: 0 };
      let upserted = 0;
      const batches = chunk(documents, chunkSize);
      for (const batch of batches) {
        await send(`${restBase}/seva_mirror?on_conflict=tbl,id`, {
          method: 'POST',
          headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(batch),
        });
        upserted += batch.length;
      }
      return { upserted, chunks: batches.length };
    },
  };
}

module.exports = {
  INIT_SQL_FILE,
  MIRROR_TABLES,
  DEFAULTS,
  MirrorError,
  initSql,
  initStatements,
  documentId,
  isMissingTableError,
  collectDocuments,
  summarise,
  chunk,
  configFromEnv,
  createMirrorClient,
};
