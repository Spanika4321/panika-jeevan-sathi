/** Render's env-vars PUT replaces the whole environment. Never use a partial read or allowlist. */
export async function readEnvironment(api, serviceId) {
  const rows = [];
  let cursor = '';
  const seen = new Set();
  for (let page = 0; page < 100; page++) {
    const result = await api(`/services/${encodeURIComponent(serviceId)}/env-vars?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!Array.isArray(result)) throw new Error('Could not read the complete Render environment. No environment changes are safe.');
    for (const row of result) {
      const variable = row?.envVar || row;
      if (!variable || typeof variable.key !== 'string' || !variable.key || typeof variable.value !== 'string' || seen.has(variable.key)) {
        throw new Error('Render returned an unreadable or duplicated environment variable. Refusing replacement.');
      }
      seen.add(variable.key);
      rows.push({ key: variable.key, value: variable.value });
    }
    if (result.length < 100) return rows;
    const next = result.at(-1)?.cursor;
    if (!next || next === cursor) throw new Error('Render environment pagination is incomplete. Refusing replacement.');
    cursor = next;
  }
  throw new Error('Render environment pagination limit exceeded. Refusing replacement.');
}

export function mergeEnvironment(current, provided = {}, defaults = {}) {
  if (!Array.isArray(current)) throw new Error('A complete existing environment is required.');
  const merged = new Map();
  for (const variable of current) {
    if (!variable || typeof variable.key !== 'string' || typeof variable.value !== 'string') throw new Error('Existing environment is unreadable.');
    merged.set(variable.key, { key: variable.key, value: variable.value });
  }
  for (const [key, value] of Object.entries(defaults)) if (!merged.has(key) && value !== '') merged.set(key, { key, value });
  for (const [key, value] of Object.entries(provided)) {
    if (typeof value !== 'string' || !value) continue; // omission never clears a configured secret
    if (['SUPABASE_URL', 'SUPABASE_STORAGE_BUCKET', 'CF_D1_DATABASE_ID', 'R2_BUCKET', 'PJS_STORAGE'].includes(key)) {
      const old = current.find((item) => item.key === key)?.value;
      if (old && old.replace(/\/+$/, '') !== value.replace(/\/+$/, '')) {
        throw new Error(`Refusing an implicit ${key} storage migration. Back up and migrate explicitly in the provider dashboard first.`);
      }
    }
    merged.set(key, { key, value });
  }
  for (const key of ['SESSION_SECRET', 'ADMIN_PASSWORD']) if (!merged.has(key)) merged.set(key, { key, generateValue: true });
  return [...merged.values()];
}

export function validateEnvironment(rows) {
  const env = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const mode = env.PJS_STORAGE || 'auto';
  const supabase = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY;
  const d1 = env.CF_ACCOUNT_ID && env.CF_D1_DATABASE_ID && env.CF_D1_API_TOKEN;
  const r2 = (env.R2_ACCOUNT_ID || env.CF_ACCOUNT_ID) && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY;
  const database = mode === 'supabase' ? supabase : mode === 'd1' ? d1 : mode === 'auto' && (supabase || d1);
  if (!database || !(supabase || r2) || env.PJS_ALLOW_LOCAL === '1') {
    throw new Error('Refusing Render deployment without durable database AND remote photo configuration. Existing data was not changed.');
  }
  let site;
  try { site = new URL(env.SITE_URL); } catch (_) { /* reported below */ }
  if (!site || site.protocol !== 'https:' || site.username || site.password) throw new Error('A trusted HTTPS SITE_URL is required.');
  const secret = rows.find((row) => row.key === 'SESSION_SECRET');
  if (!secret?.generateValue && String(secret?.value || '').length < 32) throw new Error('SESSION_SECRET must be at least 32 characters. Rotate it explicitly in Render before deploying.');
  return env;
}
