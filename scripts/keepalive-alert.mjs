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

const isDown = status === 'down';
const subject = isDown
  ? `🔴 PANIKA JEEVAN SATHI — site DOWN (keep-alive ${when})`
  : `🔴 PANIKA JEEVAN SATHI — wapas sqlite storage par (keep-alive ${when})`;

const text = isDown
  ? `Keep-alive watchdog ne ${when} par site ko unreachable paya.

  URL:      ${url}
  DETAIL:   ${detail}

  Matlab: ${url}/api/health respond nahi kar raha.

  Kya karein:
  1. https://dashboard.render.com → service "panikajeevansathi" → Logs/Events dekhein
     (deploy fail hua hai ya service crash-loop mein hai?).
  2. Supabase project paused to nahi? https://supabase.com/dashboard →
     agar "Paused" dikhe to Resume karein.
  3. Deploy hone ke baad /api/health par jaakar check karein:
     "storage":"supabase", "durable":true dikhna chahiye.

  — PANIKA JEEVAN SATHI keep-alive watchdog (GitHub Actions)`
  : `Keep-alive watchdog ne ${when} par site ko SQLITE storage par paya —
  matlab data-loss risk wapas aa gaya hai (Render free disk wipe).

  URL:      ${url}
  DETAIL:   ${detail}

  Matlab: /api/health ne "storage":"${status === 'sqlite' ? 'sqlite' : '?'}" bataya
  (expected: "supabase", "durable":true).

  Kya karein (DEPLOY.md §B/§C):
  1. https://dashboard.render.com → service "panikajeevansathi" → Environment:
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET=uploads
     teeno set hon, phir Manual Deploy → Deploy latest commit.
  2. Confirm: ${url}/api/health → "storage":"supabase", "durable":true,
     "boot_at" field dikhna chahiye.
  3. Phir Actions → "Live proof (production durability)" run karein (🟢 gate).

  — PANIKA JEEVAN SATHI keep-alive watchdog (GitHub Actions)`;

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
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
  console.error(body);
  process.exit(1);
}

console.log('REAL ALERT EMAIL SENT');
console.log(body);
