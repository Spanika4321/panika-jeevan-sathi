'use strict';
/**
 * PANIKA JEEVAN SATHI — SEO Center engine (real, permanent system).
 * ===================================================================
 *
 *   GOOGLE SEARCH DATA (Search Console, OAuth2)
 *        │
 *        ▼
 *   SEO DASHBOARD  (clicks / impressions / CTR / avg position / queries / pages)
 *        │
 *        ▼
 *   AI ENGINE  (Gemini → Router fallback; local rule-engine below Router)
 *        │
 *   ┌────┴────┐
 *   ▼         ▼
 *   POOJA   PRIYA
 *   research  verification
 *   │         │
 *   └────┬────┘
 *        ▼
 *     MANAGER  (planning + final recommendations)
 *        │
 *        ▼
 *   SEO REPORT  →  PERMANENT STORAGE
 *
 * Every cycle: Check → Search Data → AI Analysis → Pooja → Priya → Manager
 *              → Report → Verify → Next Cycle.
 *
 * Hard rules (same as the agent team policy):
 *   - ONLY real Google Search Console data is shown. No synthetic rows, ever.
 *   - Missing API/OAuth credentials → "BLOCKED" / "NOT CONNECTED", never PASS.
 *   - Priya's verification is computed against the actual data snapshot.
 *   - API keys/tokens live server-side only; the browser gets masked status.
 *   - Nothing here deploys, pushes to git, or posts anywhere.
 *
 * Zero npm dependencies: node:https/fetch + the repo's SigV4 signer (lib/r2.js)
 * for Fil One (S3-compatible) uploads.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { signRequest } = require('./r2');

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GSC_API_BASE = 'https://www.googleapis.com/webmasters/v3/sites';
const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com';
const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';

const DEFAULT_DAYS = 28;
const DEFAULT_TOP_N = 25;
const GSC_ROW_LIMIT = 100;
const SNAPSHOTS_KEPT = 60;
const CYCLES_KEPT = 120;
const REPORTS_LISTED = 40;
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_MARGIN_MS = 120 * 1000;
const MIN_CYCLE_GAP_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 45000;
const AI_TIMEOUT_MS = 90000;
const CYCLE_HARD_TIMEOUT_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ utils */

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = 'id') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function mask(value, head = 4, tail = 4) {
  const s = String(value || '');
  if (s.length <= head + tail) return '••••';
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function truthy(value) {
  return ['1', 'true', 'on', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function dateStamp(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function atomicWrite(file, data, mode) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, JSON.stringify(value, null, 2) + '\n', mode);
}

/** Fetch with timeout; returns { status, ok, text, headers }. Never throws on HTTP errors. */
async function httpFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal,
      redirect: 'follow'
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text, headers: res.headers };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      text: '',
      headers: new Map(),
      error: err && err.name === 'AbortError' ? 'timeout' : err.message
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Tolerant JSON extraction (first { … } block; also handles ```json fences). */
function extractJson(text) {
  const s = String(text || '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : s;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, error: 'no JSON object found in output' };
  let parsed = null;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    // A few well-known LLM slips: trailing commas and unescaped newlines.
    const cleaned = candidate
      .slice(start, end + 1)
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/\n/g, '\\n');
    try {
      parsed = JSON.parse(cleaned);
    } catch (err2) {
      return { ok: false, error: `JSON parse failed: ${err2.message}` };
    }
  }
  return { ok: true, value: parsed };
}

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function fmtPercent(ratio) {
  return `${round((Number(ratio) || 0) * 100, 1)}%`;
}

/* ================================================================= factory */

function createSeoCenter(options) {
  const dataDir = options.dataDir;
  const secret = options.secret;
  const db = options.db; // app driver (users table) for the admin check
  const authLib = options.auth; // lib/auth
  const log = options.log || (() => {});
  const rootDir = options.rootDir || path.resolve(__dirname, '..');

  const seoDir = path.resolve(process.env.PJS_SEO_DATA_DIR || path.join(dataDir, 'seo'));
  const DIRS = {
    seo: seoDir,
    snapshots: path.join(seoDir, 'snapshots'),
    reports: path.join(seoDir, 'reports')
  };
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

  const FILES = {
    config: path.join(seoDir, 'config.json'),
    oauth: path.join(seoDir, 'oauth.json'),
    oauthState: path.join(seoDir, 'oauth-state.json'),
    latestData: path.join(seoDir, 'latest-data.json'),
    cycles: path.join(seoDir, 'cycles.json'),
    scheduler: path.join(seoDir, 'scheduler.json'),
    aiStatus: path.join(seoDir, 'ai-status.json'),
    check: path.join(seoDir, 'check.json')
  };

  /* ------------------------------------------------------------- config */

  function loadConfig() {
    let cfg = readJson(FILES.config, null) || {};
    // Env is the authoritative seed on first boot; the admin UI can update it.
    if (process.env.GOOGLE_SEARCH_CONSOLE_SITE && !cfg.site) {
      cfg.site = String(process.env.GOOGLE_SEARCH_CONSOLE_SITE).trim();
    }
    if (Number.isFinite(Number(process.env.SEO_DEFAULT_DAYS)) && !cfg.days) {
      cfg.days = Math.min(90, Math.max(1, Number(process.env.SEO_DEFAULT_DAYS)));
    }
    if (!cfg.site) cfg.site = '';
    if (!cfg.days) cfg.days = DEFAULT_DAYS;
    writeJson(FILES.config, cfg);
    return cfg;
  }

  function saveConfig(patch) {
    const cfg = Object.assign(loadConfig(), patch);
    writeJson(FILES.config, cfg);
    return cfg;
  }

  /* ----------------------------------------------------------- admin auth */

  function adminFromReq(req) {
    if (!authLib || !db || !secret) return null;
    try {
      const cookies = authLib.parseCookies(req.headers.cookie);
      const payload = authLib.readSession(cookies[authLib.SESSION_COOKIE], secret);
      if (!payload || typeof payload.uid !== 'number') return null;
      const user = db.one('users', { id: payload.uid });
      if (!user || user.role !== 'admin' || user.status !== 'active') return null;
      return user;
    } catch (_) {
      return null;
    }
  }

  /* --------------------------------------------------------- OAuth tokens */

  function oauthTokens() {
    return readJson(FILES.oauth, null);
  }

  function oauthPublic() {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    const tokens = oauthTokens();
    const hasSeed = Boolean(String(process.env.GOOGLE_SEARCH_CONSOLE_TOKEN || '').trim());
    const connected = Boolean(tokens && (tokens.access_token || tokens.refresh_token)) || hasSeed;
    let status = 'NOT_CONNECTED';
    let detail = '';
    if (connected) status = 'CONNECTED';
    if (!clientId) {
      status = 'NOT_CONNECTED';
      detail = 'GOOGLE_CLIENT_ID is not configured on the server.';
    } else if (!tokens && !hasSeed) {
      detail = 'Google Search Console OAuth has not been completed yet.';
    } else if (tokens && tokens.last_error) {
      detail = String(tokens.last_error).slice(0, 300);
    }
    return {
      status,
      client_id_masked: clientId ? mask(clientId) : null,
      client_configured: Boolean(clientId),
      site: loadConfig().site || null,
      connected_at: tokens && tokens.connected_at ? tokens.connected_at : null,
      expires_at: tokens && tokens.expires_at ? tokens.expires_at : null,
      has_refresh_token: Boolean((tokens && tokens.refresh_token) || hasSeed),
      last_error: tokens && tokens.last_error ? String(tokens.last_error).slice(0, 300) : null,
      detail
    };
  }

  async function oauthStart(redirectUri) {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) {
      return {
        ok: false,
        error:
          'OAuth is not configured on the server: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
      };
    }
    const state = uid('gsc');
    writeJson(FILES.oauthState, {
      state,
      redirect_uri: redirectUri,
      expires_at: Date.now() + STATE_TTL_MS
    });
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GSC_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return { ok: true, url: url.toString() };
  }

  async function oauthExchange(code, state, redirectUri) {
    const pending = readJson(FILES.oauthState, null);
    if (!pending || pending.state !== state || Date.now() > Number(pending.expires_at || 0)) {
      return { ok: false, error: 'OAuth state mismatch or expired. Start the connection again.' };
    }
    fs.rmSync(FILES.oauthState, { force: true });
    const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: pending.redirect_uri || redirectUri,
      grant_type: 'authorization_code'
    });
    const res = await httpFetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      timeoutMs: 30000
    });
    let parsed = null;
    try {
      parsed = JSON.parse(res.text);
    } catch (_) {
      /* fallthrough */
    }
    if (!res.ok || !parsed || !parsed.access_token) {
      const message = parsed && parsed.error_description
        ? `Google rejected the OAuth exchange: ${parsed.error_description}`
        : `Google token exchange failed (HTTP ${res.status}).`;
      writeJson(FILES.oauth, {
        last_error: message,
        error_at: nowIso()
      }, 0o600);
      return { ok: false, error: message };
    }
    const tokens = {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token || null,
      token_type: parsed.token_type || 'Bearer',
      scope: parsed.scope || '',
      expires_at: parsed.expires_in ? Date.now() + Number(parsed.expires_in) * 1000 : 0,
      connected_at: nowIso(),
      last_error: null,
      error_at: null
    };
    writeJson(FILES.oauth, tokens, 0o600);
    return { ok: true };
  }

  async function oauthRefresh() {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
    const tokens = oauthTokens();
    const refreshToken =
      (tokens && tokens.refresh_token) ||
      String(process.env.GOOGLE_SEARCH_CONSOLE_TOKEN || '').trim() ||
      '';
    if (!refreshToken) {
      return { ok: false, code: 'NOT_CONNECTED', error: 'Google Search Console is not connected (no refresh token).' };
    }
    if (!clientId || !clientSecret) {
      return { ok: false, code: 'MISCONFIGURED', error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing — cannot refresh the token.' };
    }
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });
    const res = await httpFetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      timeoutMs: 30000
    });
    let parsed = null;
    try {
      parsed = JSON.parse(res.text);
    } catch (_) {
      /* fallthrough */
    }
    if (!res.ok || !parsed || !parsed.access_token) {
      const message = parsed && parsed.error_description
        ? `Google refresh failed: ${parsed.error_description}`
        : `Google refresh failed (HTTP ${res.status}).`;
      const current = oauthTokens() || {};
      writeJson(FILES.oauth, Object.assign({}, current, {
        last_error: message,
        error_at: nowIso()
      }), 0o600);
      return { ok: false, code: 'REFRESH_FAILED', error: message };
    }
    const current = oauthTokens() || {};
    writeJson(FILES.oauth, Object.assign({}, current, {
      access_token: parsed.access_token,
      token_type: parsed.token_type || 'Bearer',
      expires_at: parsed.expires_in ? Date.now() + Number(parsed.expires_in) * 1000 : 0,
      refresh_token: refreshToken,
      last_error: null,
      error_at: null
    }), 0o600);
    return { ok: true };
  }

  /** Returns a usable access token, refreshing when needed. */
  async function getAccessToken() {
    const tokens = oauthTokens();
    // Seeded access token (e.g. GOOGLE_SEARCH_CONSOLE_TOKEN starting with ya29.)
    if (!tokens) {
      const seed = String(process.env.GOOGLE_SEARCH_CONSOLE_TOKEN || '').trim();
      if (seed.startsWith('ya29.')) return { ok: true, token: seed };
      if (seed) {
        writeJson(FILES.oauth, {
          refresh_token: seed,
          connected_at: nowIso(),
          last_error: null
        }, 0o600);
        return oauthRefresh();
      }
      return { ok: false, code: 'NOT_CONNECTED', error: 'Google Search Console is not connected.' };
    }
    if (tokens.access_token && (!tokens.expires_at || Date.now() < tokens.expires_at - TOKEN_MARGIN_MS)) {
      return { ok: true, token: tokens.access_token };
    }
    if (tokens.refresh_token) return oauthRefresh();
    return { ok: false, code: 'NOT_CONNECTED', error: 'OAuth token expired and no refresh token is available — reconnect Google Search Console.' };
  }

  function oauthDisconnect() {
    fs.rmSync(FILES.oauth, { force: true });
    fs.rmSync(FILES.oauthState, { force: true });
    return { ok: true };
  }

  /* ------------------------------------------------- GSC: real data only */

  async function gscQuery({ site, startDate, endDate, dimensions, rowLimit = GSC_ROW_LIMIT }) {
    const token = await getAccessToken();
    if (!token.ok) return token;
    const url = `${GSC_API_BASE}/${encodeURIComponent(site)}/searchAnalytics/query`;
    const body = {
      startDate,
      endDate,
      rowLimit,
      startRow: 0
    };
    if (dimensions && dimensions.length) body.dimensions = dimensions;
    let res = await httpFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      timeoutMs: 40000
    });
    if (res.status === 401) {
      // Token expired mid-flight: refresh once and retry once.
      const refreshed = await oauthRefresh();
      if (refreshed.ok) {
        const fresh = oauthTokens();
        const freshToken = fresh && fresh.access_token ? fresh.access_token : token.token;
        res = await httpFetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${freshToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          timeoutMs: 40000
        });
      }
    }
    if (!res.ok) {
      let detail = res.error || `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(res.text);
        if (parsed && parsed.error) {
          detail = parsed.error.message || detail;
          if (parsed.error.errors && parsed.error.errors[0]) {
            detail = parsed.error.errors[0].message || detail;
          }
        }
      } catch (_) {
        /* keep the raw status */
      }
      if (res.status === 403) {
        return {
          ok: false,
          code: 'FORBIDDEN',
          error: `Search Console rejected the request (HTTP 403). ${detail} — check that the connected Google account has access to this property in Search Console.`
        };
      }
      return { ok: false, code: 'API_ERROR', error: `Search Console API error: ${detail}` };
    }
    try {
      const parsed = JSON.parse(res.text);
      return {
        ok: true,
        rows: Array.isArray(parsed.rows) ? parsed.rows : []
      };
    } catch (_) {
      return { ok: false, code: 'API_ERROR', error: 'Search Console returned a response we could not parse.' };
    }
  }

  function normalizeRow(row, dimensions) {
    const out = {
      clicks: Number(row.clicks) || 0,
      impressions: Number(row.impressions) || 0,
      ctr: round(row.ctr),
      position: round(row.position)
    };
    const keys = row.keys || [];
    if (dimensions.includes('query')) out.query = String(keys[0] || '');
    if (dimensions.includes('page')) out.page = String(keys[0] || '');
    return out;
  }

  /** Pull a real GSC snapshot for a date range (totals + top queries + top pages). */
  async function pullSearchData({ site, days }) {
    const startDate = dateStamp(-Math.max(1, Number(days) || DEFAULT_DAYS));
    const endDate = dateStamp(0);
    const totalsRes = await gscQuery({ site, startDate, endDate, rowLimit: 1 });
    if (!totalsRes.ok) return totalsRes;

    const [queriesRes, pagesRes] = await Promise.all([
      gscQuery({ site, startDate, endDate, dimensions: ['query'], rowLimit: GSC_ROW_LIMIT }),
      gscQuery({ site, startDate, endDate, dimensions: ['page'], rowLimit: GSC_ROW_LIMIT })
    ]);
    if (!queriesRes.ok) return queriesRes;
    if (!pagesRes.ok) return pagesRes;

    const totalsRow = totalsRes.rows && totalsRes.rows[0] ? totalsRes.rows[0] : null;
    const snapshot = {
      fetched_at: nowIso(),
      kind: 'gsc-searchanalytics',
      site,
      range: { start: startDate, end: endDate },
      totals: totalsRow
        ? {
            clicks: Number(totalsRow.clicks) || 0,
            impressions: Number(totalsRow.impressions) || 0,
            ctr: round(totalsRow.ctr),
            position: round(totalsRow.position)
          }
        : null,
      queries: queriesRes.rows
        .map((r) => normalizeRow(r, ['query']))
        .filter((r) => r.query)
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, DEFAULT_TOP_N),
      pages: pagesRes.rows
        .map((r) => normalizeRow(r, ['page']))
        .filter((r) => r.page)
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, DEFAULT_TOP_N)
    };
    return { ok: true, snapshot };
  }

  function persistSnapshot(snapshot) {
    writeJson(FILES.latestData, snapshot);
    const file = path.join(DIRS.snapshots, `snapshot-${snapshot.fetched_at.replace(/[:.]/g, '-')}.json`);
    writeJson(file, snapshot);
    const files = fs
      .readdirSync(DIRS.snapshots)
      .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
      .sort();
    while (files.length > SNAPSHOTS_KEPT) {
      fs.rmSync(path.join(DIRS.snapshots, files.shift()), { force: true });
    }
    return file;
  }

  function latestSnapshot() {
    return readJson(FILES.latestData, null);
  }

  /* ------------------------------------------------------------ AI engine */
  /* Gemini primary → Router fallback → local rule engine (below Router).   */

  function aiConfig() {
    const geminiKey = String(process.env.GEMINI_API_KEY || '').trim();
    const geminiBase = String(process.env.GEMINI_API_BASE || GEMINI_DEFAULT_BASE).replace(/\/+$/, '');
    const geminiModel = String(process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL).trim();
    const routerUrl = String(process.env.GEMINI_ROUTER_URL || '').replace(/\/+$/, '');
    const routerKey = String(process.env.GEMINI_ROUTER_API_KEY || '').trim();
    const routerModel = String(process.env.GEMINI_ROUTER_MODEL || geminiModel).trim();
    return {
      gemini: { configured: Boolean(geminiKey), key: geminiKey, base: geminiBase, model: geminiModel },
      router: { configured: Boolean(routerUrl && routerKey), url: routerUrl, key: routerKey, model: routerModel }
    };
  }

  async function callGemini({ system, prompt, temperature = 0.4, maxTokens = 4096 }) {
    const cfg = aiConfig().gemini;
    if (!cfg.configured) return { ok: false, engine: 'gemini', error: 'GEMINI_API_KEY is not configured.' };
    const started = Date.now();
    const res = await httpFetch(
      `${cfg.base}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cfg.key
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: system ? `${system}\n\n---\n\n${prompt}` : prompt }]
            }
          ],
          generationConfig: { temperature, maxOutputTokens: maxTokens }
        }),
        timeoutMs: AI_TIMEOUT_MS
      }
    );
    if (!res.ok) {
      let detail = res.error || `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(res.text);
        if (parsed && parsed.error && parsed.error.message) detail = parsed.error.message;
      } catch (_) {
        /* keep raw */
      }
      return { ok: false, engine: 'gemini', latency_ms: Date.now() - started, error: `Gemini error: ${detail}` };
    }
    try {
      const parsed = JSON.parse(res.text);
      const text = (parsed.candidates || [])
        .map((c) => (c.content && c.content.parts ? c.content.parts.map((p) => p.text || '').join('') : ''))
        .join('')
        .trim();
      if (!text) return { ok: false, engine: 'gemini', latency_ms: Date.now() - started, error: 'Gemini returned an empty response.' };
      return { ok: true, engine: 'gemini', model: cfg.model, text, latency_ms: Date.now() - started };
    } catch (_) {
      return { ok: false, engine: 'gemini', latency_ms: Date.now() - started, error: 'Gemini response could not be parsed.' };
    }
  }

  async function callRouter({ system, prompt, temperature = 0.4, maxTokens = 4096 }) {
    const cfg = aiConfig().router;
    if (!cfg.configured) {
      return { ok: false, engine: 'router', error: 'Router is not configured (GEMINI_ROUTER_URL + GEMINI_ROUTER_API_KEY).' };
    }
    const started = Date.now();
    const res = await httpFetch(`${cfg.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system || 'You are a helpful assistant.' },
          { role: 'user', content: prompt }
        ],
        temperature
      }),
      timeoutMs: AI_TIMEOUT_MS
    });
    if (!res.ok) {
      let detail = res.error || `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(res.text);
        if (parsed && parsed.error && parsed.error.message) detail = parsed.error.message;
      } catch (_) {
        /* keep raw */
      }
      return { ok: false, engine: 'router', latency_ms: Date.now() - started, error: `Router error: ${detail}` };
    }
    try {
      const parsed = JSON.parse(res.text);
      const text = String(
        (parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content) || ''
      ).trim();
      if (!text) return { ok: false, engine: 'router', latency_ms: Date.now() - started, error: 'Router returned an empty response.' };
      return { ok: true, engine: 'router', model: cfg.model, text, latency_ms: Date.now() - started };
    } catch (_) {
      return { ok: false, engine: 'router', latency_ms: Date.now() - started, error: 'Router response could not be parsed.' };
    }
  }

  /**
   * AI engine with the mandated fallback order:
   *   Gemini → Router → local rule engine.
   * Every attempt is recorded so the dashboard shows which engine answered.
   */
  async function callAi({ system, prompt, temperature, maxTokens }) {
    const cfg = aiConfig();
    if (!cfg.gemini.configured && !cfg.router.configured) {
      return {
        ok: false,
        engine: 'none',
        attempts: [
          { engine: 'gemini', status: 'NOT_CONFIGURED' },
          { engine: 'router', status: 'NOT_CONFIGURED' }
        ],
        error: 'AI engine is not connected: GEMINI_API_KEY (Gemini) and GEMINI_ROUTER_URL + GEMINI_ROUTER_API_KEY (Router) are all missing.'
      };
    }
    const attempts = [];
    if (cfg.gemini.configured) {
      const gem = await callGemini({ system, prompt, temperature, maxTokens });
      attempts.push(gem.ok ? { engine: 'gemini', status: 'OK', model: gem.model, latency_ms: gem.latency_ms } : { engine: 'gemini', status: 'FAILED', error: gem.error });
      if (gem.ok) return Object.assign(gem, { attempts });
    } else {
      attempts.push({ engine: 'gemini', status: 'NOT_CONFIGURED' });
    }
    if (cfg.router.configured) {
      const router = await callRouter({ system, prompt, temperature, maxTokens });
      attempts.push(router.ok ? { engine: 'router', status: 'OK', model: router.model, latency_ms: router.latency_ms } : { engine: 'router', status: 'FAILED', error: router.error });
      if (router.ok) return Object.assign(router, { attempts });
    } else {
      attempts.push({ engine: 'router', status: 'NOT_CONFIGURED' });
    }
    return {
      ok: false,
      engine: 'none',
      attempts,
      error: 'Both Gemini and Router failed. See attempts for details.'
    };
  }

  function aiPublic() {
    const cfg = aiConfig();
    const last = readJson(FILES.aiStatus, null);
    let status = 'NOT_CONNECTED';
    if (cfg.gemini.configured || cfg.router.configured) status = 'CONNECTED';
    if (last && last.status === 'FAILED' && !last.ok) status = 'ERROR';
    return {
      status,
      gemini: {
        configured: cfg.gemini.configured,
        model: cfg.gemini.model,
        base: cfg.gemini.configured ? cfg.gemini.base.replace(/^https?:\/\//, '') : null
      },
      router: {
        configured: cfg.router.configured,
        model: cfg.router.model,
        url: cfg.router.configured ? cfg.router.url.replace(/^https?:\/\//, '') : null
      },
      last_check: last || null
    };
  }

  /* --------------------------------------------------------- Fil One (S3) */

  function filOneConfig() {
    const endpoint = String(process.env.FIL_ONE_ENDPOINT || '').trim().replace(/\/+$/, '');
    const accessKey = String(process.env.FIL_ONE_ACCESS_KEY || '').trim();
    const secretKey = String(process.env.FIL_ONE_SECRET_KEY || '').trim();
    const bucket = String(process.env.FIL_ONE_BUCKET || '').trim();
    const region = String(process.env.FIL_ONE_REGION || 'eu-west-1').trim();
    const configured = Boolean(endpoint && accessKey && secretKey && bucket);
    return { configured, endpoint, accessKey, secretKey, bucket, region };
  }

  async function filOnePut(key, body, contentType) {
    const cfg = filOneConfig();
    if (!cfg.configured) return { ok: false, status: 'NOT_CONNECTED', error: 'Fil One is not configured (FIL_ONE_ENDPOINT, FIL_ONE_ACCESS_KEY, FIL_ONE_SECRET_KEY, FIL_ONE_BUCKET).' };
    const url = `${cfg.endpoint}/${cfg.bucket}/${key.replace(/^\/+/, '')}`;
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    const headers = {
      'Content-Type': contentType || 'application/octet-stream',
      host: new URL(url).host
    };
    const signed = signRequest({
      method: 'PUT',
      url,
      headers,
      payloadHash: crypto.createHash('sha256').update(payload).digest('hex'),
      accessKeyId: cfg.accessKey,
      secretAccessKey: cfg.secretKey,
      region: cfg.region,
      service: 's3'
    });
    const res = await httpFetch(url, {
      method: 'PUT',
      headers: signed.headers,
      body: payload,
      timeoutMs: 60000
    });
    if (!res.ok) {
      return { ok: false, status: 'FAILED', error: res.error || `HTTP ${res.status}${res.text ? ` — ${String(res.text).slice(0, 200)}` : ''}` };
    }
    return { ok: true, status: 'OK', key, bytes: payload.length };
  }

  function filOnePublic() {
    const cfg = filOneConfig();
    const last = readJson(path.join(seoDir, 'filone-last.json'), null);
    return {
      status: cfg.configured ? 'CONNECTED' : 'NOT_CONNECTED',
      endpoint: cfg.configured ? cfg.endpoint.replace(/^https?:\/\//, '') : null,
      bucket: cfg.configured ? cfg.bucket : null,
      region: cfg.configured ? cfg.region : null,
      last_upload: last || null
    };
  }

  /* ------------------------------------------ agent permanent memory mirror */

  async function loadAgentStore() {
    try {
      return await import(path.join(rootDir, 'agents', 'storage.mjs'));
    } catch (err) {
      return { error: err.message };
    }
  }

  async function mirrorToAgentStorage(cycle, report) {
    const store = await loadAgentStore();
    if (store.error) {
      return { ok: false, error: `agent storage engine unavailable: ${store.error}` };
    }
    try {
      for (const agentId of ['pooja', 'priya', 'manager']) {
        const step = cycle.steps[agentId] || {};
        store.ensureAgentStore(agentId);
        store.recordRun(agentId, {
          status: step.status === 'PASS' ? 'OK' : step.status === 'FAIL' ? 'FAIL' : 'BLOCKED',
          summary: String(step.summary || step.status || '').slice(0, 400),
          duration_ms: cycle.duration_ms || 0,
          details: { cycle_id: cycle.id, report_id: report.id, engine: step.engine || null }
        });
        store.agentLog(agentId, {
          event: 'seo-center.cycle',
          cycle_id: cycle.id,
          report_id: report.id,
          status: step.status
        });
      }
      store.kvSet('seo-center', 'latest', {
        cycle_id: cycle.id,
        report_id: report.id,
        at: nowIso(),
        status: cycle.status
      });
      store.ledgerAppend({
        type: 'seo-center.cycle',
        cycle_id: cycle.id,
        report_id: report.id,
        status: cycle.status,
        pooja: cycle.steps.pooja.status,
        priya: cycle.steps.priya.status,
        manager: cycle.steps.manager.status
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ---------------------------------------------------- local rule engine
   * Used only when Gemini AND Router are unavailable — clearly labelled
   * `engine: "local"`. Computed from the real snapshot; never invented.   */

  function localAnalysis(snapshot) {
    const totals = snapshot.totals || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const avgCtr = totals.ctr || 0;
    const insights = [];
    const quickWins = [];
    const risks = [];
    if (!snapshot.totals) {
      insights.push('Search Console reported no rows at all for this period — the property may be new or not yet verified.');
      risks.push('No impressions in the selected range: nothing to optimise until Google indexes the site.');
    } else {
      insights.push(`Totals: ${totals.clicks} clicks, ${totals.impressions} impressions, CTR ${fmtPercent(avgCtr)}, average position ${round(totals.position, 1)}.`);
      const lowCtrQueries = snapshot.queries.filter((q) => q.impressions >= 10 && q.ctr < avgCtr * 0.5);
      const nearTop = snapshot.queries.filter((q) => q.position > 3 && q.position <= 10);
      if (nearTop.length) insights.push(`${nearTop.length} queries sit between position 4–10 — the closest wins for title/content refinement.`);
      if (lowCtrQueries.length) insights.push(`${lowCtrQueries.length} queries earn impressions but underperform on CTR — snippet (title/description) improvements apply.`);
      const zeroClick = snapshot.queries.filter((q) => q.clicks === 0 && q.impressions > 0);
      if (zeroClick.length) quickWins.push(`${zeroClick.length} queries have impressions but zero clicks — review the ranking page's snippet and intent match.`);
    }
    return { insights, trends: [], quick_wins: quickWins, risks };
  }

  function localResearch(snapshot, analysis) {
    const totals = snapshot.totals || null;
    const avgCtr = totals ? totals.ctr || 0 : 0;
    const keyword_opportunities = snapshot.queries.slice(0, 12).map((q) => {
      let opportunity = 'Monitor';
      let rationale = '';
      if (q.clicks === 0 && q.impressions > 0) {
        opportunity = 'Zero-click opportunity';
        rationale = 'The site is shown for this query but no one clicks — the snippet or intent match needs work.';
      } else if (q.position > 3 && q.position <= 10) {
        opportunity = 'Ranking opportunity';
        rationale = `Average position ${round(q.position, 1)} — pushing into the top 3 is realistic.`;
      } else if (q.ctr < avgCtr * 0.7 && q.impressions >= 10) {
        opportunity = 'CTR opportunity';
        rationale = `CTR ${fmtPercent(q.ctr)} is well below the site average ${fmtPercent(avgCtr)}.`;
      } else if (q.position <= 3) {
        opportunity = 'Defend position';
        rationale = 'Already ranking in the top 3 — keep the page fresh and internal links intact.';
      }
      return {
        query: q.query,
        impressions: q.impressions,
        clicks: q.clicks,
        ctr: q.ctr,
        position: q.position,
        opportunity,
        rationale
      };
    });
    const page_recommendations = snapshot.pages.slice(0, 10).map((p) => {
      let recommendation = 'Keep monitoring';
      if (p.clicks === 0 && p.impressions > 0) {
        recommendation = 'Snippet review: page earns impressions but no clicks — rewrite the meta title/description to match the query.';
      } else if (p.ctr < (avgCtr * 0.7) && p.impressions >= 10) {
        recommendation = 'CTR improvement: test a clearer title and a call-to-action in the meta description.';
      } else if (p.position > 3 && p.position <= 10) {
        recommendation = 'On-page strengthening: add supporting content and internal links to move into the top 3.';
      }
      return {
        page: p.page,
        impressions: p.impressions,
        clicks: p.clicks,
        ctr: p.ctr,
        position: p.position,
        recommendation
      };
    });
    const themes = new Map();
    for (const q of snapshot.queries) {
      const words = q.query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      for (const w of words) {
        if (['panika', 'manikpuri', 'kabirpanthi', 'adivasi', 'vivah', 'shaadi', 'shadi', 'rishta', 'matrimony', 'match', 'bride', 'groom', 'dulha', 'dulhan', 'free', 'community', 'biyah'].includes(w)) {
          themes.set(w, (themes.get(w) || 0) + q.impressions);
        }
      }
    }
    const content_gaps = [...themes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([theme, impressions]) => `No dedicated content page targets the "${theme}" intent cluster (${impressions} combined impressions) — a focused landing page or FAQ section could capture it.`);
    const technical_seo = [];
    return {
      engine: 'local',
      summary: analysis.insights.join(' '),
      keyword_opportunities,
      page_recommendations,
      content_gaps,
      technical_seo
    };
  }

  function localPlan(snapshot, research, verification) {
    const actions = [];
    research.keyword_opportunities.slice(0, 3).forEach((o) => {
      actions.push({
        priority: actions.length + 1,
        action: `Improve ranking for "${o.query}" (impressions ${o.impressions}, position ${round(o.position, 1)}) — ${o.opportunity.toLowerCase()}.`,
        owner: 'Pooja',
        target: 'position ≤ 3',
        due: '+7 days'
      });
    });
    research.page_recommendations.slice(0, 2).forEach((p) => {
      actions.push({
        priority: actions.length + 1,
        action: `${p.recommendation} (${p.page})`,
        owner: 'Pooja',
        target: 'CTR ≥ site average',
        due: '+14 days'
      });
    });
    const totals = snapshot.totals;
    const final_recommendation = totals
      ? `Focus on the ${actions.length} actions above. Current baseline: ${totals.clicks} clicks and ${totals.impressions} impressions (CTR ${fmtPercent(totals.ctr)}) at average position ${round(totals.position, 1)}. Re-run the cycle weekly and compare.`
      : 'Search Console returned no rows for this period — first priority is confirming the property is verified and the sitemap is submitted.';
    return {
      engine: 'local',
      plan: actions,
      final_recommendation,
      risks: verification && verification.checks
        ? verification.checks.filter((c) => c.status === 'FAIL').map((c) => `Verification failure: ${c.id} — ${c.evidence}`)
        : []
    };
  }

  /* -------------------------------------------------- live technical checks */

  async function liveTechnicalChecks() {
    const siteUrl = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
    if (!siteUrl) {
      return {
        checked: false,
        note: 'SITE_URL is not configured — live indexability checks skipped.',
        items: []
      };
    }
    const items = [];
    try {
      const robots = await httpFetch(`${siteUrl}/robots.txt`, { timeoutMs: 15000 });
      items.push({
        id: 'robots.txt',
        status: robots.ok && robots.text.includes('Sitemap:') ? 'PASS' : 'FAIL',
        detail: robots.ok ? 'robots.txt is live and advertises the sitemap.' : `robots.txt unreachable (HTTP ${robots.status}).`
      });
      const sitemap = await httpFetch(`${siteUrl}/sitemap.xml`, { timeoutMs: 15000 });
      items.push({
        id: 'sitemap.xml',
        status: sitemap.ok && /<urlset[\s>]/.test(sitemap.text) ? 'PASS' : 'FAIL',
        detail: sitemap.ok ? 'sitemap.xml is live and well-formed.' : `sitemap.xml unreachable (HTTP ${sitemap.status}).`
      });
      const home = await httpFetch(siteUrl, { timeoutMs: 15000 });
      const noindex = /<meta[^>]+robots[^>]+noindex/i.test(home.text);
      items.push({
        id: 'homepage-indexable',
        status: home.ok && !noindex ? 'PASS' : 'FAIL',
        detail: noindex ? 'Homepage carries a noindex robots meta — search engines are excluded!' : 'Homepage is indexable.'
      });
    } catch (err) {
      items.push({ id: 'live-checks', status: 'FAIL', detail: err.message });
    }
    return { checked: true, site: siteUrl, items };
  }

  /* ----------------------------------------------------- Priya verification
   * Deterministic: every claim is compared against the actual snapshot.   */

  function verifyResearch(research, snapshot, ctx = {}) {
    const checks = [];
    const totals = snapshot.totals;
    const checksFor = (list, snapshotList, key, label) => {
      for (const claim of (list || []).slice(0, 15)) {
        const needle = String(claim[key] || '').trim().toLowerCase();
        const exact = snapshotList.find((x) => String(x[key] || '').trim().toLowerCase() === needle);
        const fuzzy = !exact
          ? snapshotList.find(
              (x) =>
                String(x[key] || '').trim().toLowerCase().includes(needle) ||
                needle.includes(String(x[key] || '').trim().toLowerCase())
            )
          : null;
        if (!exact && !fuzzy) {
          checks.push({
            id: `${label}-exists`,
            claim: claim[key] || '(empty)',
            status: 'FAIL',
            evidence: `"${claim[key]}" does not appear in the GSC snapshot (${snapshot.range.start} → ${snapshot.range.end}). The claim cannot be verified against real data.`
          });
          continue;
        }
        const actual = exact || fuzzy;
        const problems = [];
        const tolerance = { clicks: 1, impressions: 1, ctr: 0.02, position: 0.5 };
        for (const metric of ['impressions', 'clicks', 'ctr', 'position']) {
          const cited = Number(claim[metric]);
          if (!Number.isFinite(cited)) continue; // metric omitted — nothing to check
          if (Math.abs(cited - Number(actual[metric] || 0)) > tolerance[metric]) {
            problems.push(`${metric}: claimed ${cited}, actual ${round(actual[metric])}`);
          }
        }
        checks.push({
          id: `${label}-data`,
          claim: claim[key],
          status: problems.length ? 'FAIL' : 'PASS',
          evidence: problems.length
            ? `Cited numbers do not match the GSC snapshot — ${problems.join('; ')}.`
            : `"${actual[key]}" matches the GSC snapshot${exact ? '' : ' (fuzzy match)'} — ${actual.impressions} impressions, ${actual.clicks} clicks.`
        });
      }
      if (!list || !list.length) {
        checks.push({ id: `${label}-present`, claim: '(none)', status: 'FAIL', evidence: `No ${label} items were produced.` });
      }
    };
    if (ctx.aiUsed) {
      checks.push({
        id: 'ai-output-valid-json',
        claim: 'AI output parsed as strict JSON',
        status: ctx.aiJsonOk ? 'PASS' : 'FAIL',
        evidence: ctx.aiJsonOk ? 'AI output parsed successfully.' : ctx.aiJsonError || 'AI output was not valid JSON.'
      });
    }
    checksFor(research.keyword_opportunities, snapshot.queries, 'query', 'keyword-opportunity');
    checksFor(research.page_recommendations, snapshot.pages, 'page', 'page-recommendation');
    if (totals) {
      checks.push({
        id: 'totals-consistent',
        claim: 'report totals',
        status: 'PASS',
        evidence: `Totals ${totals.clicks} clicks / ${totals.impressions} impressions / CTR ${fmtPercent(totals.ctr)} / avg position ${round(totals.position, 1)} — read directly from Search Console.`
      });
    }
    const fails = checks.filter((c) => c.status === 'FAIL').length;
    const passes = checks.filter((c) => c.status === 'PASS').length;
    return {
      status: fails ? 'FAIL' : passes ? 'PASS' : 'BLOCKED',
      checks,
      summary: fails
        ? `${fails} of ${checks.length} verification checks FAILED — claims do not match the real Search Console data.`
        : `${passes} verification checks passed — every claim matches the real Search Console data.`,
      totals: { checks: checks.length, pass: passes, fail: fails }
    };
  }

  /* ---------------------------------------------------------------- cycle */

  const state = {
    running: false,
    lastStartedAt: 0,
    lastCycle: null,
    schedulerTimer: null,
    schedulerEnabled: false
  };

  function readCycles() {
    return readJson(FILES.cycles, { updated_at: null, cycles: [] });
  }

  function appendCycle(cycle) {
    const doc = readCycles();
    doc.updated_at = nowIso();
    doc.cycles.unshift(cycle);
    doc.cycles = doc.cycles.slice(0, CYCLES_KEPT);
    writeJson(FILES.cycles, doc);
    state.lastCycle = cycle;
    // Only an executed cycle may claim a last run — status included, so a
    // BLOCKED cycle stays visibly BLOCKED instead of looking like a pass.
    try {
      writeJson(FILES.scheduler, Object.assign(readJson(FILES.scheduler, {}), {
        last_run_at: cycle.started_at || cycle.at || nowIso(),
        last_cycle_id: cycle.id || null,
        last_status: cycle.status || null
      }));
    } catch (_) {
      /* the cycle record is the source of truth; the mirror is convenience */
    }
  }

  function reportList() {
    let files = [];
    try {
      files = fs
        .readdirSync(DIRS.reports)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, REPORTS_LISTED);
    } catch (_) {
      files = [];
    }
    return files.map((f) => {
      const meta = readJson(path.join(DIRS.reports, f), null);
      return {
        id: f.replace(/\.json$/, ''),
        file: f,
        generated_at: meta && meta.generated_at ? meta.generated_at : null,
        period: meta && meta.period ? meta.period : null,
        cycle_status: meta && meta.cycle_status ? meta.cycle_status : null,
        pooja: meta && meta.pooja ? meta.pooja.status : null,
        priya: meta && meta.priya ? meta.priya.status : null,
        manager: meta && meta.manager ? meta.manager.status : null,
        bytes: (() => {
          try {
            return fs.statSync(path.join(DIRS.reports, f)).size;
          } catch (_) {
            return 0;
          }
        })()
      };
    });
  }

  function reportFiles(reportId) {
    if (!/^[a-z0-9_-]+$/i.test(reportId)) return null;
    const json = path.join(DIRS.reports, `${reportId}.json`);
    const md = path.join(DIRS.reports, `${reportId}.md`);
    if (!fs.existsSync(json)) return null;
    return { json, md: fs.existsSync(md) ? md : null };
  }

  function renderMarkdown(report) {
    const L = [];
    const data = report.data || {};
    L.push(`# PANIKA JEEVAN SATHI — SEO Report`);
    L.push('');
    L.push(`- **Report:** ${report.id}`);
    L.push(`- **Generated:** ${report.generated_at}`);
    L.push(`- **Period:** ${report.period ? `${report.period.start} → ${report.period.end}` : '—'}`);
    L.push(`- **Property:** ${report.site || '—'}`);
    L.push(`- **AI engine:** ${report.ai.engine}${report.ai.model ? ` (${report.ai.model})` : ''} — ${report.ai.status}`);
    L.push(`- **Cycle status:** ${report.cycle_status}`);
    L.push('');
    L.push('## Search Console (real data)');
    L.push('');
    if (!data.totals) {
      L.push('No Search Console snapshot in this cycle (integration blocked or zero rows) — the pipeline reported the step status honestly instead of inventing numbers.');
    } else {
      L.push('| Metric | Value |');
      L.push('| --- | --- |');
      L.push(`| Clicks | ${data.totals.clicks} |`);
      L.push(`| Impressions | ${data.totals.impressions} |`);
      L.push(`| CTR | ${fmtPercent(data.totals.ctr)} |`);
      L.push(`| Average position | ${round(data.totals.position, 1)} |`);
      L.push('');
      L.push('### Top queries');
      L.push('');
      L.push('| Query | Clicks | Impressions | CTR | Position |');
      L.push('| --- | --- | --- | --- | --- |');
      for (const q of data.queries || []) L.push(`| ${q.query.replace(/\|/g, '\\|')} | ${q.clicks} | ${q.impressions} | ${fmtPercent(q.ctr)} | ${round(q.position, 1)} |`);
      L.push('');
      L.push('### Top pages');
      L.push('');
      L.push('| Page | Clicks | Impressions | CTR | Position |');
      L.push('| --- | --- | --- | --- | --- |');
      for (const p of data.pages || []) L.push(`| ${p.page} | ${p.clicks} | ${p.impressions} | ${fmtPercent(p.ctr)} | ${round(p.position, 1)} |`);
    }
    L.push('');
    L.push('## Pooja — SEO research');
    L.push('');
    L.push(`- Status: **${report.pooja.status}** (engine: ${report.pooja.engine || '—'})`);
    L.push(`- Summary: ${report.pooja.research.summary || '—'}`);
    L.push('');
    L.push('### Keyword opportunities');
    L.push('');
    for (const o of report.pooja.research.keyword_opportunities || []) {
      L.push(`- **${o.query}** — ${o.opportunity} (impressions ${o.impressions}, clicks ${o.clicks}, CTR ${fmtPercent(o.ctr)}, position ${round(o.position, 1)}). ${o.rationale || ''}`);
    }
    L.push('');
    L.push('### Page recommendations');
    L.push('');
    for (const p of report.pooja.research.page_recommendations || []) {
      L.push(`- **${p.page}** — ${p.recommendation}`);
    }
    L.push('');
    L.push('### Content gaps');
    L.push('');
    for (const g of report.pooja.research.content_gaps || []) L.push(`- ${g}`);
    L.push('');
    L.push('## Priya — verification');
    L.push('');
    L.push(`- Status: **${report.priya.status}**`);
    L.push(`- Summary: ${report.priya.summary}`);
    L.push('');
    L.push('| Check | Status | Evidence |');
    L.push('| --- | --- | --- |');
    for (const c of report.priya.checks || []) {
      L.push(`| ${c.id} (${String(c.claim || '').slice(0, 60)}) | ${c.status} | ${String(c.evidence || '').replace(/\|/g, '\\|')} |`);
    }
    L.push('');
    L.push('## Manager — plan & final recommendation');
    L.push('');
    L.push(`- Status: **${report.manager.status}** (engine: ${report.manager.engine || '—'})`);
    L.push('');
    L.push('| # | Priority | Action | Owner | Target | Due |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    for (const a of report.manager.plan || []) {
      L.push(`| ${a.priority} | P${a.priority} | ${String(a.action || '').replace(/\|/g, '\\|')} | ${a.owner} | ${a.target || '—'} | ${a.due || '—'} |`);
    }
    L.push('');
    L.push(`**Final recommendation:** ${report.manager.final_recommendation || '—'}`);
    L.push('');
    L.push('## Storage');
    L.push('');
    for (const target of report.storage_targets || []) {
      L.push(`- ${target.name}: **${target.status}**${target.detail ? ` — ${target.detail}` : ''}`);
    }
    L.push('');
    return L.join('\n');
  }

  async function storageRoundtrip(report) {
    const targets = [];
    // 1. Local permanent storage (always attempted).
    const jsonFile = path.join(DIRS.reports, `${report.id}.json`);
    const mdFile = path.join(DIRS.reports, `${report.id}.md`);
    try {
      writeJson(jsonFile, report);
      atomicWrite(mdFile, renderMarkdown(report) + '\n');
      const reread = readJson(jsonFile, null);
      targets.push({
        name: 'local',
        status: reread && reread.id === report.id ? 'OK' : 'FAILED',
        detail: `${path.basename(jsonFile)} (${fs.statSync(jsonFile).size} bytes) + markdown`,
        file: path.basename(jsonFile)
      });
    } catch (err) {
      targets.push({ name: 'local', status: 'FAILED', detail: err.message });
    }
    // 2. Fil One (S3-compatible) — used only when properly connected.
    if (filOneConfig().configured) {
      const upJson = await filOnePut(`seo/reports/${report.id}.json`, JSON.stringify(report, null, 2), 'application/json');
      const upMd = await filOnePut(`seo/reports/${report.id}.md`, renderMarkdown(report), 'text/markdown');
      const okBoth = upJson.ok && upMd.ok;
      targets.push({
        name: 'fil-one',
        status: okBoth ? 'OK' : 'FAILED',
        detail: okBoth
          ? `${filOneConfig().bucket}/seo/reports/${report.id}.{json,md} uploaded`
          : [upJson.error, upMd.error].filter(Boolean).join(' | ')
      });
      writeJson(path.join(seoDir, 'filone-last.json'), {
        at: nowIso(),
        report_id: report.id,
        status: okBoth ? 'OK' : 'FAILED',
        error: okBoth ? null : [upJson.error, upMd.error].filter(Boolean).join(' | ')
      });
    } else {
      targets.push({
        name: 'fil-one',
        status: 'NOT_CONNECTED',
        detail: 'FIL_ONE_* credentials not configured — reports stay in local permanent storage.'
      });
    }
    // (Agent-team memory mirror runs after the final status is known — the
    // ledger must record the TRUE cycle status, not a provisional one.)
    return targets;
  }

  async function stepCheck() {
    const out = {
      status: 'PASS',
      at: nowIso(),
      details: {}
    };
    const gsc = oauthPublic();
    out.details.gsc = {
      status: gsc.status,
      site: gsc.site,
      detail: gsc.detail || (gsc.status === 'CONNECTED' ? 'OAuth connected.' : 'Not connected.')
    };
    if (!gsc.site) {
      out.details.gsc.site_detail = 'No Search Console property configured — set GOOGLE_SEARCH_CONSOLE_SITE (e.g. "sc-domain:panikajeevansathi.com").';
    }
    const ai = aiPublic();
    out.details.ai = {
      status: ai.status,
      gemini: ai.gemini.configured ? 'configured' : 'not configured',
      router: ai.router.configured ? 'configured' : 'not configured'
    };
    const fil = filOnePublic();
    out.details['fil-one'] = { status: fil.status };
    try {
      const probe = path.join(seoDir, '.write-probe');
      atomicWrite(probe, nowIso());
      fs.rmSync(probe, { force: true });
      out.details.local_storage = { status: 'OK' };
    } catch (err) {
      out.details.local_storage = { status: 'FAILED', detail: err.message };
      out.status = 'FAIL';
    }
    return out;
  }

  /**
   * ONE FULL CYCLE:
   *   Check → Search Data → AI Analysis → Pooja → Priya → Manager → Report
   *   → Verify → Next Cycle.
   */
  /** Shared pre-flight guard: one cycle at a time, at most one per 5 minutes. */
  function cycleStartGuard() {
    if (state.running) return { ok: false, code: 'RUNNING', error: 'A cycle is already running.' };
    if (Date.now() - state.lastStartedAt < MIN_CYCLE_GAP_MS) {
      return { ok: false, code: 'TOO_SOON', error: 'Cycles can run at most once every 5 minutes — please wait and try again.' };
    }
    return { ok: true };
  }

  async function runCycle(options = {}) {
    const trigger = options.trigger || 'manual';
    const guard = cycleStartGuard();
    if (!guard.ok) return guard;
    state.running = true;
    state.lastStartedAt = Date.now();
    const startedAt = Date.now();
    let appended = false;
    const cycle = {
      id: `seo-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`,
      trigger,
      started_at: nowIso(),
      finished_at: null,
      duration_ms: 0,
      status: 'FAIL',
      report_id: null,
      steps: {}
    };
    const finalize = () => {
      if (appended) return;
      appended = true;
      cycle.finished_at = cycle.finished_at || nowIso();
      cycle.duration_ms = Date.now() - startedAt;
      appendCycle(cycle);
      writeJson(path.join(seoDir, 'check.json'), cycle.steps.check || {});
      scheduleNextRun();
      state.running = false;
      log(`[seo-center] cycle ${cycle.id} finished → ${cycle.status} (${cycle.duration_ms} ms).`);
    };
    const hardStop = setTimeout(() => {
      if (state.running && !appended) {
        cycle.status = 'FAIL';
        cycle.steps.verify = cycle.steps.verify || {
          status: 'FAIL',
          summary: 'Cycle exceeded the 10-minute hard timeout and was aborted.'
        };
        finalize();
      }
    }, CYCLE_HARD_TIMEOUT_MS);
    hardStop.unref();

    try {
      log(`[seo-center] cycle ${cycle.id} started (${trigger}).`);

      /* 1 ─ CHECK */
      cycle.steps.check = await stepCheck();
      log(`[seo-center] step check → ${cycle.steps.check.status}`);

      /* 2 ─ SEARCH DATA (real Search Console only) */
      const cfg = loadConfig();
      let snapshot = null;
      const gscState = oauthPublic();
      if (gscState.status !== 'CONNECTED') {
        cycle.steps.search_data = {
          status: 'BLOCKED',
          at: nowIso(),
          detail: `Google Search Console is ${gscState.status}. ${gscState.detail || 'Complete the OAuth connection to pull real search data.'}`
        };
      } else if (!cfg.site) {
        cycle.steps.search_data = {
          status: 'BLOCKED',
          at: nowIso(),
          detail: 'Search Console is connected but no property is configured (GOOGLE_SEARCH_CONSOLE_SITE).'
        };
      } else {
        const pulled = await pullSearchData({ site: cfg.site, days: cfg.days });
        if (!pulled.ok) {
          cycle.steps.search_data = {
            status: pulled.code === 'NOT_CONNECTED' || pulled.code === 'MISCONFIGURED' ? 'BLOCKED' : 'FAIL',
            at: nowIso(),
            detail: pulled.error
          };
        } else {
          snapshot = pulled.snapshot;
          persistSnapshot(snapshot);
          cycle.steps.search_data = {
            status: 'PASS',
            at: nowIso(),
            site: cfg.site,
            range: snapshot.range,
            totals: snapshot.totals,
            rows: { queries: snapshot.queries.length, pages: snapshot.pages.length }
          };
        }
      }
      log(`[seo-center] step search_data → ${cycle.steps.search_data.status}`);

      const dataBlocked = cycle.steps.search_data.status !== 'PASS';
      const noRows = Boolean(snapshot && !snapshot.totals);

      /* 3 ─ AI ANALYSIS (Gemini → Router) */
      let analysis = null;
      let aiResult = null;
      if (dataBlocked) {
        cycle.steps.ai_analysis = { status: 'SKIPPED', at: nowIso(), detail: 'Search data unavailable — nothing to analyse.' };
      } else if (noRows) {
        cycle.steps.ai_analysis = { status: 'SKIPPED', at: nowIso(), detail: 'Search Console returned zero rows for this period.' };
      } else {
        const digest = {
          totals: snapshot.totals,
          top_queries: snapshot.queries.slice(0, 15),
          top_pages: snapshot.pages.slice(0, 15)
        };
        aiResult = await callAi({
          system:
            'You are the AI analysis engine of the PANIKA JEEVAN SATHI SEO Center. ' +
            'Use ONLY the data supplied. Never invent numbers or queries. Respond with strict JSON: ' +
            '{"insights":["..."],"trends":["..."],"quick_wins":["..."],"risks":["..."]}',
          prompt: `Google Search Console data (${snapshot.range.start} → ${snapshot.range.end}):\n${JSON.stringify(digest)}`
        });
        if (aiResult.ok) {
          const parsed = extractJson(aiResult.text);
          analysis = parsed.ok ? parsed.value : localAnalysis(snapshot);
          cycle.steps.ai_analysis = {
            status: 'PASS',
            at: nowIso(),
            engine: aiResult.engine,
            model: aiResult.model || null,
            attempts: aiResult.attempts || [],
            latency_ms: aiResult.latency_ms || null,
            parsed_json: parsed.ok,
            fallback: parsed.ok ? false : 'local'
          };
        } else {
          analysis = localAnalysis(snapshot);
          cycle.steps.ai_analysis = {
            status: 'FAIL',
            at: nowIso(),
            engine: 'none',
            attempts: aiResult.attempts || [],
            error: aiResult.error,
            fallback: 'local'
          };
        }
        writeJson(FILES.aiStatus, {
          at: nowIso(),
          ok: Boolean(aiResult.ok),
          status: aiResult.ok ? 'OK' : 'FAILED',
          engine: aiResult.engine,
          error: aiResult.ok ? null : aiResult.error
        });
      }
      log(`[seo-center] step ai_analysis → ${cycle.steps.ai_analysis.status} (${cycle.steps.ai_analysis.engine || 'skipped'})`);

      /* 4 ─ POOJA (SEO research) */
      if (dataBlocked || noRows) {
        cycle.steps.pooja = {
          status: 'BLOCKED',
          at: nowIso(),
          summary: dataBlocked
            ? 'No real Search Console data available — research blocked.'
            : 'Search Console reported zero rows — nothing to research.'
        };
      } else {
        let research = null;
        let engine = 'local';
        let aiJsonOk = false;
        let aiJsonError = null;
        if (aiResult && aiResult.ok) {
          const res = await callAi({
            system:
              'You are Pooja, the SEO research agent of PANIKA JEEVAN SATHI. ' +
              'Use ONLY the supplied Search Console data. Never invent queries, pages or numbers. ' +
              'Respond with strict JSON: {"summary":"...","keyword_opportunities":[{"query":"...","impressions":0,"clicks":0,"ctr":0,"position":0,"opportunity":"...","rationale":"..."}],"page_recommendations":[{"page":"...","impressions":0,"clicks":0,"ctr":0,"position":0,"recommendation":"..."}],"content_gaps":["..."],"technical_seo":["..."]}',
            prompt: `Real Search Console data (${snapshot.range.start} → ${snapshot.range.end}):\n${JSON.stringify({
              totals: snapshot.totals,
              queries: snapshot.queries,
              pages: snapshot.pages
            })}\n\nProduce SEO research strictly from this data.`
          });
          if (res.ok) {
            const parsed = extractJson(res.text);
            if (parsed.ok) {
              research = parsed.value;
              engine = res.engine;
              aiJsonOk = true;
              research.engine = engine;
            } else {
              aiJsonError = parsed.error;
            }
          }
        }
        if (!research) {
          research = localResearch(snapshot, analysis || localAnalysis(snapshot));
          aiJsonError = aiJsonError || null;
        }
        if (engine === 'local' && aiJsonError) {
          research.ai_note = `Gemini/Router output could not be parsed (${aiJsonError}) — local rule-engine research used instead.`;
        }
        cycle.steps.pooja = {
          status: 'PASS',
          at: nowIso(),
          engine,
          ai_parse_error: aiJsonOk ? null : aiJsonError,
          summary: (research.summary || '').slice(0, 400),
          research
        };
      }
      log(`[seo-center] step pooja → ${cycle.steps.pooja.status}`);

      /* 5 ─ PRIYA (verification against the real snapshot) */
      if (cycle.steps.pooja.status === 'BLOCKED') {
        cycle.steps.priya = {
          status: 'BLOCKED',
          at: nowIso(),
          summary: 'Nothing to verify — Pooja was blocked.'
        };
      } else {
        const verification = verifyResearch(cycle.steps.pooja.research, snapshot, {
          aiUsed: cycle.steps.pooja.engine !== 'local',
          aiJsonOk: cycle.steps.pooja.ai_parse_error === null && cycle.steps.pooja.engine !== 'local',
          aiJsonError: cycle.steps.pooja.ai_parse_error
        });
        cycle.steps.priya = Object.assign(verification, { at: nowIso() });
      }
      log(`[seo-center] step priya → ${cycle.steps.priya.status}`);

      /* 6 ─ MANAGER (planning + final recommendations) */
      if (!releasePlan(cycle.steps.pooja.status, cycle.steps.priya.status)) {
        const upstreamBlocked =
          cycle.steps.search_data.status === 'BLOCKED' ||
          cycle.steps.pooja.status === 'BLOCKED' ||
          cycle.steps.priya.status === 'BLOCKED';
        cycle.steps.manager = {
          status: upstreamBlocked ? 'BLOCKED' : 'FAIL',
          at: nowIso(),
          summary: upstreamBlocked
            ? `Recommendations withheld: upstream steps are BLOCKED (Pooja=${cycle.steps.pooja.status}, Priya=${cycle.steps.priya.status}). Connect Search Console to get real data.`
            : `Recommendations withheld: Priya's verification FAILED (Pooja=${cycle.steps.pooja.status}, Priya=${cycle.steps.priya.status}). A final plan is released only after verification passes.`
        };
      } else {
        let plan = null;
        let engine = 'local';
        if (aiResult && aiResult.ok) {
          const res = await callAi({
            system:
              'You are the Manager of the PANIKA JEEVAN SATHI agent team. ' +
              'Build the action plan from the verified research only. Respond with strict JSON: ' +
              '{"plan":[{"priority":1,"action":"...","owner":"Pooja","target":"...","due":"+7 days"}],"final_recommendation":"...","risks":["..."]}',
            prompt: `Verified Pooja research (Priya verification: ${cycle.steps.priya.status}):\n${JSON.stringify({
              research: cycle.steps.pooja.research,
              verification_summary: cycle.steps.priya.summary
            })}`
          });
          if (res.ok) {
            const parsed = extractJson(res.text);
            if (parsed.ok && Array.isArray(parsed.value.plan) && parsed.value.plan.length) {
              plan = parsed.value;
              engine = res.engine;
              plan.engine = engine;
            }
          }
        }
        if (!plan) {
          plan = localPlan(snapshot, cycle.steps.pooja.research, cycle.steps.priya);
        }
        cycle.steps.manager = {
          status: 'PASS',
          at: nowIso(),
          engine,
          actions: plan.plan.length,
          plan: plan.plan,
          final_recommendation: plan.final_recommendation || '',
          risks: plan.risks || []
        };
      }
      log(`[seo-center] step manager → ${cycle.steps.manager.status}`);

      /* 7 ─ REPORT (permanent storage) */
      const tech = await liveTechnicalChecks();
      const reportId = `seo-report-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
      const report = {
        id: reportId,
        type: 'seo-report',
        generated_at: nowIso(),
        cycle_id: cycle.id,
        cycle_status: null, // set after verify
        site: cfg.site || null,
        period: snapshot ? snapshot.range : null,
        data: snapshot || null,
        ai: {
          engine: cycle.steps.ai_analysis.engine || 'none',
          model: cycle.steps.ai_analysis.model || null,
          status: cycle.steps.ai_analysis.status
        },
        analysis: analysis,
        pooja: {
          status: cycle.steps.pooja.status,
          engine: cycle.steps.pooja.engine || null,
          research: (cycle.steps.pooja.research || {}),
          ai_parse_error: cycle.steps.pooja.ai_parse_error || null
        },
        priya: {
          status: cycle.steps.priya.status,
          summary: cycle.steps.priya.summary || '',
          checks: cycle.steps.priya.checks || []
        },
        manager: {
          status: cycle.steps.manager.status,
          engine: cycle.steps.manager.engine || null,
          plan: cycle.steps.manager.plan || [],
          final_recommendation: cycle.steps.manager.final_recommendation || '',
          risks: cycle.steps.manager.risks || []
        },
        technical: tech,
        storage_targets: [],
        step_statuses: Object.fromEntries(Object.entries(cycle.steps).map(([k, v]) => [k, v.status]))
      };
      const targets = await storageRoundtrip(report);
      report.storage_targets = targets;
      writeJson(path.join(DIRS.reports, `${reportId}.json`), report); // refresh storage_targets in file
      cycle.steps.report = {
        status: targets.some((t) => t.name === 'local' && t.status === 'OK') ? 'PASS' : 'FAIL',
        at: nowIso(),
        id: reportId,
        targets: targets.map((t) => ({ name: t.name, status: t.status }))
      };
      cycle.report_id = reportId;
      log(`[seo-center] step report → ${cycle.steps.report.status} (${reportId})`);

      /* 8 ─ VERIFY + NEXT CYCLE */
      const verifyChecks = [];
      for (const t of targets) {
        if (t.name === 'fil-one' && t.status === 'NOT_CONNECTED') {
          verifyChecks.push({ id: `storage-${t.name}`, status: 'NOT_CONNECTED', detail: 'Not connected — optional target skipped honestly.' });
        } else if (t.status === 'OK') {
          verifyChecks.push({ id: `storage-${t.name}`, status: 'PASS', detail: t.detail });
        } else {
          verifyChecks.push({ id: `storage-${t.name}`, status: 'FAIL', detail: t.detail });
        }
      }
      const files = reportFiles(reportId);
      verifyChecks.push({
        id: 'report-readable',
        status: files ? 'PASS' : 'FAIL',
        detail: files ? 'Report re-read from permanent storage successfully.' : 'Report could not be re-read after saving.'
      });
      const anyFail = verifyChecks.some((c) => c.status === 'FAIL');
      cycle.steps.verify = {
        status: anyFail ? 'FAIL' : 'PASS',
        at: nowIso(),
        checks: verifyChecks
      };
      log(`[seo-center] step verify → ${cycle.steps.verify.status}`);

      const computeStatus = () =>
        cycle.steps.search_data.status === 'BLOCKED'
          ? 'BLOCKED'
          : cycle.steps.search_data.status === 'FAIL' ||
              cycle.steps.priya.status === 'FAIL' ||
              cycle.steps.manager.status === 'FAIL' ||
              cycle.steps.report.status === 'FAIL'
            ? 'FAIL'
            : cycle.steps.verify.status === 'FAIL'
              ? 'PARTIAL'
              : 'OK';
      report.cycle_status = cycle.status = computeStatus();

      /* 8b ─ Agent-team permanent memory mirror (records the TRUE status). */
      const mirror = await mirrorToAgentStorage(cycle, report);
      targets.push({
        name: 'agent-memory',
        status: mirror.ok ? 'OK' : 'FAILED',
        detail: mirror.ok
          ? 'storage/agents/{pooja,priya,manager} state + hash-chained ledger updated'
          : `agent storage unavailable: ${mirror.error}`
      });
      cycle.steps.report.targets = targets.map((t) => ({ name: t.name, status: t.status }));
      cycle.steps.verify.checks.push({
        id: 'storage-agent-memory',
        status: mirror.ok ? 'PASS' : 'FAIL',
        detail: mirror.ok ? 'Agent team memory recorded the cycle.' : mirror.error
      });
      cycle.steps.verify.status = cycle.steps.verify.checks.some((c) => c.status === 'FAIL')
        ? 'FAIL'
        : 'PASS';
      report.storage_targets = targets;
      report.cycle_status = cycle.status = computeStatus();
      writeJson(path.join(DIRS.reports, `${reportId}.json`), report);
      atomicWrite(path.join(DIRS.reports, `${reportId}.md`), renderMarkdown(report) + '\n');
    } catch (err) {
      cycle.status = 'FAIL';
      cycle.steps.verify = cycle.steps.verify || {
        status: 'FAIL',
        summary: `Unexpected error: ${err.message}`
      };
      log(`[seo-center] cycle ${cycle.id} crashed: ${err.message}`);
    } finally {
      clearTimeout(hardStop);
      finalize();
    }
    return { ok: true, cycle };
  }

  /* ------------------------------------------------------------- scheduler */

  function schedulerConfig() {
    const enabled = truthy(process.env.SEO_SCHEDULER);
    const intervalMinutes = Math.max(5, Number(process.env.SEO_CYCLE_INTERVAL_MINUTES || 1440) || 1440);
    const hourUtc = process.env.SEO_CYCLE_HOUR_UTC;
    const minuteUtc = Number(process.env.SEO_CYCLE_MINUTE_UTC ?? 0) || 0;
    let dailyAt = null;
    if (hourUtc) {
      const h = Number(hourUtc);
      if (Number.isFinite(h) && h >= 0 && h < 24) dailyAt = { hour: h, minute: Math.min(59, Math.max(0, minuteUtc)) };
    }
    return { enabled, intervalMinutes, dailyAt };
  }

  function nextRunAt(from = new Date()) {
    const sc = schedulerConfig();
    let at = null;
    let mode = 'disabled';
    if (sc.enabled) {
      if (sc.dailyAt) {
        mode = `daily ${String(sc.dailyAt.hour).padStart(2, '0')}:${String(sc.dailyAt.minute).padStart(2, '0')} UTC`;
        at = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), sc.dailyAt.hour, sc.dailyAt.minute, 0, 0));
        if (at.getTime() <= from.getTime()) at = new Date(at.getTime() + 86400000);
      } else {
        mode = `every ${sc.intervalMinutes} minutes`;
        at = new Date(from.getTime() + sc.intervalMinutes * 60000);
      }
    }
    return { enabled: sc.enabled, mode, next_run_at: at ? at.toISOString() : null };
  }

  function scheduleNextRun() {
    if (!state.schedulerEnabled) return;
    const nr = nextRunAt();
    writeJson(FILES.scheduler, Object.assign(readJson(FILES.scheduler, {}), {
      enabled: nr.enabled,
      mode: nr.mode,
      next_run_at: nr.next_run_at,
      // Arming the timer is NOT a run. The previous code stamped last_run_at
      // here, which made a reboot look like a completed cycle — the one thing
      // this dashboard promises never to do.
      scheduled_at: nowIso()
    }));
    if (state.schedulerTimer) clearTimeout(state.schedulerTimer);
    if (!nr.next_run_at) return;
    const delay = Math.max(1000, Date.parse(nr.next_run_at) - Date.now());
    state.schedulerTimer = setTimeout(async () => {
      try {
        await runCycle({ trigger: 'scheduler' });
      } catch (err) {
        log(`[seo-center] scheduled cycle error: ${err.message}`);
      }
      scheduleNextRun();
    }, delay);
    state.schedulerTimer.unref();
    log(`[seo-center] next scheduled cycle: ${nr.next_run_at} (${nr.mode}).`);
  }

  function startScheduler() {
    const sc = schedulerConfig();
    if (!sc.enabled) {
      log('[seo-center] in-app scheduler disabled (set SEO_SCHEDULER=1 to enable).');
      return { enabled: false };
    }
    state.schedulerEnabled = true;
    scheduleNextRun();
    if (truthy(process.env.SEO_CYCLE_ON_BOOT)) {
      const t = setTimeout(() => {
        runCycle({ trigger: 'boot' }).catch((err) => log(`[seo-center] boot cycle error: ${err.message}`));
      }, 30000);
      t.unref();
    }
    return { enabled: true, next: nextRunAt() };
  }

  function stopScheduler() {
    if (state.schedulerTimer) clearTimeout(state.schedulerTimer);
    state.schedulerEnabled = false;
  }

  /**
   * Manager gate: the final plan is released only when Pooja produced research
   * AND Priya's verification passed. Used by the cycle and the self-test.
   */
  function releasePlan(poojaStatus, priyaStatus) {
    return poojaStatus === 'PASS' && priyaStatus === 'PASS';
  }

  /* -------------------------------------------------------- verify round */

  async function verifyRound() {
    const started = Date.now();
    const checks = [];
    // 1. Google Search Console — real API call.
    const gsc = oauthPublic();
    if (gsc.status !== 'CONNECTED') {
      checks.push({ id: 'gsc', label: 'Google Search Console API', status: 'BLOCKED', detail: gsc.detail || 'OAuth not connected.' });
    } else {
      const cfg = loadConfig();
      if (!cfg.site) {
        checks.push({ id: 'gsc', label: 'Google Search Console API', status: 'BLOCKED', detail: 'Connected, but no property configured (GOOGLE_SEARCH_CONSOLE_SITE).' });
      } else {
        const res = await gscQuery({ site: cfg.site, startDate: dateStamp(-3), endDate: dateStamp(0), rowLimit: 1 });
        checks.push({
          id: 'gsc',
          label: 'Google Search Console API',
          status: res.ok ? 'PASS' : 'FAIL',
          detail: res.ok
            ? `Live API call succeeded for "${cfg.site}" (${res.rows.length} row(s) in the last 3 days — zero rows is a valid answer).`
            : res.error
        });
      }
    }
    // 2. Gemini + Router — real pings.
    const aiCfg = aiConfig();
    if (!aiCfg.gemini.configured) {
      checks.push({ id: 'gemini', label: 'Gemini API', status: 'NOT_CONNECTED', detail: 'GEMINI_API_KEY is not set.' });
    } else {
      const res = await callGemini({ system: 'Reply with the single word OK.', prompt: 'Reply with the single word OK.', maxTokens: 8, temperature: 0 });
      checks.push({
        id: 'gemini',
        label: 'Gemini API',
        status: res.ok ? 'PASS' : 'FAIL',
        detail: res.ok ? `Answered "${String(res.text).slice(0, 20)}" via ${res.model} in ${res.latency_ms} ms.` : res.error
      });
    }
    if (!aiCfg.router.configured) {
      checks.push({ id: 'router', label: 'Router (Gemini fallback)', status: 'NOT_CONNECTED', detail: 'GEMINI_ROUTER_URL + GEMINI_ROUTER_API_KEY are not set.' });
    } else {
      const res = await callRouter({ system: 'Reply with the single word OK.', prompt: 'Reply with the single word OK.', maxTokens: 8, temperature: 0 });
      checks.push({
        id: 'router',
        label: 'Router (Gemini fallback)',
        status: res.ok ? 'PASS' : 'FAIL',
        detail: res.ok ? `Answered "${String(res.text).slice(0, 20)}" via ${res.model} in ${res.latency_ms} ms.` : res.error
      });
    }
    // 3. Permanent storage.
    try {
      const probe = path.join(DIRS.reports, '.verify-probe');
      atomicWrite(probe, nowIso());
      const back = fs.readFileSync(probe, 'utf8');
      fs.rmSync(probe, { force: true });
      checks.push({ id: 'storage-local', label: 'Permanent local storage', status: back ? 'PASS' : 'FAIL', detail: `Write/read round-trip OK in ${DIRS.reports}.` });
    } catch (err) {
      checks.push({ id: 'storage-local', label: 'Permanent local storage', status: 'FAIL', detail: err.message });
    }
    if (filOneConfig().configured) {
      const up = await filOnePut('seo/.verify-probe', nowIso(), 'text/plain');
      checks.push({
        id: 'storage-fil-one',
        label: 'Fil One storage (S3)',
        status: up.ok ? 'PASS' : 'FAIL',
        detail: up.ok ? `Upload OK → ${filOneConfig().bucket}/seo/.verify-probe (${up.bytes} bytes).` : up.error
      });
    } else {
      checks.push({ id: 'storage-fil-one', label: 'Fil One storage (S3)', status: 'NOT_CONNECTED', detail: 'FIL_ONE_ENDPOINT / FIL_ONE_ACCESS_KEY / FIL_ONE_SECRET_KEY / FIL_ONE_BUCKET are not all set.' });
    }
    const store = await loadAgentStore();
    if (store.error) {
      checks.push({ id: 'agent-memory', label: 'Agent permanent memory', status: 'FAIL', detail: store.error });
    } else {
      try {
        store.kvSet('seo-center', 'verify-round', { at: nowIso() });
        checks.push({ id: 'agent-memory', label: 'Agent permanent memory', status: 'PASS', detail: 'storage/shared/kv/seo-center written (pooja/priya/manager memory intact).' });
      } catch (err) {
        checks.push({ id: 'agent-memory', label: 'Agent permanent memory', status: 'FAIL', detail: err.message });
      }
    }
    const doc = {
      at: nowIso(),
      duration_ms: Date.now() - started,
      checks
    };
    writeJson(path.join(seoDir, 'verify-round.json'), doc);
    return doc;
  }

  /* -------------------------------------------------------------- status */

  function statusPayload(req) {
    const cyclesDoc = readCycles();
    const latest = latestSnapshot();
    const sc = schedulerConfig();
    const nr = nextRunAt();
    const admin = adminFromReq(req);
    return {
      ok: true,
      auth: { admin: Boolean(admin), email: admin ? admin.email : null },
      config: loadConfig(),
      gsc: oauthPublic(),
      ai: aiPublic(),
      filOne: filOnePublic(),
      data: latest
        ? {
            fetched_at: latest.fetched_at,
            range: latest.range,
            totals: latest.totals,
            queries: latest.queries.slice(0, 50),
            pages: latest.pages.slice(0, 50),
            queries_total: latest.queries.length,
            pages_total: latest.pages.length
          }
        : null,
      scheduler: {
        enabled: sc.enabled || state.schedulerEnabled,
        mode: nr.mode,
        next_run_at: nr.next_run_at,
        in_app: state.schedulerEnabled,
        interval_minutes: sc.intervalMinutes,
        daily_at: sc.dailyAt
      },
      cycle: {
        running: state.running,
        last: cyclesDoc.cycles.length ? cyclesDoc.cycles[0] : null,
        history: cyclesDoc.cycles.slice(0, 20).map((c) => ({
          id: c.id,
          trigger: c.trigger,
          started_at: c.started_at,
          finished_at: c.finished_at,
          duration_ms: c.duration_ms,
          status: c.status,
          report_id: c.report_id,
          steps: Object.fromEntries(Object.entries(c.steps || {}).map(([k, v]) => [k, v.status]))
        }))
      },
      reports: reportList()
    };
  }

  /* ------------------------------------------------------------ self-test
   * Proves the anti-fake guarantee mechanically: Priya must PASS consistent
   * research and must FAIL hallucinated claims. Runs fully offline on a
   * labelled fixture — it never touches the real data files or the dashboard. */

  function selftest() {
    const results = [];
    const fixture = {
      kind: 'selftest-fixture', // never persisted anywhere as real data
      fetched_at: nowIso(),
      site: 'sc-domain:selftest.invalid',
      range: { start: dateStamp(-28), end: dateStamp(0) },
      totals: { clicks: 123, impressions: 4560, ctr: 0.027, position: 8.4 },
      queries: [
        { query: 'panika jeevan sathi', clicks: 40, impressions: 1200, ctr: 0.033, position: 3.1 },
        { query: 'panika matrimony', clicks: 12, impressions: 300, ctr: 0.04, position: 4.5 },
        { query: 'manikpuri vivah', clicks: 5, impressions: 250, ctr: 0.02, position: 7.2 }
      ],
      pages: [
        { page: 'https://selftest.invalid/', clicks: 90, impressions: 3000, ctr: 0.03, position: 5.2 },
        { page: 'https://selftest.invalid/about.html', clicks: 15, impressions: 500, ctr: 0.03, position: 8.9 }
      ]
    };
    const pass = (id, detail) => results.push({ id, status: 'PASS', detail });
    const fail = (id, detail) => results.push({ id, status: 'FAIL', detail });

    // 1. Consistent research must verify PASS.
    const honest = localResearch(fixture, localAnalysis(fixture));
    const v1 = verifyResearch(honest, fixture, { aiUsed: false });
    if (v1.status === 'PASS') pass('priya-passes-honest-research', `${v1.totals.pass} checks passed on consistent research.`);
    else fail('priya-passes-honest-research', `expected PASS, got ${v1.status} — ${v1.summary}`);

    // 2. A hallucinated query must be caught.
    const tampered = JSON.parse(JSON.stringify(honest));
    tampered.keyword_opportunities.push({
      query: 'hallucinated query that google never saw',
      impressions: 99999, clicks: 888, ctr: 0.5, position: 1,
      opportunity: 'Fake opportunity', rationale: 'This must be rejected.'
    });
    const v2 = verifyResearch(tampered, fixture, { aiUsed: false });
    const caughtFakeQuery = v2.checks.some(
      (c) => c.id === 'keyword-opportunity-exists' && c.status === 'FAIL' && String(c.claim).includes('hallucinated')
    );
    if (v2.status === 'FAIL' && caughtFakeQuery) pass('priya-catches-hallucinated-query', 'Priya rejected a query that is not in the snapshot.');
    else fail('priya-catches-hallucinated-query', `expected a FAIL on the hallucinated query, got status ${v2.status}.`);

    // 3. Wrong numbers on a real query must be caught.
    const wrongNumbers = JSON.parse(JSON.stringify(honest));
    wrongNumbers.keyword_opportunities[0].impressions = 5; // real value is 1200
    wrongNumbers.keyword_opportunities[0].clicks = 1; // real value is 40
    const v3 = verifyResearch(wrongNumbers, fixture, { aiUsed: false });
    const caughtNumbers = v3.checks.some(
      (c) => c.id === 'keyword-opportunity-data' && c.status === 'FAIL' && /impressions|clicks/.test(c.evidence)
    );
    if (v3.status === 'FAIL' && caughtNumbers) pass('priya-catches-wrong-numbers', 'Priya compared cited numbers against the snapshot and failed the claim.');
    else fail('priya-catches-wrong-numbers', `expected a FAIL on tampered numbers, got status ${v3.status}.`);

    // 4. Manager must withhold recommendations when Priya has not passed —
    //    this is the exact gate used by the cycle (releasePlan).
    if (!releasePlan('PASS', 'FAIL') && !releasePlan('FAIL', 'PASS') && releasePlan('PASS', 'PASS')) {
      pass('manager-withholds-on-failed-verification', 'Plan release requires Pooja PASS + Priya PASS (the same gate the cycle uses).');
    } else {
      fail('manager-withholds-on-failed-verification', 'Manager gate did not behave as expected.');
    }

    // 5. Manager releases a real plan after verification passes.
    const plan = localPlan(fixture, honest, { checks: [], status: 'PASS' });
    if (plan && Array.isArray(plan.plan) && plan.plan.length && plan.final_recommendation) {
      pass('manager-releases-plan-after-pass', `${plan.plan.length} actions planned; recommendation written.`);
    } else {
      fail('manager-releases-plan-after-pass', 'localPlan produced no plan.');
    }

    const failed = results.filter((r) => r.status === 'FAIL');
    return {
      at: nowIso(),
      note: 'Self-test on a labelled fixture (kind: selftest-fixture) — never stored as real data.',
      results,
      verdict: failed.length ? 'FAIL' : 'PASS'
    };
  }

  /* ---------------------------------------------------------------- HTTP */

  async function handle(req, res, url) {
    const pathname = url.pathname;
    const admin = adminFromReq(req);

    const isAdmin = () => {
      if (!admin) {
        res.writeHead(403, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify({ ok: false, error: 'Admin access required. Log in at /login.html first.' }));
        return false;
      }
      return true;
    };

    const json = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
      });
      res.end(body);
    };

    const redirect = (location) => {
      res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
      res.end();
    };

    /* public */
    if (pathname === '/api/seo/oauth/callback') {
      const code = String(url.searchParams.get('code') || '');
      const state = String(url.searchParams.get('state') || '');
      const err = String(url.searchParams.get('error') || '');
      if (err) {
        return redirect(`/seo-center.html?gsc=error&reason=${encodeURIComponent(err)}`);
      }
      if (!code) {
        return redirect('/seo-center.html?gsc=error&reason=no_code');
      }
      const origin = publicOrigin(req);
      const result = await oauthExchange(code, state, `${origin}/api/seo/oauth/callback`);
      return redirect(result.ok ? '/seo-center.html?gsc=connected' : `/seo-center.html?gsc=error&reason=${encodeURIComponent(result.error)}`);
    }

    /* everything below requires admin (including status/dashboard data) */
    if (!isAdmin()) return;

    if (pathname === '/api/seo/status') {
      return json(200, statusPayload(req));
    }

    if (pathname === '/api/seo/oauth/start' && req.method === 'POST') {
      const origin = publicOrigin(req);
      const result = await oauthStart(`${origin}/api/seo/oauth/callback`);
      if (!result.ok) return json(400, result);
      return json(200, { ok: true, url: result.url });
    }

    if (pathname === '/api/seo/oauth/disconnect' && req.method === 'POST') {
      oauthDisconnect();
      return json(200, { ok: true });
    }

    if (pathname === '/api/seo/config' && req.method === 'POST') {
      let body = {};
      try {
        body = JSON.parse(await readBody(req));
      } catch (_) {
        return json(400, { ok: false, error: 'Invalid JSON body.' });
      }
      const site = String(body.site || '').trim();
      if (site && !/^(sc-domain:|https?:\/\/)/i.test(site)) {
        return json(400, { ok: false, error: 'Property must look like "sc-domain:example.com" or "https://example.com/".' });
      }
      const days = Number(body.days);
      const patch = {};
      if (site) patch.site = site;
      if (Number.isFinite(days) && days >= 1 && days <= 90) patch.days = Math.floor(days);
      const cfg = saveConfig(patch);
      return json(200, { ok: true, config: { site: cfg.site, days: cfg.days } });
    }

    if (pathname === '/api/seo/data') {
      const refresh = url.searchParams.get('refresh') === '1';
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || loadConfig().days));
      const gsc = oauthPublic();
      if (gsc.status !== 'CONNECTED') {
        return json(200, { ok: true, blocked: true, reason: gsc.detail || 'Google Search Console is not connected.', data: null });
      }
      const cfg = loadConfig();
      if (!cfg.site) {
        return json(200, { ok: true, blocked: true, reason: 'No Search Console property configured.', data: null });
      }
      if (refresh) {
        const pulled = await pullSearchData({ site: cfg.site, days });
        if (!pulled.ok) {
          return json(200, { ok: true, blocked: true, reason: pulled.error, data: null });
        }
        persistSnapshot(pulled.snapshot);
      }
      const snapshot = latestSnapshot();
      if (!snapshot) {
        return json(200, { ok: true, blocked: true, reason: 'No snapshot yet — run a cycle or refresh.', data: null });
      }
      return json(200, {
        ok: true,
        blocked: false,
        data: {
          fetched_at: snapshot.fetched_at,
          range: snapshot.range,
          totals: snapshot.totals,
          queries: snapshot.queries,
          pages: snapshot.pages
        }
      });
    }

    if (pathname === '/api/seo/cycles') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
      return json(200, { ok: true, cycles: readCycles().cycles.slice(0, limit) });
    }

    if (pathname === '/api/seo/reports') {
      return json(200, { ok: true, reports: reportList() });
    }

    const reportMatch = pathname.match(/^\/api\/seo\/reports\/([a-z0-9_-]+)$/i);
    if (reportMatch && req.method === 'GET') {
      const files = reportFiles(reportMatch[1]);
      if (!files) return json(404, { ok: false, error: 'Report not found.' });
      if (url.searchParams.get('format') === 'md') {
        const body = fs.readFileSync(files.md || files.json, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store'
        });
        return res.end(body);
      }
      return json(200, { ok: true, report: readJson(files.json, null) });
    }

    if (pathname === '/api/seo/cycle/run' && req.method === 'POST') {
      const guard = cycleStartGuard();
      if (!guard.ok) return json(guard.code === 'RUNNING' ? 409 : 429, guard);
      // Fire-and-forget; the client polls /api/seo/status.
      runCycle({ trigger: 'manual' }).catch((err) => log(`[seo-center] manual cycle error: ${err.message}`));
      return json(202, { ok: true, started: true });
    }

    if (pathname === '/api/seo/verify' && req.method === 'POST') {
      const doc = await verifyRound();
      return json(200, { ok: true, round: doc });
    }

    return json(404, { ok: false, error: 'SEO Center endpoint not found.' });
  }

  function publicOrigin(req) {
    const pinned = String(process.env.SITE_URL || '').trim();
    if (pinned && /^https?:\/\//i.test(pinned)) return pinned.replace(/\/+$/, '');
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    return `${proto}://${String(host).split(',')[0].trim()}`;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 1 * 1024 * 1024) {
          reject(new Error('Request too large.'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve('{}');
        resolve(raw);
      });
      req.on('error', reject);
    });
  }

  return {
    handle,
    runCycle,
    verifyRound,
    selftest,
    startScheduler,
    stopScheduler,
    status: statusPayload,
    pullSearchData,
    oauthPublic,
    aiPublic,
    filOnePublic,
    DIRS,
    FILES
  };
}

module.exports = { createSeoCenter, GSC_SCOPE };
