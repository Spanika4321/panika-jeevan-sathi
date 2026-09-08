#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — wait for the pushed commit to become the live release.
 *
 *   node scripts/wait-for-release.mjs --url https://… --release "$GITHUB_SHA" \
 *        --budget 300000
 *
 * Replaces the old blind `sleep 300` in the keep-alive watchdog: instead of
 * waiting a fixed five minutes and then checking whatever happens to be live,
 * this polls the read-only health endpoint until `/api/health` reports
 * `release == <pushed commit>` (Render sets RENDER_GIT_COMMIT), or until the
 * time budget runs out. A free-tier cold start or a slow deploy is not an
 * error: the wait always exits 0 and prints what it observed, so the safety
 * checks that follow decide whether production is healthy.
 *
 * GET requests only — nothing is created, changed or restarted.
 */
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { productionUrl } from './lib/production-check.mjs';

const short = (value) => (value ? String(value).slice(0, 7) : 'unavailable');

export async function waitForRelease(url, {
  expected,
  fetchImpl = fetch,
  sleep = delay,
  budgetMs = 300000,
  pollMs = 20000,
  timeoutMs = 20000,
  maxAttempts = 20,
  now = () => Date.now(),
  log = () => {}
} = {}) {
  const base = productionUrl(url);
  if (!expected) {
    log('No expected release given; skipping the deployment wait.');
    return { matched: false, skipped: true, attempts: 0, waitedMs: 0, release: null };
  }
  const started = now();
  let attempts = 0;
  let release = null;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const response = await fetchImpl(`${base}/api/health`, {
        method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', 'User-Agent': 'PJS-Release-Wait/1.0' }
      });
      const body = response.headers.get('content-type')?.includes('application/json') ? await response.json().catch(() => null) : null;
      if (!response.bodyUsed) await response.body?.cancel();
      release = body?.release ?? null;
      if (release === expected) {
        log(`Live release matches the pushed commit ${short(expected)} after ${attempts} probe(s).`);
        return { matched: true, skipped: false, attempts, waitedMs: now() - started, release };
      }
      log(`Probe ${attempts}: live release is ${short(release)}, waiting for ${short(expected)}…`);
    } catch (error) {
      log(`Probe ${attempts}: health endpoint not ready (${error.message}).`);
    }
    if (now() - started + pollMs > budgetMs) break;
    await sleep(pollMs);
  }
  log(`Stopped waiting after ${attempts} probe(s); live release is ${short(release)}. Continuing with the safety checks.`);
  return { matched: false, skipped: false, attempts, waitedMs: now() - started, release };
}

const args = process.argv.slice(2);
function option(name, fallback) { const at = args.indexOf(name); return at < 0 || args[at + 1] === undefined ? fallback : args[at + 1]; }

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await waitForRelease(option('--url', process.env.SITE_URL || 'https://panikajeevansathi.onrender.com'), {
    expected: option('--release', process.env.EXPECTED_RELEASE || ''),
    budgetMs: Number(option('--budget', '300000')),
    pollMs: Number(option('--poll', '20000')),
    log: (line) => console.log(line)
  });
  console.log(`WAIT_RESULT: ${result.skipped ? 'skipped' : result.matched ? 'matched' : 'budget-exhausted'} (probes=${result.attempts}, waited=${result.waitedMs}ms)`);
}
