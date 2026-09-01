#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — MAUJUDA Google Apps Script project ko repo se update karo.
 *
 *   node scripts/appsscript-deploy.mjs            # push + naya version deploy
 *   node scripts/appsscript-deploy.mjs --dry-run  # sirf dikhao, kuch push mat karo
 *   node scripts/appsscript-deploy.mjs --no-deploy# sirf code push, version nahi
 *
 * Ye NAYA project nahi banata. Ye sirf GAS_SCRIPT_ID wale purane project ke
 * Code.gs / appsscript.json ko `apps-script/` folder se overwrite karta hai,
 * aur us project ki MAUJUDA web-app deployment ko naye version par point kar
 * deta hai — /exec URL bilkul wahi rehta hai.
 *
 * Zaroori environment variables (GitHub Secrets mein rakhein):
 *   GAS_SCRIPT_ID       Apps Script project ID (script.google.com → Project Settings)
 *   GAS_CLIENT_ID       Google Cloud OAuth client (Desktop app)
 *   GAS_CLIENT_SECRET
 *   GAS_REFRESH_TOKEN   ek baar `node scripts/appsscript-auth.mjs` se banega
 * Optional:
 *   GAS_DEPLOYMENT_ID   kis web-app deployment ko update karna hai
 *                       (na dein to sabse purani/@HEAD ke alawa pehli mil jaye)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'apps-script');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const NO_DEPLOY = args.has('--no-deploy');

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  ✖ ${name} set nahi hai.`);
    console.error('    GitHub → Settings → Secrets and variables → Actions mein add karein.');
    console.error('    Details: apps-script/README.md\n');
    process.exit(1);
  }
  return value;
}

function readSources() {
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs') || f === 'appsscript.json');
  return files.map((file) => {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    if (file === 'appsscript.json') return { name: 'appsscript', type: 'JSON', source };
    return { name: file.replace(/\.gs$/, ''), type: 'SERVER_JS', source };
  });
}

async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: need('GAS_CLIENT_ID'),
      client_secret: need('GAS_CLIENT_SECRET'),
      refresh_token: need('GAS_REFRESH_TOKEN'),
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function api(token, url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text}`);
  return data;
}

async function main() {
  const files = readSources();
  console.log(`\n  Apps Script sync — ${files.length} file(s) from apps-script/`);
  for (const f of files) console.log(`    • ${f.name} (${f.type}, ${f.source.length} bytes)`);

  if (DRY) {
    console.log('\n  --dry-run: kuch bheja nahi gaya.\n');
    return;
  }

  const scriptId = need('GAS_SCRIPT_ID');
  const token = await accessToken();
  const base = `https://script.googleapis.com/v1/projects/${scriptId}`;

  // 1) purane project ka content overwrite
  await api(token, `${base}/content`, 'PUT', { files });
  console.log('  ✓ Code.gs / appsscript.json project mein update ho gaya (same script ID).');

  if (NO_DEPLOY) {
    console.log('  --no-deploy: /exec abhi purane version par hai (test ke liye /dev use karein).\n');
    return;
  }

  // 2) naya version
  const version = await api(token, `${base}/versions`, 'POST', {
    description: `repo sync ${new Date().toISOString()}`
  });
  console.log(`  ✓ Version ${version.versionNumber} bana.`);

  // 3) maujuda web-app deployment ko us version par point karo (URL same rehta hai)
  const list = await api(token, `${base}/deployments`);
  const deployments = (list.deployments || []).filter(
    (d) => d.deploymentId && d.deploymentId !== 'HEAD'
  );
  const target =
    process.env.GAS_DEPLOYMENT_ID ||
    (deployments[0] && deployments[0].deploymentId);

  if (!target) {
    console.log('  ! Koi maujuda deployment nahi mila — GAS_DEPLOYMENT_ID secret set karein.');
    console.log('    (Apps Script → Deploy → Manage deployments → deployment ID copy karein.)\n');
    return;
  }

  const updated = await api(token, `${base}/deployments/${target}`, 'PUT', {
    deploymentConfig: {
      scriptId,
      versionNumber: version.versionNumber,
      manifestFileName: 'appsscript',
      description: 'PANIKA JEEVAN SATHI web app'
    }
  });
  const url = (updated.entryPoints || [])
    .map((e) => e.webApp && e.webApp.url)
    .filter(Boolean)[0];
  console.log(`  ✓ Deployment ${target} ab version ${version.versionNumber} par hai.`);
  console.log(`  ✓ Live URL (badla nahi): ${url || '.../exec'}\n`);
}

main().catch((err) => {
  console.error(`\n  ✖ ${err.message}\n`);
  process.exit(1);
});
