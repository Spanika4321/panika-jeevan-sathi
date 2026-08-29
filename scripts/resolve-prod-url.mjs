#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — resolve the production URL for the browser E2E suite.
 *
 *   node scripts/resolve-prod-url.mjs [--input URL] [--json]
 *
 * Resolution order (first non-empty, verified result wins):
 *
 *   1. --input / SITE_URL          explicit override (GitHub Actions
 *                                  workflow_dispatch input, or a local run)
 *   2. PJS_PRODUCTION_URL           configured production URL — set it as a
 *                                  repository secret/variable once and the
 *                                  daily run always tests the right site
 *   3. Render API                   discovered live service: queries
 *                                  api.render.com (Bearer RENDER_API_KEY repo
 *                                  secret) and picks the newest web service
 *                                  named panika-jeevan-sathi*
 *   4. (no match)                   prints an empty URL → the caller boots a
 *                                  local server instead, so the E2E pipeline
 *                                  works everywhere with zero configuration
 *
 * Before printing, the URL is verified with GET /api/health and Render Free
 * wake-up retries, so the suite never starts against a dead service.
 *
 * Output: prints `SITE_URL=…` (or `SITE_URL=`) to stdout; with --json prints
 * `{"url":"…","source":"…","verified":true}` for the GitHub Actions step.
 */

const SLEEP_MS = 10000;
const MAX_TRIES = 8; // ~80 s — covers a cold Render Free instance

function warn(message) {
  console.error(`[resolve-prod-url] ${message}`);
}

function readArg(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : process.argv[idx + 1] || '';
}

async function waitForHealth(url) {
  const health = url.replace(/\/+$/, '') + '/api/health';
  for (let i = 1; i <= MAX_TRIES; i += 1) {
    try {
      const res = await fetch(health, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body && body.ok === true) return 'ok';
      }
    } catch (_) {
      /* still waking up */
    }
    if (i < MAX_TRIES) await new Promise((r) => setTimeout(r, SLEEP_MS));
  }
  return null;
}

/** Find the live web service from the Render API (no value for service URLs
 *  is ever logged — the token is the only secret involved). */
async function fromRenderApi(apiKey) {
  const res = await fetch('https://api.render.com/v1/services?limit=200', {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    warn(`Render API responded ${res.status} — check the RENDER_API_KEY secret`);
    return null;
  }
  const list = await res.json().catch(() => null);
  const services = Array.isArray(list) ? list.map((i) => i && i.service).filter(Boolean) : [];
  const web = services
    .filter(
      (s) =>
        s.type === 'web' &&
        /panika[-_ ]?jeevan[-_ ]?sathi/i.test(s.name || '') &&
        s.serviceDetails &&
        typeof s.serviceDetails.url === 'string' &&
        /^https:\/\//.test(s.serviceDetails.url)
    )
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return web.length ? web[0].serviceDetails.url : null;
}

async function main() {
  const json = process.argv.includes('--json');
  const input = (readArg('--input') || process.env.SITE_URL || '').trim();

  let url = '';
  let source = '';

  for (const candidate of [
    { value: input, name: 'input/override' },
    { value: (process.env.PJS_PRODUCTION_URL || '').trim(), name: 'PJS_PRODUCTION_URL' }
  ]) {
    if (!candidate.value) continue;
    const clean = candidate.value.replace(/\/+$/, '');
    // Production URLs must be https; local staging targets (127.0.0.1 /
    // localhost) may be plain http — handy for testing against a local server.
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(clean);
    if (!local && !/^https:\/\//.test(clean)) {
      warn(`ignoring ${candidate.name}=“${clean}” — must start with https:// (or be http://localhost)`);
      continue;
    }
    url = clean;
    source = candidate.name;
    break;
  }

  if (!url && process.env.RENDER_API_KEY) {
    try {
      const found = await fromRenderApi(process.env.RENDER_API_KEY.trim());
      if (found) {
        url = found.replace(/\/+$/, '');
        source = 'Render API';
      } else {
        warn('no panika-jeevan-sathi web service found on Render (or API token lacks access)');
      }
    } catch (err) {
      warn(`Render API unreachable: ${err.message}`);
    }
  }

  let verified = false;
  if (url) {
    const health = await waitForHealth(url);
    verified = health === 'ok';
    if (!verified) {
      warn(`resolved ${source} URL ${url} but /api/health did not answer — treating as unavailable`);
      url = '';
      source = '';
    }
  }

  if (json) {
    console.log(JSON.stringify({ url, source, verified: verified || false }));
  } else {
    console.log(`SITE_URL=${url}`);
    if (url) console.log(`[resolve-prod-url] using ${source}: ${url}`);
    else console.log('[resolve-prod-url] no production URL configured — local server mode');
  }
}

main().catch((err) => {
  warn(err.message);
  process.exit(2);
});