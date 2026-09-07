#!/usr/bin/env node
'use strict';
/**
 * SEVA MARKET INDIA — storage doctor.
 *
 * Answers one question before you trust a deploy with real customers:
 * "will the next redeploy delete my data?"
 *
 *   npm run storage:sql       print scripts/supabase-storage.sql to paste
 *   npm run storage:doctor    check env + reachability + tables
 *   npm run storage:doctor -- --write   also write and read back a canary row
 *
 * Exit code 0 = durable, 1 = something would be lost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_FILE = path.join(ROOT, 'scripts', 'supabase-storage.sql');

const { createRemoteClient, readEnvConfig, describeKey } = require('../src/db/remote');
const { resolveDriver, assertStorageSafe, flag } = require('../src/store/guard');

export function readSql(file = SQL_FILE) {
  return fs.readFileSync(file, 'utf8');
}

/** Parse `--flag` / `--flag=value` argv into an object. */
export function parseArgs(argv) {
  const args = { _: [] };
  for (const token of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(token);
    if (!match) args._.push(token);
    else args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return args;
}

/** Mask a key so it can be printed in a deploy log. */
export function maskKey(key) {
  const value = String(key || '');
  if (!value) return '(not set)';
  if (value.length <= 12) return `${value.slice(0, 3)}***`;
  return `${value.slice(0, 6)}...${value.slice(-4)} (${value.length} chars)`;
}

const USAGE = `
SEVA MARKET INDIA — storage doctor

  npm run storage:sql                 print the Postgres schema to paste
  npm run storage:doctor              check configuration and connectivity
  npm run storage:doctor -- --write   additionally write a canary audit row

  --sql        print scripts/supabase-storage.sql and exit (no network)
  --write      prove a real INSERT reaches Postgres
  --json       machine-readable output

  Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEVA_STORAGE,
               SEVA_REQUIRE_REMOTE
`.trim();

/**
 * @param {string[]} argv
 * @param {object} deps  injected in tests: { env, log, error, fetchImpl }
 * @returns {Promise<number>} exit code
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    env = process.env,
    log = console.log,
    error = console.error,
    fetchImpl,
    sqlFile = SQL_FILE,
  } = deps;

  const args = parseArgs(argv);
  if (args.help || args.h) {
    log(USAGE);
    return 0;
  }
  if (args.sql) {
    log(readSql(sqlFile));
    return 0;
  }

  const report = { driver: null, durable: false, checks: [], warnings: [], ok: false };
  const record = (name, ok, detail) => {
    report.checks.push({ name, ok, detail });
    if (!args.json) log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const isProduction = env.NODE_ENV === 'production';
  const { url, key } = readEnvConfig(env);
  const tables = {
    users: env.SEVA_TABLE_USERS || 'seva_users',
    leads: env.SEVA_TABLE_LEADS || 'seva_leads',
    audit: env.SEVA_TABLE_AUDIT || 'seva_audit_logs',
  };

  if (!args.json) log('SEVA MARKET INDIA — storage doctor\n');

  let driver;
  try {
    driver = resolveDriver(env, { isProduction });
  } catch (err) {
    error(err.message);
    return 1;
  }
  report.driver = driver;

  const storage = {
    driver,
    requireRemote: flag(env, 'SEVA_REQUIRE_REMOTE'),
    allowEphemeral: flag(env, 'SEVA_ALLOW_EPHEMERAL'),
    supabase: { url, key },
    tables,
  };

  let verdict;
  try {
    verdict = assertStorageSafe(storage, { isProduction });
    record('configuration', true, `driver "${driver}"`);
  } catch (err) {
    record('configuration', false, err.message.split('\n')[0]);
    if (!args.json) error(`\n${err.message}\n`);
    else log(JSON.stringify({ ...report, error: err.message }, null, 2));
    return 1;
  }

  report.durable = verdict.durable;
  report.warnings = verdict.warnings;
  for (const warning of verdict.warnings) {
    if (!args.json) log(` WARN  ${warning}`);
  }

  if (driver !== 'supabase') {
    record('durability', false, 'local SQLite — data is lost if this filesystem is ephemeral');
    if (!args.json) {
      log('\nVerdict: NOT durable on an ephemeral host.');
      log('Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (and SEVA_REQUIRE_REMOTE=1) to fix.');
    } else {
      log(JSON.stringify(report, null, 2));
    }
    return 1;
  }

  record('SUPABASE_URL', true, url);
  record('service-role key', true, `${maskKey(key)} role=${describeKey(key).role || 'unknown'}`);

  const remote = createRemoteClient({ url, key, fetchImpl });

  for (const [label, table] of Object.entries(tables)) {
    try {
      const count = await remote.count(table, {});
      record(`table ${table}`, true, `${count} row(s)`);
    } catch (err) {
      record(`table ${table}`, false, err.message.split('\n')[0]);
      if (!args.json) {
        error(`\n${err.message}\n`);
        error('Fix: npm run storage:sql, paste into the Supabase SQL editor, Run.');
      } else {
        log(JSON.stringify({ ...report, error: err.message }, null, 2));
      }
      return 1;
    }
    void label;
  }

  if (args.write) {
    const marker = `storage-doctor-${Date.now()}`;
    try {
      await remote.insert(tables.audit, {
        actor: 'storage-doctor',
        action: 'canary',
        entity: 'storage',
        detail: marker,
      }, { returning: 'minimal' });
      const found = await remote.first(tables.audit, { columns: 'id,detail', where: { detail: marker } });
      record('write-through canary', Boolean(found), found ? `row id ${found.id}` : 'row not readable back');
      if (!found) return 1;
    } catch (err) {
      record('write-through canary', false, err.message.split('\n')[0]);
      return 1;
    }
  }

  report.ok = true;
  if (args.json) {
    log(JSON.stringify(report, null, 2));
  } else {
    log('\nVerdict: durable. Accounts and enquiries are written through to Postgres,');
    log('so a redeploy or a wake-from-sleep cannot lose them.');
  }
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
}
