import { CONFIG, now, writeReport, envStatus } from './lib.mjs';

const result = {
  agent: 'Priya',
  role: 'Campaign / Community Growth Worker',
  generated_at: now(),
  status: 'READY',
  tasks: [
    'Prepare community campaign ideas',
    'Prepare Facebook-safe campaign drafts',
    'Identify audience themes without scraping private data',
    'Prepare daily content calendar',
    'Analyse aggregate growth signals',
    'Prepare referral and engagement ideas',
    'Track campaign outcomes when analytics are available'
  ],
  external: {
    meta: envStatus(['META_ACCESS_TOKEN', 'META_PAGE_ID']),
    gemini: envStatus(['GEMINI_API_KEY'])
  },
  policy: [
    'No unsolicited mass posting',
    'No private-user surveillance',
    'No scraping private Facebook groups',
    'No fake engagement',
    'No production UI redesign'
  ]
};

if (!result.external.meta.META_ACCESS_TOKEN ||
    !result.external.meta.META_PAGE_ID) {
  result.status = 'BLOCKED';
  result.reason =
    'Meta publishing credentials are not configured. Campaign drafting remains available.';
}

writeReport(
  'priya-latest.json',
  JSON.stringify(result, null, 2) + '\n'
);

console.log(JSON.stringify(result, null, 2));
