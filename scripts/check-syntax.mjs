#!/usr/bin/env node
/** Check every shipped JS/CJS/MJS file, inline browser script and JSON-LD block. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-syntax-'));
let checked = 0;
let broken = 0;

function checkFile(label, file) {
  checked++;
  try {
    // Preserve the original module type; CommonJS source is not an ES module.
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    broken++;
    console.log(`  ✗ ${label}`);
    console.log(String(err.stderr || err.message).split('\n').slice(0, 6).join('\n'));
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
  for (const dir of ['lib', 'agents', 'scripts', 'public/assets/js']) walk(path.join(ROOT, dir));

  for (const file of fs.readdirSync(PUBLIC).filter((name) => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    blocks.forEach(([_, attrs, code], index) => {
      if (/\bsrc\s*=/i.test(attrs) || !code.trim()) return;
      const label = `${file} <script #${index + 1}>`;
      if (/type\s*=\s*["']application\/(?:ld\+)?json["']/i.test(attrs)) {
        checked++;
        try {
          JSON.parse(code);
        } catch (err) {
          broken++;
          console.log(`  ✗ ${label} (invalid JSON)\n${err.message}`);
        }
      } else {
        const extension = /type\s*=\s*["']module["']/i.test(attrs) ? 'mjs' : 'js';
        const script = path.join(tmp, `inline-${checked}.${extension}`);
        fs.writeFileSync(script, code);
        checkFile(label, script);
      }
    });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`  ${checked} checked, ${broken} with syntax errors`);
process.exitCode = broken ? 1 : 0;
