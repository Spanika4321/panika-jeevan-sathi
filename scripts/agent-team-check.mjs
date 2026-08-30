import fs from 'node:fs';
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

console.log('\nAGENT TEAM CHECK:', failed ? 'FAIL' : 'PASS');

if (failed) process.exit(1);
