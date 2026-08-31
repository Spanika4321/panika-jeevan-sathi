'use strict';
/**
 * PANIKA JEEVAN SATHI — SEO Center.
 *
 *   GOOGLE SEARCH DATA  →  AI ENGINE (Gemini → router)  →  POOJA (research)
 *                          →  PRIYA (verification)  →  MANAGER (plan)
 *                          →  SEO REPORT  →  PERMANENT STORAGE  →  next cycle
 *
 * Everything in here runs on the server. API keys and OAuth tokens are read
 * from the environment / encrypted database rows and are never serialised into
 * a response. When an integration is missing or broken the center reports
 * NOT_CONNECTED or BLOCKED with the real reason — it never fabricates metrics
 * and never reports a passing status it cannot prove.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');

const gscLib = require('./gsc');
const aiLib = require('./ai');
const agents = require('./agents');
const storeLib = require('./store');
const s3Lib = require('../s3');

const SCHEMA = 'pjs-seo-report/v1';

const STAGES = [
  { key: 'check', label: 'Check' },
  { key: 'search_data', label: 'Search data' },
  { key: 'ai_analysis', label: 'AI analysis' },
  { key: 'pooja', label: 'Pooja (research)' },
  { key: 'priya', label: 'Priya (verification)' },
  { key: 'manager', label: 'Manager (plan)' },
  { key: 'report', label: 'Report' },
  { key: 'verify', label: 'Verify storage' }
];

const DAY_MS = 86400000;

function nowIso() {
  return new Date().toISOString();
}

function clampDays(value) {
  const days = Number(value || 28);
  if (!Number.isFinite(days)) return 28;
  return Math.max(7, Math.min(90, Math.round(days)));
}

function createSeoCenter(options = {}) {
  const db = options.db;
  const dataDir = options.dataDir || process.cwd();
  const secret = options.secret || '';
  const log = options.log || (() => {});
  const env = options.env || process.env;
  // Only the test suite injects a transport; the server never does. There is no
  // demo mode and no sample data in the production path.
  const fetchImpl = options.fetchImpl;

  const store = storeLib.createStore({ db, dataDir, secret, log });
  const ai = aiLib.createRouter({ env, fetchImpl, log });

  const gscConfig = gscLib.configFromEnv(env);
  const s3Config = s3Lib.configFromEnv(env);
  const s3 = s3Config ? s3Lib.createClient(s3Config, { fetchImpl, log }) : null;

  const runtime = {
    running: false,
    lastCycleAt: 0,
    lastCycleStatus: null,
    timer: null,
    oauthStates: new Map(),
    cachedServiceToken: null,
    lastAiEngine: null,
    lastArchiveProbe: null
  };

  /* ------------------------------------------------------------- tokens */

  function defaultRedirectUri(requestOrigin) {
    if (gscConfig.redirectUri) return gscConfig.redirectUri;
    const base = String(env.SITE_URL || requestOrigin || '').replace(/\/+$/, '');
    return base ? `${base}/api/seo/connect/callback` : '';
  }

  /**
   * The only place that produces a Google access token.
   * Priority: stored OAuth connection → env refresh token → service account.
   */
  async function getAccessToken({ forceRefresh = false } = {}) {
    const connection = store.loadConnection();

    if (connection && connection.refreshToken && gscConfig.clientId && gscConfig.clientSecret) {
      const fresh = !forceRefresh && connection.accessToken && connection.expiresAt > Date.now() + 60000;
      if (fresh) return connection.accessToken;
      const tokens = await gscLib.refreshAccessToken({
        refreshToken: connection.refreshToken,
        clientId: gscConfig.clientId,
        clientSecret: gscConfig.clientSecret,
        fetchImpl,
        timeoutMs: gscConfig.timeoutMs
      });
      store.saveConnection({
        method: connection.method,
        accountEmail: connection.accountEmail,
        scope: tokens.scope || connection.scope,
        siteUrl: connection.siteUrl,
        accessToken: tokens.accessToken,
        expiresAt: Date.now() + Number(tokens.expiresIn || 3600) * 1000 - 30000,
        refreshToken: tokens.refreshToken || connection.refreshToken,
        connected: true,
        error: '',
        verifiedAt: Date.now()
      });
      return tokens.accessToken;
    }

    if (connection && connection.accessToken && connection.expiresAt > Date.now() + 30000 && !forceRefresh) {
      return connection.accessToken;
    }

    if (gscConfig.staticRefreshToken && gscConfig.clientId && gscConfig.clientSecret) {
      const tokens = await gscLib.refreshAccessToken({
        refreshToken: gscConfig.staticRefreshToken,
        clientId: gscConfig.clientId,
        clientSecret: gscConfig.clientSecret,
        fetchImpl,
        timeoutMs: gscConfig.timeoutMs
      });
      store.saveConnection({
        method: 'env_refresh_token',
        accountEmail: connection ? connection.accountEmail : '',
        scope: tokens.scope || gscLib.SCOPE_READONLY,
        siteUrl: connection && connection.siteUrl ? connection.siteUrl : gscConfig.siteUrl,
        accessToken: tokens.accessToken,
        expiresAt: Date.now() + Number(tokens.expiresIn || 3600) * 1000 - 30000,
        refreshToken: gscConfig.staticRefreshToken,
        connected: true,
        error: '',
        verifiedAt: Date.now()
      });
      return tokens.accessToken;
    }

    if (gscConfig.serviceAccountReady) {
      const cached = runtime.cachedServiceToken;
      if (cached && cached.expiresAt > Date.now() + 60000) return cached.accessToken;
      const tokens = await gscLib.serviceAccountToken({
        serviceAccount: gscConfig.serviceAccount,
        fetchImpl,
        timeoutMs: gscConfig.timeoutMs
      });
      runtime.cachedServiceToken = {
        accessToken: tokens.accessToken,
        expiresAt: Date.now() + Number(tokens.expiresIn || 3600) * 1000 - 60000
      };
      return tokens.accessToken;
    }

    throw new gscLib.GscError('Google Search Console is not connected on this server.');
  }

  const gsc = gscLib.createClient({ fetchImpl, getAccessToken, limits: { maxRows: gscConfig.maxRows } });

  /* ------------------------------------------------------------ status */

  function connectionState() {
    const connection = store.connectionSummary();
    const envStatus = gscLib.envStatus(env);

    if (connection && connection.connected && connection.tokens_present) {
      return {
        state: 'CONNECTED',
        method: connection.method,
        account: connection.account_email || (gscConfig.serviceAccount && gscConfig.serviceAccount.clientEmail) || '',
        site_url: connection.site_url || gscConfig.siteUrl || '',
        reason: '',
        last_verified_at: connection.verified_at,
        last_error: connection.error || '',
        env: envStatus
      };
    }

    if (connection && connection.error) {
      return {
        state: 'BLOCKED',
        method: connection.method,
        account: connection.account_email || '',
        site_url: connection.site_url || gscConfig.siteUrl || '',
        reason: connection.error,
        last_verified_at: connection.verified_at,
        last_error: connection.error,
        env: envStatus
      };
    }

    if (gscConfig.serviceAccount && gscConfig.serviceAccount.error) {
      return {
        state: 'BLOCKED',
        method: 'service_account',
        account: '',
        site_url: gscConfig.siteUrl || '',
        reason: gscConfig.serviceAccount.error,
        last_verified_at: 0,
        last_error: gscConfig.serviceAccount.error,
        env: envStatus
      };
    }

    if (gscConfig.serviceAccountReady) {
      return {
        state: 'CONNECTED',
        method: 'service_account',
        account: gscConfig.serviceAccount.clientEmail,
        site_url: gscConfig.siteUrl || '',
        reason: '',
        last_verified_at: 0,
        last_error: '',
        env: envStatus
      };
    }

    if (gscConfig.refreshReady) {
      return {
        state: 'CONNECTED',
        method: 'env_refresh_token',
        account: '',
        site_url: gscConfig.siteUrl || '',
        reason: '',
        last_verified_at: 0,
        last_error: '',
        env: envStatus
      };
    }

    return {
      state: 'NOT_CONNECTED',
      method: gscConfig.oauthReady ? 'oauth_ready' : null,
      account: '',
      site_url: gscConfig.siteUrl || '',
      reason: gscConfig.oauthReady
        ? 'Google OAuth is configured on this server but no Google account has authorised the site yet.'
        : 'No Google credentials are configured on this server (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET, or GSC_REFRESH_TOKEN, or GSC_SERVICE_ACCOUNT_JSON).',
      last_verified_at: 0,
      last_error: '',
      env: envStatus
    };
  }

  async function archiveStatus({ probe = false } = {}) {
    const configured = Boolean(s3);
    const base = {
      provider: s3Config ? s3Config.provider : 'fil_one',
      configured,
      bucket: s3Config ? s3Config.bucket : '',
      endpoint: s3Config ? s3Config.endpoint : '',
      prefix: s3Config ? s3Config.prefix : '',
      env: s3Lib.envStatus(env),
      state: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      reason: configured ? '' : 'Fil One object storage is not configured (FILONE_ENDPOINT, FILONE_BUCKET, FILONE_ACCESS_KEY_ID, FILONE_SECRET_ACCESS_KEY).',
      last_probe: runtime.lastArchiveProbe
    };
    if (!configured || !probe) return base;

    try {
      const ok = await s3.ping();
      runtime.lastArchiveProbe = { at: nowIso(), ok, error: '' };
      return Object.assign(base, {
        state: ok ? 'CONNECTED' : 'BLOCKED',
        reason: ok ? '' : 'The write/read probe did not return the stored object.',
        last_probe: runtime.lastArchiveProbe
      });
    } catch (err) {
      runtime.lastArchiveProbe = { at: nowIso(), ok: false, error: String(err.message || err).slice(0, 300) };
      return Object.assign(base, {
        state: 'BLOCKED',
        reason: String(err.message || err).slice(0, 300),
        last_probe: runtime.lastArchiveProbe
      });
    }
  }

  function schedulerStatus() {
    const minutes = Number(env.PJS_SEO_AUTO_CYCLE_MINUTES || 0);
    return {
      enabled: minutes >= 5,
      interval_minutes: minutes >= 5 ? minutes : 0,
      next_run_in_ms: minutes >= 5 && runtime.lastCycleAt ? Math.max(0, minutes * 60000 - (Date.now() - runtime.lastCycleAt)) : null,
      last_run_at: runtime.lastCycleAt || null,
      last_status: runtime.lastCycleStatus,
      running: runtime.running
    };
  }

  async function status() {
    return {
      schema: SCHEMA,
      generated_at: nowIso(),
      site_url_default: gscConfig.siteUrl || '',
      google_search_console: connectionState(),
      ai: Object.assign(ai.status(), { last_engine: runtime.lastAiEngine }),
      storage: {
        database: { kind: db.kind || 'unknown', reports: store.counts().reports, cycles: store.counts().cycles },
        disk: {
          directory: store.dir,
          reports_directory: store.reportsDir,
          writable: writable(store.dir)
        },
        tokens_encrypted: store.encryption.available,
        tokens_algorithm: store.encryption.algorithm,
        archive: await archiveStatus({ probe: false })
      },
      scheduler: schedulerStatus(),
      stages: STAGES,
      security: {
        keys_server_side_only: true,
        values_returned_to_browser: 'none — only booleans, labels and error text'
      }
    };
  }

  function writable(dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ------------------------------------------------------------- OAuth */

  function connectStart({ requestOrigin = '' } = {}) {
    const redirectUri = defaultRedirectUri(requestOrigin);
    if (!gscConfig.oauthReady) {
      return {
        ok: false,
        state: 'BLOCKED',
        reason:
          'Google OAuth needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in this service’s environment. Without them the browser flow cannot start.'
      };
    }
    if (!redirectUri) {
      return {
        ok: false,
        state: 'BLOCKED',
        reason: 'No redirect URI could be determined — set SITE_URL or GOOGLE_REDIRECT_URI.'
      };
    }
    const state = crypto.randomBytes(16).toString('hex');
    runtime.oauthStates.set(state, { at: Date.now(), redirectUri });
    // Keep the map small; states live 10 minutes.
    for (const [key, value] of runtime.oauthStates) {
      if (Date.now() - value.at > 10 * 60000) runtime.oauthStates.delete(key);
    }
    return {
      ok: true,
      state: 'READY',
      authorization_url: gscLib.authorizationUrl({
        clientId: gscConfig.clientId,
        redirectUri,
        state,
        scope: `${gscLib.SCOPE_READONLY} ${gscLib.SCOPE_IDENTITY}`
      }),
      redirect_uri: redirectUri,
      scope: `${gscLib.SCOPE_READONLY} ${gscLib.SCOPE_IDENTITY}`
    };
  }

  async function connectCallback({ code, state }) {
    const pending = runtime.oauthStates.get(String(state || ''));
    if (!pending) {
      return { ok: false, state: 'BLOCKED', reason: 'The OAuth state did not match (the login link expired or was reused). Connect again.' };
    }
    runtime.oauthStates.delete(String(state));
    if (!code) return { ok: false, state: 'BLOCKED', reason: 'Google did not return an authorisation code.' };

    try {
      const tokens = await gscLib.exchangeCode({
        code,
        clientId: gscConfig.clientId,
        clientSecret: gscConfig.clientSecret,
        redirectUri: pending.redirectUri,
        fetchImpl,
        timeoutMs: gscConfig.timeoutMs
      });

      store.saveConnection({
        method: 'oauth',
        accountEmail: tokens.email,
        scope: tokens.scope,
        siteUrl: gscConfig.siteUrl,
        accessToken: tokens.accessToken,
        expiresAt: Date.now() + Number(tokens.expiresIn || 3600) * 1000 - 30000,
        refreshToken: tokens.refreshToken,
        connected: true,
        error: '',
        verifiedAt: Date.now()
      });

      // Prove the connection actually works before calling it CONNECTED.
      let properties = [];
      let siteUrl = gscConfig.siteUrl;
      try {
        properties = await gsc.listSites();
        if (!siteUrl && properties.length) siteUrl = properties[0].site_url;
        if (siteUrl) {
          const connection = store.loadConnection();
          store.saveConnection(Object.assign({}, connection, { siteUrl, verifiedAt: Date.now() }));
        }
      } catch (err) {
        store.saveConnection({
          method: 'oauth',
          accountEmail: tokens.email,
          scope: tokens.scope,
          siteUrl,
          accessToken: tokens.accessToken,
          expiresAt: Date.now() + Number(tokens.expiresIn || 3600) * 1000 - 30000,
          refreshToken: tokens.refreshToken,
          connected: true,
          error: `Authorised, but Search Console refused the property list: ${gscLib.describeError(err)}`,
          verifiedAt: 0
        });
        return {
          ok: false,
          state: 'BLOCKED',
          reason: `Google authorised the account, but Search Console could not be read: ${gscLib.describeError(err)}`
        };
      }

      return {
        ok: true,
        state: 'CONNECTED',
        account: tokens.email,
        site_url: siteUrl,
        properties: properties.map((p) => p.site_url),
        reason: ''
      };
    } catch (err) {
      const reason = gscLib.describeError(err);
      store.saveConnection({
        method: 'oauth',
        accountEmail: '',
        scope: '',
        siteUrl: gscConfig.siteUrl,
        accessToken: '',
        expiresAt: 0,
        refreshToken: '',
        connected: false,
        error: reason,
        verifiedAt: 0
      });
      return { ok: false, state: 'BLOCKED', reason };
    }
  }

  function disconnect() {
    const removed = store.clearConnection();
    runtime.cachedServiceToken = null;
    return { ok: true, removed };
  }

  async function properties() {
    const connection = connectionState();
    if (connection.state !== 'CONNECTED') {
      return { ok: false, state: connection.state, reason: connection.reason, properties: [] };
    }
    try {
      const list = await gsc.listSites();
      return { ok: true, state: 'CONNECTED', properties: list, reason: '' };
    } catch (err) {
      return { ok: false, state: 'BLOCKED', reason: gscLib.describeError(err), properties: [] };
    }
  }

  /* ------------------------------------------------------- search data */

  function siteFromRequest(requested) {
    const value = String(requested || '').trim();
    if (value) return gscLib.normalizeSiteUrl(value);
    const connection = store.connectionSummary();
    if (connection && connection.site_url) return connection.site_url;
    return gscConfig.siteUrl || '';
  }

  /** Fetch the whole picture for one window. Throws when Search Console fails. */
  async function fetchSearchData({ site, days }) {
    const range = gsc.dateRange(days);
    const previousRange = gsc.shiftRange(range, days);

    const [totals, daily, queries, pages, previous] = await Promise.all([
      gsc.totals(site, range),
      gsc.searchAnalytics(site, {
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ['date'],
        rowLimit: days + 3
      }),
      gsc.searchAnalytics(site, {
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ['query'],
        rowLimit: 1000
      }),
      gsc.searchAnalytics(site, {
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ['page'],
        rowLimit: 500
      }),
      gsc.totals(site, previousRange)
    ]);

    const dailyRows = daily.rows
      .map((row) => ({
        date: row.keys[0] || '',
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      site_url: site,
      period: { start: range.startDate, end: range.endDate },
      previous_period: { start: previousRange.startDate, end: previousRange.endDate },
      days,
      totals,
      previous: previous && !previous.empty ? previous : null,
      daily: dailyRows,
      queries: queries.rows.map((row) => ({
        query: row.keys[0] || '',
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position
      })),
      pages: pages.rows.map((row) => ({
        page: row.keys[0] || '',
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position
      })),
      truncated: Boolean(queries.truncated || pages.truncated)
    };
  }

  function deltas(data) {
    if (!data.previous) return null;
    const change = (a, b) => (b ? ((a - b) / b) * 100 : null);
    return {
      clicks: data.totals.clicks - data.previous.clicks,
      clicks_percent: change(data.totals.clicks, data.previous.clicks),
      impressions: data.totals.impressions - data.previous.impressions,
      impressions_percent: change(data.totals.impressions, data.previous.impressions),
      ctr_points: (data.totals.ctr - data.previous.ctr) * 100,
      position: data.totals.position - data.previous.position
    };
  }

  async function overview({ site, days = 28 } = {}) {
    const connection = connectionState();
    const target = siteFromRequest(site);
    const window = clampDays(days);
    if (connection.state !== 'CONNECTED') {
      return {
        ok: true,
        state: connection.state,
        reason: connection.reason,
        site_url: target,
        days: window,
        period: null,
        totals: null,
        previous: null,
        deltas: null,
        daily: [],
        data_source: null
      };
    }
    if (!target) {
      return {
        ok: true,
        state: 'BLOCKED',
        reason: 'Connected, but no property is selected. Choose a Search Console property first.',
        site_url: '',
        days: window,
        period: null,
        totals: null,
        previous: null,
        deltas: null,
        daily: [],
        data_source: null
      };
    }
    try {
      const data = await fetchSearchData({ site: target, days: window });
      return {
        ok: true,
        state: 'CONNECTED',
        reason: '',
        site_url: target,
        days: window,
        period: data.period,
        previous_period: data.previous_period,
        totals: data.totals,
        previous: data.previous,
        deltas: deltas(data),
        daily: data.daily,
        query_count: data.queries.length,
        page_count: data.pages.length,
        data_source: 'google_search_console'
      };
    } catch (err) {
      return {
        ok: false,
        state: 'BLOCKED',
        reason: gscLib.describeError(err),
        site_url: target,
        days: window,
        period: null,
        totals: null,
        previous: null,
        deltas: null,
        daily: [],
        data_source: null
      };
    }
  }

  async function table({ site, days = 28, dimension = 'query', limit = 100 } = {}) {
    const connection = connectionState();
    const target = siteFromRequest(site);
    const window = clampDays(days);
    if (connection.state !== 'CONNECTED') {
      return { ok: true, state: connection.state, reason: connection.reason, rows: [], dimension, data_source: null };
    }
    if (!target) {
      return { ok: true, state: 'BLOCKED', reason: 'No property selected.', rows: [], dimension, data_source: null };
    }
    try {
      const range = gsc.dateRange(window);
      const result = await gsc.searchAnalytics(target, {
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: [dimension],
        rowLimit: Math.max(1, Math.min(2000, Number(limit) || 100))
      });
      const key = dimension === 'page' ? 'page' : dimension;
      return {
        ok: true,
        state: 'CONNECTED',
        reason: '',
        dimension,
        period: { start: range.startDate, end: range.endDate },
        rows: result.rows.map((row) => ({
          [key]: row.keys[0] || '',
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position
        })),
        truncated: result.truncated,
        data_source: 'google_search_console'
      };
    } catch (err) {
      return { ok: false, state: 'BLOCKED', reason: gscLib.describeError(err), rows: [], dimension, data_source: null };
    }
  }

  /* ------------------------------------------------------------- cycle */

  /**
   * One full cycle:
   *   check → search data → AI analysis → Pooja → Priya → Manager → report → verify
   */
  async function runCycle({ days = 28, site = '', trigger = 'manual' } = {}) {
    if (runtime.running) {
      return { ok: false, state: 'BUSY', reason: 'A cycle is already running. Wait for it to finish.', stages: [] };
    }
    runtime.running = true;

    const stages = [];
    const startedAt = Date.now();
    const window = clampDays(days);
    const stageStarted = {};
    let currentStage = 'check';
    const begin = (key) => {
      currentStage = key;
      stageStarted[key] = Date.now();
    };
    const end = (key, status, detail) => {
      stages.push({
        stage: key,
        label: (STAGES.find((s) => s.key === key) || {}).label || key,
        status,
        detail: detail || '',
        at: nowIso(),
        duration_ms: stageStarted[key] ? Date.now() - stageStarted[key] : 0
      });
    };

    const cycleRow = store.startCycle({
      trigger,
      stage: 'check',
      site_url: siteFromRequest(site),
      days: window
    });

    try {
      /* 1. CHECK ------------------------------------------------------- */
      begin('check');
      const connection = connectionState();
      const archive = await archiveStatus({ probe: false });
      const target = siteFromRequest(site);
      const checks = {
        google_search_console: connection.state,
        property: target ? 'selected' : 'missing',
        ai_providers: ai.status().available.length,
        storage_database: db.kind || 'unknown',
        storage_archive: archive.state
      };
      if (connection.state !== 'CONNECTED') {
        end('check', 'BLOCKED', `${connection.state}: ${connection.reason}`);
        return finishBlocked({
          cycleRow,
          stages,
          startedAt,
          reason: `Google Search Console is ${connection.state}. ${connection.reason}`,
          stage: 'check',
          checks
        });
      }
      if (!target) {
        end('check', 'BLOCKED', 'Connected but no Search Console property is selected.');
        return finishBlocked({
          cycleRow,
          stages,
          startedAt,
          reason: 'Connected, but no Search Console property is selected. Choose one and run the cycle again.',
          stage: 'check',
          checks
        });
      }
      end('check', 'OK', `Search Console ${connection.method || ''} · property ${target} · ${ai.status().available.length} AI provider(s) · archive ${archive.state}`);

      /* 2. SEARCH DATA -------------------------------------------------- */
      begin('search_data');
      let data;
      try {
        data = await fetchSearchData({ site: target, days: window });
      } catch (err) {
        end('search_data', 'BLOCKED', gscLib.describeError(err));
        return finishBlocked({
          cycleRow,
          stages,
          startedAt,
          reason: `Search Console could not be read: ${gscLib.describeError(err)}`,
          stage: 'search_data',
          checks,
          site: target
        });
      }
      store.updateCycle(cycleRow.id, {
        site_url: data.site_url,
        period_start: data.period.start,
        period_end: data.period.end,
        clicks: data.totals.clicks,
        impressions: data.totals.impressions,
        data_source: 'google_search_console'
      });
      end(
        'search_data',
        'OK',
        `${data.totals.clicks} clicks · ${data.totals.impressions} impressions · ${data.queries.length} queries · ${data.pages.length} pages · ${data.daily.length} days`
      );

      /* 3. AI ANALYSIS (Gemini → router) -------------------------------- */
      begin('ai_analysis');
      const aiAnalysis = await ai.complete({
        system:
          'You are the SEO analysis engine for PANIKA JEEVAN SATHI. Answer only from the data you are given.',
        prompt: [
          'In two sentences, state the single most important search performance issue in this',
          'real Google Search Console data. No invented numbers.',
          '',
          JSON.stringify(agents.digest(data, { queries: 25, pages: 15, days: 10 }))
        ].join('\n'),
        json: false
      });
      runtime.lastAiEngine = aiAnalysis.ok ? aiAnalysis.engine : null;
      if (aiAnalysis.ok) {
        end('ai_analysis', 'OK', `${aiAnalysis.engine}${aiAnalysis.fallback_used ? ' (fallback)' : ''} · ${aiAnalysis.model || ''}`);
      } else {
        end(
          'ai_analysis',
          'FALLBACK',
          `No AI provider answered (${aiAnalysis.reason}). Deterministic rule engine will be used — the report will say so.`
        );
      }
      store.updateCycle(cycleRow.id, {
        ai_engine: aiAnalysis.ok ? aiAnalysis.engine : 'deterministic-rules',
        stage: 'pooja'
      });

      /* 4. POOJA — research -------------------------------------------- */
      begin('pooja');
      const research = await agents.research({ data, ai, log });
      end('pooja', 'OK', `${research.findings.length} findings · engine ${research.engine}${research.model ? `/${research.model}` : ''}`);

      /* 5. PRIYA — verification ---------------------------------------- */
      begin('priya');
      const verification = agents.verify({
        data,
        research,
        period: { startDate: data.period.start, endDate: data.period.end }
      });
      end('priya', verification.status, `${verification.counts.verified}/${verification.counts.total} claims matched · ${verification.status}`);
      store.updateCycle(cycleRow.id, { verification_status: verification.status, stage: 'manager' });

      /* 6. MANAGER — plan ---------------------------------------------- */
      begin('manager');
      const manager = await agents.plan({ data, research, verification, ai, log });
      end('manager', 'OK', `${manager.priorities.length} priorities · publish ${manager.decisions.publish}`);

      /* 7. REPORT ------------------------------------------------------ */
      begin('report');
      const report = {
        schema: SCHEMA,
        cycle_id: cycleRow.id,
        cycle_no: cycleRow.cycle_no,
        trigger,
        generated_at: nowIso(),
        site_url: data.site_url,
        period: data.period,
        previous_period: data.previous_period,
        days: data.days,
        status: 'PENDING',
        totals: data.totals,
        previous: data.previous,
        deltas: deltas(data),
        daily: data.daily,
        queries: data.queries.slice(0, 250),
        pages: data.pages.slice(0, 150),
        query_count: data.queries.length,
        page_count: data.pages.length,
        truncated: data.truncated,
        data_source: 'google_search_console',
        ai: {
          engine: aiAnalysis.ok ? aiAnalysis.engine : 'deterministic-rules',
          engine_name: aiAnalysis.ok ? aiAnalysis.engine_name : 'Deterministic rule engine',
          model: aiAnalysis.ok ? aiAnalysis.model : null,
          remote: Boolean(aiAnalysis.ok),
          fallback_used: Boolean(aiAnalysis.fallback_used),
          attempts: aiAnalysis.attempts || [],
          situation_summary: aiAnalysis.ok ? String(aiAnalysis.text || '').slice(0, 1200) : '',
          reason_when_unavailable: aiAnalysis.ok ? '' : aiAnalysis.reason || ''
        },
        research,
        verification,
        manager,
        stages
      };
      report.status =
        verification.status === 'FAILED'
          ? 'REVIEW_REQUIRED'
          : verification.status === 'PARTIAL'
            ? 'PARTIAL'
            : 'OK';

      const saved = await store.saveReport(report, { s3 });
      end(
        'report',
        'OK',
        `stored in the database (id ${saved.id})${saved.disk.saved ? ' + disk' : ''}${saved.archive.saved ? ' + Fil One' : saved.archive.configured ? ' · Fil One FAILED' : ''}`
      );
      store.updateCycle(cycleRow.id, { report_id: saved.id, archive_status: saved.archive.status, stage: 'verify' });

      /* 8. VERIFY (storage integrity) ----------------------------------- */
      begin('verify');
      const storageVerification = await verifyStoredReport(saved.id, { s3 });
      end(
        'verify',
        storageVerification.status,
        storageVerification.checks.map((c) => `${c.name}: ${c.status}`).join(' · ')
      );

      const cycleStatus =
        storageVerification.status === 'FAILED' || verification.status === 'FAILED' ? 'REVIEW_REQUIRED' : 'OK';

      store.updateCycle(cycleRow.id, {
        status: cycleStatus,
        stage: 'complete',
        finished_at: Date.now(),
        duration_ms: Date.now() - startedAt,
        error: ''
      });

      runtime.lastCycleAt = Date.now();
      runtime.lastCycleStatus = cycleStatus;

      const finalReport = store.getReport(saved.id);
      return {
        ok: true,
        state: 'COMPLETE',
        status: cycleStatus,
        cycle_id: cycleRow.id,
        cycle_no: cycleRow.cycle_no,
        report_id: saved.id,
        checksum: saved.checksum,
        stages,
        data_source: 'google_search_console',
        totals: data.totals,
        previous: data.previous,
        deltas: deltas(data),
        ai: report.ai,
        verification,
        storage_verification: storageVerification,
        storage: saved,
        report: finalReport ? finalReport.report : null,
        next_cycle: report.manager.next_cycle,
        duration_ms: Date.now() - startedAt
      };
    } catch (err) {
      log(`[seo] cycle failed: ${err && err.stack ? err.stack : err}`);
      end(currentStage, 'FAIL', String(err.message || err));
      store.updateCycle(cycleRow.id, {
        status: 'FAIL',
        stage: 'failed',
        error: String(err.message || err).slice(0, 400),
        finished_at: Date.now(),
        duration_ms: Date.now() - startedAt
      });
      runtime.lastCycleAt = Date.now();
      runtime.lastCycleStatus = 'FAIL';
      return {
        ok: false,
        state: 'FAIL',
        reason: String(err.message || err),
        cycle_id: cycleRow.id,
        stages,
        duration_ms: Date.now() - startedAt
      };
    } finally {
      runtime.running = false;
    }
  }

  function finishBlocked({ cycleRow, stages, startedAt, reason, stage, checks, site }) {
    store.updateCycle(cycleRow.id, {
      status: 'BLOCKED',
      stage,
      site_url: site || cycleRow.site_url || '',
      error: reason.slice(0, 400),
      finished_at: Date.now(),
      duration_ms: Date.now() - startedAt
    });
    runtime.lastCycleAt = Date.now();
    runtime.lastCycleStatus = 'BLOCKED';
    return {
      ok: false,
      // Explicitly NOT a passing status: no data, no report, no numbers.
      state: 'BLOCKED',
      status: 'BLOCKED',
      reason,
      cycle_id: cycleRow.id,
      cycle_no: cycleRow.cycle_no,
      report_id: 0,
      report: null,
      stages,
      checks: checks || {},
      data_source: null,
      totals: null,
      duration_ms: Date.now() - startedAt
    };
  }

  /** Read the report back out of every layer and prove it is intact. */
  async function verifyStoredReport(id, { s3 = null } = {}) {
    const checks = [];
    const add = (name, ok, detail) => {
      checks.push({ name, status: ok ? 'VERIFIED' : 'FAILED', detail });
      return ok;
    };

    const row = store.getReport(id);
    add('report row is readable from the database', Boolean(row && row.report), row ? `id ${row.id}` : 'not found');
    if (!row || !row.report) {
      return { status: 'FAILED', checks };
    }

    const recomputed = store.sha256(JSON.stringify(row.report));
    add(
      'stored payload matches its checksum',
      recomputed === row.checksum,
      `${recomputed === row.checksum ? 'sha256 matches' : `stored ${row.checksum} ≠ recomputed ${recomputed}`}`
    );

    const totals = row.report.totals || {};
    add(
      'the stored report carries real metrics',
      Number(totals.impressions) > 0 && row.report.data_source === 'google_search_console',
      `${totals.clicks} clicks / ${totals.impressions} impressions from ${row.report.data_source}`
    );

    add(
      'verification result is recorded',
      ['VERIFIED', 'PARTIAL', 'FAILED'].includes(row.verification_status),
      `Priya: ${row.verification_status}`
    );

    if (row.archive_key) {
      if (!s3) {
        add('archive object readable from Fil One', false, 'archive key present but no storage client is configured');
      } else {
        try {
          const text = await store.readArchive(id, s3);
          const parsed = text ? JSON.parse(text) : null;
          add(
            'archive object readable from Fil One',
            Boolean(parsed && parsed.checksum === row.checksum),
            parsed ? `${row.archive_key} · checksum matches` : `${row.archive_key} could not be read back`
          );
        } catch (err) {
          add('archive object readable from Fil One', false, String(err.message || err).slice(0, 200));
        }
      }
    } else {
      checks.push({
        name: 'archive object readable from Fil One',
        status: 'NOT_CONFIGURED',
        detail: s3 ? 'the object could not be written to Fil One' : 'Fil One is not configured on this server'
      });
    }

    const failed = checks.filter((c) => c.status === 'FAILED');
    return { status: failed.length ? 'FAILED' : 'VERIFIED', checks, report_id: id, at: nowIso() };
  }

  /* --------------------------------------------------------- scheduler */

  function startScheduler() {
    const minutes = Number(env.PJS_SEO_AUTO_CYCLE_MINUTES || 0);
    if (!(minutes >= 5)) return schedulerStatus();
    if (runtime.timer) return schedulerStatus();

    const run = () => {
      runCycle({ trigger: 'scheduler' }).catch((err) => log(`[seo] scheduled cycle error: ${err.message}`));
    };
    runtime.timer = setInterval(run, minutes * 60000);
    if (runtime.timer.unref) runtime.timer.unref();

    if (String(env.PJS_SEO_AUTO_CYCLE_ON_BOOT || '') === '1') {
      const boot = setTimeout(run, Number(env.PJS_SEO_BOOT_DELAY_MS || 20000));
      if (boot.unref) boot.unref();
    }
    log(`[seo] automatic cycle every ${minutes} minute(s)`);
    return schedulerStatus();
  }

  function stopScheduler() {
    if (runtime.timer) clearInterval(runtime.timer);
    runtime.timer = null;
  }

  return {
    SCHEMA,
    STAGES,
    store,
    ai,
    gsc,
    status,
    connectionState,
    archiveStatus,
    schedulerStatus,
    connectStart,
    connectCallback,
    disconnect,
    properties,
    overview,
    table,
    queries: (opts) => table(Object.assign({ dimension: 'query' }, opts)),
    pages: (opts) => table(Object.assign({ dimension: 'page' }, opts)),
    runCycle,
    verifyStoredReport,
    startScheduler,
    stopScheduler,
    testAi: () => ai.probe(),
    helpers: { clampDays, siteFromRequest, fetchSearchData, deltas }
  };
}

module.exports = { createSeoCenter, STAGES, SCHEMA, DAY_MS };
