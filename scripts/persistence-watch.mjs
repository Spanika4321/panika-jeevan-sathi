#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — persistence alarm.
 *
 * Asks the LIVE website one question: "is your data actually safe?"
 *
 * It fails (exit 1) when the site is storing members somewhere that a Render
 * Free instance erases on every sleep or redeploy — which is the single
 * failure that can quietly wipe every registration.
 *
 *   node scripts/persistence-watch.mjs --url https://panikajeevansathi.onrender.com
 *
 * Checks:
 *   1. the site answers at all
 *   2. /api/health reports storage = d1        (not sqlite / json)
 *   3. /api/health reports photos are durable in D1 or R2 (not local)
 *   4. the D1 write queue is not stuck (pending writes / lastError)
 *   5. the member count did not go DOWN since the last run (state file), which
 *      is the fingerprint of a wipe
 *
 * Used by .github/workflows/persistence-watch.yml, which opens a GitHub issue
 * the moment any of these turn red.
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}

const url = (arg('url', process.env.SITE_URL || 'https://panikajeevansathi.onrender.com') || '').replace(/\/+$/, '');
const stateFile = path.resolve(process.cwd(), arg('state', 'reports/persistence-state.json'));

let passed = 0;
let failed = 0;
const problems = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    problems.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function getJson(pathname) {
  const res = await fetch(`${url}${pathname}`, {
    headers: { accept: 'application/json' },
    // Render Free instances take ~50 s to wake from sleep.
    signal: AbortSignal.timeout(90000)
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch (_) {
    return { status: res.status, body: null, text };
  }
}

console.log(`Persistence watch — ${url}\n`);
console.log('1. Site reachable');

let health = null;
try {
  health = await getJson('/api/health');
  check('the website answers /api/health', health.status === 200, `HTTP ${health.status}`);
} catch (err) {
  check('the website answers /api/health', false, err.message);
}

const body = (health && health.body) || {};

console.log('\n2. Where is the member data stored?');
const storage = String(body.storage || 'unknown');
check(
  'the member database is Cloudflare D1 (survives restarts)',
  storage === 'd1',
  storage === 'd1'
    ? 'd1'
    : `storage="${storage}" — THIS IS EPHEMERAL. Every sleep or redeploy erases all members. Set CF_ACCOUNT_ID, CF_D1_DATABASE_ID and CF_D1_API_TOKEN on Render.`
);

const photos = String(body.photos || 'unknown');
const photoStats = (body.remote && body.remote.photos) || {};
const photoBackend = String(photoStats.backend || (photos.includes('+') ? photos.split('+')[0] : photos));
const durablePhotos =
  Boolean(photoStats.remote) && (photoBackend === 'd1' || photoBackend === 'r2');
check(
  'profile photos survive restarts (D1 bridge or R2)',
  durablePhotos,
  durablePhotos
    ? `${photoBackend} (${photoBackend === 'd1' ? 'temporary bridge' : 'object storage'})`
    : `photos="${photos}" — uploaded photos are local and can disappear. Use D1 storage; R2 is optional.`
);

if (photoBackend === 'd1') {
  const photoBytes = Number((photoStats.usage || {}).bytes || 0);
  // Three encrypted snapshots are retained. Alerting at 120 MB keeps their
  // combined worst-case size below GitHub Free's artifact storage allowance.
  const warningAt = 120 * 1024 * 1024;
  check(
    'D1 bridge photo usage stays below the 120 MB safety line',
    photoBytes < warningAt,
    `${(photoBytes / (1024 * 1024)).toFixed(1)} MB, ${Number((photoStats.usage || {}).objects || 0)} photo(s)`
  );
}

console.log('\n3. Is the write queue healthy?');
const dbStats = (body.remote && body.remote.database) || {};
check('D1 reports no write error', !dbStats.lastError, dbStats.lastError || 'none');
check(
  'no writes are stuck in the queue',
  !(Number(dbStats.pending) > 25),
  `${Number(dbStats.pending || 0)} pending`
);

console.log('\n4. Did the member count drop?');
let site = null;
try {
  site = await getJson('/api/site');
} catch (err) {
  check('/api/site answers', false, err.message);
}
const members = Number(((site && site.body && site.body.counts) || {}).members || 0);
let previous = null;
try {
  previous = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
} catch (_) {
  /* first run */
}

if (previous && Number.isFinite(Number(previous.members))) {
  check(
    'the member count did not fall since the last check',
    members >= Number(previous.members),
    `was ${previous.members} (${previous.checkedAt}), now ${members}` +
      (members < Number(previous.members) ? ' — DATA LOSS DETECTED' : '')
  );
} else {
  console.log(`  – first run: recording ${members} member(s) as the baseline.`);
}

try {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      { members, storage, photos, checkedAt: new Date().toISOString(), url },
      null,
      2
    )
  );
} catch (err) {
  console.log(`  – could not write ${stateFile}: ${err.message}`);
}

/* ------------------------------------------------------------------ report */

console.log(`\n${'─'.repeat(58)}`);
console.log(`Persistence watch: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nProblems:');
  for (const p of problems) console.log(`  • ${p}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(
      summary,
      `## ⚠️ Persistence watch failed\n\n${problems.map((p) => `- ${p}`).join('\n')}\n`
    );
  }
}
process.exit(failed ? 1 : 0);
