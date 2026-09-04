#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { checkProduction } from './lib/production-check.mjs';

const args = process.argv.slice(2);
function option(name, fallback) { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; }
const url = option('--url', process.env.SITE_URL || 'https://panikajeevansathi.onrender.com');
const output = option('--output', '');
try {
  const report = await checkProduction(url, { expectedStorage: process.env.PJS_EXPECTED_STORAGE || 'supabase' });
  const lines = [
    '# Production safety check', '', `Checked: ${report.checked_at}`, `Site: ${report.site}`, '',
    ...report.checks.map((check) => `${check.ok ? '✅' : '❌'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`), '',
    `Result: ${report.ok ? 'PASS' : 'NOT FULLY VERIFIED — resolve failed checks'}`, '',
    ...report.limitations.map((text) => `- ${text}`), ''
  ];
  console.log(lines.join('\n'));
  if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, lines.join('\n')); }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Production verification failed: ${error.message}`);
  process.exitCode = 1;
}
