'use strict';
/**
 * PANIKA JEEVAN SATHI — Google Sheets storage driver.
 *
 * The Apps Script bridge (apps-script/Code.gs) is an HTTPS API, far too slow to
 * call once per query, so this driver uses exactly the same shape as the
 * Cloudflare D1 driver:
 *
 *   reads   → the whole database mirrored in memory (instant, synchronous)
 *   writes  → memory + a queued operation list, flushed to the Sheet by the
 *             server before the HTTP response completes, on a timer, and at
 *             shutdown
 *
 * The rest of the application is untouched: this driver exposes the same
 * synchronous interface as the SQLite and JSON drivers.
 *
 * Two ways to use it:
 *
 *   PJS_STORAGE=sheets   the Sheet is the database (loaded at boot)
 *   PJS_STORAGE=mirror   the site keeps SQLite / D1 and every change is also
 *                        written to the Sheet, so the owner can read the members
 *                        in Google Sheets. The site still boots if the Sheet is
 *                        unreachable.
 */

const dbLib = require('./db');

const TABLES = dbLib.TABLES;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Column defaults taken from the SQL schema, so a row that comes back from the
 * Sheet looks exactly like the same row coming back from SQLite: every column
 * with a DEFAULT gets that default instead of null, columns without one stay
 * null. Without this the application would see null where it expects "".
 */
function parseDefaults(schema) {
  const out = {};
  const blocks = String(schema || '').split(/;\s*/);
  for (const block of blocks) {
    const match = block.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\)\s*$/);
    if (!match) continue;
    const table = match[1];
    const defaults = {};
    for (const line of match[2].split('\n')) {
      const col = line.trim().replace(/,$/, '');
      if (!col || /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)/i.test(col)) continue;
      const parts = col.split(/\s+/);
      const name = parts[0];
      const value = col.match(/DEFAULT\s+('([^']*)'|(-?\d+(?:\.\d+)?))/i);
      if (!name || !value) continue;
      defaults[name] = value[2] !== undefined ? value[2] : Number(value[1]);
    }
    out[table] = defaults;
  }
  return out;
}

const DEFAULT_VALUES = parseDefaults(dbLib.SCHEMA);

function normaliseRow(table, row) {
  const defaults = DEFAULT_VALUES[table];
  if (defaults) {
    for (const column of Object.keys(defaults)) {
      if (row[column] === null || row[column] === undefined) row[column] = defaults[column];
    }
  }
  return row;
}

/** Copy a dumped table set into the in-memory state and re-arm the id counters. */
function applyRemote(state, tables) {
  for (const table of Object.keys(TABLES)) {
    state.tables[table] = Array.isArray(tables && tables[table])
      ? tables[table].map((r) => normaliseRow(table, Object.assign({}, r)))
      : [];
    state.seq[table] = 0;
  }
  for (const table of Object.keys(TABLES)) {
    const pk = TABLES[table];
    if (pk !== 'id') continue;
    let max = 0;
    for (const row of state.tables[table]) {
      const value = Number(row && row.id);
      if (Number.isFinite(value) && value > max) max = value;
    }
    state.seq[table] = max;
  }
}

function countRows(state) {
  let rows = 0;
  for (const table of Object.keys(TABLES)) rows += (state.tables[table] || []).length;
  return rows;
}

/**
 * Primary-mode driver: the Google Sheet holds the data.
 *
 * @param {{client:Object, log?:Function}} options
 */
function createSheetsDriver(options) {
  const client = options.client;
  const log = options.log || (() => {});

  const state = { tables: {}, seq: {} };
  for (const table of Object.keys(TABLES)) state.tables[table] = [];

  let queue = [];
  let chain = Promise.resolve();
  let lastError = null;
  let loaded = false;
  let flushCount = 0;
  let lastFlushAt = 0;

  const engine = dbLib.createMemoryDriver({
    state,
    onMutate(op) {
      if (op.type === 'insert') queue.push({ type: 'insert', table: op.table, row: Object.assign({}, op.row) });
      else if (op.type === 'update') queue.push({ type: 'update', table: op.table, patch: op.patch, where: op.where });
      else if (op.type === 'remove') queue.push({ type: 'remove', table: op.table, where: op.where });
    }
  });

  async function flushOnce() {
    if (!queue.length) return 0;
    const ops = queue;
    queue = [];
    try {
      const result = await client.mutate(ops);
      lastError = null;
      flushCount++;
      lastFlushAt = Date.now();
      return result.applied || ops.length;
    } catch (err) {
      // Keep the operations: the next request, the timer or shutdown retries.
      queue = ops.concat(queue);
      lastError = err;
      throw err;
    }
  }

  function flush() {
    chain = chain.then(flushOnce, flushOnce);
    return chain;
  }

  async function load() {
    const data = await client.dump();
    applyRemote(state, data.tables || {});
    loaded = true;
    const rows = countRows(state);
    log(`[storage] Google Sheets loaded — ${rows} rows from ${Object.keys(TABLES).length} tables`);
    return { rows, tables: Object.keys(TABLES).length };
  }

  async function reload() {
    const info = await load();
    return info;
  }

  return Object.assign(
    {
      kind: 'sheets',

      /** True once the Sheet has been read; the server waits for this. */
      isLoaded() {
        return loaded;
      },

      load,
      reload,
      flush,

      exec() {},

      raw() {
        return [];
      },

      close() {},

      stats() {
        return {
          kind: 'sheets',
          queued: queue.length,
          flushes: flushCount,
          lastFlushAt,
          rows: countRows(state),
          loaded,
          lastError: lastError ? lastError.message : null,
          client: client.stats ? client.stats() : null
        };
      }
    },
    engine
  );
}

/**
 * Mirror mode: keep the website's own database as the source of truth and
 * write every change through to the Sheet as well. If the Sheet is unreachable
 * the site keeps working — the queue is retried, exactly like the photo store.
 */
function createMirrorProxy(primary, sheetsDriver, options = {}) {
  const log = options.log || (() => {});

  const proxy = Object.assign({}, primary, {
    kind: `${primary.kind || 'local'}+sheets`,

    insert(table, row) {
      const saved = primary.insert(table, row);
      try {
        sheetsDriver.insert(table, saved);
      } catch (err) {
        log(`[storage] sheet mirror could not queue insert: ${err.message}`);
      }
      return saved;
    },

    update(table, where, patch) {
      const count = primary.update(table, where, patch);
      if (count) {
        try {
          sheetsDriver.update(table, where, patch);
        } catch (err) {
          log(`[storage] sheet mirror could not queue update: ${err.message}`);
        }
      }
      return count;
    },

    remove(table, where) {
      const count = primary.remove(table, where);
      if (count) {
        try {
          sheetsDriver.remove(table, where);
        } catch (err) {
          log(`[storage] sheet mirror could not queue remove: ${err.message}`);
        }
      }
      return count;
    },

    async flush() {
      if (primary.flush) await primary.flush();
      await sheetsDriver.flush();
    },

    stats() {
      return {
        kind: proxy.kind,
        primary: primary.stats ? primary.stats() : { kind: primary.kind || 'local' },
        sheets: sheetsDriver.stats()
      };
    }
  });

  return proxy;
}

/** Build the client + driver pair for a resolved configuration. */
function openSheets(config, options = {}) {
  const log = options.log || (() => {});
  const appsScript = require('./appsscript');
  const client = appsScript.createClient(config, { log });
  const driver = createSheetsDriver({ client, log });
  return { client, driver };
}

module.exports = {
  TABLES,
  applyRemote,
  createSheetsDriver,
  createMirrorProxy,
  openSheets
};
