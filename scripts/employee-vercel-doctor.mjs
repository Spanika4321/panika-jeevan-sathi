import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const run = (cmd, args = []) => {
  try {
    return {
      ok: true,
      out: execFileSync(cmd, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    };
  } catch (e) {
    return {
      ok: false,
      out: String(e.stdout || e.stderr || e.message || '')
    };
  }
};

console.log('==============================================');
console.log(' PANIKA JEEVAN SATHI — EMPLOYEE VERCEL DOCTOR');
console.log('==============================================');

const report = {
  time: new Date().toISOString(),
  github: {},
  vercel: {},
  diagnosis: [],
  actions: [],
  final: 'NEEDS_REVIEW'
};

console.log('\n1. GITHUB CHECK');
const git = run('git', ['status', '--short']);
report.github.status = git.ok ? 'PASS' : 'FAIL';

const branch = run('git', ['branch', '--show-current']);
report.github.branch = branch.out.trim();

const remote = run('git', ['remote', '-v']);
report.github.remote = remote.out.trim();

console.log(`Git status: ${report.github.status}`);
console.log(`Branch: ${report.github.branch}`);

console.log('\n2. PROJECT TEST');
const tests = run('npm', ['test']);
report.github.tests = tests.ok ? 'PASS' : 'FAIL';
console.log(`Website tests: ${report.github.tests}`);

console.log('\n3. VERCEL CLI CHECK');

const vercelVersion = run('vercel', ['--version']);

if (!vercelVersion.ok) {
  report.vercel.cli = 'NOT_INSTALLED';
  report.diagnosis.push(
    'Vercel CLI उपलब्ध नहीं है। Termux fallback mode इस्तेमाल होगा।'
  );
  console.log('Vercel CLI: NOT INSTALLED');
} else {
  report.vercel.cli = 'AVAILABLE';
  console.log(`Vercel CLI: ${vercelVersion.out.trim()}`);

  const list = run('vercel', ['ls']);

  if (list.ok) {
    report.vercel.projects = list.out.trim();
    console.log('Vercel project listing: AVAILABLE');

    if (
      list.out.toLowerCase().includes('panika-jeevan-sathi') ||
      list.out.toLowerCase().includes('panika')
    ) {
      report.vercel.project_found = true;
      console.log('Vercel project: FOUND');
    } else {
      report.vercel.project_found = false;
      report.diagnosis.push(
        'Connected Vercel account में PANIKA JEEVAN SATHI project नहीं मिला।'
      );
      console.log('Vercel project: NOT FOUND');
    }
  } else {
    report.vercel.project_found = false;
    report.diagnosis.push(
      'Vercel project listing access नहीं मिला।'
    );
    console.log('Vercel project listing: BLOCKED');
  }
}

console.log('\n4. POoja — DOCTOR DIAGNOSIS');

if (report.github.tests === 'FAIL') {
  report.actions.push(
    'Pooja: local test failure को diagnose करना है।'
  );
  console.log('Pooja: LOCAL TEST FAILURE DETECTED');
} else if (report.vercel.project_found === false) {
  report.actions.push(
    'Pooja: Vercel access/project mapping समस्या की diagnosis करे।'
  );
  console.log('Pooja: VERCEL ACCESS/MAPPING ISSUE');
} else {
  report.actions.push(
    'Pooja: Vercel deployment/build logs inspect करे।'
  );
  console.log('Pooja: VERCEL LOG DIAGNOSIS');
}

console.log('\n5. PRIYA — REPORTING');

report.actions.push(
  'Priya: Hindi report तैयार करे और वास्तविक PASS/FAIL status ही लिखे।'
);

console.log('Priya: REPORTING READY');

console.log('\n6. MANAGER — DECISION');

if (report.github.tests === 'FAIL') {
  report.final = 'REPAIR_REQUIRED';
  console.log('Manager: LOCAL REPAIR REQUIRED');
} else if (report.vercel.project_found === false) {
  report.final = 'VERCEL_ACCESS_REQUIRED';
  console.log('Manager: VERCEL ACCESS REQUIRED');
} else {
  report.final = 'VERCEL_LOG_CHECK_REQUIRED';
  console.log('Manager: VERCEL LOG CHECK REQUIRED');
}

fs.mkdirSync('reports/agents', { recursive: true });

fs.writeFileSync(
  'reports/agents/vercel-doctor-latest.json',
  JSON.stringify(report, null, 2) + '\n'
);

console.log('\n==============================================');
console.log(`FINAL STATUS: ${report.final}`);
console.log('REAL STATUS ONLY — NO FAKE PASS');
console.log('REPORT: reports/agents/vercel-doctor-latest.json');
console.log('==============================================');
