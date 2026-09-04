#!/usr/bin/env node
'use strict';
/**
 * PANIKA JEEVAN SATHI — keep-alive watchdog alert (REAL email via Resend).
 *
 * Called by .github/workflows/keep-alive.yml when the production site is
 * unreachable or has fallen back to ephemeral sqlite storage:
 *
 *   node scripts/keepalive-alert.mjs --url https://… --status sqlite \
 *        --detail "storage=sqlite durable=false"
 *
 * Reads the recipient from .report-recipient (same as the employee reports)
 * and sends through RESEND_API_KEY. Zero dependencies: Node 22 fetch.
 *
 * Exit codes: 0 = sent · 1 = send failed / bad config · 2 = key missing.
 */

import fs from 'node:fs';

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v === undefined || String(v).startsWith('--') ? fallback : v;
}

const url = argValue('--url', 'https://panikajeevansathi.onrender.com');
const status = argValue('--status', 'unknown');
const detail = argValue('--detail', '');
const when = new Date().toLocaleString('en-IN');

const recipient = fs.readFileSync('.report-recipient', 'utf8').trim();
const apiKey = process.env.RESEND_API_KEY;

if (!recipient) {
  console.error('ALERT EMAIL FAIL: .report-recipient missing');
  process.exit(1);
}
if (!apiKey) {
  console.error('ALERT EMAIL BLOCKED: RESEND_API_KEY GitHub Secret missing');
  process.exit(2);
}

const subject = `PANIKA JEEVAN SATHI — production safety check failed (${when})`;
const text = `The production safety monitor could not verify all checks.

Site: ${url}
Status: ${status}
Detail: ${detail}

Open the Keep-alive workflow summary for the exact failed checks. They can
include availability, database/photo durability, privacy headers, missing
security releases or SMTP configuration. A failed check is not automatically
proof that data was lost. Do not delete data or switch storage to SQLite.

Review Render service events and Supabase status. Confirm durable=true,
remote photos, and the required security release after any repair.
This alert is not an inbox-delivery test for member account emails.
`;

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST', signal: AbortSignal.timeout(15000), redirect: 'error',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    from: 'PANIKA JEEVAN SATHI <onboarding@resend.dev>',
    to: [recipient],
    subject,
    text
  })
});

const body = await response.text();

if (!response.ok) {
  console.error('ALERT EMAIL FAIL');
  console.error(`Provider returned HTTP ${response.status}; inspect Resend delivery logs.`);
  process.exit(1);
}

console.log('Alert accepted by the email provider; inbox delivery is not confirmed.');
