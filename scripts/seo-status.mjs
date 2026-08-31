#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — "what is still missing?" in one command.
 *
 *   npm run seo:status            → connection board for every stage of the
 *                                   SEO pipeline (GSC → AI → Pooja → Priya →
 *                                   Manager → permanent report)
 *
 * This never guesses: a stage is CONNECTED only when its credentials are
 * present *and* the app can read them; otherwise it prints exactly which key
 * to set and where to get it. Safe to run on a server or in CI — it writes
 * nothing and prints no secret values, only whether they exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.PJS_DATA_DIR || path.join(ROOT, 'data');
const SEO_DIR = process.env.PJS_SEO_DATA_DIR || path.join(DATA_DIR, 'seo');

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

const has = (key) => Boolean(process.env[key] && String(process.env[key]).trim());
const len = (key) => (has(key) ? String(process.env[key]).trim().length : 0);

const config = readJson(path.join(SEO_DIR, 'config.json'), {});
const oauth = readJson(path.join(SEO_DIR, 'oauth.json'), {});
const scheduler = readJson(path.join(SEO_DIR, 'scheduler.json'), {});
const aiStatus = readJson(path.join(SEO_DIR, 'ai-status.json'), {});
const cycles = readJson(path.join(SEO_DIR, 'cycles.json'), { cycles: [] });
const latestData = readJson(path.join(SEO_DIR, 'latest-data.json'), null);
const squad = readJson(path.join(ROOT, 'storage/shared/kv/seo-center.json'), { values: {} });

const gscConnected = Boolean(oauth && (oauth.refresh_token || oauth.access_token)) || has('GOOGLE_SEARCH_CONSOLE_TOKEN');

const rows = [
  {
    stage: 'Google Search Console',
    need: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    connected: gscConnected,
    how: 'Google Cloud Console → OAuth client (Web) → redirect URI https://<site>/api/seo/oauth/callback; then /seo-center.html → Connect. Property must be a domain property: sc-domain:panikajeevansathi.com',
    note: gscConnected
      ? `refresh token stored${oauth.property ? `, property ${oauth.property}` : ''}${oauth.refresh_token ? '' : ' (env token)'}`
      : has('GOOGLE_CLIENT_ID')
        ? 'OAuth client keys are set but nobody has connected the account yet — open /seo-center.html and click Connect'
        : 'no OAuth client yet'
  },
  {
    stage: 'Gemini (first AI provider)',
    need: ['GEMINI_API_KEY'],
    connected: has('GEMINI_API_KEY'),
    how: 'aistudio.google.com → Create API key → set GEMINI_API_KEY (model: GEMINI_MODEL, default gemini-2.5-flash)'
  },
  {
    stage: 'Router (fallback AI provider)',
    need: ['GEMINI_ROUTER_API_KEY', 'GEMINI_ROUTER_URL'],
    connected: has('GEMINI_ROUTER_API_KEY') && has('GEMINI_ROUTER_URL'),
    optional: true,
    how: 'any OpenAI-compatible endpoint (OpenRouter / Groq / Together). Optional: without it a failed Gemini call falls back to the local rule engine.'
  },
  {
    stage: 'Pooja — research worker',
    need: [],
    connected: true,
    local: true,
    how: 'runs on the Search Console snapshot; no key of its own'
  },
  {
    stage: 'Priya — verification worker',
    need: [],
    connected: true,
    local: true,
    how: 'deterministic check of every claim against the real snapshot; a mismatch fails the cycle instead of passing it'
  },
  {
    stage: 'Manager — plan release',
    need: [],
    connected: true,
    local: true,
    how: 'publishes the plan only when Pooja PASS and Priya PASS'
  },
  {
    stage: 'Permanent report storage (local)',
    need: [],
    connected: fs.existsSync(SEO_DIR),
    local: true,
    how: `every cycle writes JSON + Markdown under ${path.relative(ROOT, SEO_DIR) || SEO_DIR} (in a deployed app this is reports/agents + data/seo)`
  },
  {
    stage: 'Filecoin mirror (Fil One / S3)',
    need: ['FIL_ONE_ENDPOINT', 'FIL_ONE_ACCESS_KEY', 'FIL_ONE_SECRET_KEY', 'FIL_ONE_BUCKET'],
    connected: has('FIL_ONE_ENDPOINT') && has('FIL_ONE_ACCESS_KEY') && has('FIL_ONE_SECRET_KEY') && has('FIL_ONE_BUCKET'),
    optional: true,
    how: 'optional off-box permanence for reports; local + Git storage already survives restarts'
  },
  {
    stage: 'Owner email report',
    need: ['RESEND_API_KEY'],
    connected: has('RESEND_API_KEY'),
    optional: true,
    how: 'Resend → API key; without it the draft is written to data/outbox/ and never sent'
  },
  {
    stage: 'Daily scheduler',
    need: [],
    connected: String(process.env.SEO_SCHEDULER || '0') !== '0',
    how: 'SEO_SCHEDULER=1 on the running service, or install ops/seo-cycle.workflow.yml as .github/workflows/seo-cycle.yml for the free GitHub Actions cron'
  },
  {
    stage: 'Canonical production URL',
    need: ['SITE_URL'],
    connected: has('SITE_URL'),
    how: 'SITE_URL pins canonical/OG/sitemap/robots — without it Google sees whatever hostname answered'
  },
  {
    stage: 'Google site verification tag',
    need: ['GOOGLE_SITE_VERIFICATION'],
    connected: has('GOOGLE_SITE_VERIFICATION'),
    optional: true,
    how: 'Search Console → verify property → HTML tag → paste only the token; it is injected at render time on public pages'
  }
];

const bar = '─'.repeat(74);
console.log('');
console.log(`  PANIKA JEEVAN SATHI — SEO pipeline board  (${new Date().toISOString()})`);
console.log(bar);
console.log('  stage                              status        keys');
console.log(bar);
let open = 0;
let optionalOpen = 0;
for (const r of rows) {
  const status = r.connected ? 'CONNECTED' : r.optional ? 'not set  ' : 'BLOCKED  ';
  const keys = r.local
    ? 'local engine'
    : r.need.length
      ? r.need.map((k) => `${k}${has(k) ? ` (${len(k)} chars)` : ' — missing'}`).join(', ')
      : 'no key needed';
  console.log(`  ${r.stage.padEnd(34)} ${status}  ${keys}`);
  if (!r.connected) {
    if (r.optional) optionalOpen += 1;
    else open += 1;
    console.log(`  ${''.padEnd(34)} ${''.padEnd(11)}↳ ${r.how}`);
  }
}
console.log(bar);

const lastCycle = (cycles.cycles || []).slice(-1)[0] || null;
const squadLast = squad.values && squad.values['squad-last'] ? squad.values['squad-last'].value : null;
const reports = (() => {
  try {
    return fs.readdirSync(path.join(SEO_DIR, 'reports')).filter((f) => f.endsWith('.json')).length;
  } catch (_) {
    return 0;
  }
})();

console.log('');
console.log(`  last cycle      : ${lastCycle ? `${lastCycle.id || 'cycle'} — ${lastCycle.status} (${lastCycle.at || lastCycle.started_at || 'unknown time'})` : 'none recorded in this data dir'}`);
console.log(`  stored reports  : ${reports}`);
console.log(`  search data     : ${latestData ? `${latestData.rows ? `${latestData.rows} rows` : 'snapshot present'} (${latestData.from || '?'} → ${latestData.to || '?'})` : 'no Search Console snapshot yet'}`);
console.log(`  AI provider used: ${aiStatus && aiStatus.last ? `${aiStatus.last.provider || aiStatus.last.model || 'recorded'} (${aiStatus.last.ok === false ? `fell back: ${aiStatus.last.error || 'error'}` : 'ok'})` : 'no AI call recorded yet'}`);
console.log(`  scheduler       : ${scheduler && scheduler.next_run_at ? `next run ${scheduler.next_run_at} (${scheduler.mode || 'daily'})` : String(process.env.SEO_SCHEDULER || '0') !== '0' ? 'enabled, first run being scheduled' : 'off (SEO_SCHEDULER=1 to enable)'}`);
console.log(`  agent squad     : ${squadLast ? `${squadLast.at} — ${Object.entries(squadLast.workers || {}).map(([k, v]) => `${k}:${v}`).join(' ')}` : 'never dispatched (npm run seo:squad)'}`);
console.log('');
console.log(
  open === 0
    ? '  ✅ every required stage is connected — the pipeline can run end to end'
    : `  ⏳ ${open} required stage(s) still need a credential${optionalOpen ? ` (${optionalOpen} optional ones left unset)` : ''}`
);
console.log('');
console.log('  Run one real cycle:   npm run seo:cycle');
console.log('  Verify the reports:   npm run seo:verify');
console.log('  Dispatch the squad:   npm run seo:squad');
console.log('');
process.exit(open ? 2 : 0);
