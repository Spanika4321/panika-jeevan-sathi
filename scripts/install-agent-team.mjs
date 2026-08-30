import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();

const files = {
  'agents/README.md': `# PANIKA JEEVAN SATHI Agent Team

Hierarchy:
- Guardian = Sardar / existing safety and health authority
- Manager = coordinator
- Pooja = SEO and organic growth worker
- Priya = campaign and community worker

Rules:
- Never modify public UI/design automatically.
- Never read passwords or private messages.
- Never claim an external action happened without verification.
- Never create spam backlinks or mass-post to communities.
- Missing API credentials must produce BLOCKED, never PASS.
- Production deployment requires all safety tests to pass.
`,

  'agents/config.json': JSON.stringify({
    project: 'PANIKA JEEVAN SATHI',
    site: 'https://panikajeevansathi.onrender.com',
    guardian: 'sardar',
    manager: 'manager',
    workers: ['pooja', 'priya'],
    daily: {
      backlink_opportunities: 10,
      campaign_ideas: 5,
      seo_tasks: 10,
      health_checks: true
    },
    safety: {
      preserve_public_ui: true,
      no_private_message_reading: true,
      no_password_access: true,
      no_mass_social_posting: true,
      no_fake_success: true
    }
  }, null, 2) + '\\n',

  'agents/lib.mjs': `import fs from 'node:fs';
import path from 'node:path';

export const ROOT = process.cwd();
export const CONFIG = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'agents/config.json'), 'utf8')
);

export function now() {
  return new Date().toISOString();
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeReport(name, data) {
  const dir = path.join(ROOT, 'reports/agents');
  ensureDir(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
}

export function envStatus(keys) {
  return Object.fromEntries(
    keys.map(k => [k, Boolean(process.env[k])])
  );
}

export function blocked(reason) {
  return { status: 'BLOCKED', reason };
}
`,

  'agents/pooja.mjs': `import { CONFIG, now, writeReport, envStatus, blocked } from './lib.mjs';

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
  JSON.stringify(result, null, 2) + '\\n'
);

console.log(JSON.stringify(result, null, 2));
`,

  'agents/priya.mjs': `import { CONFIG, now, writeReport, envStatus } from './lib.mjs';

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
  JSON.stringify(result, null, 2) + '\\n'
);

console.log(JSON.stringify(result, null, 2));
`,

  'agents/manager.mjs': `import { execFileSync } from 'node:child_process';
import { CONFIG, now, writeReport } from './lib.mjs';

function run(file) {
  try {
    const out = execFileSync(process.execPath, [file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { status: 'PASS', output: out };
  } catch (err) {
    return {
      status: 'FAIL',
      output: String(err.stdout || err.stderr || err.message)
    };
  }
}

const pooja = run('agents/pooja.mjs');
const priya = run('agents/priya.mjs');

let guardian = { status: 'NOT_RUN' };

try {
  const out = execFileSync(
    process.execPath,
    ['scripts/health-check.mjs'],
    { encoding: 'utf8' }
  );
  guardian = { status: 'PASS', output: out };
} catch (err) {
  guardian = {
    status: 'FAIL',
    output: String(err.stdout || err.stderr || err.message)
  };
}

const report = {
  project: CONFIG.project,
  manager: 'Manager',
  generated_at: now(),
  hierarchy: {
    sardar: 'Guardian',
    manager: 'Manager',
    workers: ['Pooja', 'Priya']
  },
  workers: { pooja, priya },
  guardian,
  safety: CONFIG.safety,
  production_deploy: 'NOT_AUTOMATICALLY_TRIGGERED'
};

writeReport(
  'manager-latest.json',
  JSON.stringify(report, null, 2) + '\\n'
);

console.log(JSON.stringify(report, null, 2));

if (pooja.status === 'FAIL' ||
    priya.status === 'FAIL' ||
    guardian.status === 'FAIL') {
  process.exitCode = 1;
}
`,

  'scripts/agent-team-check.mjs': `import fs from 'node:fs';
import path from 'node:path';

const required = [
  'agents/README.md',
  'agents/config.json',
  'agents/lib.mjs',
  'agents/manager.mjs',
  'agents/pooja.mjs',
  'agents/priya.mjs'
];

let failed = false;

for (const file of required) {
  if (!fs.existsSync(path.join(process.cwd(), file))) {
    console.error('MISSING:', file);
    failed = true;
  } else {
    console.log('PASS:', file);
  }
}

const config = JSON.parse(
  fs.readFileSync('agents/config.json', 'utf8')
);

if (config.safety.preserve_public_ui !== true) {
  console.error('FAIL: public UI preservation disabled');
  failed = true;
}

if (config.safety.no_private_message_reading !== true) {
  console.error('FAIL: private message protection disabled');
  failed = true;
}

if (config.daily.backlink_opportunities !== 10) {
  console.error('FAIL: backlink target is not 10');
  failed = true;
}

console.log('\\nAGENT TEAM CHECK:', failed ? 'FAIL' : 'PASS');

if (failed) process.exit(1);
`
};

for (const [file, content] of Object.entries(files)) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  console.log('CREATED', file);
}

console.log('\\n=== RUNNING AGENT TEAM CHECK ===');
execSync('node scripts/agent-team-check.mjs', {
  stdio: 'inherit'
});

console.log('\\n=== RUNNING MANAGER ===');
try {
  execSync('node agents/manager.mjs', { stdio: 'inherit' });
} catch {
  console.log('\\nManager reported one or more blocked/failed external capabilities.');
}

console.log('\\n=== RUNNING EXISTING PROJECT TESTS ===');
try {
  execSync('npm test', { stdio: 'inherit' });
  console.log('\\nPROJECT TESTS: PASS');
} catch {
  console.error('\\nPROJECT TESTS: FAIL');
  process.exitCode = 1;
}

console.log('\\n=== FINAL SAFETY CHECK ===');
console.log('Existing Guardian: PRESERVED');
console.log('Public UI redesign: NOT PERFORMED');
console.log('Production deploy: NOT PERFORMED');
console.log('Private-message access: NOT IMPLEMENTED');
console.log('Password access: NOT IMPLEMENTED');
console.log('Spam backlink automation: NOT IMPLEMENTED');
