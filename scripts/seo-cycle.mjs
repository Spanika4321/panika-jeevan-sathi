#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — SEO Center cycle runner (CLI / CI).
 *
 *   node scripts/seo-cycle.mjs             # one full cycle (Check → … → Verify)
 *   node scripts/seo-cycle.mjs --verify    # live verification round only
 *   node scripts/seo-cycle.mjs --days 28   # data window override
 *
 * Same engine as the in-app SEO Center (`lib/seo-center.js`) — one source of
 * truth. A local `.env` file is loaded when present (API keys stay in env).
 * Used by the GitHub Actions workflow `.github/workflows/seo-cycle.yml` and by
 * any external cron (e.g. `0 4 * * * node scripts/seo-cycle.mjs`).
 *
 * Rules it obeys: no fake data, no fake PASS, missing credentials → BLOCKED,
 * nothing is deployed or pushed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createSeoCenter } = require(path.join(ROOT, 'lib', 'seo-center.js'));

/* ------------------------------------------------------------------ env */

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return 0;
  let count = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
    count += 1;
  }
  return count;
}

const envFile = process.env.PJS_ENV_FILE || path.join(ROOT, '.env');
const loaded = loadDotEnv(envFile);
if (loaded) console.log(`[seo-cli] loaded ${loaded} variable(s) from ${envFile}`);

const verifyOnly = process.argv.includes('--verify');
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const days = daysArg ? Number(daysArg.split('=')[1]) : Number(process.env.SEO_DEFAULT_DAYS || 28);
if (daysArg) process.env.SEO_DEFAULT_DAYS = String(days);

const dataDir = process.env.PJS_SEO_DATA_DIR || process.env.PJS_DATA_DIR || path.join(ROOT, 'data');

const seo = createSeoCenter({
  dataDir,
  secret: process.env.SESSION_SECRET || 'cli-secret-not-for-http',
  db: null, // no HTTP session checks in CLI mode
  auth: null,
  rootDir: ROOT,
  log: (m) => console.log(m)
});

if (verifyOnly) {
  console.log('[seo-cli] live verification round (real API calls only)…');
  const round = await seo.verifyRound();
  console.log(JSON.stringify(round, null, 2));
  const bad = round.checks.filter((c) => c.status === 'FAIL' || c.status === 'BLOCKED');
  const notConnected = round.checks.filter((c) => c.status === 'NOT_CONNECTED').map((c) => c.id);
  console.log(`[seo-cli] ${round.duration_ms} ms — FAIL/BLOCKED: ${bad.length}, NOT_CONNECTED: ${notConnected.length || 'none'} ${notConnected.length ? `(${notConnected.join(', ')})` : ''}`);
  process.exitCode = bad.length ? 1 : 0;
} else {
  console.log(`[seo-cli] starting one full cycle (window: last ${days} days)…`);
  const result = await seo.runCycle({ trigger: 'cli' });
  if (!result.ok) {
    console.error(`[seo-cli] could not start the cycle: ${result.error}`);
    process.exit(1);
  }
  const cycle = result.cycle;
  console.log(JSON.stringify(
    {
      id: cycle.id,
      status: cycle.status,
      duration_ms: cycle.duration_ms,
      report_id: cycle.report_id,
      steps: Object.fromEntries(Object.entries(cycle.steps).map(([k, v]) => [k, v.status]))
    },
    null,
    2
  ));
  process.exitCode = cycle.status === 'OK' || cycle.status === 'PARTIAL' ? 0 : 1;
}
