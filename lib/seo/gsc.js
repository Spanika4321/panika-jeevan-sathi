'use strict';
/**
 * PANIKA JEEVAN SATHI — Google Search Console client (real search data only).
 *
 * Zero dependencies: OAuth 2.0, the service-account JWT (RS256 via
 * node:crypto) and the Search Analytics REST calls are all implemented here
 * with Node's built-in fetch.
 *
 * Three ways to connect, in order of preference:
 *   1. OAuth (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)  → /seo.html "Connect"
 *   2. A refresh token pasted into the environment (GSC_REFRESH_TOKEN)
 *   3. A service-account key (GSC_SERVICE_ACCOUNT_JSON), once that account has
 *      been added as a user in Search Console
 *
 * Hard rules this module enforces:
 *   • Every credential stays on the server — nothing here is serialised to the
 *     browser; the SEO Center only reports booleans and account labels.
 *   • Failures return a precise reason (NOT_CONNECTED / BLOCKED) instead of
 *     invented numbers. There is no demo mode and no sample data.
 *
 * API reference:
 *   https://developers.google.com/webmaster-tools/search-console-api-original/v3/
 */

const crypto = require('node:crypto');

const ENDPOINTS = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  api: 'https://searchconsole.googleapis.com/webmasters/v3',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo'
};

const SCOPE_READONLY = 'https://www.googleapis.com/auth/webmasters.readonly';
const SCOPE_IDENTITY = 'openid email profile';

const DEFAULTS = {
  timeoutMs: 30000,
  maxRows: 25000, // Search Analytics hard limit per request page
  pageSize: 25000,
  maxRetries: 2,
  retryBaseMs: 400
};

class GscError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'GscError';
    this.retryable = Boolean(extra.retryable);
    this.status = extra.status || 0;
    this.code = extra.code || '';
  }
}

function first(...values) {
  for (const value of values) {
    const text = String(value === null || value === undefined ? '' : value).trim();
    if (text) return text;
  }
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalise a Search Console property.
 *   panikajeevansathi.onrender.com   → https://panikajeevansathi.onrender.com/
 *   https://example.com              → https://example.com/
 *   sc-domain:example.com            → sc-domain:example.com
 */
function normalizeSiteUrl(value) {
  const raw = first(value);
  if (!raw) return '';
  if (raw.startsWith('sc-domain:')) return raw;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return `${url.origin}/`;
  } catch (_) {
    return raw;
  }
}

/** Read the service-account key from the environment (inline JSON or a file). */
function serviceAccountFromEnv(env = process.env) {
  const fs = require('node:fs');
  let raw = first(env.GSC_SERVICE_ACCOUNT_JSON, env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!raw) {
    const file = first(env.GOOGLE_APPLICATION_CREDENTIALS, env.GSC_CREDENTIALS_FILE);
    if (file) {
      try {
        raw = fs.readFileSync(file, 'utf8');
      } catch (err) {
        return { error: `credentials file could not be read: ${err.message}` };
      }
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) {
      return { error: 'the service-account key has no client_email or private_key' };
    }
    return {
      clientEmail: String(parsed.client_email),
      privateKey: String(parsed.private_key).replace(/\\n/g, '\n'),
      projectId: String(parsed.project_id || '')
    };
  } catch (err) {
    return { error: `the service-account key is not valid JSON: ${err.message}` };
  }
}

function configFromEnv(env = process.env) {
  const clientId = first(env.GOOGLE_CLIENT_ID, env.GSC_CLIENT_ID);
  const clientSecret = first(env.GOOGLE_CLIENT_SECRET, env.GSC_CLIENT_SECRET);
  const redirectUri = first(
    env.GOOGLE_REDIRECT_URI,
    env.GSC_REDIRECT_URI,
    env.SEO_REDIRECT_URI
  );
  const staticRefreshToken = first(env.GSC_REFRESH_TOKEN, env.GOOGLE_REFRESH_TOKEN);
  const serviceAccount = serviceAccountFromEnv(env);
  const siteUrl = normalizeSiteUrl(first(env.GSC_SITE_URL, env.SEO_SITE_URL));

  return {
    clientId,
    clientSecret,
    redirectUri,
    staticRefreshToken,
    serviceAccount,
    siteUrl,
    timeoutMs: Number(env.GSC_TIMEOUT_MS || DEFAULTS.timeoutMs),
    maxRows: Math.max(1, Number(env.GSC_MAX_ROWS || DEFAULTS.maxRows)),
    oauthReady: Boolean(clientId && clientSecret),
    refreshReady: Boolean(staticRefreshToken),
    serviceAccountReady: Boolean(serviceAccount && !serviceAccount.error),
    credentialsConfigured: Boolean(
      (clientId && clientSecret) || staticRefreshToken || (serviceAccount && !serviceAccount.error)
    )
  };
}

/** Which settings are present — safe to show in the admin UI (booleans only). */
function envStatus(env = process.env) {
  const config = configFromEnv(env);
  return {
    client_id: Boolean(config.clientId),
    client_secret: Boolean(config.clientSecret),
    redirect_uri: Boolean(config.redirectUri),
    refresh_token: Boolean(config.staticRefreshToken),
    service_account: Boolean(config.serviceAccount && !config.serviceAccount.error),
    service_account_error: config.serviceAccount && config.serviceAccount.error ? config.serviceAccount.error : '',
    site_url: Boolean(config.siteUrl)
  };
}

/* ----------------------------------------------------------------- OAuth */

function authorizationUrl({ clientId, redirectUri, state, scope }) {
  if (!clientId || !redirectUri) {
    throw new GscError('Google OAuth is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI).');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scope || `${SCOPE_READONLY} ${SCOPE_IDENTITY}`,
    access_type: 'offline', // asks Google for a refresh token
    include_granted_scopes: 'true',
    prompt: 'consent', // always returns a refresh_token, not only on first consent
    state: String(state || '')
  });
  return `${ENDPOINTS.auth}?${params.toString()}`;
}

function decodeIdToken(idToken) {
  if (!idToken) return null;
  const parts = String(idToken).split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
}

async function tokenRequest(body, { fetchImpl, timeoutMs }) {
  let res;
  try {
    res = await fetchImpl(ENDPOINTS.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw new GscError(`Google's token endpoint could not be reached: ${err.message}`, {
      retryable: true
    });
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = null;
  }
  if (!res.ok || !json || json.error) {
    const reason = json && json.error ? `${json.error}${json.error_description ? `: ${json.error_description}` : ''}` : `HTTP ${res.status}`;
    throw new GscError(`Google rejected the token request (${reason}).`, { status: res.status });
  }
  return json;
}

/** Exchange the code Google redirected back with. */
async function exchangeCode({ code, clientId, clientSecret, redirectUri, fetchImpl, timeoutMs }) {
  const json = await tokenRequest(
    {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    },
    { fetchImpl, timeoutMs }
  );
  const claims = decodeIdToken(json.id_token);
  return {
    accessToken: String(json.access_token || ''),
    refreshToken: String(json.refresh_token || ''),
    expiresIn: Number(json.expires_in || 3600),
    scope: String(json.scope || ''),
    email: (claims && (claims.email || '')) || ''
  };
}

/** Turn a refresh token into a fresh access token. */
async function refreshAccessToken({ refreshToken, clientId, clientSecret, fetchImpl, timeoutMs }) {
  const json = await tokenRequest(
    {
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token'
    },
    { fetchImpl, timeoutMs }
  );
  return {
    accessToken: String(json.access_token || ''),
    expiresIn: Number(json.expires_in || 3600),
    scope: String(json.scope || ''),
    // Google only returns a refresh token once; the stored one stays valid.
    refreshToken: String(json.refresh_token || '')
  };
}

/** Build and sign the service-account JWT, then swap it for an access token. */
async function serviceAccountToken({ serviceAccount, fetchImpl, timeoutMs }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.clientEmail,
    scope: SCOPE_READONLY,
    aud: ENDPOINTS.token,
    iat: issuedAt,
    exp: issuedAt + 3600
  };
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(serviceAccount.privateKey, 'base64url');

  const json = await tokenRequest(
    {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${signature}`
    },
    { fetchImpl, timeoutMs }
  );
  return {
    accessToken: String(json.access_token || ''),
    expiresIn: Number(json.expires_in || 3600),
    scope: String(json.scope || SCOPE_READONLY)
  };
}

/* ------------------------------------------------------------ API client */

function describeError(err) {
  if (!err) return 'Unknown Search Console error.';
  if (err.status === 401) return 'Google rejected the access token — the Search Console connection needs to be authorised again.';
  if (err.status === 403) return 'Google refused access to this property. Check that the signed-in Google account has permission in Search Console.';
  if (err.status === 404) return 'That property is not in this Google account’s Search Console.';
  if (err.status === 429) return 'Google rate-limited the request. Try again in a few minutes.';
  return err.message || String(err);
}

/**
 * A thin Search Console API client.
 *
 * `getAccessToken()` is supplied by the SEO Center and is the only place that
 * touches stored credentials; this module never persists anything itself.
 */
function createClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const getAccessToken = options.getAccessToken;
  const limits = Object.assign({}, DEFAULTS, options.limits || {});
  let requestCount = 0;

  async function call(method, urlPath, body) {
    if (typeof getAccessToken !== 'function') {
      throw new GscError('No Search Console access token is available.');
    }
    const token = await getAccessToken();
    if (!token) {
      throw new GscError('No Search Console access token is available.');
    }

    let attempt = 0;
    for (;;) {
      let res;
      try {
        res = await fetchImpl(`${ENDPOINTS.api}${urlPath}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(limits.timeoutMs)
        });
      } catch (err) {
        throw new GscError(`Search Console could not be reached: ${err.message}`, { retryable: true });
      }
      requestCount += 1;

      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (_) {
        json = null;
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt < limits.maxRetries) {
          await sleep(limits.retryBaseMs * 2 ** attempt);
          attempt += 1;
          continue;
        }
        throw new GscError(
          `Search Console returned HTTP ${res.status}${json && json.error && json.error.message ? `: ${json.error.message}` : ''}`,
          { status: res.status, retryable: true }
        );
      }

      if (!res.ok) {
        const detail =
          json && json.error
            ? `${json.error.message || json.error}${json.error.errors && json.error.errors[0] && json.error.errors[0].reason ? ` (${json.error.errors[0].reason})` : ''}`
            : text.slice(0, 200);
        throw new GscError(`Search Console ${method} ${urlPath} failed — ${detail}`, {
          status: res.status,
          code: (json && json.error && json.error.status) || ''
        });
      }

      return json || {};
    }
  }

  /** ISO date (YYYY-MM-DD) helpers — Search Analytics is day-granular. */
  function dateRange(days) {
    const end = new Date();
    // Search Console data lags ~2 days, so the window ends 3 days ago.
    end.setUTCDate(end.getUTCDate() - 3);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (Number(days) - 1));
    const iso = (d) => d.toISOString().slice(0, 10);
    return { startDate: iso(start), endDate: iso(end) };
  }

  function shiftRange(range, days) {
    const move = (value, offset) => {
      const d = new Date(`${value}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const span = Math.round(
      (new Date(`${range.endDate}T00:00:00Z`) - new Date(`${range.startDate}T00:00:00Z`)) / 86400000
    ) + 1;
    return {
      startDate: move(range.startDate, -span),
      endDate: move(range.endDate, -span)
    };
  }

  /** One Search Analytics request page. */
  async function queryPage(siteUrl, { startDate, endDate, dimensions, rowLimit, startRow, dataState }) {
    const body = { startDate, endDate, rowLimit: Math.max(1, Number(rowLimit) || 1) };
    if (Array.isArray(dimensions) && dimensions.length) body.dimensions = dimensions;
    if (startRow) body.startRow = startRow;
    if (dataState) body.dataState = dataState;
    return call(
      'POST',
      `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      body
    );
  }

  return {
    kind: 'google_search_console',

    dateRange,
    shiftRange,
    describeError,

    /** Properties this Google account can see. */
    async listSites() {
      const json = await call('GET', '/sites');
      const entries = Array.isArray(json.siteEntry) ? json.siteEntry : [];
      return entries.map((entry) => ({
        site_url: entry.siteUrl,
        permission_level: entry.permissionLevel || ''
      }));
    },

    async siteInfo(siteUrl) {
      return call('GET', `/sites/${encodeURIComponent(siteUrl)}`);
    },

    /**
     * Aggregate Search Analytics. Pages through the API until the row limit is
     * reached so big properties are not silently truncated.
     */
    async searchAnalytics(siteUrl, options = {}) {
      const dimensions = Array.isArray(options.dimensions) ? options.dimensions : [];
      const pageSize = Math.min(limits.pageSize, Number(options.rowLimit) || limits.pageSize);
      const maxRows = Math.min(limits.maxRows * 10, Number(options.maxRows) || limits.maxRows);
      const rows = [];
      let startRow = 0;
      let truncated = false;

      for (;;) {
        const page = await queryPage(siteUrl, {
          startDate: options.startDate,
          endDate: options.endDate,
          dimensions,
          rowLimit: pageSize,
          startRow,
          dataState: options.dataState
        });
        const batch = Array.isArray(page.rows) ? page.rows : [];
        for (const row of batch) {
          rows.push({
            keys: Array.isArray(row.keys) ? row.keys : [],
            clicks: Number(row.clicks || 0),
            impressions: Number(row.impressions || 0),
            ctr: Number(row.ctr || 0),
            position: Number(row.position || 0)
          });
        }
        startRow += batch.length;
        // An aggregate query (no dimensions) always returns exactly one row —
        // asking for a second page would repeat it forever.
        if (!dimensions.length) break;
        if (batch.length < pageSize || startRow >= maxRows) {
          if (startRow >= maxRows && batch.length === pageSize) truncated = true;
          break;
        }
      }

      return { rows, truncated, requested: { startDate: options.startDate, endDate: options.endDate, dimensions } };
    },

    /** The single total row for a date range (no dimensions). */
    async totals(siteUrl, range) {
      const result = await this.searchAnalytics(siteUrl, {
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: [],
        rowLimit: 1
      });
      const row = result.rows[0] || null;
      return row
        ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }
        : { clicks: 0, impressions: 0, ctr: 0, position: 0, empty: true };
    },

    stats() {
      return { requests: requestCount };
    }
  };
}

module.exports = {
  ENDPOINTS,
  SCOPE_READONLY,
  SCOPE_IDENTITY,
  DEFAULTS,
  GscError,
  configFromEnv,
  envStatus,
  normalizeSiteUrl,
  serviceAccountFromEnv,
  authorizationUrl,
  exchangeCode,
  refreshAccessToken,
  serviceAccountToken,
  createClient,
  describeError
};
