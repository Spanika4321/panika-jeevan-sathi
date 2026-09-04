#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — AI Agent Roster
 * =====================================
 *
 * Poore system ke saare AI agents ki ek hi jagah definition. Har agent ko
 * `storage/agents/<id>/` ke andar apni permanent storage milti hai
 * (state, memory, tasks, log, metrics, inbox, outbox).
 *
 * Hierarchy (kabhi nahi badalti):
 *   Guardian (Sardar)  → sabse upar, safety + health authority
 *   Manager            → coordinator, workers ko task deta hai
 *   Workers            → kaam karte hain, report dete hain
 *
 * Hard rules (har agent par lago):
 *   - Public UI/Design automatically change nahi hota.
 *   - Password / private message kabhi nahi padha jaata.
 *   - Bina verified proof ke "ho gaya" nahi kaha jaata.
 *   - Missing credentials => PASS nahi, BLOCKED.
 *   - Production deploy / git push / social posting automatic nahi.
 */

export const HIERARCHY = {
  sardar: 'guardian',
  manager: 'manager',
  workers: [
    'pooja',
    'priya',
    'rushma',
    'arjun',
    'kavita',
    'rahul',
    'sneha',
    'amit',
    'nisha',
    'vikram',
    'meera'
  ]
};

export const SAFETY = {
  preserve_public_ui: true,
  no_private_message_reading: true,
  no_password_access: true,
  no_mass_social_posting: true,
  no_fake_success: true,
  no_automatic_production_deploy: true,
  no_automatic_git_push: true
};

/**
 * Har entry:
 *   requires      → env keys jinke bina agent BLOCKED report karega
 *   capabilities  → jo agent *local* taur par kar sakta hai (bina external API)
 *   cadence       → kitni baar chalta hai (GitHub Actions cron se match)
 */
export const AGENTS = [
  {
    id: 'guardian',
    name: 'Guardian (Sardar)',
    role: 'Safety & Health Authority',
    reports_to: 'owner',
    cadence: 'daily 03:30 UTC + every push',
    workflow: 'guardian.yml',
    capabilities: [
      'Full site health check (95 checks)',
      'Syntax + end-to-end test suite',
      'Design lock verification (approved UI unchanged)',
      'Security header verification',
      'robots.txt / sitemap.xml verification'
    ],
    requires: [],
    priority: 'critical'
  },
  {
    id: 'manager',
    name: 'Manager',
    role: 'Coordinator',
    reports_to: 'guardian',
    cadence: 'daily 04:00 UTC',
    workflow: 'manager.yml',
    capabilities: [
      'Runs Pooja + Priya + Guardian in one cycle',
      'Collects worker reports into one manager report',
      'Assigns tasks through the shared job queue',
      'Escalates failures to the incident register'
    ],
    requires: [],
    priority: 'high'
  },
  {
    id: 'pooja',
    name: 'Pooja',
    role: 'SEO / Organic Growth Worker',
    reports_to: 'manager',
    cadence: 'daily 04:30 UTC',
    workflow: 'pooja.yml',
    capabilities: [
      'Indexability + technical SEO analysis',
      'sitemap/robots/canonical review',
      'Keyword opportunity research (local, no paid API)',
      '10 genuine backlink opportunity drafts per day',
      'Rejects paid / spam / duplicate link targets'
    ],
    requires: ['GOOGLE_SEARCH_CONSOLE_TOKEN', 'GEMINI_API_KEY'],
    priority: 'high'
  },
  {
    id: 'priya',
    name: 'Priya',
    role: 'Campaign / Community Growth Worker',
    reports_to: 'manager',
    cadence: 'daily 05:00 UTC',
    workflow: 'priya.yml',
    capabilities: [
      'Community campaign ideas',
      'Facebook-safe campaign drafts',
      'Audience themes from aggregate signals only',
      'Daily content calendar',
      'Referral & engagement ideas'
    ],
    requires: ['META_ACCESS_TOKEN', 'META_PAGE_ID'],
    priority: 'high'
  },
  {
    id: 'rushma',
    name: 'Rushma',
    role: 'User Acquisition & Outreach Planner',
    reports_to: 'manager',
    cadence: 'daily 05:45 UTC (aur har 6-ghante ke agent cycle mein)',
    workflow: 'rushma.yml (ops/) + agent-storage.yml',
    capabilities: [
      'Panika surname + Manikpuri/Kabirpanthi/Adivasi community targeting',
      '7-din platform rotation: Facebook, WhatsApp, Instagram, YouTube, Telegram, X, Quora + offline samaj',
      'Daily ready-to-copy outreach kit: Hindi drafts + hashtags + search terms + action checklist',
      'Lead tracker maintenance (owner manually status bharta hai)',
      'Referral loop ideas — har member 2 rishtedaron ko bataye',
      'Sunday content-handoff to Kavita/Pooja (blog + Quora topics)',
      'KABHI auto-post nahi karti — posting hamesha owner manually karta hai'
    ],
    requires: [],
    priority: 'high'
  },
  {
    id: 'aman',
    name: 'Aman',
    role: 'Daily Site & Member Report Agent',
    reports_to: 'owner',
    cadence: 'daily 13:05 UTC (18:35 IST)',
    workflow: 'aman.yml',
    capabilities: [
      'Fetches live aggregate visitor + member analytics from the site',
      'Writes the owner ka daily Hindi/Hinglish report (visitors, visits, naye + total members)',
      'Emails the daily report to the owner (RESEND_API_KEY)',
      'Tracks 7/14-din trends from stored history',
      'Snapshots site health (/api/health) alongside the numbers',
      'Koi raw IP / private member data kabhi nahi padhta ya bhejta'
    ],
    requires: ['RESEND_API_KEY'],
    priority: 'high'
  },
  {
    id: 'arjun',
    name: 'Arjun',
    role: 'Backlink & Directory Research Worker',
    reports_to: 'manager',
    cadence: 'daily 05:30 UTC',
    workflow: 'agent-storage.yml',
    capabilities: [
      'Maintains a curated, hand-verified target list',
      'Flags spam / paid / link-farm candidates for rejection',
      'Tracks outreach status per target (never auto-mails)'
    ],
    requires: [],
    priority: 'normal'
  },
  {
    id: 'kavita',
    name: 'Kavita',
    role: 'Content & Blog Drafting Worker',
    reports_to: 'manager',
    cadence: 'daily 06:00 UTC',
    workflow: 'agent-storage.yml',
    capabilities: [
      'Drafts matrimonial/community articles (Hindi + English)',
      'Suggests internal links between existing pages',
      'Keeps a topic backlog in agent memory'
    ],
    requires: [],
    priority: 'normal'
  },
  {
    id: 'rahul',
    name: 'Rahul',
    role: 'Uptime & Performance Worker',
    reports_to: 'guardian',
    cadence: 'every 6 hours',
    workflow: 'agent-storage.yml',
    capabilities: [
      'Records site reachability samples into metrics',
      'Tracks response-time trend from stored history',
      'Opens an incident when failures repeat'
    ],
    requires: ['SITE_URL'],
    priority: 'high'
  },
  {
    id: 'sneha',
    name: 'Sneha',
    role: 'Security & Compliance Worker',
    reports_to: 'guardian',
    cadence: 'daily 06:30 UTC',
    workflow: 'agent-storage.yml',
    capabilities: [
      'Checks noindex on private pages',
      'Verifies security headers on every response',
      'Verifies no secrets are committed to the repo'
    ],
    requires: [],
    priority: 'critical'
  },
  {
    id: 'amit',
    name: 'Amit',
    role: 'Profile Quality & Match Data Worker',
    reports_to: 'manager',
    cadence: 'daily 07:00 UTC',
    workflow: 'agent-storage.yml',
    capabilities: [
      'Aggregate, anonymised profile completeness stats',
      'Suggests match-quality improvements',
      'Never reads private messages or passwords'
    ],
    requires: [],
    priority: 'normal'
  },
  {
    id: 'nisha',
    name: 'Nisha',
    role: 'Support & FAQ Knowledge Worker',
    reports_to: 'manager',
    cadence: 'daily 07:30 UTC',
    workflow: 'agent-storage.yml',
    capabilities: [
      'Builds the shared FAQ knowledge base',
      'Summarises recurring support themes (aggregate only)',
      'Drafts help-centre articles'
    ],
    requires: [],
    priority: 'normal'
  },
  {
    id: 'vikram',
    name: 'Vikram',
    role: 'Analytics & Reporting Worker',
    reports_to: 'manager',
    cadence: 'daily 08:00 UTC',
    workflow: 'agent-storage.yml',
    capabilities: [
      'Rolls up all agent metrics into one daily scorecard',
      'Computes streaks, failure rates, queue throughput',
      'Writes the human-readable Hindi/Hinglish report'
    ],
    requires: [],
    priority: 'normal'
  },
  {
    id: 'meera',
    name: 'Meera',
    role: 'Email & Notification Composer',
    reports_to: 'manager',
    cadence: 'every 10 minutes (with employee cycle)',
    workflow: 'employee-report.yml',
    capabilities: [
      'Composes the owner email from verified step outcomes',
      'Never marks a step PASS unless the command really passed'
    ],
    requires: ['RESEND_API_KEY'],
    priority: 'high'
  }
];

export function agentById(id) {
  return AGENTS.find((a) => a.id === String(id || '').toLowerCase()) || null;
}

export function workerIds() {
  return HIERARCHY.workers.slice();
}

export function missingRequirements(agent) {
  return (agent.requires || []).filter((key) => !process.env[key]);
}

export default { HIERARCHY, SAFETY, AGENTS, agentById, workerIds, missingRequirements };
