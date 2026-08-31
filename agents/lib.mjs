import fs from 'node:fs';
import path from 'node:path';

import * as agentStore from './storage.mjs';

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

/**
 * Agent ke is run ko permanent storage mein record karta hai.
 *
 * Kabhi fail nahi karta: agar filesystem read-only ho (ya koi aur dikkat
 * aaye) to sirf warning print hoti hai — agent ka kaam chalta rehta hai.
 * Isse purane agents (Pooja / Priya / Manager) bhi storage-aware ho jaate
 * hain bina unki existing behaviour badle.
 */
export function persistRun(agentId, { status, summary = '', details = null } = {}) {
  // Jab agent cycle-runner ke andar chalta hai to runner khud record karta
  // hai (ek hi source of truth) — double counting avoid karne ke liye.
  if (process.env.PJS_CYCLE_MANAGED) return false;
  try {
    agentStore.ensureAgentStore(agentId);
    agentStore.recordRun(agentId, { status, summary, details });
    return true;
  } catch (err) {
    console.error(`[storage] persist skipped for ${agentId}: ${err.message}`);
    return false;
  }
}
