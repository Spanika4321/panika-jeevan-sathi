import { execFileSync } from 'node:child_process';
import { CONFIG, now, writeReport, persistRun } from './lib.mjs';

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

const guardianStatus = guardian.status === 'NOT_RUN' ? 'BLOCKED' : guardian.status;

// Guardian (Sardar) ka result bhi permanent storage mein record karo.
persistRun('guardian', {
  status: guardianStatus,
  summary:
    guardian.status === 'NOT_RUN'
      ? 'Guardian health check did not execute in this cycle.'
      : 'Guardian health check executed via the manager cycle.',
  details: { runs: { pooja: pooja.status, priya: priya.status } }
});

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
  JSON.stringify(report, null, 2) + '\n'
);

console.log(JSON.stringify(report, null, 2));

// Manager ka apna run bhi storage mein record.
persistRun('manager', {
  status:
    pooja.status === 'FAIL' || priya.status === 'FAIL' || guardian.status === 'FAIL'
      ? 'FAIL'
      : 'OK',
  summary: `pooja=${pooja.status} priya=${priya.status} guardian=${guardian.status}`,
  details: { production_deploy: report.production_deploy }
});

if (pooja.status === 'FAIL' ||
    priya.status === 'FAIL' ||
    guardian.status === 'FAIL') {
  process.exitCode = 1;
}
