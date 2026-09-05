#!/usr/bin/env node
/**
 * Syntax gate — every shipped JS file, plus every inline <script> and JSON-LD
 * block in the public HTML. Runs in CI before the test suite so a typo fails
 * fast with a clear message.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seva-syntax-'));
let checked = 0;
let broken = 0;

function checkFile(label, file) {
  checked += 1;
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    broken += 1;
    console.log(`  x ${label}`);
    console.log(String(error.stderr || error.message).split('\n').slice(0, 6).join('\n'));
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) checkFile(path.relative(ROOT, file), file);
  }
}

try {
  checkFile('server.js', path.join(ROOT, 'server.js'));
  for (const dir of ['lib', 'scripts', 'tests', 'public/assets/js']) walk(path.join(ROOT, dir));

  for (const file of fs.readdirSync(PUBLIC).filter((name) => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    blocks.forEach((match, index) => {
      const attrs = match[1];
      const code = match[2];
      if (/\bsrc\s*=/i.test(attrs) || !code.trim()) return;
      const label = `${file} <script #${index + 1}>`;
      if (/type\s*=\s*["']application\/(?:ld\+)?json["']/i.test(attrs)) {
        checked += 1;
        try {
          JSON.parse(code);
        } catch (error) {
          broken += 1;
          console.log(`  x ${label} (invalid JSON)\n${error.message}`);
        }
        return;
      }
      const script = path.join(tmp, `inline-${checked}.mjs`);
      fs.writeFileSync(script, code);
      checkFile(label, script);
    });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`  ${checked} checked, ${broken} with syntax errors`);
process.exitCode = broken ? 1 : 0;
