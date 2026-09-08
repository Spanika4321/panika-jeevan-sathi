#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { checkProduction, formatReport } from './lib/production-check.mjs';

const args = process.argv.slice(2);
function option(name, fallback) { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; }
const url = option('--url', process.env.SITE_URL || 'https://panikajeevansathi.onrender.com');
const output = option('--output', '');
try {
  const report = await checkProduction(url, {
    expectedStorage: process.env.PJS_EXPECTED_STORAGE || 'supabase',
    // SMTP credentials can only be set by the owner in the Render dashboard, so
    // by default they are reported as an advisory warning instead of turning the
    // whole safety watchdog red. PJS_REQUIRE_MAIL=1 makes them blocking again.
    requireMail: process.env.PJS_REQUIRE_MAIL === '1'
  });
  const text = formatReport(report);
  console.log(text);
  if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, text); }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  for (const name of report.advisory_failures) console.log(`ADVISORY (owner action, not a job failure): ${name}`);
  for (const name of report.blocking_failures) console.log(`FAILED: ${name}`);
  if (!report.blocking_ok) process.exitCode = 1;
} catch (error) {
  console.error(`Production verification failed: ${error.message}`);
  process.exitCode = 1;
}
