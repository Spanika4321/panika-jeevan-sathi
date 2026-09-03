#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Aman : Daily Site & Member Report Agent
 * =============================================================
 *
 * Aman roz owner ko site ki report deta hai: visitors, page visits, naye
 * members aur total members — sab aggregate, anonymous numbers.
 *
 *   node agents/aman.mjs                # report banao + email bhejo (daily)
 *   PJS_AMAN_NO_EMAIL=1 node agents/aman.mjs   # sirf report files, koi email
 *
 * Cycle-runner (agent-storage.yml, PJS_CYCLE_MANAGED=1) ke andar Aman email
 * NAHI bhejta — sirf live stats fetch karke run record karta hai. Daily email
 * sirf aman.yml workflow se jaati hai (RESEND_API_KEY secret ke saath).
 *
 * Data source: public aggregate endpoints
 *   /api/analytics/daily?days=30   (site_stats/site_visitors counters)
 *   /api/health                    (storage + durability snapshot)
 *
 * Hard rules:
 *   - Sirf aggregate numbers — koi raw IP / private member data kabhi nahi
 *     padha jaata, store hota hai ya email hota hai.
 *   - RESEND_API_KEY ke bina email = BLOCKED (PASS kabhi nahi).
 *   - Public UI / design kabhi touch nahi hota. Deploy / git push automatic
 *     nahi.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CONFIG, now, writeReport, persistRun } from './lib.mjs';

const ROOT = process.cwd();
const SITE = String(process.env.PJS_SITE_URL || CONFIG.site || '').replace(/\/+$/, '');
const RECIPIENT_FILE = path.join(ROOT, '.report-recipient');
const CYCLE = process.env.PJS_CYCLE_MANAGED === '1';
const QUIET = process.env.PJS_AMAN_NO_EMAIL === '1';
const EMAIL_FROM = 'PANIKA JEEVAN SATHI <onboarding@resend.dev>';

const startedAt = Date.now();
const UA = 'Aman/1.0 (PANIKA JEEVAN SATHI daily site & member report)';

/* ---------------------------------------------------------------- helpers */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pctChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function signLabel(v) {
  return v > 0 ? `+${v}` : `${v}`;
}

/** Kal 0 tha to % banaona misleading hota hai — 'naya' likho. */
function deltaText(current, previous) {
  if (previous > 0) return `${signLabel(pctChange(current, previous))}%`;
  return current > 0 ? 'naya' : '—';
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

function fmtIst() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function fmtDayShort(day) {
  const d = new Date(`${day}T00:00:00.000Z`);
  return d.toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short' });
}

function recipient() {
  try {
    const email = fs.readFileSync(RECIPIENT_FILE, 'utf8').trim();
    if (email) return email;
  } catch (_) {
    /* fall through */
  }
  return null;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Site (Render free) so sakta hai sleep ho — cold-start wake ke liye retries. */
async function fetchJson(url, attempts) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(25000)
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.ok !== false) return { json };
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (i + 1 < attempts) {
      const waitMs = [8000, 15000, 25000, 40000, 60000][i] || 60000;
      console.log(`[aman] retry ${i + 2}/${attempts} after ${waitMs}ms — ${lastError.message}`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  return { error: lastError };
}

/* ----------------------------------------------------------- report text */

function composeReport(data) {
  const lines = [];
  const warnings = [];
  const d = data.daily;

  lines.push(`Namaste Owner ji 🙏`);
  lines.push('');
  lines.push(`Aaj ki site report — ${data.generated_ist}`);
  lines.push('');

  const today = d.today_stats || { visits: 0, visitors: 0 };
  const yesterday = d.yesterday_stats || { visits: 0, visitors: 0 };
  const vDelta = pctChange(today.visitors, yesterday.visitors);
  const pDelta = pctChange(today.visits, yesterday.visits);
  const vText = deltaText(today.visitors, yesterday.visitors);
  const pText = deltaText(today.visits, yesterday.visits);

  // Trend: pichhle 7 din (aaj chhod kar) ka average
  const trend = (d.history || []).slice(-8, -1);
  const avgVisitors = trend.length
    ? Math.round(trend.reduce((s, r) => s + num(r.visitors), 0) / trend.length)
    : 0;

  lines.push(`📈 VISITORS`);
  lines.push(`• Aaj ke visitors (approx): ${fmtNumber(today.visitors)}`);
  lines.push(`  (kal: ${fmtNumber(yesterday.visitors)}, kal se ${vText})`);
  lines.push(`• Aaj ke page visits: ${fmtNumber(today.visits)}`);
  lines.push(`  (kal: ${fmtNumber(yesterday.visits)}, kal se ${pText})`);
  lines.push(`• Pichhle 7 din ka average visitors: ${fmtNumber(avgVisitors)}/din`);
  lines.push('');
  lines.push(`👥 MEMBERS`);
  lines.push(`• Total members (profiles): ${fmtNumber(d.totals ? d.totals.members : 0)}`);
  lines.push(`• Registered users: ${fmtNumber(d.totals ? d.totals.users : 0)}`);
  lines.push(`• Aaj naye members: ${fmtNumber(d.totals ? d.totals.new_members_today : 0)}`);
  lines.push('');

  const last7 = (d.history || []).slice(-7);
  if (last7.length) {
    lines.push(`📅 Pichhle 7 din (UTC din)`);
    lines.push('```');
    lines.push('Din        Visitors   Visits');
    for (const r of last7) {
      lines.push(
        `${fmtDayShort(r.day).padEnd(12)} ${fmtNumber(r.visitors).padStart(6)}   ${fmtNumber(r.visits).padStart(8)}`
      );
    }
    lines.push('```');
    lines.push('');
  }

  if (data.tracking === false) {
    warnings.push(
      '⚠️ Visitor tracking tables (site_stats/site_visitors) production database mein abhi nahi hain — supabase/schema.sql ek baar Supabase SQL editor mein chalao. Members ke numbers live hain.'
    );
  }

  if (d.note) warnings.push(`⚠️ ${d.note}`);

  if (data.health) {
    const h = data.health;
    lines.push(`🩺 SITE HEALTH`);
    lines.push(`• Status: ${h.ok ? 'OK — site chal rahi hai' : 'PROBLEM'}`);
    lines.push(
      `• Storage: ${h.storage || '?'}  • Photos: ${h.photos || '?'}  • durable: ${h.durable === true ? 'yes' : 'NO'}  • data_loss_risk: ${h.data_loss_risk === false ? 'false' : 'TRUE'}`
    );
    if (!h.ok) warnings.push('🔴 /api/health OK nahi hai — turant dekho!');
    lines.push('');
  }

  // Insaan jaisi chhoti salah — sirf aggregate se, koi spam nahi.
  const tips = [];
  if (yesterday.visitors > 0 && vDelta >= 10) tips.push(`Visitors kal se ${vDelta}% badhe — achhi growth hai, aise hi content/community momentum rakho.`);
  else if (yesterday.visitors > 0 && vDelta <= -10) tips.push(`Visitors kal se ${Math.abs(vDelta)}% gire hain. Priya (campaign) se naye outreach ideas maango.`);
  else if (yesterday.visitors === 0 && today.visitors > 0) tips.push(`Kal se naye visitors aane lage hain — achha signal hai.`);
  if ((d.totals ? d.totals.new_members_today : 0) > 0) {
    tips.push(`Aaj ${fmtNumber(d.totals.new_members_today)} naye member aaye — naye members ko welcome message zaroor bhejo.`);
  } else if (avgVisitors >= 8) {
    tips.push(`Aaj koi naya member nahi juda. Registration funnel check karo (verify-email on hai to bina verify ke profile nahi banta).`);
  }
  if (tips.length) {
    lines.push(`💡 Aman ki salah`);
    for (const t of tips) lines.push(`• ${t}`);
    lines.push('');
  }

  lines.push('— Aman (aapka daily report agent) 🤖');
  lines.push('Report time: ' + data.generated_iso + ' UTC');
  if (warnings.length) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of warnings) lines.push(w);
  }

  return { text: lines.join('\n'), warnings, tips };
}

function htmlReport(data, mdText) {
  const esc = escapeHtml;
  const warnings = data.warnings || [];
  const d = data.daily || {};
  const today = d.today_stats || {};
  const yesterday = d.yesterday_stats || {};
  const last7 = (d.history || []).slice(-7);
  const tot = d.totals || {};

  const rows = last7
    .map(
      (r) =>
        `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee">${esc(fmtDayShort(r.day))}</td>` +
        `<td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right">${fmtNumber(r.visitors)}</td>` +
        `<td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right">${fmtNumber(r.visits)}</td></tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="hi"><body style="margin:0;padding:0;background:#fdf7f2;font-family:Segoe UI,Arial,sans-serif">
<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #f0d9c8">
  <div style="background:#8c1d18;padding:18px 22px;color:#ffffff">
    <div style="font-size:20px;font-weight:bold">📊 Aman — Aaj ki Site Report</div>
    <div style="font-size:13px;opacity:.9">PANIKA JEEVAN SATHI · ${esc(data.generated_ist)}</div>
  </div>
  <div style="padding:20px 22px;color:#333">
    ${warnings.length ? warnings.map((w) => `<div style="background:#fff4e5;border:1px solid #f5c99b;color:#7a4b12;padding:10px 12px;border-radius:6px;margin-bottom:14px;font-size:13px">${esc(w)}</div>`).join('') : ''}
    <h3 style="margin:6px 0 10px">📈 Visitors</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:4px 0">Aaj ke visitors (approx)</td><td style="text-align:right;font-weight:bold">${fmtNumber(today.visitors)}</td></tr>
      <tr><td style="padding:4px 0;color:#777;font-size:13px">kal: ${fmtNumber(yesterday.visitors || 0)}</td><td></td></tr>
      <tr><td style="padding:4px 0">Aaj ke page visits</td><td style="text-align:right;font-weight:bold">${fmtNumber(today.visits)}</td></tr>
      <tr><td style="padding:4px 0;color:#777;font-size:13px">kal: ${fmtNumber(yesterday.visits || 0)}</td><td></td></tr>
    </table>
    <h3 style="margin:18px 0 10px">👥 Members</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:4px 0">Total members (profiles)</td><td style="text-align:right;font-weight:bold">${fmtNumber(tot.members)}</td></tr>
      <tr><td style="padding:4px 0">Registered users</td><td style="text-align:right;font-weight:bold">${fmtNumber(tot.users)}</td></tr>
      <tr><td style="padding:4px 0">Aaj naye members 🎉</td><td style="text-align:right;font-weight:bold;color:#1a7a3c">${fmtNumber(tot.new_members_today)}</td></tr>
    </table>
    ${rows ? `<h3 style="margin:18px 0 10px">📅 Pichhle 7 din</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#faf0e8"><th style="text-align:left;padding:6px 10px">Din</th><th style="text-align:right;padding:6px 10px">Visitors</th><th style="text-align:right;padding:6px 10px">Visits</th></tr>
      ${rows}
    </table>` : ''}
    ${data.health ? `<h3 style="margin:18px 0 10px">🩺 Site Health</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:3px 0">Status</td><td style="text-align:right">${data.health.ok ? '🟢 OK' : '🔴 PROBLEM'}</td></tr>
      <tr><td style="padding:3px 0">Storage / Photos</td><td style="text-align:right">${esc(data.health.storage || '?')} / ${esc(data.health.photos || '?')}</td></tr>
      <tr><td style="padding:3px 0">data_loss_risk</td><td style="text-align:right">${data.health.data_loss_risk === false ? 'false' : '⚠️ TRUE'}</td></tr>
    </table>` : ''}
    ${data.tips && data.tips.length ? `<h3 style="margin:18px 0 10px">💡 Aman ki salah</h3><ul style="font-size:13px;padding-left:20px">${data.tips.map((t) => `<li style="margin:4px 0">${esc(t)}</li>`).join('')}</ul>` : ''}
    <div style="margin-top:16px;font-size:12px;color:#999">Generated ${esc(data.generated_iso)} UTC · Aman (daily report agent)</div>
  </div>
</div></body></html>`;
}

/* -------------------------------------------------------------- email */

async function sendEmail({ subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = recipient();
  if (!apiKey) {
    const err = new Error('BLOCKED: RESEND_API_KEY GitHub Secret missing');
    err.code = 'BLOCKED';
    throw err;
  }
  if (!to) {
    const err = new Error('FAIL: .report-recipient missing/empty');
    err.code = 'FAIL';
    throw err;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject,
      text,
      html
    })
  });
  const bodyText = await res.text();
  if (!res.ok) {
    const err = new Error(`Resend HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
    err.code = 'FAIL';
    throw err;
  }
  return { to, id: String((bodyText.match(/"id"\s*:\s*"([^"]+)"/) || [])[1] || '') };
}

/* -------------------------------------------------------------- main */

async function main() {
  if (!SITE) {
    console.error('[aman] no site URL — CONFIG.site ya PJS_SITE_URL chahiye');
    process.exit(1);
  }

  const generatedIso = now();
  const generatedIst = fmtIst();
  const maxAttempts = CYCLE ? 2 : Number(process.env.PJS_AMAN_MAX_ATTEMPTS || 6);
  console.log(`[aman] site=${SITE} cycle=${CYCLE} quiet=${QUIET} attempts=${maxAttempts}`);

  const healthRes = await fetchJson(`${SITE}/api/health`, maxAttempts);
  const dailyRes = await fetchJson(`${SITE}/api/analytics/daily?days=30`, maxAttempts);

  const health = healthRes.json ? healthRes.json : null;
  const daily = dailyRes.json ? dailyRes.json : null;

  const data = {
    generated_iso: generatedIso,
    generated_ist: generatedIst,
    tracking: daily ? daily.tracking !== false : false,
    health,
    daily,
    warnings: []
  };

  let status;
  let summary;

  if (!daily) {
    // Site se data hi nahi mila — owner ko turant alert email.
    status = 'FAIL';
    const why = dailyRes.error ? dailyRes.error.message : 'no data';
    summary = `Site se analytics data nahi mila (${why}) — ${maxAttempts} attempts ke baad bhi.`;
    data.warnings.push(`🔴 ${summary} Health: ${health ? (health.ok ? 'OK' : 'degraded') : 'unreachable'}.`);
  } else {
    const todayStats = daily.today_stats || { visits: 0, visitors: 0 };
    const tot = daily.totals || {};
    summary =
      `visitors=${todayStats.visitors} visits=${todayStats.visits} ` +
      `naye_members=${tot.new_members_today ?? '?'} members=${tot.members ?? '?'} ` +
      `health=${health ? (health.ok ? 'ok' : 'problem') : 'na'}`;
  }

  const composed = daily ? composeReport(data) : { text: '', warnings: [], tips: [] };
  data.warnings.push(...composed.warnings);
  data.tips = composed.tips || [];
  const mdText = daily ? composed.text : `# Aman Report — ${generatedIst}\n\n${data.warnings[0] || ''}\n`;
  const subject = daily
    ? `📊 Aman ki Aaj ki Report — PANIKA JEEVAN SATHI (${generatedIst})`
    : `⚠️ Aman Report — site se data nahi mila (${generatedIst})`;

  // Files: latest JSON (machines ke liye) + daily markdown (archive ke liye)
  writeReport('aman-latest.json', JSON.stringify({
    agent: 'Aman',
    role: 'Daily Site & Member Report Agent',
    generated_at: generatedIso,
    site: SITE,
    status,
    summary,
    duration_ms: Date.now() - startedAt,
    report: { ...data, warnings: undefined },
    safety: CONFIG.safety
  }, null, 2) + '\n');

  const dayKey = (daily && daily.today) || generatedIso.slice(0, 10);
  writeReport(`aman-report-${dayKey}.md`, mdText + '\n');

  // Email: cycle/quiet mode mein kabhi nahi; warna RESEND_API_KEY zaroori.
  const email = { attempted: false, sent: false, reason: '' };
  if (CYCLE || QUIET) {
    email.reason = CYCLE ? 'cycle mode (PJS_CYCLE_MANAGED) — email daily workflow se jaati hai' : 'PJS_AMAN_NO_EMAIL=1';
  } else {
    email.attempted = true;
    try {
      const html = daily ? htmlReport({ ...data, warnings: data.warnings, daily, health }, mdText) : mdText;
      const sent = await sendEmail({ subject, text: mdText, html });
      email.sent = true;
      email.to = sent.to;
      email.id = sent.id;
    } catch (err) {
      email.error = err.message;
      if (err.code === 'BLOCKED') {
        if (status !== 'FAIL') status = 'BLOCKED';
        summary = `${summary} | email BLOCKED: ${err.message}`;
      } else {
        status = 'FAIL';
        summary = `${summary} | email FAIL: ${err.message}`;
      }
    }
  }

  persistRun('aman', {
    status: status === 'BLOCKED' ? 'BLOCKED' : status === 'FAIL' ? 'FAIL' : 'OK',
    summary: String(summary || 'Aman cycle completed.').slice(0, 400),
    details: {
      site: SITE,
      email_attempted: email.attempted,
      email_sent: email.sent,
      tracking: data.tracking,
      day: dayKey
    }
  });

  const result = {
    agent: 'Aman',
    id: 'aman',
    role: 'Daily Site & Member Report Agent',
    generated_at: generatedIso,
    status: status === 'BLOCKED' ? 'BLOCKED' : status === 'FAIL' ? 'FAIL' : 'OK',
    summary,
    duration_ms: Date.now() - startedAt,
    site: SITE,
    email,
    tracking: data.tracking,
    external_actions: email.sent ? 'EMAIL (daily site & member report — aggregate only)' : 'NONE (local report only)'
  };

  console.log(JSON.stringify(result, null, 2));

  if (status === 'FAIL') process.exitCode = 1;
  else if (status === 'BLOCKED') process.exitCode = 2;
}

main().catch((err) => {
  console.error(`[aman] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
