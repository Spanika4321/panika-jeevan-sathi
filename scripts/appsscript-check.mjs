#!/usr/bin/env node
/** apps-script/ folder ki syntax + manifest validate karta hai (deploy se pehle). */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps-script');
let failed = 0;

const files = fs.readdirSync(SRC);
if (!files.includes('Code.gs')) {
  console.error('  ✖ apps-script/Code.gs missing');
  process.exit(1);
}

for (const file of files) {
  const full = path.join(SRC, file);
  const text = fs.readFileSync(full, 'utf8');
  if (file.endsWith('.gs')) {
    try {
      new vm.Script(text, { filename: file });
      console.log(`  ✓ ${file} — syntax OK`);
    } catch (err) {
      console.error(`  ✖ ${file} — ${err.message}`);
      failed += 1;
    }
    if (file === 'Code.gs') {
      for (const fn of ['doGet', 'doPost']) {
        if (!new RegExp(`function\\s+${fn}\\s*\\(`).test(text)) {
          console.error(`  ✖ Code.gs — ${fn}() missing (web app kaam nahi karega)`);
          failed += 1;
        }
      }
    }
  } else if (file === 'appsscript.json') {
    try {
      const manifest = JSON.parse(text);
      if (!manifest.webapp) {
        console.error('  ✖ appsscript.json — "webapp" section missing');
        failed += 1;
      } else {
        console.log('  ✓ appsscript.json — manifest OK');
      }
    } catch (err) {
      console.error(`  ✖ appsscript.json — ${err.message}`);
      failed += 1;
    }
  }
}

if (failed) {
  console.error(`\n  ${failed} problem(s) — deploy roka gaya.\n`);
  process.exit(1);
}
console.log('\n  Sab theek hai — deploy safe hai.\n');
