import { CONFIG, now, writeReport, envStatus, blocked } from './lib.mjs';

const result = {
  agent: 'Pooja',
  role: 'SEO / Organic Growth Worker',
  generated_at: now(),
  status: 'READY',
  tasks: [
    'Analyse indexability and technical SEO signals',
    'Review sitemap/robots/canonical configuration',
    'Identify relevant keyword opportunities',
    'Prepare 10 genuine backlink opportunities',
    'Reject irrelevant, paid, spam and duplicate backlink targets',
    'Prepare internal-link improvement suggestions',
    'Prepare search-content opportunities'
  ],
  external: {
    google: envStatus(['GOOGLE_SEARCH_CONSOLE_TOKEN']),
    gemini: envStatus(['GEMINI_API_KEY'])
  },
  policy: [
    'No automated spam links',
    'No fake backlinks',
    'No fake success status',
    'No production UI redesign'
  ]
};

if (!result.external.google.GOOGLE_SEARCH_CONSOLE_TOKEN &&
    !result.external.gemini.GEMINI_API_KEY) {
  result.status = 'BLOCKED';
  result.reason =
    'External Google/Gemini credentials are not configured. Local analysis remains available.';
}

writeReport(
  'pooja-latest.json',
  JSON.stringify(result, null, 2) + '\n'
);

console.log(JSON.stringify(result, null, 2));
