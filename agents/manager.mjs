import { execFileSync } from 'node:child_process';
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
  JSON.stringify(report, null, 2) + '\n'
);

console.log(JSON.stringify(report, null, 2));

if (pooja.status === 'FAIL' ||
    priya.status === 'FAIL' ||
    guardian.status === 'FAIL') {
  process.exitCode = 1;
}
