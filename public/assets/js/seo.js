/* ==========================================================================
   PANIKA JEEVAN SATHI — SEO Center front end.

   Everything on this page is rendered from /api/seo/* responses. There are no
   hard-coded metrics and no demo mode: when Google Search Console is not
   connected the page says NOT CONNECTED and shows no numbers at all.
   ========================================================================== */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = PJS.esc;

  const STAGES = [
    ['check', 'Check'],
    ['search_data', 'Search data'],
    ['ai_analysis', 'AI analysis'],
    ['pooja', 'Pooja (research)'],
    ['priya', 'Priya (verification)'],
    ['manager', 'Manager (plan)'],
    ['report', 'Report'],
    ['verify', 'Verify storage']
  ];

  let state = {
    status: null,
    overview: null,
    queries: null,
    pages: null,
    cycles: [],
    reports: [],
    lastRun: null
  };

  /* ------------------------------------------------------------- helpers */

  const num = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('en-IN'));
  const pctStr = (value, digits) =>
    value === null || value === undefined ? '—' : `${(Number(value) * 100).toFixed(digits === undefined ? 2 : digits)}%`;
  const pos = (value) => (value === null || value === undefined ? '—' : Number(value).toFixed(1));

  function dot(kind) {
    return `<span class="dot ${kind}"></span>`;
  }

  function stateChip(value) {
    const map = {
      CONNECTED: ['ok', 'CONNECTED'],
      VERIFIED: ['ok', 'VERIFIED'],
      SAVED: ['ok', 'SAVED'],
      OK: ['ok', 'OK'],
      CONFIGURED: ['warn', 'CONFIGURED'],
      PARTIAL: ['warn', 'PARTIAL'],
      FALLBACK: ['warn', 'FALLBACK'],
      REVIEW_REQUIRED: ['warn', 'REVIEW REQUIRED'],
      RUNNING: ['warn', 'RUNNING'],
      PENDING: ['warn', 'PENDING'],
      NOT_CONNECTED: ['bad', 'NOT CONNECTED'],
      NOT_CONFIGURED: ['off', 'NOT CONFIGURED'],
      BLOCKED: ['bad', 'BLOCKED'],
      FAILED: ['bad', 'FAILED'],
      FAIL: ['bad', 'FAIL']
    };
    const entry = map[value] || ['off', String(value || 'UNKNOWN')];
    return `<span class="chip ${entry[0] === 'ok' ? 'green' : entry[0] === 'warn' ? 'gold' : entry[0] === 'bad' ? 'red' : ''}">${esc(entry[1])}</span>`;
  }

  function banner(kind, title, body) {
    return `<div class="alert ${kind}"><b>${esc(title)}</b>${body || ''}</div>`;
  }

  function empty(message) {
    return `<div class="empty"><h3>${esc(message)}</h3></div>`;
  }

  function toast(res, okMessage) {
    if (res && res.ok) {
      if (okMessage) PJS.toast(okMessage, 'success');
      return true;
    }
    PJS.toast((res && res.error) || 'Something went wrong.', 'error');
    return false;
  }

  /* --------------------------------------------------------------- status */

  function renderStatus(status) {
    const gsc = status.google_search_console;
    const ai = status.ai;
    const archive = status.storage.archive;
    const disk = status.storage.disk;

    const gscKind = gsc.state === 'CONNECTED' ? 'ok' : gsc.state === 'BLOCKED' ? 'bad' : 'bad';
    const aiKind = ai.available && ai.available.length ? (ai.available[0] === 'gemini' ? 'ok' : 'warn') : 'warn';
    const archiveKind =
      archive.state === 'CONNECTED' ? 'ok' : archive.state === 'CONFIGURED' ? 'warn' : 'off';

    $('statusStrip').innerHTML = `
      <div class="item">
        <h4>Google Search Console</h4>
        <div class="val">${dot(gscKind)}${stateChip(gsc.state)}</div>
        <p>${esc(gsc.reason || (gsc.account ? `${gsc.account}${gsc.site_url ? ` · ${gsc.site_url}` : ''}` : gsc.site_url || 'No property selected'))}</p>
      </div>
      <div class="item">
        <h4>AI engine (Gemini → router)</h4>
        <div class="val">${dot(aiKind)}${esc(ai.available.length ? ai.order.join(' → ') : 'Deterministic rules only')}</div>
        <p>${esc(
          ai.available.length
            ? `${ai.available.length} provider(s) configured server-side. Keys are never sent to the browser.`
            : 'No AI provider is configured (GEMINI_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY / GROQ_API_KEY). Analysis falls back to the deterministic rule engine and the report says so.'
        )}</p>
      </div>
      <div class="item">
        <h4>Permanent storage</h4>
        <div class="val">${dot(archiveKind)}${stateChip(archive.state)}</div>
        <p>${esc(
          `Database ${status.storage.database.kind} · ${status.storage.database.reports} report(s), ${status.storage.database.cycles} cycle(s) · disk ${disk.writable ? 'writable' : 'read-only'} · tokens ${status.storage.tokens_encrypted ? 'encrypted' : 'NOT encrypted'}`
        )}</p>
      </div>
      <div class="item">
        <h4>Automatic cycle</h4>
        <div class="val">${dot(status.scheduler.enabled ? 'ok' : 'off')}${esc(status.scheduler.enabled ? `Every ${status.scheduler.interval_minutes} min` : 'Off')}</div>
        <p>${esc(
          status.scheduler.enabled
            ? `Last run ${status.scheduler.last_run_at ? PJS.fmt.ago(status.scheduler.last_run_at) : 'not yet'}${status.scheduler.last_status ? ` · ${status.scheduler.last_status}` : ''}`
            : 'Set PJS_SEO_AUTO_CYCLE_MINUTES on this service to run cycles automatically.'
        )}</p>
      </div>`;

    const banners = [];
    if (gsc.state !== 'CONNECTED') {
      banners.push(
        banner(
          gsc.state === 'BLOCKED' ? 'error' : 'warn',
          `GOOGLE SEARCH CONSOLE — ${gsc.state === 'BLOCKED' ? 'BLOCKED' : 'NOT CONNECTED'}`,
          `${esc(gsc.reason || '')}
           <div class="btn-row mt-2">
             <button class="btn sm" id="bannerConnect" type="button">Connect Google account</button>
             <button class="btn ghost sm" data-go="connections" type="button">Connection details</button>
           </div>`
        )
      );
    }
    if (!ai.available.length) {
      banners.push(
        banner(
          'warn',
          'AI ENGINE — NOT CONFIGURED',
          'No Gemini/OpenAI/OpenRouter/Groq key is present in this service’s environment. Cycles still run on the deterministic rule engine, and every report states that no AI provider answered.'
        )
      );
    }
    if (archive.state === 'BLOCKED') {
      banners.push(banner('error', 'FIL ONE ARCHIVE — BLOCKED', `${esc(archive.reason || '')}`));
    }
    $('bannerArea').innerHTML = banners.join('');

    const connectBtn = $('bannerConnect');
    if (connectBtn) connectBtn.onclick = startConnect;
    document.querySelectorAll('[data-go]').forEach((b) => {
      b.onclick = () => setTab(b.dataset.go);
    });

    $('runCycleBtn').disabled = gsc.state !== 'CONNECTED';
    $('runCycleBtn').title =
      gsc.state === 'CONNECTED' ? 'Run a full SEO cycle now' : 'Connect Google Search Console first';
  }

  /* -------------------------------------------------------------- overview */

  function deltaHtml(value, suffix, invert) {
    if (value === null || value === undefined || Number.isNaN(value)) return '';
    const positive = invert ? value < 0 : value > 0;
    const cls = Math.abs(value) < 0.005 ? 'flat' : positive ? 'up' : 'down';
    const sign = value > 0 ? '+' : '';
    return `<span class="metric-delta ${cls}">${sign}${Number(value).toFixed(suffix === '%' ? 1 : 2)}${suffix || ''}</span>`;
  }

  function renderOverview(overview) {
    const grid = $('metricGrid');
    $('rangeLabel').textContent = overview.period
      ? `${overview.period.start} → ${overview.period.end} · ${overview.days} days · source: ${overview.data_source || 'none'}`
      : 'No data loaded.';

    if (!overview.totals) {
      grid.innerHTML = ['Clicks', 'Impressions', 'CTR', 'Average position']
        .map((label) => `<div class="stat"><b>—</b><span>${esc(label)}</span></div>`)
        .join('');
      $('chart').innerHTML = empty(
        overview.state === 'CONNECTED'
          ? 'No rows returned for this window.'
          : `No data — Google Search Console is ${overview.state || 'NOT_CONNECTED'}.`
      );
      return;
    }

    const d = overview.deltas;
    grid.innerHTML = `
      <div class="stat"><b>${num(overview.totals.clicks)}</b><span>Clicks</span>
        ${d ? deltaHtml(d.clicks, '', false) : ''}</div>
      <div class="stat"><b>${num(overview.totals.impressions)}</b><span>Impressions</span>
        ${d ? deltaHtml(d.impressions, '', false) : ''}</div>
      <div class="stat"><b>${pctStr(overview.totals.ctr)}</b><span>CTR</span>
        ${d ? deltaHtml(d.ctr_points, ' pp', false) : ''}</div>
      <div class="stat"><b>${pos(overview.totals.position)}</b><span>Average position</span>
        ${d ? deltaHtml(d.position, '', true) : ''}</div>`;

    $('chart').innerHTML = chart(overview.daily || []);
  }

  /** Tiny dependency-free SVG chart of the real daily rows. */
  function chart(daily) {
    if (!daily.length) return empty('No daily rows.');
    const width = 900;
    const height = 210;
    const pad = { top: 12, right: 12, bottom: 24, left: 40 };
    const maxClicks = Math.max(1, ...daily.map((d) => Number(d.clicks) || 0));
    const maxImpressions = Math.max(1, ...daily.map((d) => Number(d.impressions) || 0));
    const stepX = daily.length > 1 ? (width - pad.left - pad.right) / (daily.length - 1) : 0;

    const line = (key, max) =>
      daily
        .map((d, i) => {
          const x = pad.left + i * stepX;
          const y = pad.top + (height - pad.top - pad.bottom) * (1 - (Number(d[key]) || 0) / max);
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');

    const labels = daily
      .filter((_, i) => i % Math.ceil(daily.length / 6) === 0)
      .map((d, i) => {
        const index = daily.indexOf(d);
        return `<text x="${(pad.left + index * stepX).toFixed(1)}" y="${height - 6}" font-size="10" fill="#8a7a80" text-anchor="middle">${esc(d.date.slice(5))}</text>`;
      })
      .join('');

    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily clicks and impressions">
      <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#e6dcd6"/>
      <text x="4" y="${pad.top + 8}" font-size="10" fill="#8a7a80">${maxImpressions}</text>
      <path d="${line('impressions', maxImpressions)}" fill="none" stroke="var(--gold)" stroke-width="2"/>
      <path d="${line('clicks', maxClicks)}" fill="none" stroke="var(--brand)" stroke-width="2"/>
      ${labels}
    </svg>`;
  }

  /* ------------------------------------------------------------- pipeline */

  function renderPipeline(result) {
    const stages = (result && result.stages) || [];
    const byKey = {};
    stages.forEach((s) => {
      byKey[s.stage] = s;
    });

    $('pipeline').innerHTML = STAGES.map(([key, label], index) => {
      const stage = byKey[key];
      // Priya and the storage check report VERIFIED, which is a success — only
      // a genuine failure may be painted red.
      const succeeded = ['OK', 'VERIFIED'];
      const cls = !stage
        ? 'pending'
        : succeeded.includes(stage.status)
          ? 'done'
          : stage.status === 'FALLBACK'
            ? 'pending'
            : 'blocked';
      const detail = stage ? `${stage.status}${stage.detail ? ` — ${stage.detail}` : ''}` : 'not reached';
      return `<div class="pipe-stage ${cls}">
        <span class="n">${index + 1}</span>
        <div><b>${esc(label)}</b><span>${esc(detail)}</span></div>
        <span class="tiny muted">${stage && stage.duration_ms ? `${stage.duration_ms} ms` : ''}</span>
      </div>`;
    }).join('');

    const meta = [];
    if (result) {
      meta.push(`cycle #${result.cycle_no || ''}`);
      meta.push(result.state || result.status);
      if (result.duration_ms) meta.push(`${(result.duration_ms / 1000).toFixed(1)} s`);
    }
    $('cycleMeta').textContent = meta.filter(Boolean).join(' · ');

    // result.report is the report PAYLOAD (research / verification / manager),
    // not the database row wrapper returned by /api/seo/reports/:id.
    const report = result && result.report && result.report.research ? result.report : null;
    if (!report) {
      $('findings').innerHTML = empty(result ? 'This cycle produced no report. See the reason above.' : 'No cycle has run yet.');
      $('verification').innerHTML = '';
      $('verifyChip').className = 'chip';
      $('verifyChip').textContent = 'not run';
      $('plan').innerHTML = '';
      $('poojaEngine').textContent = '';
      $('managerEngine').textContent = '';
      return;
    }

    $('poojaEngine').textContent = `${report.research.engine}${report.research.model ? ` · ${report.research.model}` : ''}`;
    $('managerEngine').textContent = `${report.manager.engine}${report.manager.model ? ` · ${report.manager.model}` : ''}`;

    $('findings').innerHTML = (report.research.findings || [])
      .map(
        (f) => `<div class="finding">
          <h4>${esc(f.title)}</h4>
          <div class="row" style="gap:8px">
            <span class="chip ${f.severity === 'critical' ? 'red' : f.severity === 'high' ? 'gold' : 'brand'}">${esc(f.severity)}</span>
            <span class="tiny muted">${esc(f.type)}</span>
          </div>
          <p class="small mt-1">${esc(f.summary || '')}</p>
          ${(f.evidence || []).length ? `<div class="tiny muted"><b>Evidence</b></div><ul>${f.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
          ${(f.actions || []).length ? `<div class="tiny muted mt-1"><b>Actions</b></div><ul>${f.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
        </div>`
      )
      .join('');

    const v = report.verification;
    $('verifyChip').className = `chip ${v.status === 'VERIFIED' ? 'green' : v.status === 'PARTIAL' ? 'gold' : 'red'}`;
    $('verifyChip').textContent = v.status;
    $('verification').innerHTML = `
      <p class="small">${v.counts.verified}/${v.counts.total} numeric claims matched the fetched data ·
      ${v.counts.contradicted} contradicted · ${v.counts.unverifiable} unverifiable.</p>
      ${(v.checks || [])
        .map(
          (c) => `<div class="claim-row">
            <span>${c.status === 'VERIFIED' ? '✅' : c.status === 'FAILED' ? '❌' : '⚠️'}</span>
            <span><b>${esc(c.name)}</b><br><span class="tiny muted">${esc(c.detail || '')}</span></span>
          </div>`
        )
        .join('')}
      ${(v.fabricated_subjects || []).length
        ? `<p class="small mt-2"><b>Not found in the data:</b> ${v.fabricated_subjects.map((f) => esc(`${f.kind}: ${f.value}`)).join(', ')}</p>`
        : ''}`;

    const m = report.manager;
    $('plan').innerHTML = `
      <p class="small">${esc(m.summary || '')}</p>
      <ol class="small" style="padding-left:18px;line-height:1.8">
        ${(m.priorities || []).map((p) => `<li><b>${esc(p.title)}</b> — ${esc(p.action)}<br><span class="tiny muted">impact ${esc(p.impact)} · effort ${esc(p.effort)}</span></li>`).join('')}
      </ol>
      <p class="tiny muted mt-2"><b>Next cycle:</b> ${esc((m.next_cycle || {}).focus || '')}</p>
      <p class="tiny muted"><b>Production deploy:</b> ${esc((m.decisions || {}).production_deploy || '')} · <b>Publish:</b> ${esc((m.decisions || {}).publish || '')}</p>`;
  }

  function renderCycles(cycles) {
    if (!cycles.length) {
      $('cycleHistory').innerHTML = empty('No cycles have run yet.');
      return;
    }
    $('cycleHistory').innerHTML = `<table class="data">
      <thead><tr><th>#</th><th>Started</th><th>Trigger</th><th>Status</th><th>Stage</th><th>Clicks</th><th>Impressions</th><th>AI</th><th>Verification</th><th>Report</th></tr></thead>
      <tbody>${cycles
        .map(
          (c) => `<tr>
            <td>${c.cycle_no}</td>
            <td>${esc(PJS.fmt.dateTime(c.started_at))}</td>
            <td>${esc(c.trigger)}</td>
            <td>${stateChip(c.status)}</td>
            <td class="small">${esc(c.stage || '')}</td>
            <td>${c.data_source ? num(c.clicks) : '—'}</td>
            <td>${c.data_source ? num(c.impressions) : '—'}</td>
            <td class="small">${esc(c.ai_engine || '—')}</td>
            <td>${c.verification_status ? stateChip(c.verification_status) : '—'}</td>
            <td>${c.report_id ? `<button class="btn ghost sm" data-report="${c.report_id}" type="button">Open</button>` : '—'}</td>
          </tr>${c.error ? `<tr><td></td><td colspan="9" class="small" style="color:var(--red)">${esc(c.error)}</td></tr>` : ''}`
        )
        .join('')}</tbody></table>`;
    document.querySelectorAll('[data-report]').forEach((b) => {
      b.onclick = () => {
        setTab('reports');
        openReport(b.dataset.report);
      };
    });
  }

  /* ---------------------------------------------------------------- tables */

  function renderTable(rows, key, container, metaEl, label) {
    if (!rows || !rows.length) {
      $(container).innerHTML = empty(`No ${label} rows returned for this window.`);
      $(metaEl).textContent = '';
      return;
    }
    $(metaEl).textContent = `${rows.length} rows`;
    $(container).innerHTML = `<table class="data">
      <thead><tr><th>${esc(label)}</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr>
            <td class="small" style="word-break:break-word">${esc(r[key])}</td>
            <td>${num(r.clicks)}</td>
            <td>${num(r.impressions)}</td>
            <td>${pctStr(r.ctr)}</td>
            <td>${pos(r.position)}</td>
          </tr>`
        )
        .join('')}</tbody></table>`;
  }

  /* --------------------------------------------------------------- reports */

  function renderReports(reports) {
    if (!reports.length) {
      $('reportTable').innerHTML = empty('No reports stored yet. Run a cycle once Google Search Console is connected.');
      return;
    }
    $('reportTable').innerHTML = `<table class="data">
      <thead><tr><th>Cycle</th><th>Generated</th><th>Property</th><th>Window</th><th>Status</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>AI</th><th>Verification</th><th>Archive</th><th></th></tr></thead>
      <tbody>${reports
        .map(
          (r) => `<tr>
            <td>#${r.cycle_no}</td>
            <td class="small">${esc(PJS.fmt.dateTime(r.created_at))}</td>
            <td class="small">${esc(r.site_url || '—')}</td>
            <td class="small">${esc(r.period_start)} → ${esc(r.period_end)}</td>
            <td>${stateChip(r.status)}</td>
            <td>${num(r.clicks)}</td>
            <td>${num(r.impressions)}</td>
            <td>${pctStr(r.ctr)}</td>
            <td class="small">${esc(r.ai_engine || '—')}${r.ai_remote ? '' : ' (rules)'}</td>
            <td>${r.verification_status ? stateChip(r.verification_status) : '—'}</td>
            <td class="small">${esc(r.archive_status)}</td>
            <td><button class="btn ghost sm" data-report="${r.id}" type="button">Open</button></td>
          </tr>`
        )
        .join('')}</tbody></table>`;
    document.querySelectorAll('[data-report]').forEach((b) => {
      b.onclick = () => openReport(b.dataset.report);
    });
  }

  function renderLatest(report) {
    if (!report) {
      $('latestReport').innerHTML = empty('No report stored yet.');
      return;
    }
    $('latestReport').innerHTML = `
      <div class="row spread row-wrap">
        <div>
          <div class="row" style="gap:8px">${stateChip(report.status)}${report.verification_status ? stateChip(report.verification_status) : ''}
            <span class="tiny muted">cycle #${report.cycle_no} · ${esc(PJS.fmt.ago(report.created_at))}</span></div>
          <p class="small mt-1">${num(report.clicks)} clicks · ${num(report.impressions)} impressions · CTR ${pctStr(report.ctr)} · position ${pos(report.position)}</p>
          <p class="tiny muted">${esc(report.site_url || '')} · ${esc(report.period_start)} → ${esc(report.period_end)} · AI ${esc(report.ai_engine || '—')}</p>
        </div>
        <div class="btn-row">
          <button class="btn ghost sm" id="openLatest" type="button">Open report</button>
          <a class="btn ghost sm" href="/api/seo/reports/${report.id}?format=md" download>Download .md</a>
        </div>
      </div>
      <p class="tiny muted mt-2">Checksum <code>${esc(report.checksum || '')}</code> · archive ${esc(report.archive_status || 'NOT_CONFIGURED')}</p>`;
    const open = $('openLatest');
    if (open) {
      open.onclick = () => {
        setTab('reports');
        openReport(report.id);
      };
    }
  }

  async function openReport(id) {
    const res = await PJS.get(`/api/seo/reports/${id}`);
    if (!toast(res)) return;
    const report = res.report;
    $('reportDetailCard').classList.remove('hide');
    $('reportDetailTitle').textContent = `Report #${report.cycle_no} — ${report.site_url || ''}`;
    $('reportMarkdown').textContent = report.markdown || '(no markdown stored)';
    $('reportDownload').href = `/api/seo/reports/${report.id}?format=md`;
    $('reportDetailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ----------------------------------------------------------- connections */

  function renderConnections(status) {
    const gsc = status.google_search_console;
    $('gscBox').innerHTML = `
      <div class="row spread row-wrap mb-2">
        <div><b>${stateChip(gsc.state)}</b> <span class="small muted">${esc(gsc.method || '')}</span></div>
        <div class="btn-row">
          ${gsc.state === 'CONNECTED' ? '<button class="btn ghost sm danger" id="disconnectBtn" type="button">Disconnect</button>' : ''}
          <button class="btn sm" id="connectBtn" type="button">${gsc.state === 'CONNECTED' ? 'Re-authorise' : 'Connect Google account'}</button>
        </div>
      </div>
      <table class="data" style="min-width:0">
        <tbody>
          <tr><td class="small muted">Account</td><td class="small">${esc(gsc.account || '—')}</td></tr>
          <tr><td class="small muted">Property</td><td class="small">${esc(gsc.site_url || '—')}</td></tr>
          <tr><td class="small muted">Last verified</td><td class="small">${gsc.last_verified_at ? esc(PJS.fmt.dateTime(gsc.last_verified_at)) : '—'}</td></tr>
          <tr><td class="small muted">OAuth client configured</td><td class="small">${gsc.env && gsc.env.client_id && gsc.env.client_secret ? 'yes' : 'no'}</td></tr>
          <tr><td class="small muted">Refresh token in env</td><td class="small">${gsc.env && gsc.env.refresh_token ? 'yes' : 'no'}</td></tr>
          <tr><td class="small muted">Service account in env</td><td class="small">${gsc.env && gsc.env.service_account ? 'yes' : 'no'}</td></tr>
        </tbody>
      </table>
      ${gsc.reason ? `<p class="small mt-2">${esc(gsc.reason)}</p>` : ''}`;

    const connect = $('connectBtn');
    if (connect) connect.onclick = startConnect;
    const disconnect = $('disconnectBtn');
    if (disconnect) {
      disconnect.onclick = async () => {
        const yes = await PJS.confirm('Disconnect Google?', 'The stored OAuth tokens will be deleted from this server. Reports already saved stay.', 'Disconnect', true);
        if (!yes) return;
        const res = await PJS.post('/api/seo/disconnect');
        if (toast(res, 'Disconnected.')) refreshStatus();
      };
    }

    const ai = status.ai;
    $('aiBox').innerHTML = `
      <div class="mb-2">${stateChip(ai.available.length ? 'CONFIGURED' : 'NOT_CONFIGURED')}
        <span class="small muted">${esc(ai.available.length ? ai.order.join(' → ') : 'no provider configured')}</span></div>
      <table class="data" style="min-width:0"><tbody>
        <tr><td class="small muted">GEMINI_API_KEY</td><td class="small">${ai.gemini ? 'present' : 'missing'}</td></tr>
        <tr><td class="small muted">OPENAI_API_KEY</td><td class="small">${ai.openai ? 'present' : 'missing'}</td></tr>
        <tr><td class="small muted">OPENROUTER_API_KEY</td><td class="small">${ai.openrouter ? 'present' : 'missing'}</td></tr>
        <tr><td class="small muted">GROQ_API_KEY</td><td class="small">${ai.groq ? 'present' : 'missing'}</td></tr>
        <tr><td class="small muted">Last engine used</td><td class="small">${esc(ai.last_engine || '—')}</td></tr>
      </tbody></table>
      <p class="tiny muted mt-2">Key values are never returned by the API — only whether each one is present on the server.</p>`;

    const archive = status.storage.archive;
    $('archiveBox').innerHTML = `
      <div class="mb-2">${stateChip(archive.state)} <span class="small muted">${esc(archive.bucket ? `${archive.bucket} @ ${archive.endpoint}` : 'not configured')}</span></div>
      <table class="data" style="min-width:0"><tbody>
        <tr><td class="small muted">FILONE_ENDPOINT</td><td class="small">${archive.env.endpoint ? 'present' : 'missing'}</td></tr>
        <tr><td class="small muted">FILONE_BUCKET</td><td class="small">${archive.env.bucket ? 'present' : 'missing'}</td></tr>
        <tr><td class="small muted">FILONE_ACCESS_KEY_ID</td><td class="small">${archive.env.access_key ? 'present' : 'missing'}</td></tr>
        <tr><td class="small muted">FILONE_SECRET_ACCESS_KEY</td><td class="small">${archive.env.secret_key ? 'present' : 'missing'}</td></tr>
        <tr><td class="small muted">Last probe</td><td class="small">${archive.last_probe ? `${esc(archive.last_probe.at)} · ${archive.last_probe.ok ? 'OK' : `FAILED${archive.last_probe.error ? ` — ${esc(archive.last_probe.error)}` : ''}`}` : 'not run'}</td></tr>
      </tbody></table>
      ${archive.reason ? `<p class="small mt-2">${esc(archive.reason)}</p>` : ''}`;
  }

  function renderStorage(storage) {
    const archive = storage.archive;
    $('storageMeta').textContent = `${storage.database.reports} report(s) · database ${storage.database.kind}`;
    $('storageLayer').innerHTML = `
      <div class="list-row"><span></span>
        <div><b>Database</b><div class="small muted">seo_reports + seo_cycles in the site’s ${esc(storage.database.kind)} store — survives restarts and redeploys.</div></div>
        <span class="chip green">${storage.database.reports} stored</span></div>
      <div class="list-row"><span></span>
        <div><b>Disk mirror</b><div class="small muted">${esc(storage.disk.directory)} (JSON + Markdown, append-only cycles.ndjson).</div></div>
        <span class="chip">present</span></div>
      <div class="list-row"><span></span>
        <div><b>Fil One archive</b><div class="small muted">${esc(archive.reason || `${archive.bucket} @ ${archive.endpoint}`)}</div></div>
        ${stateChip(archive.state)}</div>`;
  }

  /* ----------------------------------------------------------------- loads */

  async function refreshStatus() {
    const res = await PJS.get('/api/seo/status');
    if (!res.ok) {
      $('bannerArea').innerHTML = banner('error', 'The SEO Center API is unavailable', esc(res.error || ''));
      return null;
    }
    state.status = res;
    renderStatus(res);
    renderConnections(res);
    return res;
  }

  async function loadOverview() {
    const days = $('rangeDays').value;
    $('metricGrid').innerHTML = ['Clicks', 'Impressions', 'CTR', 'Average position']
      .map((label) => `<div class="stat"><div class="skeleton" style="height:34px"></div><span>${esc(label)}</span></div>`)
      .join('');
    const res = await PJS.get(`/api/seo/overview?days=${encodeURIComponent(days)}`);
    if (!res.ok) {
      $('metricGrid').innerHTML = `<div class="alert error"><b>BLOCKED</b>${esc(res.error || '')}</div>`;
      return;
    }
    state.overview = res;
    renderOverview(res);
    loadLatest();
  }

  async function loadLatest() {
    const res = await PJS.get('/api/seo/reports?limit=1');
    renderLatest(res.ok && res.reports.length ? await fetchReport(res.reports[0].id) : null);
  }

  async function fetchReport(id) {
    const res = await PJS.get(`/api/seo/reports/${id}`);
    return res.ok ? res.report : null;
  }

  async function loadQueries() {
    const days = $('rangeDays').value;
    $('queryTable').innerHTML = '<div class="skeleton" style="height:120px"></div>';
    const res = await PJS.get(`/api/seo/queries?days=${encodeURIComponent(days)}&limit=250`);
    if (!res.ok) {
      $('queryTable').innerHTML = banner('error', 'BLOCKED', esc(res.error || ''));
      return;
    }
    state.queries = res;
    renderTable(res.rows, 'query', 'queryTable', 'queryMeta', 'Query');
  }

  async function loadPages() {
    const days = $('rangeDays').value;
    $('pageTable').innerHTML = '<div class="skeleton" style="height:120px"></div>';
    const res = await PJS.get(`/api/seo/pages?days=${encodeURIComponent(days)}&limit=250`);
    if (!res.ok) {
      $('pageTable').innerHTML = banner('error', 'BLOCKED', esc(res.error || ''));
      return;
    }
    state.pages = res;
    renderTable(res.rows, 'page', 'pageTable', 'pageMeta', 'Page');
  }

  async function loadReports() {
    const res = await PJS.get('/api/seo/reports?limit=50');
    if (!res.ok) {
      $('reportTable').innerHTML = banner('error', 'Storage unavailable', esc(res.error || ''));
      return;
    }
    state.reports = res.reports;
    renderReports(res.reports);

    const storage = await PJS.get('/api/seo/storage');
    if (storage.ok) renderStorage(storage);
  }

  async function loadCycles() {
    const res = await PJS.get('/api/seo/cycles?limit=25');
    if (!res.ok) return;
    state.cycles = res.cycles;
    renderCycles(res.cycles);

    const last = res.cycles.find((c) => c.report_id) || null;
    if (last && !state.lastRun) {
      const stored = await fetchReport(last.report_id); // { …row, report: payload }
      const payload = stored && stored.report;
      if (payload) {
        renderPipeline({
          cycle_no: last.cycle_no,
          state: last.status,
          duration_ms: last.duration_ms,
          stages: (payload.stages || []).map((s) => ({ stage: s.stage, status: s.status, detail: s.detail, duration_ms: s.duration_ms })),
          report: payload
        });
      }
    }
  }

  /* ----------------------------------------------------------------- cycle */

  async function runCycle() {
    const button = $('runCycleBtn');
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Running cycle…';
    setTab('pipeline');
    $('pipeline').innerHTML = STAGES.map(([key, label], index) =>
      `<div class="pipe-stage pending"><span class="n">${index + 1}</span><div><b>${esc(label)}</b><span>waiting…</span></div><span></span></div>`
    ).join('');

    const res = await PJS.post('/api/seo/cycle', { days: $('rangeDays').value });
    button.textContent = original;
    button.disabled = !(state.status && state.status.google_search_console.state === 'CONNECTED');

    if (!res.ok) {
      PJS.toast(res.error || 'The cycle failed.', 'error');
      renderPipeline({ cycle_no: '', state: 'FAILED', stages: [], report: null });
      return;
    }

    state.lastRun = res;
    renderPipeline(res);
    if (res.state === 'BLOCKED') {
      PJS.toast(`BLOCKED — ${res.reason}`, 'error');
    } else if (res.state === 'COMPLETE') {
      PJS.toast(`Cycle #${res.cycle_no} finished — ${res.status}`, 'success');
      loadOverview();
      loadCycles();
      loadReports();
    }
    refreshStatus();
  }

  /* ------------------------------------------------------------ connect */

  async function startConnect() {
    const res = await PJS.get('/api/seo/connect/start');
    if (!res.ok) {
      PJS.toast(res.error || 'OAuth is not configured on this server.', 'error');
      return;
    }
    window.location.href = res.authorization_url;
  }

  /* ----------------------------------------------------------------- tabs */

  const LOADERS = {
    overview: () => {
      loadOverview();
    },
    pipeline: () => {
      loadCycles();
    },
    queries: loadQueries,
    pages: loadPages,
    reports: loadReports,
    connections: refreshStatus
  };

  function setTab(name) {
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hide', p.dataset.pane !== name));
    if (LOADERS[name]) LOADERS[name]();
  }

  /* ----------------------------------------------------------------- boot */

  PJS.onReady(async function () {
    if (!PJS.requireAuth()) return;
    if (!PJS.me || PJS.me.role !== 'admin') {
      $('gate').innerHTML = `<div class="alert error">
        <b>Administrator access required</b>
        The SEO Center shows the site’s search data and is only available to administrators.
        <div class="btn-row mt-2">
          <a class="btn sm" href="/login.html?next=${encodeURIComponent('/seo.html')}">Log in as administrator</a>
          <a class="btn ghost sm" href="/dashboard.html">Back to dashboard</a>
        </div></div>`;
      return;
    }
    $('panel').classList.remove('hide');
    document.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => setTab(b.dataset.tab);
    });
    $('refreshData').onclick = loadOverview;
    $('rangeDays').onchange = () => {
      const active = document.querySelector('[data-tab].active');
      setTab(active ? active.dataset.tab : 'overview');
    };
    $('runCycleBtn').onclick = runCycle;
    $('closeReport').onclick = () => $('reportDetailCard').classList.add('hide');
    $('testAiBtn').onclick = async () => {
      $('testAiBtn').disabled = true;
      const res = await PJS.post('/api/seo/ai/test');
      $('testAiBtn').disabled = false;
      if (!res.ok) return PJS.toast(res.error || 'The AI test failed.', 'error');
      PJS.toast(
        res.ok && res.engine ? `AI answered via ${res.engine} (${res.model})` : 'No AI provider answered — the deterministic rule engine will be used.',
        res.engine ? 'success' : 'error'
      );
      refreshStatus();
    };
    $('probeArchiveBtn').onclick = async () => {
      $('probeArchiveBtn').disabled = true;
      const res = await PJS.get('/api/seo/storage?probe=1');
      $('probeArchiveBtn').disabled = false;
      if (!res.ok) return PJS.toast(res.error || 'The probe failed.', 'error');
      PJS.toast(
        res.archive.state === 'CONNECTED' ? 'Fil One archive probe succeeded.' : `Archive ${res.archive.state}: ${res.archive.reason || ''}`,
        res.archive.state === 'CONNECTED' ? 'success' : 'error'
      );
      refreshStatus();
    };

    const connected = PJS.qs('connected');
    const connectError = PJS.qs('connect_error');
    if (connected) PJS.toast(connected, 'success');
    if (connectError) PJS.toast(connectError, 'error');

    const status = await refreshStatus();
    renderPipeline(null);
    if (status && status.google_search_console.state === 'CONNECTED') {
      loadOverview();
    } else {
      renderOverview({ totals: null, daily: [], state: status ? status.google_search_console.state : 'NOT_CONNECTED', period: null, days: $('rangeDays').value });
      loadLatest();
    }
    loadCycles();
    if (connectError || connected) setTab('connections');
  });
})();
