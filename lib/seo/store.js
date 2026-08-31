'use strict';
/**
 * PANIKA JEEVAN SATHI — SEO Center permanent storage.
 *
 * Three layers, written in this order:
 *
 *   1. Database   seo_cycles + seo_reports  (the site's own store: SQLite,
 *                 JSON or Cloudflare D1 — whatever the site already uses, so
 *                 reports survive restarts and redeploys)
 *   2. Disk       <dataDir>/seo/…           (human-readable JSON + Markdown,
 *                 plus an append-only cycles.ndjson history)
 *   3. Fil One    S3-compatible object storage (lib/s3.js) — used only when it
 *                 is configured, and only reported as CONNECTED after a real
 *                 write/read/delete probe succeeds
 *
 * Secrets: the Google tokens are encrypted with AES-256-GCM before they touch
 * the database. The key is derived from the site's session secret, which never
 * leaves the server.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CIPHER = 'aes-256-gcm';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/* ------------------------------------------------------------- encryption */

function deriveKey(secret) {
  const material = String(secret || '').trim();
  if (!material) return null;
  return crypto.createHash('sha256').update(`${material}::pjs-seo-tokens`).digest();
}

function encrypt(plain, key) {
  if (!plain) return '';
  if (!key) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(payload, key) {
  if (!payload || !key) return '';
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  try {
    const decipher = crypto.createDecipheriv(CIPHER, key, Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

/* ----------------------------------------------------------------- store */

function createStore(options = {}) {
  const db = options.db;
  const dataDir = options.dataDir || process.cwd();
  const log = options.log || (() => {});
  const key = deriveKey(options.secret);
  const dir = path.join(dataDir, 'seo');
  const reportsDir = path.join(dir, 'reports');

  if (!key) {
    log('[seo/store] no session secret available — stored Google tokens would not survive a restart.');
  }

  function ensureDirs() {
    try {
      fs.mkdirSync(reportsDir, { recursive: true });
      return true;
    } catch (err) {
      log(`[seo/store] cannot create ${reportsDir}: ${err.message}`);
      return false;
    }
  }

  /* --------------------------------------------------------- connection */

  function saveConnection(connection) {
    const existing = db.one('seo_connections', { provider: 'google_search_console' });
    const row = {
      provider: 'google_search_console',
      method: connection.method || 'oauth',
      account_email: connection.accountEmail || '',
      scope: connection.scope || '',
      site_url: connection.siteUrl || '',
      access_token: encrypt(connection.accessToken || '', key),
      access_token_expires: Number(connection.expiresAt || 0),
      refresh_token: encrypt(connection.refreshToken || '', key),
      connected: connection.connected ? 1 : 0,
      last_error: connection.error || '',
      last_verified_at: Number(connection.verifiedAt || 0),
      updated_at: Date.now()
    };
    if (existing) {
      db.update('seo_connections', { id: existing.id }, row);
      return existing.id;
    }
    const inserted = db.insert('seo_connections', Object.assign({ created_at: Date.now() }, row));
    return inserted.id;
  }

  /** The connection with decrypted tokens (server-side use only). */
  function loadConnection() {
    const row = db.one('seo_connections', { provider: 'google_search_console' });
    if (!row) return null;
    return {
      id: row.id,
      provider: row.provider,
      method: row.method,
      accountEmail: row.account_email || '',
      scope: row.scope || '',
      siteUrl: row.site_url || '',
      accessToken: decrypt(row.access_token, key),
      expiresAt: Number(row.access_token_expires || 0),
      refreshToken: decrypt(row.refresh_token, key),
      connected: Number(row.connected) === 1,
      error: row.last_error || '',
      verifiedAt: Number(row.last_verified_at || 0),
      updatedAt: Number(row.updated_at || 0),
      tokensReadable: Boolean(decrypt(row.access_token, key) || decrypt(row.refresh_token, key))
    };
  }

  /** The connection without any secret material (safe for the admin UI). */
  function connectionSummary() {
    const connection = loadConnection();
    if (!connection) return null;
    return {
      id: connection.id,
      provider: connection.provider,
      method: connection.method,
      account_email: connection.accountEmail,
      scope: connection.scope,
      site_url: connection.siteUrl,
      connected: connection.connected,
      error: connection.error,
      verified_at: connection.verifiedAt,
      updated_at: connection.updatedAt,
      tokens_present: Boolean(connection.accessToken || connection.refreshToken)
    };
  }

  function clearConnection() {
    const removed = db.remove('seo_connections', { provider: 'google_search_console' });
    return removed > 0;
  }

  /* ------------------------------------------------------------- cycles */

  function nextCycleNo() {
    const last = db.all('seo_cycles', {}, { order: '-cycle_no', limit: 1 })[0];
    return last ? Number(last.cycle_no) + 1 : 1;
  }

  function startCycle(cycle) {
    const row = db.insert('seo_cycles', {
      cycle_no: Number(cycle.cycle_no || nextCycleNo()),
      trigger: String(cycle.trigger || 'manual'),
      status: 'RUNNING',
      stage: String(cycle.stage || 'check'),
      site_url: String(cycle.site_url || ''),
      days: Number(cycle.days || 28),
      period_start: String(cycle.period_start || ''),
      period_end: String(cycle.period_end || ''),
      data_source: '',
      ai_engine: '',
      verification_status: '',
      clicks: 0,
      impressions: 0,
      report_id: 0,
      archive_status: 'NOT_CONFIGURED',
      error: '',
      started_at: Date.now(),
      finished_at: 0,
      duration_ms: 0
    });
    return row;
  }

  function updateCycle(id, patch) {
    const clean = {};
    for (const [field, value] of Object.entries(patch || {})) {
      if (value === undefined) continue;
      clean[field] = value;
    }
    if (!Object.keys(clean).length) return 0;
    return db.update('seo_cycles', { id }, clean);
  }

  function listCycles(limit = 25) {
    return db
      .all('seo_cycles', {}, { order: '-started_at', limit: Math.max(1, Math.min(200, Number(limit) || 25)) })
      .map(cycleSummary);
  }

  function cycleSummary(row) {
    return {
      id: row.id,
      cycle_no: row.cycle_no,
      trigger: row.trigger,
      status: row.status,
      stage: row.stage,
      site_url: row.site_url,
      days: row.days,
      period_start: row.period_start,
      period_end: row.period_end,
      data_source: row.data_source,
      ai_engine: row.ai_engine,
      verification_status: row.verification_status,
      clicks: row.clicks,
      impressions: row.impressions,
      report_id: row.report_id,
      archive_status: row.archive_status,
      error: row.error,
      started_at: row.started_at,
      finished_at: row.finished_at,
      duration_ms: row.duration_ms
    };
  }

  function getCycle(id) {
    const row = db.one('seo_cycles', { id: Number(id) });
    return row ? cycleSummary(row) : null;
  }

  /* ------------------------------------------------------------ reports */

  /** Build the Markdown version of a report (what the owner actually reads). */
  function toMarkdown(report) {
    const lines = [];
    const totals = report.totals || {};
    lines.push(`# SEO REPORT — ${report.site_url || 'unknown property'}`);
    lines.push('');
    lines.push(`- **Cycle** : #${report.cycle_no}`);
    lines.push(`- **Generated** : ${report.generated_at}`);
    lines.push(`- **Window** : ${report.period.start} → ${report.period.end} (${report.days} days)`);
    lines.push(`- **Data source** : ${report.data_source || 'none'}`);
    lines.push(`- **AI engine** : ${report.ai.engine || 'none'}${report.ai.remote ? ` (${report.ai.model || ''})` : ' — deterministic rules'}`);
    lines.push(`- **Verification** : ${report.verification.status}`);
    lines.push(`- **Status** : ${report.status}`);
    lines.push(`- **Checksum** : \`${report.checksum}\``);
    lines.push('');

    lines.push('## Search data (Google Search Console)');
    lines.push('');
    lines.push('| Metric | This period | Previous period | Change |');
    lines.push('| --- | ---: | ---: | ---: |');
    const previous = report.previous || {};
    const delta = (a, b, digits = 0) => {
      if (b === null || b === undefined) return '—';
      const diff = Number(a) - Number(b);
      const sign = diff > 0 ? '+' : '';
      return `${sign}${diff.toFixed(digits)}`;
    };
    lines.push(`| Clicks | ${totals.clicks ?? 0} | ${previous.clicks ?? '—'} | ${delta(totals.clicks, previous.clicks)} |`);
    lines.push(
      `| Impressions | ${totals.impressions ?? 0} | ${previous.impressions ?? '—'} | ${delta(totals.impressions, previous.impressions)} |`
    );
    lines.push(
      `| CTR | ${((totals.ctr || 0) * 100).toFixed(2)}% | ${previous.ctr === undefined ? '—' : `${(previous.ctr * 100).toFixed(2)}%`} | ${
        previous.ctr === undefined ? '—' : `${delta(totals.ctr * 100, previous.ctr * 100, 2)} pp`
      } |`
    );
    lines.push(
      `| Average position | ${(totals.position || 0).toFixed(1)} | ${previous.position === undefined ? '—' : previous.position.toFixed(1)} | ${
        previous.position === undefined ? '—' : delta(totals.position, previous.position, 2)
      } |`
    );
    lines.push('');

    const queries = (report.queries || []).slice(0, 25);
    if (queries.length) {
      lines.push(`## Top queries (${(report.query_count || queries.length)} total)`);
      lines.push('');
      lines.push('| Query | Clicks | Impressions | CTR | Position |');
      lines.push('| --- | ---: | ---: | ---: | ---: |');
      for (const q of queries) {
        lines.push(
          `| ${String(q.query).replace(/\|/g, '\\|')} | ${q.clicks} | ${q.impressions} | ${(q.ctr * 100).toFixed(2)}% | ${q.position.toFixed(1)} |`
        );
      }
      lines.push('');
    }

    const pages = (report.pages || []).slice(0, 25);
    if (pages.length) {
      lines.push(`## Top pages (${(report.page_count || pages.length)} total)`);
      lines.push('');
      lines.push('| Page | Clicks | Impressions | CTR | Position |');
      lines.push('| --- | ---: | ---: | ---: | ---: |');
      for (const p of pages) {
        lines.push(
          `| ${String(p.page).replace(/\|/g, '\\|')} | ${p.clicks} | ${p.impressions} | ${(p.ctr * 100).toFixed(2)}% | ${p.position.toFixed(1)} |`
        );
      }
      lines.push('');
    }

    lines.push('## Pooja — SEO research');
    lines.push('');
    for (const finding of report.research.findings || []) {
      lines.push(`### ${finding.title}`);
      lines.push('');
      lines.push(`- **Severity** : ${finding.severity} · **Type** : ${finding.type}`);
      if (finding.summary) lines.push(`- ${finding.summary}`);
      if ((finding.evidence || []).length) {
        lines.push('- **Evidence** :');
        for (const evidence of finding.evidence) lines.push(`  - ${evidence}`);
      }
      if ((finding.actions || []).length) {
        lines.push('- **Actions** :');
        for (const action of finding.actions) lines.push(`  - ${action}`);
      }
      if (finding.expected) lines.push(`- **Expected** : ${finding.expected}`);
      lines.push('');
    }

    if ((report.research.keyword_opportunities || []).length) {
      lines.push('### Keyword hypotheses (not measured data)');
      lines.push('');
      for (const k of report.research.keyword_opportunities) {
        lines.push(`- **${k.theme}** — ${k.related_queries} related queries, ${k.impressions} impressions. ${k.note || ''}`);
      }
      lines.push('');
    }

    lines.push('## Priya — verification');
    lines.push('');
    lines.push(`**Result: ${report.verification.status}** — ${report.verification.counts.verified}/${report.verification.counts.total} numeric claims matched the data.`);
    lines.push('');
    for (const check of report.verification.checks || []) {
      lines.push(`- [${check.status === 'VERIFIED' ? 'x' : ' '}] **${check.name}** — ${check.detail}`);
    }
    if ((report.verification.fabricated_subjects || []).length) {
      lines.push('');
      lines.push('Subjects that could not be found in the fetched data:');
      for (const item of report.verification.fabricated_subjects) {
        lines.push(`- ${item.kind}: ${item.value} (${item.reason})`);
      }
    }
    lines.push('');

    lines.push('## Manager — plan and final recommendations');
    lines.push('');
    lines.push(report.manager.summary || '');
    lines.push('');
    for (const priority of report.manager.priorities || []) {
      lines.push(`${priority.rank}. **${priority.title}** (impact: ${priority.impact}, effort: ${priority.effort})`);
      lines.push(`   - ${priority.action}`);
      if (priority.why) lines.push(`   - Why: ${priority.why}`);
    }
    lines.push('');
    lines.push(`**Next cycle focus** : ${report.manager.next_cycle.focus}`);
    for (const check of report.manager.next_cycle.checks || []) lines.push(`- ${check}`);
    if ((report.manager.risks || []).length) {
      lines.push('');
      lines.push('**Risks** :');
      for (const risk of report.manager.risks) lines.push(`- ${risk}`);
    }
    lines.push('');
    lines.push('## Cycle trail');
    lines.push('');
    for (const stage of report.stages || []) {
      lines.push(
        `- \`${stage.stage}\` → ${stage.status}${stage.detail ? ` — ${stage.detail}` : ''}${stage.duration_ms ? ` (${stage.duration_ms} ms)` : ''}`
      );
    }
    lines.push('');
    lines.push(`Production deploy: **${report.manager.decisions.production_deploy}** · Publish: **${report.manager.decisions.publish}**`);
    lines.push('');
    return lines.join('\n');
  }

  /**
   * Persist a report: database row first, then the disk mirror, then Fil One.
   * The returned object always says exactly which layers succeeded.
   */
  async function saveReport(report, { s3 = null } = {}) {
    const markdown = toMarkdown(report);
    const payload = JSON.stringify(report);
    const checksum = sha256(payload);
    const createdAt = Date.now();

    const row = db.insert('seo_reports', {
      cycle_id: Number(report.cycle_id || 0),
      cycle_no: Number(report.cycle_no || 0),
      site_url: String(report.site_url || ''),
      period_start: String(report.period.start || ''),
      period_end: String(report.period.end || ''),
      status: String(report.status || 'BLOCKED'),
      clicks: Number(report.totals.clicks || 0),
      impressions: Number(report.totals.impressions || 0),
      ctr: Number(report.totals.ctr || 0),
      position: Number(report.totals.position || 0),
      query_count: Number(report.query_count || 0),
      page_count: Number(report.page_count || 0),
      data_source: String(report.data_source || ''),
      ai_engine: String(report.ai.engine || ''),
      ai_remote: report.ai.remote ? 1 : 0,
      verification_status: String(report.verification.status || ''),
      archive_key: '',
      archive_status: s3 ? 'PENDING' : 'NOT_CONFIGURED',
      checksum,
      payload,
      markdown,
      created_at: createdAt
    });

    const result = {
      id: row.id,
      checksum,
      database: { saved: true, table: 'seo_reports' },
      disk: { saved: false, json: '', markdown: '', error: '' },
      archive: { configured: Boolean(s3), saved: false, key: '', status: s3 ? 'PENDING' : 'NOT_CONFIGURED', error: '' }
    };

    // Disk mirror (best effort — a read-only filesystem must not lose the report,
    // it is already in the database).
    if (ensureDirs()) {
      const base = `seo-report-${String(report.cycle_no).padStart(4, '0')}-${stamp(new Date(createdAt))}`;
      try {
        const jsonPath = path.join(reportsDir, `${base}.json`);
        const mdPath = path.join(reportsDir, `${base}.md`);
        fs.writeFileSync(jsonPath, `${JSON.stringify(Object.assign({ checksum }, report), null, 2)}\n`);
        fs.writeFileSync(mdPath, markdown);
        fs.writeFileSync(path.join(dir, 'latest.json'), `${JSON.stringify(Object.assign({ checksum }, report), null, 2)}\n`);
        fs.writeFileSync(path.join(dir, 'latest.md'), markdown);
        fs.appendFileSync(
          path.join(dir, 'cycles.ndjson'),
          `${JSON.stringify({
            at: nowIso(),
            report_id: row.id,
            cycle_no: report.cycle_no,
            status: report.status,
            verification: report.verification.status,
            clicks: report.totals.clicks,
            impressions: report.totals.impressions,
            checksum
          })}\n`
        );
        result.disk = { saved: true, json: jsonPath, markdown: mdPath, error: '' };
      } catch (err) {
        result.disk = { saved: false, json: '', markdown: '', error: err.message };
        log(`[seo/store] disk mirror failed: ${err.message}`);
      }
    }

    // Fil One mirror (only when configured; a failure is reported, never hidden).
    if (s3) {
      const key = `reports/seo-report-${String(report.cycle_no).padStart(4, '0')}-${stamp(new Date(createdAt))}.json`;
      try {
        await s3.put(key, `${JSON.stringify(Object.assign({ checksum }, report), null, 2)}\n`, 'application/json');
        await s3.put(key.replace(/\.json$/, '.md'), markdown, 'text/markdown');
        await s3.put('reports/seo-report-latest.json', `${JSON.stringify(Object.assign({ checksum }, report), null, 2)}\n`, 'application/json');
        result.archive = { configured: true, saved: true, key, status: 'SAVED', error: '' };
        db.update('seo_reports', { id: row.id }, { archive_key: key, archive_status: 'SAVED' });
      } catch (err) {
        result.archive = { configured: true, saved: false, key, status: 'FAILED', error: String(err.message || err).slice(0, 300) };
        db.update('seo_reports', { id: row.id }, { archive_status: 'FAILED' });
        log(`[seo/store] Fil One archive failed: ${err.message}`);
      }
    }

    return result;
  }

  function rowToReport(row, { includePayload = true } = {}) {
    let payload = null;
    if (includePayload) {
      try {
        payload = JSON.parse(row.payload || 'null');
      } catch (_) {
        payload = null;
      }
    }
    return {
      id: row.id,
      cycle_id: row.cycle_id,
      cycle_no: row.cycle_no,
      site_url: row.site_url,
      period_start: row.period_start,
      period_end: row.period_end,
      status: row.status,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
      query_count: row.query_count,
      page_count: row.page_count,
      data_source: row.data_source,
      ai_engine: row.ai_engine,
      ai_remote: Number(row.ai_remote) === 1,
      verification_status: row.verification_status,
      archive_key: row.archive_key,
      archive_status: row.archive_status,
      checksum: row.checksum,
      created_at: row.created_at,
      markdown: includePayload ? row.markdown : undefined,
      report: payload
    };
  }

  function listReports(limit = 25, offset = 0) {
    return db
      .all('seo_reports', {}, { order: '-created_at', limit: Math.max(1, Math.min(200, Number(limit) || 25)), offset: Math.max(0, Number(offset) || 0) })
      .map((row) => rowToReport(row, { includePayload: false }));
  }

  function getReport(id) {
    const row = db.one('seo_reports', { id: Number(id) });
    return row ? rowToReport(row) : null;
  }

  function latestReport() {
    const row = db.all('seo_reports', {}, { order: '-created_at', limit: 1 })[0];
    return row ? rowToReport(row) : null;
  }

  /** Read a report back out of Fil One (proves the archive is really readable). */
  async function readArchive(id, s3) {
    const row = db.one('seo_reports', { id: Number(id) });
    if (!row || !row.archive_key) return null;
    if (!s3) return null;
    const buffer = await s3.get(row.archive_key);
    return buffer ? buffer.toString('utf8') : null;
  }

  function counts() {
    return {
      cycles: db.count('seo_cycles'),
      reports: db.count('seo_reports'),
      connections: db.count('seo_connections')
    };
  }

  return {
    dir,
    reportsDir,
    encryption: { available: Boolean(key), algorithm: CIPHER },
    saveConnection,
    loadConnection,
    connectionSummary,
    clearConnection,
    nextCycleNo,
    startCycle,
    updateCycle,
    listCycles,
    getCycle,
    saveReport,
    listReports,
    getReport,
    latestReport,
    readArchive,
    counts,
    toMarkdown,
    sha256
  };
}

module.exports = { createStore, encrypt, decrypt, deriveKey, sha256 };
