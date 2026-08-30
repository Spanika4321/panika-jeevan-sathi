import fs from 'node:fs';
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
