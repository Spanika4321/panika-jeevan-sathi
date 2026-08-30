import { execFileSync } from 'node:child_process';

const worker = process.argv[2];

if (!['pooja', 'priya'].includes(worker)) {
  console.error('Usage: node scripts/worker-recovery.mjs pooja|priya');
  process.exit(1);
}

console.log(`=== RECOVERY START: ${worker.toUpperCase()} ===`);

try {
  execFileSync(
    process.execPath,
    ['scripts/recovery-clone.mjs', worker],
    { stdio: 'inherit' }
  );
} catch {
  console.error('Recovery clone creation failed.');
  process.exit(1);
}

console.log('=== RECOVERY POLICY ===');
console.log('1. Clone is isolated.');
console.log('2. Clone cannot access private messages.');
console.log('3. Clone cannot read passwords.');
console.log('4. Clone cannot publish to Facebook.');
console.log('5. Clone cannot create backlinks automatically.');
console.log('6. Clone cannot deploy production automatically.');
console.log('7. Guardian must verify any repair.');

console.log('=== RECOVERY COMPLETE ===');
