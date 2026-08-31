import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const worker = process.argv[2] || 'unknown';
const runId = process.env.GITHUB_RUN_ID || Date.now().toString();
const cloneDir = path.join(root, '.agent-recovery', `${worker}-${runId}`);

const allowedWorkers = new Set(['pooja', 'priya']);

if (!allowedWorkers.has(worker)) {
  console.error(`RECOVERY BLOCKED: unknown worker "${worker}"`);
  console.error(`Usage: node scripts/recovery-clone.mjs ${[...allowedWorkers].join('|')}`);
  process.exit(1);
}

if (fs.existsSync(cloneDir)) {
  console.error('RECOVERY BLOCKED: clone already exists for this run');
  process.exit(1);
}

fs.mkdirSync(cloneDir, { recursive: true });

// Clone ek *chalne layak* copy honi chahiye: agents + scripts ke saath server,
// lib aur public bhi. Pehle public/lib copy nahi hote the, isliye clone ke
// andar `node scripts/check-syntax.mjs` hamesha ENOENT se crash karta tha aur
// recovery kabhi complete nahi hoti thi.
const filesToCopy = [
  'agents',
  'scripts',
  'lib',
  'public',
  'server.js',
  'package.json',
  '.node-version'
];

for (const item of filesToCopy) {
  const src = path.join(root, item);
  const dst = path.join(cloneDir, item);

  if (!fs.existsSync(src)) continue;

  fs.cpSync(src, dst, {
    recursive: true,
    filter: p => {
      const rel = path.relative(root, p);
      return !rel.includes('node_modules') &&
             !rel.includes('.git') &&
             !rel.includes('.agent-recovery');
    }
  });
}

const report = {
  recovery_clone: true,
  worker,
  run_id: runId,
  created_at: new Date().toISOString(),
  purpose: 'isolated diagnosis and repair',
  production_deploy: false,
  automatic_git_push: false,
  automatic_external_posting: false
};

fs.writeFileSync(
  path.join(cloneDir, 'recovery-report.json'),
  JSON.stringify(report, null, 2) + '\n'
);

console.log('RECOVERY CLONE CREATED');
console.log(cloneDir);
console.log(JSON.stringify(report, null, 2));

try {
  execFileSync(process.execPath, ['scripts/check-syntax.mjs'], {
    cwd: cloneDir,
    stdio: 'inherit'
  });

  console.log('CLONE SYNTAX: PASS');
} catch {
  console.error('CLONE SYNTAX: FAIL');
  process.exit(1);
}
