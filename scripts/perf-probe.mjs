#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — scalability probe (guardian agent).
 *
 * Seeds a TEMPORARY database with N synthetic members (fake data, never
 * touches the real data folder) and measures the latency of the two heaviest
 * member-facing endpoints:
 *
 *   GET /api/profiles  — search results (filters, scoring, cards)
 *   GET /api/matches   — recommended matches
 *
 * Used by the weekly scalability review to detect N+1-query regressions and
 * bottlenecks before they become user-facing problems.
 *
 *   node scripts/perf-probe.mjs [members]   (default: 300)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbLib = require(path.join(ROOT, 'lib/db.js'));
const authLib = require(path.join(ROOT, 'lib/auth.js'));

const MEMBERS = Math.max(50, Math.min(2000, Number(process.argv[2]) || 300));
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-perf-'));
const PORT = 3600 + Math.floor(Math.random() * 400);
const SECRET = 'perf-probe-secret-0123456789abcdef';
const BASE = `http://127.0.0.1:${PORT}`;

/* --------------------------------------------------------------- seeding */

const { driver } = dbLib.open(DATA_DIR);
const now = Date.now();
const passwordHash = authLib.hashPassword('ProbePass123!');

function insertMember(i, viewer) {
  const user = driver.insert('users', {
    email: viewer ? 'viewer@probe.example' : `probe${i}@probe.example`,
    password_hash: passwordHash,
    name: viewer ? 'Probe Viewer' : `Probe Member ${i}`,
    role: 'user',
    status: 'active',
    email_verified: 1,
    verification_token: null,
    reset_token: null,
    reset_expires: 0,
    token_version: 1,
    photo: null,
    last_login: now,
    created_at: now - i * 60000
  });
  driver.insert('profiles', {
    user_id: user.id,
    headline: 'Looking for a life partner',
    age: 21 + (i % 30),
    gender: i % 2 ? 'Female' : 'Male',
    height_cm: 150 + (i % 40),
    marital_status: 'Never Married',
    religion: 'Hindu',
    community: 'Panika',
    city: 'Raipur',
    state: 'Chhattisgarh',
    country: 'India',
    education: 'Graduate',
    occupation: i % 2 ? 'Teacher' : 'Engineer',
    visibility: 'members',
    hide_photo: 1,
    hide_contact: 1,
    searchable: 1,
    profile_complete: 1,
    updated_at: now
  });
  return user;
}

let viewer = null;
for (let i = 0; i < MEMBERS; i += 1) {
  const u = insertMember(i, i === 0);
  if (i === 0) viewer = u;
}
// A realistic amount of activity: some interests + shortlist entries so the
// per-card lookups actually do work instead of short-circuiting.
for (let i = 1; i < MEMBERS; i += 1) {
  if (i % 7 === 0) {
    driver.insert('interests', {
      from_user_id: viewer.id,
      to_user_id: i,
      message: '',
      status: i % 21 === 0 ? 'accepted' : 'pending',
      created_at: now - i,
      responded_at: 0
    });
  }
  if (i % 11 === 0) {
    driver.insert('shortlist', { user_id: viewer.id, target_user_id: i, created_at: now - i });
  }
}
driver.close();

/* ---------------------------------------------------------------- server */

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), PJS_DATA_DIR: DATA_DIR, HOST: '127.0.0.1', SESSION_SECRET: SECRET },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let ready = false;
    const onData = (buf) => {
      if (!ready && String(buf).includes('is running')) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.on('exit', (code) => {
      if (!ready) reject(new Error(`server exited early with code ${code}`));
    });
    setTimeout(() => reject(new Error('server did not start within 20s')), 20000).unref();
  });
}

async function timedGet(pathname, cookie, runs) {
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = process.hrtime.bigint();
    const res = await fetch(BASE + pathname, { headers: { Cookie: cookie } });
    await res.text();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (res.status !== 200) throw new Error(`${pathname} → ${res.status}`);
    times.push(ms);
  }
  times.sort((a, b) => a - b);
  return {
    median: Math.round(times[Math.floor(times.length / 2)]),
    p95: Math.round(times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)]),
    max: Math.round(times[times.length - 1])
  };
}

const child = await startServer();
let summary = '';
try {
  const token = authLib.createSession(viewer.id, 1, SECRET);
  const cookie = `pjs_session=${encodeURIComponent(token)}`;

  // warm-up (first request pays JIT / cache costs)
  await timedGet('/api/health', cookie, 1);
  await timedGet('/api/profiles?per_page=12', cookie, 1);

  const search = await timedGet('/api/profiles?per_page=12', cookie, 8);
  const matches = await timedGet('/api/matches?limit=12', cookie, 5);

  summary = [
    `members=${MEMBERS}`,
    `search ms (median/p95/max)=${search.median}/${search.p95}/${search.max}`,
    `matches ms (median/p95/max)=${matches.median}/${matches.p95}/${matches.max}`
  ].join(' · ');
  console.log(`PERF ${summary}`);
} finally {
  child.kill('SIGTERM');
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}
