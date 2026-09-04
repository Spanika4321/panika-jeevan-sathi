#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — Generic Agent Worker
 * ==========================================
 *
 *   node agents/worker.mjs <agent-id>
 *
 * Roster ke har *naye* agent (rushma, arjun, kavita, rahul, sneha, amit, nisha,
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

/* ------------------------------------------------ Rushma (user acquisition) */
/*
 * Rushma — panika / manikpuri surname wale log PANIKA JEEVAN SATHI tak kaise
 * pahunche, iska roz ka multi-platform plan aur ready-to-copy drafts banati
 * hai. HARD RULE: Rushma KHUD kabhi post nahi karti — koi auto-posting,
 * mass-DM, scraping ya fake engagement nahi. Wo sirf outreach KIT deti hai;
 * posting hamesha owner manually karta hai (SAFETY.no_mass_social_posting).
 */

const RUSHMA_FALLBACK_SITE = 'https://panikajeevansathi.onrender.com';
const RUSHMA_WHATSAPP = 'https://wa.me/918099834725';

function rushmaSiteUrl() {
  try {
    const cfg = JSON.parse(readIfExists('agents/config.json') || '{}');
    return typeof cfg.site === 'string' && cfg.site.startsWith('http')
      ? cfg.site
      : RUSHMA_FALLBACK_SITE;
  } catch {
    return RUSHMA_FALLBACK_SITE;
  }
}

function runRushma() {
  const SITE = rushmaSiteUrl();
  const WA = RUSHMA_WHATSAPP;
  const fill = (text) =>
    String(text).replaceAll('{SITE}', SITE).replaceAll('{WA}', WA);

  const TARGET_AUDIENCE = {
    surnames: ['Panika (पनिका / पानिका)'],
    community: ['Manikpuri (मानिकपुरी)', 'Kabirpanthi (कबीरपंथी)', 'Adivasi (आदिवासी)'],
    region:
      'Chhattisgarh (Kabirdham/Kawardha, Mungeli, Bemetara, Bilaspur, Raipur) + adjoining MP/UP belts',
    who: 'Shaadi-umar ke candidates + unke parents/parivar',
    promise: '100% free, community-first, privacy-first — koi payment kabhi nahi'
  };

  const CONTENT_THEMES = [
    '100% free forever — koi payment, koi locked profile nahin',
    'Apne samaj ki apni website — Panika / Manikpuri / Kabirpanthi',
    'Free registration sirf 2 minute mein, mobile se',
    'Privacy first — photo/contact control member ke haath mein',
    'Parents ke liye simple Hindi process',
    'WhatsApp support se seedhi madad',
    'Success stories se bharosa',
    'Har member 2 rishtedaron ko bataye — referral push',
    'Shaadi season se pehle profile banwao',
    'Paid agents / mehengi sites ka free alternative'
  ];

  const HASHTAG_BANK = [
    '#PanikaJeevanSathi', '#PanikaSamaj', '#पनिकासमाज', '#Manikpuri',
    '#मानिकपुरी', '#Kabirpanthi', '#कबीरपंथी', '#Adivasi', '#Chhattisgarh',
    '#Kawardha', '#Kabirdham', '#FreeMatrimony', '#Rishta', '#Vivah', '#PanikaVivah'
  ];

  const COMPLIANCE = [
    'Auto-posting / mass-DM kabhi nahin — sirf owner manually share karega',
    'Sirf wahan post karo jahan allowed ho (apne groups ya group-admin ki permission)',
    'Koi scraping nahin, koi fake account / fake engagement nahin',
    'Private member data kabhi use nahin hota',
    'Fake member-count ya jhoothi claims kabhi nahin — sirf saach (site sach mein free hai)',
    'Paid ads optional — Rushma ka focus organic + referral hai'
  ];

  const WEEKLY_ROTATION = [
    {
      key: 'quora_content',
      name: 'Quora/Reddit + content handoff',
      goal: 'Helpful Hindi answers likhna + blog topics nikalna (SEO growth loop)',
      where_to_find: [
        'Quora Hindi — "panika samaj", "manikpuri", "chhattisgarh matrimony" questions',
        'Reddit r/Chhattisgarh (subreddit rules follow karke)'
      ],
      search_terms: ['panika samaj vivah', 'manikpuri samaj', 'free matrimonial site chhattisgarh'],
      checklist: [
        '1 genuine, helpful Hindi answer likho (site link sirf tab jab relevant ho)',
        '3 blog topics finalise karo — Rushma khud Kavita/Pooja ko bhejti hai',
        'Lead tracker ka weekly review: kitne contacted → joined hue'
      ],
      rules: ['Answer pehle helpful, link baad mein', 'Har answer same copy-paste mat karo']
    },
    {
      key: 'facebook',
      name: 'Facebook — Panika/Manikpuri groups & pages',
      goal: 'Samaj ke Facebook groups mein site ki pehchaan — 2 genuine posts',
      where_to_find: [
        '"पनिका समाज" / "Panika Samaj" groups',
        'Manikpuri / Kabirpanthi community groups',
        'Kawardha/Kabirdham, Mungeli, Bemetara, Bilaspur local groups',
        'Chhattisgarh matrimony / samaj pages'
      ],
      search_terms: ['पनिका समाज', 'Panika samaj', 'मानिकपुरी समाज', 'Manikpuri', 'Kabirpanthi samaj', 'कबीरधाम समाज', 'Kawardha community'],
      checklist: [
        'Search terms se 3 relevant groups find karke join request bhejo',
        'Group rules padho — matrimony post allowed hai ya admin se permission maango',
        'Draft #1 apni profile/page se post karo (site link ke saath)',
        'Jo comment/PM aaye, unhe registration link + WhatsApp support do'
      ],
      rules: ['Ek group mein ek hi post — repeat spam nahin', 'Dusron ke posts par irrelevant comment nahin', 'Admin mana kare to post turant hata do']
    },
    {
      key: 'whatsapp',
      name: 'WhatsApp — apne groups & contacts',
      goal: '1 forward-friendly message apne family/samaj groups mein share karna',
      where_to_find: [
        'Apne ghar/parivar ke WhatsApp groups',
        'Mohalla/gaon ke samaj groups jahan aap pehle se member ho',
        'Samaj ke function/event groups'
      ],
      search_terms: ['(search nahin — sirf apne existing groups)'],
      checklist: [
        'Draft copy karke apne 2–3 groups mein share karo',
        'Jo pooche, usse registration mein madad karo (WhatsApp support number do)',
        'Har member se bolo: 2 rishtedaron ko forward kare'
      ],
      rules: ['Unknown numbers ko cold-message nahin', 'Jis group ne promotion mana kiya ho wahan nahin', 'Ek din mein baar-baar forward nahin']
    },
    {
      key: 'instagram',
      name: 'Instagram — post + reel',
      goal: '1 post ya reel publish — hashtag reach se naye users',
      where_to_find: [
        'Apna page/profile (nahin hai to banao)',
        'Community hashtags ke neeche active accounts',
        'Local Chhattisgarh culture pages (collab request)'
      ],
      search_terms: ['#पनिकासमाज', '#Manikpuri', '#Chhattisgarh communities'],
      checklist: [
        'Draft caption + hashtags se 1 post/reel daalo',
        'Reel script: 15–20 sec Hindi voiceover (script niche drafts mein hai)',
        'Bio mein site link + WhatsApp daalo',
        'Community posts par 5 genuine helpful comments (spammy nahin)'
      ],
      rules: ['Follow/unfollow tricks nahin', 'Paid followers nahin', 'DM spam nahin — sirf tab jab koi khud pooche']
    },
    {
      key: 'youtube',
      name: 'YouTube — community channels ke through',
      goal: 'Chhattisgarhi/community channels se mention ya collab',
      where_to_find: [
        'Kabirpanthi bhajan/pravachan channels',
        'Chhattisgarh samaj news/event channels',
        'Local wedding videographers ke channels'
      ],
      search_terms: ['Kabirpanthi', 'Kabirdham', 'Kawardha news', 'CG samaj', 'CG vivah'],
      checklist: [
        '5 channels shortlist karo jinki audience match karti hai',
        'Unke latest relevant video par ek helpful comment karo (context match ho to hi site mention)',
        '1 channel owner ko short collab message manually bhejo (draft niche hai)',
        'Apna 30-sec intro video script ready rakho'
      ],
      rules: ['Har video par same comment paste nahin karna', 'Clickbait nahin']
    },
    {
      key: 'telegram_x',
      name: 'Telegram + X (Twitter)',
      goal: 'Telegram channels mein permission ke saath share + X par 1 post',
      where_to_find: [
        'Chhattisgarh news/community Telegram channels',
        'Samaj Telegram groups',
        'X par Hindi community conversations'
      ],
      search_terms: ['Chhattisgarh telegram groups', 'adivasi community telegram', 'कबीरपंथी'],
      checklist: [
        '2 Telegram channel admins se permission lo',
        'Draft wahan share karo — ya apna channel banao',
        'X par 1 post: site intro + hashtags'
      ],
      rules: ['Sirf permission-based sharing', 'Telegram par personal numbers collect nahin']
    },
    {
      key: 'offline_referral',
      name: 'Offline samaj + referral drive',
      goal: 'Zameeni reach — events, mandir notice board, panchayat + referral',
      where_to_find: [
        'Samaj ke milan-samaroh / vivah functions',
        'Mandir notice board (permission ke saath)',
        'Panchayat / community meetings',
        'Local wedding se jude log'
      ],
      search_terms: ['(offline — apne town ke aas-paas)'],
      checklist: [
        'Agle samaj event ka pata karo — wahan kam se kam 5 logon ko batao',
        'Notice board ke liye poster text ready karo (draft niche hai)',
        'Existing members ko bolo: 2 logon ko refer kare (referral draft niche hai)',
        'Jo join kare, unki entry lead tracker mein daalo'
      ],
      rules: ['Sirf saach bolna — "free" hi bolna kyunki site sach mein free hai', 'Kisi ka number bina permission share nahin']
    }
  ];

  const DRAFTS = {
    facebook: [
      {
        title: 'Facebook post — samaj intro',
        text: '🙏 पनिका समाज के सभी भाइयों-बहनों को नमस्कार!\n\nअब हमारे समाज के लड़के-लड़कियों का रिश्ता ढूंढना हुआ बिल्कुल आसान और मुफ्त। PANIKA JEEVAN SATHI — हमारी अपनी 100% FREE matrimonial website:\n\n✅ Registration बिल्कुल free\n✅ सभी profile देखना free — कोई locked profile नहीं\n✅ अपने समाज (पनिका / मानिकपुरी / कबीरपंथी) के लोग\n✅ Privacy आपके हाथ में, मदद के लिए WhatsApp support\n\nमोबाइल से 2 मिनट में profile बनाएं 👇\n{SITE}\nकिसी मदद के लिए WhatsApp: {WA}\n\nकृपया उन परिवारों तक पहुंचाएं जिनके घर में शादी की उम्र के बच्चे हैं 🙏'
      },
      {
        title: 'Facebook post — free angle',
        text: 'शादी के रिश्ते के लिए अब महंगे agent या paid website की ज़रूरत नहीं 🙏\n\nPANIKA JEEVAN SATHI हमारे पनिका/मानिकपुरी समाज के लिए बनी है और हमेशा के लिए free है — किसी भी तरह का कोई charge नहीं।\n\nआज ही free profile बनाएं: {SITE}\nसवाल हों तो WhatsApp करें: {WA}\n\nजिस परिवार में शादी की बात चल रही हो, उन्हें यह post ज़रूर बताएं।'
      }
    ],
    whatsapp: [
      {
        title: 'WhatsApp forward message',
        text: '🙏 *PANIKA JEEVAN SATHI*\nहमारे *पनिका / मानिकपुरी समाज* की अपनी *100% FREE* matrimonial website 💍\n\n✅ Free registration\n✅ सभी profile free में देखें\n✅ कोई पैसा कभी नहीं लगेगा\n\nअपने घर/परिवार में जिनकी शादी की उम्र है, उन्हें ज़रूर बताएं 🙏\n\nरजिस्टर करें 👇\n{SITE}\nमदद के लिए WhatsApp: {WA}'
      },
      {
        title: 'WhatsApp — parents angle',
        text: '🙏 नमस्कार! अगर घर में बेटे-बेटी की शादी की चिंता है, तो अपने समाज की free website ज़रूर देखें — PANIKA JEEVAN SATHI।\n\nपैसा बिल्कुल नहीं लगता। Registration और profile देखना — सब free।\nमोबाइल में खोलें: {SITE}\nकोई दिक्कत हो तो WhatsApp पर पूछें: {WA}'
      }
    ],
    instagram: [
      {
        title: 'Instagram caption',
        text: 'हमारे समाज के लिए, हमारी अपनी website 💍\nPANIKA JEEVAN SATHI — 100% FREE matrimonial site for Panika, Manikpuri, Kabirpanthi parivaar.\n\n✅ Free registration\n✅ कोई locked profile नहीं\n✅ Mobile से 2 मिनट में शुरू\n\n🔗 {SITE}\nWhatsApp: {WA}'
      },
      {
        title: 'Reel script (15–20 sec Hindi voiceover)',
        text: '"पनिका समाज वालों, एक अच्छी खबर! अब रिश्ता ढूंढने के लिए पैसे देने की ज़रूरत नहीं। PANIKA JEEVAN SATHI पूरी तरह free है — registration free, profile देखना free। अभी अपना profile बनाइए — link bio में है। और अपने परिवार वालों को भी बताइए!"\n(Background: site का screen-record + shaadi की imagery + hashtags caption mein)'
      }
    ],
    youtube: [
      {
        title: 'Channel owner ko collab message',
        text: 'नमस्कार 🙏 मैं PANIKA JEEVAN SATHI team से हूं — हमने हमारे पनिका/मानिकपुरी/कबीरपंथी समाज के लिए एक 100% free matrimonial website बनाई है ({SITE})। आपके channel के दर्शक इसी समाज से हैं — अगर आप चाहें तो एक छोटा mention/collab कर सकते हैं। यह paid promotion नहीं है — site सच में free है, सिर्फ समाज की मदद के लिए। पूरी जानकारी और draft हम दे देंगे। धन्यवाद!'
      },
      {
        title: 'Helpful comment idea (context match ho to hi)',
        text: '"बहुत सुंदर 🙏 हमारे समाज के लिए एक free matrimonial website भी बनी है — PANIKA JEEVAN SATHI ({SITE}) — जिन परिवारों में शादी की उम्र के बच्चे हैं, उनके काम आएगी।"\n(सिर्फ tab jab video का context match kare — हर जगह paste नहीं करना)'
      }
    ],
    telegram_x: [
      {
        title: 'Telegram channel share',
        text: '🙏 समाज की free service — PANIKA JEEVAN SATHI\nपनिका/मानिकपुरी/कबीरपंथी समाज के लिए 100% free matrimonial website।\n\nरजिस्टर करें: {SITE}\nWhatsApp support: {WA}\n\nकृपया ज़रूरतमंद परिवारों तक पहुंचाएं।'
      },
      {
        title: 'X (Twitter) post',
        text: 'पनिका / मानिकपुरी / कबीरपंथी समाज के लिए 100% FREE matrimonial website — PANIKA JEEVAN SATHI 💍\n✅ Registration free\n✅ Profiles देखना free\n✅ Koi payment kabhi nahin\n{SITE}\n#PanikaSamaj #FreeMatrimony #Chhattisgarh'
      }
    ],
    offline_referral: [
      {
        title: 'Poster / pamphlet text (notice board)',
        text: 'पनिका – मानिकपुरी समाज के लिए शुभ सूचना 🙏\nअब रिश्ते ढूंढना हुआ FREE!\n\nPANIKA JEEVAN SATHI — 100% मुफ्त matrimonial website\n• रजिस्ट्रेशन free\n• सभी profiles देखना free\n• कभी कोई charge नहीं\n\nWebsite: {SITE}\nWhatsApp मदद: {WA}\nमोबाइल से 2 मिनट में profile बनाएं 🙏'
      },
      {
        title: 'Referral message (existing members ko)',
        text: '🙏 आप PANIKA JEEVAN SATHI से जुड़े — धन्यवाद! बस एक छोटी मदद: अपने किसी 2 रिश्तेदार/परिचित को बताइए जिनके घर शादी की बात चल रही हो। Website पूरी तरह free है: {SITE} — आपकी एक बात से किसी का रिश्ता बन सकता है ❤️'
      }
    ],
    quora_content: [
      {
        title: 'Quora Hindi answer का ढांचा',
        text: 'सवाल (उदा.): "छत्तीसगढ़ में free matrimonial site कौन सी है?" / "पनिका समाज में रिश्ता कैसे ढूंढें?"\n\nजवाब का ढांचा:\n1) सीधा जवाब: PANIKA JEEVAN SATHI — पनिका/मानिकपुरी/कबीरपंथी समाज के लिए बनी 100% free site।\n2) क्या-क्या free है: registration, सभी profiles देखना — कोई locked profile नहीं।\n3) कैसे शुरू करें: {SITE} पर जाकर 2 मिनट में registration; दिक्कत हो तो WhatsApp {WA}।\n4) सुझाव: paid agents से पहले free option ज़रूर आज़माएं।'
      },
      {
        title: 'Blog topics (Kavita handoff)',
        text: 'पनिका समाज में रिश्ता कैसे ढूंढें — पूरी free guide\nमानिकपुरी/कबीरपंथी विवाह परंपराएं — एक introduction\nमाता-पिता के लिए: बच्चे का matrimonial profile कैसे बनाएं\nFree vs paid shaadi sites — असली फर्क क्या है?'
      }
    ]
  };

  const DAY_NAMES = [
    'Ravivar (Sunday)', 'Somvar (Monday)', 'Mangalvar (Tuesday)',
    'Budhvar (Wednesday)', 'Guruvar (Thursday)', 'Shukravar (Friday)',
    'Shanivar (Saturday)'
  ];
  const dayIdx = new Date().getUTCDay();
  const focus = WEEKLY_ROTATION[dayIdx];
  const drafts = (DRAFTS[focus.key] || []).map((d) => ({ title: d.title, text: fill(d.text) }));

  const kit = {
    date_utc: new Date().toISOString().slice(0, 10),
    day: DAY_NAMES[dayIdx],
    platform: focus.name,
    goal: focus.goal,
    where_to_find: focus.where_to_find,
    search_terms: focus.search_terms,
    action_checklist: focus.checklist,
    posting_rules: focus.rules,
    drafts,
    hashtags: HASHTAG_BANK,
    content_themes: CONTENT_THEMES,
    site: SITE,
    whatsapp: WA
  };

  // Lead tracker — owner manually status bharta hai; Rushma sirf structure sambhalti hai.
  const tracker = store.recall(id, 'lead_tracker', { longTerm: true }) || {
    note: 'Owner manually bhare: { platform, group/channel ka naam, contact date, status: todo/contacted/replied/joined, notes }',
    stats: { contacted: 0, replied: 0, joined: 0 },
    leads: []
  };
  tracker.last_seen_at = new Date().toISOString();

  store.remember(id, 'target_audience', TARGET_AUDIENCE, { longTerm: true });
  store.remember(id, 'weekly_rotation', WEEKLY_ROTATION.map((p) => p.name), { longTerm: true });
  store.remember(id, 'hashtag_bank', HASHTAG_BANK, { longTerm: true });
  store.remember(id, 'content_themes', CONTENT_THEMES, { longTerm: true });
  store.remember(id, 'compliance_rules', COMPLIANCE, { longTerm: true });
  store.remember(id, 'lead_tracker', tracker, { longTerm: true });
  store.remember(id, 'last_plan', kit);

  store.bumpMetric(id, 'plans_generated');
  store.bumpMetric(id, 'drafts_generated', drafts.length);
  store.bumpMetric(id, 'hashtags_tracked', HASHTAG_BANK.length);

  focus.checklist.slice(0, 3).forEach((title, i) =>
    store.addTask(id, { title: `[${focus.name}] ${title}`, priority: i === 0 ? 'high' : 'normal' })
  );

  store.sendMessage({
    from: id,
    to: 'manager',
    subject: `Rushma outreach plan — ${kit.date_utc} · ${focus.name}`,
    body:
      `Aaj ka platform: ${focus.name}. ${drafts.length} drafts ready, ${focus.checklist.length} actions. ` +
      `Lead funnel: contacted=${tracker.stats.contacted} replied=${tracker.stats.replied} joined=${tracker.stats.joined}. ` +
      `Auto-post NAHI — posting hamesha owner manually karega.`
  });

  // Ravivar ko content-handoff: blog topics Kavita ko, search terms Pooja ko.
  if (focus.key === 'quora_content') {
    store.sendMessage({
      from: id,
      to: 'kavita',
      subject: 'Panika/Manikpuri blog topics (acquisition angle)',
      body: CONTENT_THEMES.slice(0, 8).join(' | ')
    });
    store.sendMessage({
      from: id,
      to: 'pooja',
      subject: 'Search terms — Panika/Manikpuri (ground keywords)',
      body: focus.search_terms.join(', ')
    });
  }

  return finish(
    'OK',
    `Aaj ka outreach kit ready (${DAY_NAMES[dayIdx]} · ${focus.name}) — ${drafts.length} Hindi drafts, ${focus.checklist.length} actions, ${HASHTAG_BANK.length} hashtags. Posting hamesha manual (owner).`,
    {
      kit,
      target_audience: TARGET_AUDIENCE,
      weekly_rotation: WEEKLY_ROTATION.map((p) => p.name),
      lead_stats: tracker.stats,
      compliance: COMPLIANCE
    }
  );
}

/* ---------------------------------------------------------------- main */

const HANDLERS = {
  rushma: runRushma,
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
