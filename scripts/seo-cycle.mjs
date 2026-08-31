#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — SEO Center cycle runner (CLI / CI).
 *
 *   node scripts/seo-cycle.mjs                # run one full cycle
 *   node scripts/seo-cycle.mjs --days=7       # a different window (7–90)
 *   node scripts/seo-cycle.mjs --status       # connection + storage status only
 *   node scripts/seo-cycle.mjs --report       # print the stored Markdown report
 *   node scripts/seo-cycle.mjs --json         # machine-readable output
 *
 * This runs exactly the same pipeline as the website:
 *   check → Search Console data → AI (Gemini → router) → Pooja → Priya →
 *   Manager → report → permanent storage → verify
 *
 * It never deploys, never pushes, never posts anywhere, and never invents data:
 * when Google Search Console is not connected the exit status is BLOCKED (2) and
 * no report is written.
 *
 * Exit codes: 0 OK · 1 FAIL · 2 BLOCKED · 3 REVIEW_REQUIRED
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import * as agentStore from '../agents/storage.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dbLib = require(path.join(ROOT, 'lib/db.js'));
const seoLib = require(path.join(ROOT, 'lib/seo/index.js'));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const argValue = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DATA_DIR = process.env.PJS_DATA_DIR || path.join(ROOT, 'data');
const days = Number(argValue('days', 28));

/** Record this SEO cycle in the permanent agent memory (Pooja / Priya / Manager). */
function rememberAgents(result) {
  try {
    const statusFor = (value) => (value === 'OK' ? 'OK' : value === 'FAIL' ? 'FAIL' : 'BLOCKED');
    const common = {
      cycle_no: result.cycle_no,
      report_id: result.report_id || 0,
      site: (result.report && result.report.site_url) || '',
      source: result.data_source || null
    };

    agentStore.recordRun('pooja', {
      status: result.state === 'COMPLETE' ? 'OK' : statusFor(result.state),
      summary:
        result.state === 'COMPLETE'
          ? `SEO research: ${result.report.research.findings.length} findings via ${result.report.research.engine}`
          : `SEO research skipped — cycle ${result.state}: ${result.reason || ''}`.slice(0, 200),
      duration_ms: result.duration_ms || 0,
      details: Object.assign({}, common, {
        engine: result.report ? result.report.research.engine : null,
        findings: result.report ? result.report.research.findings.length : 0
      })
    });

    agentStore.recordRun('priya', {
      status: result.state === 'COMPLETE' ? 'OK' : statusFor(result.state),
      summary:
        result.state === 'COMPLETE'
          ? `Verification ${result.verification.status}: ${result.verification.counts.verified}/${result.verification.counts.total} claims matched`
          : `Verification skipped — cycle ${result.state}`,
      duration_ms: 0,
      details: Object.assign({}, common, {
        verification: result.verification ? result.verification.status : null,
        counts: result.verification ? result.verification.counts : null,
        fabricated: result.verification ? result.verification.fabricated_subjects.length : 0
      })
    });

    agentStore.recordRun('manager', {
      status: result.state === 'COMPLETE' ? 'OK' : statusFor(result.state),
      summary:
        result.state === 'COMPLETE'
          ? `Plan ready: ${result.report.manager.priorities.length} priorities · publish ${result.report.manager.decisions.publish}`
          : `No plan — cycle ${result.state}: ${result.reason || ''}`.slice(0, 200),
      duration_ms: 0,
      details: Object.assign({}, common, {
        priorities: result.report ? result.report.manager.priorities.length : 0,
        production_deploy: result.report ? result.report.manager.decisions.production_deploy : null,
        storage: result.storage
          ? { database: result.storage.database.saved, disk: result.storage.disk.saved, archive: result.storage.archive.status }
          : null
      })
    });
    return true;
  } catch (err) {
    console.error(`[seo-cycle] agent memory not updated: ${err.message}`);
    return false;
  }
}

async function main() {
  const opened = dbLib.open(DATA_DIR, { log: (message) => console.log(message) });
  const driver = opened.driver;
  if (opened.ready) await opened.ready();

  const seo = seoLib.createSeoCenter({
    db: driver,
    dataDir: DATA_DIR,
    secret: (() => {
      // The same session secret the server uses, so encrypted tokens are shared.
      const authLib = require(path.join(ROOT, 'lib/auth.js'));
      return authLib.loadSecret(DATA_DIR);
    })(),
    log: (message) => console.log(message)
  });

  if (flag('status')) {
    const status = await seo.status();
    console.log(JSON.stringify(status, null, 2));
    await driver.close?.();
    process.exit(0);
  }

  if (flag('report')) {
    const report = seo.store.latestReport();
    if (!report) {
      console.log('No report stored yet.');
      await driver.close?.();
      process.exit(2);
    }
    console.log(report.markdown || JSON.stringify(report.report, null, 2));
    await driver.close?.();
    process.exit(0);
  }

  console.log('SEO Center — running one full cycle');
  console.log(`  data dir : ${DATA_DIR}`);
  console.log(`  window   : last ${days} days`);
  console.log('');

  const result = await seo.runCycle({ days, trigger: 'cli' });

  for (const stage of result.stages || []) {
    console.log(`  ${stage.status.padEnd(9)} ${stage.label.padEnd(22)} ${stage.detail}`);
  }
  console.log('');

  if (result.state === 'COMPLETE') {
    console.log(`  Cycle #${result.cycle_no} → ${result.status}`);
    console.log(
      `  Clicks ${result.totals.clicks} · Impressions ${result.totals.impressions} · CTR ${(result.totals.ctr * 100).toFixed(2)}% · Position ${result.totals.position.toFixed(1)}`
    );
    console.log(`  AI engine   : ${result.ai.engine}${result.ai.model ? ` (${result.ai.model})` : ''}${result.ai.remote ? '' : ' — no provider answered'}`);
    console.log(`  Verification: ${result.verification.status} (${result.verification.counts.verified}/${result.verification.counts.total} claims matched)`);
    console.log(`  Report id   : ${result.report_id} · checksum ${result.checksum.slice(0, 16)}…`);
    console.log(`  Stored in   : database ${result.storage.database.saved ? 'yes' : 'no'}, disk ${result.storage.disk.saved ? 'yes' : 'no'}, Fil One ${result.storage.archive.status}`);
    console.log(`  Next focus  : ${result.report.manager.next_cycle.focus}`);
  } else {
    console.log(`  Cycle ${result.state}${result.cycle_no ? ` #${result.cycle_no}` : ''}`);
    console.log(`  Reason: ${result.reason}`);
    console.log('  No report was written — the SEO Center never stores invented data.');
  }

  rememberAgents(result);

  if (flag('json')) console.log(JSON.stringify(result, null, 2));

  await driver.close?.();

  if (result.state === 'COMPLETE') process.exit(result.status === 'OK' ? 0 : 3);
  process.exit(result.state === 'BLOCKED' ? 2 : 1);
}

main().catch(async (err) => {
  console.error(`\n[seo-cycle] crashed: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
