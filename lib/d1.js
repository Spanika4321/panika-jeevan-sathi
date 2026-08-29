'use strict';
/**
 * PANIKA JEEVAN SATHI — Cloudflare D1 client.
 *
 * D1 is SQLite, reachable over plain HTTPS, with a free tier (500 MB per
 * database, 10 databases, no 30-day expiry). That makes it the right home for
 * the member database on Render's Free plan, where the local filesystem is
 * erased every time the instance sleeps or redeploys.
 *
 * Zero dependencies: Node 22's global fetch is used.
 *
 * API: POST /accounts/{account_id}/d1/database/{database_id}/query
 *      {"sql": "...", "params": [...]}            — one statement
 *      {"batch": [{"sql": "...", "params": []}]}  — many statements at once
 *
 * Docs: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
 */

const DEFAULTS = {
  apiUrl: 'https://api.cloudflare.com/client/v4',
  timeoutMs: 15000,
  // D1 limits: 100 bound parameters per query, 100 KB per SQL statement.
  // Stay comfortably below both.
  maxParamsPerStatement: 90,
  maxStatementsPerRequest: 40,
  maxBytesPerRequest: 400 * 1024,
  maxRetries: 4,
  retryBaseMs: 250,
  maxRetryDelayMs: 8000
};

class D1Error extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'D1Error';
    Object.assign(this, extra);
  }
}

/** Environment configuration, or null when D1 is not configured. */
function configFromEnv(env = process.env) {
  const accountId = String(env.CF_ACCOUNT_ID || '').trim();
  const databaseId = String(env.CF_D1_DATABASE_ID || '').trim();
  const token = String(env.CF_D1_API_TOKEN || env.CF_API_TOKEN || '').trim();
  if (!accountId || !databaseId || !token) return null;
  return {
    accountId,
    databaseId,
    token,
    apiUrl: String(env.CF_D1_API_URL || DEFAULTS.apiUrl).replace(/\/+$/, '')
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  const base = DEFAULTS.retryBaseMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 120);
  return Math.min(DEFAULTS.maxRetryDelayMs, base + jitter);
}

/**
 * Split a SQL script into individual statements.
 * Handles the usual script shapes (semicolon separated, `--` and `/* * /`
 * comments, single-quoted strings). DDL in this project never contains a
 * semicolon inside a string literal, so a scanner is enough.
 */
function splitStatements(script) {
  const out = [];
  let buffer = '';
  let quote = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < script.length; i += 1) {
    const ch = script[i];
    const next = script[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        buffer += '\n';
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      buffer += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '-' && next === '-') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === ';') {
      if (buffer.trim()) out.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  if (buffer.trim()) out.push(buffer.trim());

  // Pragmas are connection-level settings; D1 manages them itself.
  return out.filter((sql) => !/^\s*PRAGMA\s/i.test(sql));
}

/** Group statements into requests that respect D1's size/binding limits. */
function chunkStatements(statements, limits = DEFAULTS) {
  const chunks = [];
  let current = [];
  let bytes = 0;

  const flush = () => {
    if (current.length) chunks.push(current);
    current = [];
    bytes = 0;
  };

  for (const statement of statements) {
    const params = statement.params || [];
    if (params.length > limits.maxParamsPerStatement) {
      throw new D1Error(
        `Statement has ${params.length} bound parameters; D1 allows at most 100.`
      );
    }
    const size = Buffer.byteLength(statement.sql, 'utf8');
    if (size > 100000) {
      throw new D1Error('Statement exceeds D1’s 100 KB SQL limit.');
    }
    const tooBig =
      bytes + size > limits.maxBytesPerRequest ||
      current.length >= limits.maxStatementsPerRequest;
    if (tooBig) flush();
    current.push(statement);
    bytes += size;
  }
  flush();
  return chunks;
}

function createClient(config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = options.log || (() => {});
  const limits = Object.assign({}, DEFAULTS, options.limits || {});
  const url = `${config.apiUrl}/accounts/${encodeURIComponent(
    config.accountId
  )}/d1/database/${encodeURIComponent(config.databaseId)}/query`;

  let lastError = null;
  let requestCount = 0;

  function describeErrors(payload) {
    const errors = (payload && (payload.errors || payload.messages)) || [];
    return errors
      .map((e) => {
        const code = e && e.code ? `${e.code}: ` : '';
        return code + String((e && e.message) || 'unknown error');
      })
      .join('; ');
  }

  /** Send one request worth of statements. Returns the array of results. */
  async function sendOnce(statements) {
    const body =
      statements.length === 1
        ? { sql: statements[0].sql, params: statements[0].params || [] }
        : {
            batch: statements.map((s) => ({
              sql: s.sql,
              params: s.params || []
            }))
          };

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(limits.timeoutMs)
    });

    requestCount += 1;
    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (_) {
      if (!res.ok) {
        throw new D1Error(`D1 HTTP ${res.status}: ${text.slice(0, 300)}`, {
          status: res.status,
          retryable: res.status === 429 || res.status >= 500
        });
      }
      throw new D1Error(`D1 returned a non-JSON response (HTTP ${res.status}).`, {
        status: res.status,
        retryable: res.status >= 500
      });
    }

    if (res.status === 429 || res.status >= 500) {
      throw new D1Error(
        `D1 HTTP ${res.status}: ${describeErrors(payload) || text.slice(0, 200)}`,
        { status: res.status, retryable: true }
      );
    }

    if (!res.ok || !payload || payload.success === false) {
      throw new D1Error(
        `D1 request failed: ${describeErrors(payload) || `HTTP ${res.status}`}`,
        { status: res.status, retryable: false }
      );
    }

    const results = Array.isArray(payload.result) ? payload.result : [];
    const failed = results.find((r) => r && r.success === false);
    if (failed) {
      throw new D1Error(`D1 statement failed: ${describeErrors(payload) || 'unknown'}`, {
        status: res.status,
        retryable: false
      });
    }
    return results;
  }

  /** Send statements with retries for transient failures (429 / 5xx / network). */
  async function send(statements) {
    let attempt = 0;
    for (;;) {
      try {
        const results = await sendOnce(statements);
        lastError = null;
        return results;
      } catch (err) {
        const retryable =
          err &&
          (err.retryable === true ||
            err.name === 'TimeoutError' ||
            err.name === 'AbortError' ||
            !err.status);
        lastError = err;
        if (!retryable || attempt >= limits.maxRetries) throw err;
        const delay = backoffDelay(attempt);
        log(
          `[d1] ${err.message} — retrying in ${delay} ms (attempt ${attempt + 1}/${
            limits.maxRetries
          })`
        );
        await sleep(delay);
        attempt += 1;
      }
    }
  }

  return {
    kind: 'd1',

    /** Run one or many statements (in a single HTTP request when possible). */
    async run(statements) {
      const list = Array.isArray(statements) ? statements : [statements];
      if (!list.length) return [];
      const out = [];
      for (const chunk of chunkStatements(list, limits)) {
        const results = await send(chunk);
        for (const r of results) out.push(r);
      }
      return out;
    },

    /** Convenience: one statement. */
    async query(sql, params = []) {
      const results = await this.run([{ sql, params }]);
      return results[0] || { results: [], meta: {} };
    },

    /** Run a whole SQL script (schema, indexes) in safe-sized batches. */
    async execScript(script) {
      const statements = splitStatements(script).map((sql) => ({ sql, params: [] }));
      if (!statements.length) return 0;
      for (const chunk of chunkStatements(statements, limits)) {
        await send(chunk);
      }
      return statements.length;
    },

    /** Rows of a table — used to warm the in-memory mirror at boot. */
    async selectAll(table) {
      const result = await this.query(`SELECT * FROM "${table}"`);
      return Array.isArray(result.results) ? result.results : [];
    },

    /** Connectivity probe for `npm run verify:cloud` and the boot sequence. */
    async ping() {
      const result = await this.query('SELECT 1 AS ok');
      return Boolean(result && result.success !== false);
    },

    stats() {
      return { requests: requestCount, lastError: lastError ? lastError.message : null };
    }
  };
}

module.exports = {
  DEFAULTS,
  D1Error,
  configFromEnv,
  createClient,
  splitStatements,
  chunkStatements
};
