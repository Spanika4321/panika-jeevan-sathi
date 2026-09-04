import { setTimeout as delay } from 'node:timers/promises';

export function productionUrl(value) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new Error('Use an HTTPS site origin without credentials, query parameters or fragments. HTTP is allowed only for loopback tests.');
  }
  if (url.pathname !== '/') throw new Error('Use the site origin, not an API path.');
  return url.origin;
}

export function healthProblems(body, expectedStorage = 'supabase') {
  const issues = [];
  if (body?.ok !== true || body?.service !== 'panika-jeevan-sathi') issues.push('Health response is not a healthy Panika Jeevan Sathi service');
  if (body?.storage !== expectedStorage) issues.push('Expected remote database is not active');
  if (body?.durable !== true || body?.data_loss_risk !== false) issues.push('Durability is not confirmed');
  if (!['supabase+cache', 'r2+cache'].includes(body?.photos) || body?.remote?.photos?.remote !== true) issues.push('Remote photo storage is not confirmed');
  if (body?.remote?.database?.loaded !== true) issues.push('Database startup checks are not confirmed');
  if (body?.remote?.database?.lastError || body?.remote?.photos?.lastError) issues.push('Storage reports an error');
  if (body?.remote?.database?.pending > 0 || body?.remote?.photos?.pending > 0) issues.push('Storage has unacknowledged writes');
  return issues;
}

/** Safe to schedule: GET requests only. No member creation, password changes or photo downloads. */
export async function checkProduction(value, { fetchImpl = fetch, attempts = 5, delayMs = 15000, timeoutMs = 90000, requireMail = true, expectedStorage = 'supabase' } = {}) {
  const base = productionUrl(value);
  const checks = [];
  async function request(path, json = false) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetchImpl(base + path, {
          method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
          headers: { Accept: json ? 'application/json' : 'text/html', 'User-Agent': 'PJS-Security-Monitor/1.0' }
        });
        const body = json && response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
        if ((response.status >= 500 || (json && !body)) && attempt + 1 < attempts) { if (!response.bodyUsed) await response.body?.cancel(); await delay(delayMs); continue; }
        if (!json) await response.body?.cancel();
        return { response, body };
      } catch (_) {
        if (attempt + 1 < attempts) await delay(delayMs);
      }
    }
    return { response: null, body: null };
  }
  function record(name, ok, detail = '') { checks.push({ name, ok: Boolean(ok), detail }); }

  const health = await request('/api/health', true);
  record('Health endpoint responds', health.response?.status === 200 && health.body?.ok === true);
  const problems = healthProblems(health.body, expectedStorage);
  record('Database and photos are durable', problems.length === 0, problems.join('; '));
  record('Security release is deployed', health.body?.security_revision === '2026-09-05');
  if (requireMail) record('SMTP is configured (not an inbox delivery test)', health.body?.mail?.configured === true);

  const site = await request('/api/site', true);
  record('Public site performs a database read', site.response?.status === 200 && site.body?.ok === true && Boolean(site.body?.site));
  record('Site is not in maintenance', site.body?.site?.maintenance === '0');

  const home = await request('/');
  record('Home page loads', home.response?.status === 200);
  const headers = home.response?.headers;
  const csp = headers?.get('content-security-policy') || '';
  record('CSP blocks inline injection and embedding', /script-src[^;]*'sha256-/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp) && /frame-ancestors/.test(csp) && /object-src 'none'/.test(csp));
  record('Token referrers and MIME sniffing are blocked', headers?.get('referrer-policy') === 'no-referrer' && headers?.get('x-content-type-options') === 'nosniff');
  if (base.startsWith('https:')) record('HTTPS is enforced with HSTS', /max-age=[1-9]\d*/.test(headers?.get('strict-transport-security') || ''));

  for (const path of ['/api/me', '/api/admin/stats', '/api/conversations']) {
    const result = await request(path, true);
    record(`Anonymous access denied: ${path}`, [401, 403].includes(result.response?.status) && result.body?.ok === false);
  }
  for (const path of ['/data/admin-credentials.txt', '/.env', '/server.js']) {
    const result = await request(path);
    record(`Server file is not public: ${path}`, [403, 404].includes(result.response?.status));
  }
  return {
    checked_at: new Date().toISOString(), site: base,
    ok: checks.every((check) => check.ok), checks,
    limitations: ['Read-only point-in-time check, not a penetration-test guarantee.', 'No inbox delivery, production backup restore, disk wipe or 24-hour soak was performed.']
  };
}
