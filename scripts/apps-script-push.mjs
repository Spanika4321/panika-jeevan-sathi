#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — push apps-script/ into the existing Apps Script project.
 *
 * The Apps Script project is standalone (script.google.com); only its code is
 * kept here so it can be reviewed and deployed from GitHub.
 *
 *   node scripts/apps-script-push.mjs pull              # back up what is live now
 *   node scripts/apps-script-push.mjs diff              # what would change
 *   node scripts/apps-script-push.mjs push              # dry run (nothing is sent)
 *   node scripts/apps-script-push.mjs push --apply      # update the project code
 *   node scripts/apps-script-push.mjs deploy --apply    # code + version + pinned deployment
 *   node scripts/apps-script-push.mjs ping              # ask the live /exec web app
 *
 * Environment
 *   PJS_APPS_SCRIPT_ID     script id (Project Settings → Script ID)   [required]
 *   PJS_AS_CLIENT_ID       OAuth client id (TVs and Limited Input)
 *   PJS_AS_CLIENT_SECRET   OAuth client secret (optional)
 *   PJS_AS_REFRESH_TOKEN   refresh token from scripts/apps-script-auth.mjs
 *   PJS_AS_DEPLOYMENT_ID   only for `deploy`: the AKfycb… id inside the /exec URL
 *   PJS_APPS_SCRIPT_URL    /exec URL, used by `ping` (or PJS_SHEETS_URL)
 *   PJS_SHEETS_TOKEN       shared secret, used by `ping`
 *   PJS_APPS_SCRIPT_DIR    source folder (default: apps-script)
 *
 * Nothing is written unless --apply (or PJS_AS_APPLY=1) is given, and `pull`
 * always saves a backup of the code that is live today.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://script.googleapis.com/v1';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const EXTENSIONS = {
  '.gs': { type: 'SERVER_JS', ext: '.gs' },
  '.js': { type: 'SERVER_JS', ext: '.gs' },
  '.html': { type: 'HTML', ext: '.html' },
  '.json': { type: 'JSON', ext: '.json' }
};

const APPLY = process.argv.includes('--apply') || process.env.PJS_AS_APPLY === '1';
const command = (process.argv[2] || 'diff').toLowerCase();
const sourceDir = path.resolve(ROOT, process.env.PJS_APPS_SCRIPT_DIR || 'apps-script');
const backupDir = path.join(sourceDir, '_remote');

/* ------------------------------------------------------------------ helpers */

function log(message = '') {
  console.log(message);
}

function die(message, code = 1) {
  console.error(`\n  ${message}\n`);
  process.exit(code);
}

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function scriptId() {
  return String(process.env.PJS_APPS_SCRIPT_ID || '').trim();
}

function maskId(id) {
  if (!id) return '(missing)';
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

async function postForm(endpoint, params) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { error: 'invalid_json', raw: text.slice(0, 300) };
  }
  return { status: res.status, data };
}

async function accessToken() {
  const clientId = String(process.env.PJS_AS_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.PJS_AS_CLIENT_SECRET || '').trim();
  const refreshToken = String(process.env.PJS_AS_REFRESH_TOKEN || '').trim();
  if (!clientId || !refreshToken) {
    die(
      'Missing PJS_AS_CLIENT_ID / PJS_AS_REFRESH_TOKEN.\n' +
        '  Create them once with: node scripts/apps-script-auth.mjs --client-id YOUR_CLIENT_ID\n' +
        '  then store them as GitHub repository secrets.'
    );
  }
  const { status, data } = await postForm(TOKEN_ENDPOINT, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  if (!data || !data.access_token) {
    die(
      `Could not exchange the refresh token (HTTP ${status}): ${data && data.error} — ${
        (data && data.error_description) || ''
      }\n  If it says invalid_grant, run scripts/apps-script-auth.mjs again.`
    );
  }
  return data.access_token;
}

async function api(method, urlPath, token, body) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    const message = (data && data.error && data.error.message) || (data && data.error) || `HTTP ${res.status}`;
    const hint =
      res.status === 403 && /has not been used in project|it is disabled/i.test(String(message))
        ? '\n  Enable the Apps Script API in the Google Cloud project that owns the OAuth client.'
        : res.status === 404
          ? '\n  Check PJS_APPS_SCRIPT_ID (Project Settings → Script ID) and that you are an editor of the project.'
          : '';
    throw new Error(`${message}${hint}`);
  }
  return data;
}

/* -------------------------------------------------------------- local files */

function localFiles() {
  if (!fs.existsSync(sourceDir)) die(`No such folder: ${sourceDir}`);
  const files = [];
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue; // _remote backups, .md notes
    const ext = path.extname(entry.name).toLowerCase();
    const spec = EXTENSIONS[ext];
    if (!spec) continue;
    // Apps Script file names carry no extension: appsscript.json → "appsscript".
    const name = entry.name.slice(0, entry.name.length - ext.length);
    files.push({
      name,
      type: spec.type,
      source: fs.readFileSync(path.join(sourceDir, entry.name), 'utf8'),
      file: entry.name
    });
  }
  if (!files.length) die(`No .gs / .html / .json files found in ${sourceDir}`);
  return files;
}

function remoteNameToFileName(file) {
  if (file.type === 'JSON') return `${file.name}.json`;
  if (file.type === 'HTML') return `${file.name}.html`;
  return `${file.name}.gs`;
}

function summarise(files) {
  return files
    .map((f) => `    ${f.file || remoteNameToFileName(f)}  ${f.type}  ${f.source.split('\n').length} lines`)
    .join('\n');
}

function diffOf(remoteFiles, local) {
  const remoteByName = new Map(remoteFiles.map((f) => [f.name, f]));
  const localByName = new Map(local.map((f) => [f.name, f]));
  const names = [...new Set([...remoteByName.keys(), ...localByName.keys()])];
  const rows = [];
  for (const name of names.sort()) {
    const r = remoteByName.get(name);
    const l = localByName.get(name);
    if (!r) rows.push({ name, state: 'added', remote: 0, local: l.source.split('\n').length });
    else if (!l) rows.push({ name, state: 'removed (live only)', remote: r.source.split('\n').length, local: 0 });
    else if (r.source === l.source) rows.push({ name, state: 'unchanged', remote: r.source.split('\n').length, local: l.source.split('\n').length });
    else rows.push({ name, state: 'changed', remote: r.source.split('\n').length, local: l.source.split('\n').length });
  }
  return rows;
}

/* ------------------------------------------------------------------ actions */

async function pull(token, outDir = backupDir) {
  const content = await api('GET', `/projects/${scriptId()}/content`, token);
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const file of content.files || []) {
    const name = remoteNameToFileName(file);
    fs.writeFileSync(path.join(outDir, name), file.source || '');
    written.push({ name, file, lines: String(file.source || '').split('\n').length });
  }
  fs.writeFileSync(
    path.join(outDir, '_manifest.json'),
    JSON.stringify({ pulledAt: new Date().toISOString(), scriptId: scriptId(), files: content.files || [] }, null, 2)
  );
  log(`  Backed up ${written.length} file(s) from the Apps Script project into ${path.relative(ROOT, outDir)}:`);
  for (const w of written) log(`    ${w.name}  ${w.file.type}  ${w.lines} lines`);
  return content;
}

async function diff(token) {
  const local = localFiles();
  const content = await api('GET', `/projects/${scriptId()}/content`, token);
  const rows = diffOf(content.files || [], local);
  log(`  Difference between the live Apps Script project and ${path.relative(ROOT, sourceDir)}:`);
  for (const r of rows) {
    const mark = r.state === 'unchanged' ? '=' : r.state === 'added' ? '+' : '~';
    log(`    ${mark} ${r.name.padEnd(16)} ${r.state.padEnd(20)} live ${r.remote} lines → local ${r.local} lines`);
  }
  const pending = rows.filter((r) => r.state !== 'unchanged');
  log('');
  log(pending.length ? `  ${pending.length} file(s) would change.` : '  Nothing to do — the project already matches the repository.');
  return { rows, pending, content, local };
}

async function push(token, { deploy = false } = {}) {
  const local = localFiles();
  const content = await api('GET', `/projects/${scriptId()}/content`, token);
  const rows = diffOf(content.files || [], local);
  const changed = rows.filter((r) => r.state !== 'unchanged');
  for (const r of rows) {
    log(`    ${r.state === 'unchanged' ? '=' : r.state === 'added' ? '+' : '~'} ${r.name.padEnd(16)} ${r.state}`);
  }

  if (!APPLY) {
    log('');
    log('  Dry run — nothing was sent. Re-run with --apply to update the project.');
    return { applied: false, changed };
  }

  // Always keep a copy of what is live today before overwriting it.
  await pull(token);
  log('');

  const body = {
    files: local.map((f) => ({ name: f.name, type: f.type, source: f.source }))
  };
  await api('PUT', `/projects/${scriptId()}/content`, token, body);
  log('');
  log(`  ✓ Updated ${local.length} file(s) in the Apps Script project (${maskId(scriptId())}).`);

  // A version is a rollback point; it does not change what /exec serves.
  let version = null;
  if (deploy || process.env.PJS_AS_VERSION === '1') {
    version = await api('POST', `/projects/${scriptId()}/versions`, token, {
      description: `from GitHub ${process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : new Date().toISOString()}`
    });
    log(`  ✓ Saved version ${version.versionNumber} (rollback point).`);
  }

  if (deploy) {
    const deploymentId = String(process.env.PJS_AS_DEPLOYMENT_ID || '').trim();
    if (!deploymentId) {
      log('');
      log('  ! PJS_AS_DEPLOYMENT_ID is not set — the deployment was not moved.');
      log('    If the web app is pinned to a version, set PJS_AS_DEPLOYMENT_ID (the AKfycb…');
      log('    part of the /exec URL) or switch the deployment to "Latest (Head)" once in the');
      log('    editor: Deploy → Manage deployments → Edit → Version → Latest (Head).');
    } else {
      const updated = await api('PUT', `/projects/${scriptId()}/deployments/${deploymentId}`, token, {
        deploymentConfig: {
          scriptId: scriptId(),
          versionNumber: version ? version.versionNumber : undefined,
          manifestFileName: 'appsscript',
          description: 'production (from GitHub)'
        }
      });
      const entryPoints = updated.entryPoints || [];
      log(`  ✓ Deployment ${maskId(deploymentId)} now runs version ${updated.deploymentConfig.versionNumber}.`);
      if (!entryPoints.length) {
        log('  ⚠  the API did not return entry points for this deployment — check the /exec URL.');
      } else {
        for (const ep of entryPoints) {
          log(`    entry point: ${ep.entryPointType}${ep.webApp && ep.webApp.url ? ` → ${ep.webApp.url}` : ''}`);
        }
      }
    }
  }

  log('');
  log('  Next: open your /exec URL with ?action=ping to confirm the new code is live.');
  return { applied: true, changed, version };
}

async function ping() {
  const url = String(process.env.PJS_APPS_SCRIPT_URL || process.env.PJS_SHEETS_URL || '').trim();
  if (!url) die('Set PJS_APPS_SCRIPT_URL (or PJS_SHEETS_URL) to the /exec URL.');
  const token = String(process.env.PJS_SHEETS_TOKEN || '').trim();
  const target = new URL(url.replace(/\/+$/, ''));
  target.searchParams.set('action', 'ping');
  if (token) target.searchParams.set('token', token);
  const res = await fetch(target.toString(), { redirect: 'follow' });
  const text = await res.text();
  log(`  GET ${target.toString().replace(/token=[^&]+/, 'token=***')}`);
  log(`  HTTP ${res.status}`);
  try {
    log(JSON.stringify(JSON.parse(text), null, 2));
  } catch (_) {
    log(text.slice(0, 600));
  }
}

/* --------------------------------------------------------------------- main */

async function main() {
  if (command === 'ping') return ping();
  if (!scriptId()) {
    die(
      'Missing PJS_APPS_SCRIPT_ID.\n' +
        '  Find it in the Apps Script editor: Project Settings (gear) → Script ID.'
    );
  }
  const token = await accessToken();
  log(`  Apps Script project ${maskId(scriptId())} — authorised.`);

  if (command === 'pull') return pull(token, arg('out', backupDir));
  if (command === 'diff') return diff(token);
  if (command === 'push') return push(token);
  if (command === 'deploy') return push(token, { deploy: true });

  die(`Unknown command "${command}". Use pull, diff, push, deploy or ping.`);
}

main().catch((err) => {
  console.error(`\n  Failed: ${err.message}\n`);
  process.exit(1);
});
