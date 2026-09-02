#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — run the real site in SUPABASE MODE locally.
 *
 * If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are already in the environment,
 * the app talks to that real Supabase project.
 *
 * Otherwise this starts the bundled PostgREST + Storage compatible server
 * (scripts/lib/mock-supabase.mjs, backed by a real SQLite file + object dir
 * OUTSIDE the app data dir) so the site runs on the exact same Supabase code
 * path — remote DB, remote photos, durable=true — with no account needed.
 *
 *   node scripts/supabase-dev.mjs            # port 3000
 *   PORT=8080 node scripts/supabase-dev.mjs
 */

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSupabaseMock } from './lib/mock-supabase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || '3000';

let url = String(process.env.SUPABASE_URL || '').trim();
let key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const bucket = String(process.env.SUPABASE_STORAGE_BUCKET || 'uploads').trim();
let mock = null;

if (url && key) {
  console.log(`\n  Supabase: REAL project → ${url}\n`);
} else {
  const storeDir = path.join(root, '.supabase-local');
  fs.mkdirSync(path.join(storeDir, 'objects'), { recursive: true });
  mock = createSupabaseMock({
    file: path.join(storeDir, 'supabase.sqlite'),
    objectsDir: path.join(storeDir, 'objects'),
    token: 'local-service-role'
  });
  url = await mock.listen();
  key = mock.token;
  console.log('\n  Supabase: LOCAL PostgREST/Storage compatible server');
  console.log(`  endpoint : ${url}`);
  console.log(`  database : ${path.join(storeDir, 'supabase.sqlite')}`);
  console.log(`  objects  : ${path.join(storeDir, 'objects')}`);
  console.log('  (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to use a real project)\n');
}

const app = spawn(process.execPath, [path.join(root, 'server.js')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT,
    HOST: process.env.HOST || '0.0.0.0',
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: key,
    SUPABASE_STORAGE_BUCKET: bucket
  }
});

function shutdown(signal) {
  try {
    app.kill(signal);
  } catch (_) {
    /* ignore */
  }
  if (mock) mock.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
app.on('exit', (code) => {
  if (mock) mock.close();
  process.exit(code || 0);
});
