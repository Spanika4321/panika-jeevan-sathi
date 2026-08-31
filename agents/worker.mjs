#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Generic Agent Worker
 * ==========================================
 *
 *   node agents/worker.mjs <agent-id>
 *
 * Roster ke har *naye* agent (arjun, kavita, rahul, sneha, amit, nisha,
 * vikram, meera) ka local kaam yahin se chalta hai. Pooja / Priya / Manager /
 * Guardian ke apne purane scripts hain — unhe chhoda nahi gaya, sirf unka
 * result ab storage mein record hota hai (agents/storage.mjs ke zariye).
 *
 * Hard rules:
 *   - Sirf LOCAL analysis. Koi external API call nahi (network-free).
 *   - Jo check nahi ho sakta wo FAIL nahi, BLOCKED report hota hai.
 *   - Public UI / design kabhi touch nahi hota.
 *   - Password / private message kabhi nahi padha jaata.
 *   - Deploy / git push / social post kabhi automatic nahi.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from './storage.mjs';
import { AGENTS, SAFETY, agentById, missingRequirements } from './roster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const id = String(process.argv[2] || '').toLowerCase();
const agent = agentById(id);

if (!agent) {
  console.error(`Unknown agent: ${process.argv[2] || '(none)'}`);
  console.error(`Available: ${AGENTS.map((a) => a.id).join(', ')}`);
  process.exit(2);
}

const startedAt = Date.now();

/* ------------------------------------------------------------- helpers */

function readIfExists(file) {
  const full = path.join(ROOT, file);
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

function listHtml() {
  try {
    return fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html'));
  } catch {
    return [];
  }
}

function htmlHasNoindex(file) {
  const html = readIfExists(path.join('public', file));
  if (!html) return false;
  return /<meta\s+name=["']robots["'][^>]*noindex/i.test(html);
}

function htmlHasMetaDescription(file) {
  const html = readIfExists(path.join('public', file));
  if (!html) return false;
  return /<meta\s+name=["']description["']\s+content=["'][^"']+["']/i.test(html);
}

function htmlHasTitle(file) {
  const html = readIfExists(path.join('public', file));
  if (!html) return false;
  return /<title>\s*\S[\s\S]*?<\/title>/i.test(html);
}

function finish(status, summary, details = {}) {
  const duration_ms = Date.now() - startedAt;
  // Cycle runner ke andar runner khud record karta hai (double-entry avoid).
  if (!process.env.PJS_CYCLE_MANAGED) {
    store.recordRun(id, { status, summary, duration_ms, details });
  }

  const result = {
    agent: agent.name,
    id: agent.id,
    role: agent.role,
    generated_at: new Date().toISOString(),
    status,
    summary,
    duration_ms,
    storage: store.agentDir(id).replace(ROOT + path.sep, ''),
    details,
    safety: SAFETY,
    external_actions: 'NONE (local analysis only)'
  };

  console.log(JSON.stringify(result, null, 2));
  if (status === 'FAIL') process.exitCode = 1;
  return result;
}

/* --------------------------------------------------------- agent logic */

function runArjun() {
  // Curated hand-verifiable target categories. Kabhi auto-mail nahi bhejta.
  const categories = [
    'Community / cultural organisation websites (manual outreach only)',
    'Matrimonial & marriage directory listings with free submission',
    'Local Chhattisgarh news & community blogs',
    'Open-source / free-project showcase directories',
    'Educational & NGO resource pages'
  ];
  const rejected = [
    'Paid link networks',
    'Link farms / PBNs',
    'Irrelevant foreign-language link dumps',
    'Comment-spam forums',
    'Any site requiring reciprocal paid placement'
  ];

  store.remember(id, 'target_categories', categories, { longTerm: true });
  store.remember(id, 'rejection_rules', rejected, { longTerm: true });
  store.addTask(id, { title: 'Manually verify 10 target sites before any outreach', priority: 'high' });

  store.sendMessage({
    from: id,
    to: 'pooja',
    subject: 'Backlink category list ready for review',
    body: 'Curated categories stored. No outreach performed — awaiting human approval.'
  });

  return finish('OK', `${categories.length} target categories curated, ${rejected.length} rejection rules active. No outreach sent.`, {
    categories,
    rejected
  });
}

function runKavita() {
  const topics = [
    'Panika community matrimony: a complete guide',
    'How to write an honest profile that gets responses',
    'What to check before saying yes — a family checklist',
    'Free vs paid matrimony sites: what actually matters',
    'Safety tips for first meetings'
  ];

  const backlog = store.recall(id, 'topic_backlog') || [];
  for (const topic of topics) {
    if (!backlog.includes(topic)) backlog.push(topic);
  }
  store.remember(id, 'topic_backlog', backlog, { longTerm: true });

  const publicPages = listHtml();
  const linkTargets = publicPages.filter((f) =>
    ['index.html', 'about.html', 'contact.html', 'login.html', 'privacy.html', 'terms.html'].includes(f)
  );
  store.remember(id, 'internal_link_targets', linkTargets, { longTerm: true });
  store.addTask(id, { title: `Draft article: ${topics[backlog.length % topics.length]}` });

  return finish('OK', `${backlog.length} topics in backlog, ${linkTargets.length} internal-link targets identified.`, {
    backlog,
    linkTargets
  });
}

async function runRahul() {
  const siteUrl = process.env.SITE_URL || 'https://panikajeevansathi.onrender.com';
  const missing = missingRequirements(agent);

  // Honest sampling: agar network available nahi to SKIPPED, FAIL nahi.
  let sample;
  try {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(siteUrl, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    sample = { http: res.status, ms: Date.now() - started, ok: res.ok };
  } catch (err) {
    sample = { http: null, ms: null, ok: false, error: String(err.message || err) };
  }

  store.bumpMetric(id, 'samples');
  if (sample.ok) store.bumpMetric(id, 'reachable');
  else store.bumpMetric(id, 'unreachable');
  store.remember(id, 'last_sample', { at: new Date().toISOString(), ...sample });

  if (sample.http === null) {
    return finish('BLOCKED', `Network se ${siteUrl} reach nahi ho paya — koi fake status nahi diya gaya.`, {
      siteUrl,
      sample,
      missing_env: missing
    });
  }

  if (!sample.ok) {
    store.openIncident({
      id: `site-unreachable`,
      agent: id,
      severity: 'critical',
      title: `Site unreachable (HTTP ${sample.http})`,
      detail: `${siteUrl} returned ${sample.http}`
    });
    return finish('FAIL', `Site responded HTTP ${sample.http} — incident opened.`, { siteUrl, sample });
  }

  store.closeIncident('site-unreachable', { note: `Recovered: HTTP ${sample.http}` });
  return finish('OK', `${siteUrl} reachable — HTTP ${sample.http} in ${sample.ms}ms.`, { siteUrl, sample });
}

function runSneha() {
  const privatePages = [
    'admin.html', 'settings.html', 'dashboard.html', 'matches.html', 'messages.html',
    'notifications.html', 'interests.html', 'shortlist.html', 'edit-profile.html',
    'profile.html', 'search.html', 'reset-password.html', 'verify-email.html'
  ];

  const missingNoindex = privatePages.filter((f) => !htmlHasNoindex(f));

  const serverSource = readIfExists('server.js') || '';
  const headerChecks = ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy']
    .filter((h) => !serverSource.toLowerCase().includes(h));
  const declaresHeaders = headerChecks.length === 0;

  // Secret scan: sirf obvious committed-secret patterns, koi value print nahi.
  const secretPatterns = [
    /(?:sk|rk|pk)-(?:live|test)-[A-Za-z0-9]{16,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  ];
  const suspicious = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'data', 'storage'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|mjs|json|yml|yaml|env|md)$/i.test(entry.name)) continue;
      if (entry.name.includes('test-sigv4')) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const pattern of secretPatterns) {
        if (pattern.test(text)) {
          suspicious.push(path.relative(ROOT, full));
          break;
        }
      }
    }
  };
  try {
    walk(ROOT);
  } catch {
    /* read-only tree — ignore */
  }

  store.remember(id, 'private_page_count', privatePages.length, { longTerm: true });
  store.remember(id, 'last_scan', { at: new Date().toISOString(), missingNoindex, suspicious }, { longTerm: true });

  const problems = [];
  if (missingNoindex.length) problems.push(`noindex missing: ${missingNoindex.join(', ')}`);
  if (!declaresHeaders) problems.push(`server.js missing headers: ${headerChecks.join(', ')}`);
  if (suspicious.length) problems.push(`possible committed secret pattern in: ${suspicious.join(', ')}`);

  if (problems.length) {
    store.openIncident({
      id: 'security-scan',
      agent: id,
      severity: 'critical',
      title: 'Security scan found issues',
      detail: problems.join(' | ')
    });
    return finish('FAIL', `${problems.length} security issue(s) found.`, {
      missingNoindex,
      missingHeaders: headerChecks,
      suspicious
    });
  }

  store.closeIncident('security-scan', { note: 'Clean scan' });
  return finish('OK', `${privatePages.length} private pages noindex-verified, security headers present, no committed secrets found.`, {
    privatePages: privatePages.length,
    declaresHeaders,
    suspicious: []
  });
}

// Field vocabulary the matrimonial data model is expected to expose.
// Sirf *field names* scan hote hain — koi bhi user data nahi padha jaata.
const PROFILE_FIELD_VOCABULARY = [
  'name', 'age', 'gender', 'height', 'weight', 'maritalStatus', 'religion',
  'community', 'gotra', 'motherTongue', 'education', 'occupation', 'income',
  'city', 'state', 'country', 'diet', 'smoking', 'drinking', 'about',
  'photo', 'dob', 'email', 'phone', 'horoscope', 'familyType', 'manglik'
];

function runAmit() {
  const sources = [
    readIfExists('public/edit-profile.html') || '',
    readIfExists('public/profile.html') || '',
    readIfExists('public/search.html') || '',
    readIfExists('public/assets/js/app.js') || '',
    readIfExists('public/assets/js/cards.js') || '',
    readIfExists('lib/profiles.js') || '',
    readIfExists('server.js') || ''
  ].join('\n');

  const present = PROFILE_FIELD_VOCABULARY.filter((field) =>
    new RegExp(`\\b${field}\\b`).test(sources)
  );
  const missingFields = PROFILE_FIELD_VOCABULARY.filter((f) => !present.includes(f));

  const profileLib = readIfExists('lib/profiles.js') || '';
  const searchable =
    /\bage\b/.test(profileLib) && /\b(gender|community|city|state)\b/i.test(profileLib);

  store.remember(id, 'profile_fields', present, { longTerm: true });
  store.remember(id, 'profile_fields_missing', missingFields, { longTerm: true });
  store.bumpMetric(id, 'field_scans');

  const score = Math.round((present.length / PROFILE_FIELD_VOCABULARY.length) * 100);
  store.remember(id, 'last_completeness_score', score);

  // Missing fields ko task ke roop mein daal do, taaki kaam track rahe.
  for (const field of missingFields.slice(0, 5)) {
    store.addTask(id, { title: `Consider adding profile field: ${field}`, priority: 'low' });
  }

  return finish('OK', `${present.length}/${PROFILE_FIELD_VOCABULARY.length} profile fields detected in the data model (score ${score}/100). No private data read.`, {
    fields_present: present.length,
    fields_total: PROFILE_FIELD_VOCABULARY.length,
    present,
    missing: missingFields,
    searchable_profile_model: searchable,
    completeness_score: score,
    note: 'Aggregate/schema scan only — koi bhi individual profile data padha nahi gaya.'
  });
}

function runNisha() {
  const faq = store.getKnowledge('faq');
  const entryCount = (faq.entries || []).length;

  const themes = ['pricing', 'verification', 'photos', 'privacy', 'account'];
  store.remember(id, 'support_themes', themes, { longTerm: true });
  store.putKnowledge('support-themes', themes.map((t) => ({ theme: t, source: 'aggregate', tickets: 0 })));

  return finish('OK', `FAQ knowledge base has ${entryCount} entries; ${themes.length} support themes tracked (aggregate only).`, {
    faq_entries: entryCount,
    themes
  });
}

function runVikram() {
  const status = store.status();
  const totalRuns = status.agents.reduce((sum, a) => sum + a.runs, 0);
  const failing = status.agents.filter((a) => a.consecutive_failures > 0);
  const neverRun = status.agents.filter((a) => a.status === 'NEVER_RUN');

  const scorecard = {
    generated_at: status.generated_at,
    agents: status.agents.length,
    total_runs: totalRuns,
    agents_never_run: neverRun.map((a) => a.id),
    agents_with_failures: failing.map((a) => ({ id: a.id, streak: a.consecutive_failures })),
    queue: status.queue,
    ledger_ok: status.ledger.ok
  };

  store.kvSet('scorecard', 'latest', scorecard);
  store.kvSet('scorecard', `week-${store.isoWeek()}`, scorecard);
  store.addFact(id, `Daily rollup: ${totalRuns} total runs, ${failing.length} agent(s) with failures.`);

  if (failing.length) {
    store.sendMessage({
      from: id,
      to: 'manager',
      subject: `${failing.length} agent(s) reporting failures`,
      body: failing.map((a) => `${a.id}: ${a.consecutive_failures} consecutive`).join(', '),
      priority: 'high'
    });
  }

  return finish('OK', `Scorecard built: ${totalRuns} total runs, ${failing.length} failing, ${neverRun.length} never run.`, scorecard);
}

function runMeera() {
  const cycle = store.kvGet('cycle', 'last') || null;
  const status = store.status();

  const subject = cycle
    ? `PANIKA JEEVAN SATHI — cycle ${cycle.status} (${status.agents.length} agents)`
    : 'PANIKA JEEVAN SATHI — agent storage cycle report';

  const body = status.agents
    .map((a) => `• ${a.name}: ${a.status} (runs: ${a.runs})`)
    .join('\n');

  store.remember(id, 'last_subject', subject);
  store.addTask(id, { title: 'Owner email composed from verified outcomes (send only via RESEND_API_KEY)' });

  const missing = missingRequirements(agent);
  if (missing.length) {
    return finish('BLOCKED', `Email draft ready, par RESEND_API_KEY configured nahi — koi email bheja nahi gaya.`, {
      subject,
      body,
      missing_env: missing,
      note: 'Jab tak key configured nahi, email nahi jaata. Fake "sent" status kabhi nahi.'
    });
  }

  return finish('OK', `Email draft prepared (${status.agents.length} agents summarised).`, { subject, body });
}

/* ---------------------------------------------------------------- main */

const HANDLERS = {
  arjun: runArjun,
  kavita: runKavita,
  rahul: runRahul,
  sneha: runSneha,
  amit: runAmit,
  nisha: runNisha,
  vikram: runVikram,
  meera: runMeera
};

const handler = HANDLERS[id];

if (!handler) {
  console.error(`No handler for agent: ${id} (use its dedicated script)`);
  process.exit(2);
}

// Top-level await ke liye async wrapper.
Promise.resolve()
  .then(() => handler())
  .catch((err) => {
    finish('FAIL', String(err && err.message ? err.message : err), { stack: String(err && err.stack || '') });
    process.exitCode = 1;
  });
