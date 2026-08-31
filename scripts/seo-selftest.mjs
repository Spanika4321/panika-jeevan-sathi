#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — SEO Center self-test (offline, fixture-based).
 *
 *   node scripts/seo-selftest.mjs
 *
 * Proves the anti-fake guarantee of the pipeline mechanically:
 *   • Priya PASSES research whose claims match the data snapshot.
 *   • Priya FAILS hallucinated queries and tampered numbers.
 *   • Manager withholds the plan unless Pooja + Priya both pass.
 *
 * Runs on a clearly-labelled fixture (kind: "selftest-fixture") that is never
 * written into the real reports, snapshots or dashboard.
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createSeoCenter } = require(path.join(ROOT, 'lib', 'seo-center.js'));

const seo = createSeoCenter({
  dataDir: process.env.PJS_SEO_DATA_DIR || process.env.PJS_DATA_DIR || path.join(ROOT, 'data'),
  secret: null,
  db: null,
  auth: null,
  rootDir: ROOT,
  log: () => {}
});

const result = seo.selftest();
console.log(JSON.stringify(result, null, 2));
const failed = result.results.filter((r) => r.status === 'FAIL').length;
console.log(`\n[seo-selftest] verdict: ${result.verdict} (${result.results.length - failed} pass, ${failed} fail)`);
process.exitCode = result.verdict === 'PASS' ? 0 : 1;
