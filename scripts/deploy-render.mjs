#!/usr/bin/env node
/**
 * Explicit Render release. Secrets come from environment variables, never
 * workflow form inputs or logs. Existing env vars are read completely and
 * preserved before any replacement. No implicit storage migrations.
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readEnvironment, mergeEnvironment, validateEnvironment } from './lib/deploy-config.mjs';
import { checkProduction } from './lib/production-check.mjs';

const args = process.argv.slice(2);
function arg(name, fallback = '') { const at = args.indexOf(`--${name}`); return at < 0 ? fallback : args[at + 1] || fallback; }

async function main() {
  const key = String(process.env.RENDER_API_KEY || '').trim();
  if (!key) throw new Error('RENDER_API_KEY is not configured. Use a protected provider/GitHub secret, not a workflow input or chat message.');
  const branch = arg('branch', process.env.DEPLOY_BRANCH || execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim());
  const commit = process.env.DEPLOY_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const name = arg('name', 'panikajeevansathi');
  if (!branch || !/^[a-f0-9]{40}$/i.test(commit)) throw new Error('A checked-out branch and exact tested commit are required.');
  const checkoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (commit !== checkoutCommit) throw new Error('Refusing to deploy a commit other than the checked-out/tested revision.');

  async function api(path, { method = 'GET', body } = {}) {
    const response = await fetch(`https://api.render.com/v1${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
      // Error bodies can echo environment variables. Never print them.
      await response.body?.cancel();
      throw new Error(`Render ${method} failed (HTTP ${response.status}). Check provider permissions and service events; no secret values were logged.`);
    }
    return response.status === 204 ? null : response.json();
  }

  const result = await api(`/services?name=${encodeURIComponent(name)}&limit=100&includePreviews=false`);
  if (!Array.isArray(result)) throw new Error('Could not enumerate Render services safely.');
  const matching = result.map((row) => row.service || row).filter((service) => service.name === name && (!process.env.RENDER_SERVICE_ID || service.id === process.env.RENDER_SERVICE_ID));
  if (matching.length > 1) throw new Error('Multiple services match. Set RENDER_SERVICE_ID explicitly.');
  let service = matching[0];
  if (!service && !args.includes('--create')) throw new Error('Service not found. Refusing to create a replacement automatically; first-time installs must explicitly use --create.');

  // Any read/pagination/validation error stops BEFORE PATCH, PUT or deployment.
  const current = service ? await readEnvironment(api, service.id) : [];
  const provided = { HOST: '0.0.0.0', NODE_VERSION: '22.22.3', NODE_ENV: 'production', PJS_REQUIRE_REMOTE: '1' };
  for (const name of [
    'SITE_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'OWNER_EMAILS',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET',
    'CF_ACCOUNT_ID', 'CF_D1_DATABASE_ID', 'CF_D1_API_TOKEN',
    'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'MAIL_FROM'
  ]) if (process.env[name]) provided[name] = process.env[name];
  if (Boolean(provided.SUPABASE_URL) !== Boolean(provided.SUPABASE_SERVICE_ROLE_KEY)) throw new Error('Supply both Supabase URL and service key, or neither to preserve existing configuration.');
  if (provided.SUPABASE_URL && !current.some((row) => row.key === 'PJS_STORAGE')) provided.PJS_STORAGE = 'supabase';
  const environment = mergeEnvironment(current, provided, {
    SITE_URL: service?.serviceDetails?.url || `https://${name}.onrender.com`,
    ADMIN_EMAIL: 'sukulpanika939@gmail.com', TRUST_PROXY_HOPS: '1'
  });
  validateEnvironment(environment);
  const build = { buildCommand: 'npm ci --omit=dev --ignore-scripts', startCommand: 'node server.js' };

  if (service) {
    await api(`/services/${service.id}/env-vars`, { method: 'PUT', body: environment });
    // A rejected build/branch update is fatal, not a successful stale-code deploy.
    await api(`/services/${service.id}`, { method: 'PATCH', body: {
      branch, serviceDetails: { healthCheckPath: '/api/health', envSpecificDetails: build }
    } });
  } else {
    let ownerId = process.env.RENDER_OWNER_ID;
    if (!ownerId) {
      const owners = await api('/owners?limit=100');
      if (!Array.isArray(owners) || owners.length !== 1) throw new Error('Set RENDER_OWNER_ID to select the intended workspace explicitly.');
      ownerId = (owners[0].owner || owners[0]).id;
    }
    const created = await api('/services', { method: 'POST', body: {
      type: 'web_service', name, ownerId, repo: 'https://github.com/Spanika4321/panika-jeevan-sathi',
      branch, autoDeploy: 'yes', envVars: environment,
      serviceDetails: { plan: 'free', region: 'singapore', runtime: 'node', numInstances: 1, healthCheckPath: '/api/health', envSpecificDetails: build }
    } });
    service = created.service || created;
  }
  console.log(`Deploying tested revision ${commit.slice(0, 12)} from ${branch}; existing configuration was preserved.`);
  const release = await api(`/services/${service.id}/deploys`, { method: 'POST', body: { clearCache: 'clear', commitId: commit } });
  const deployId = release.id || release.deployId;
  if (!deployId) throw new Error('Render did not return a deployment id.');
  let status = 'created';
  for (let attempt = 0; attempt < 90; attempt++) {
    const info = await api(`/services/${service.id}/deploys/${deployId}`);
    status = info.status;
    if (status === 'live') break;
    if (['build_failed', 'update_failed', 'deploy_failed', 'pre_deploy_failed', 'upload_failed', 'canceled', 'deactivated'].includes(status)) break;
    await sleep(10000);
  }
  if (status !== 'live') throw new Error(`Deployment not verified live (${status}). Inspect Render service events; do not assume it succeeded.`);
  const fresh = await api(`/services/${service.id}`);
  const url = (fresh.service || fresh).serviceDetails?.url;
  if (!url) throw new Error('Render did not return the public service URL.');
  console.log(`PUBLIC URL : ${url}`);
  const report = await checkProduction(url);
  for (const check of report.checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? `: ${check.detail}` : ''}`);
  if (!report.ok) throw new Error('Release is up, but post-deploy safety checks did not all pass. See the failed checks above.');
  console.log('Post-deploy read-only checks passed. Inbox delivery, production backup restore and 24-hour monitoring are not proved by this deployment.');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
