'use strict';
/**
 * PANIKA JEEVAN SATHI — SEO Center agent team.
 *
 *   Pooja   → SEO research on the real Search Console numbers
 *   Priya   → verification: every claim is re-checked against the data
 *   Manager → planning + final recommendations
 *
 * Integrity rules that are enforced in code, not in prose:
 *
 *   • No agent may invent a number. Every finding carries `claims` that name a
 *     real query/page and the metric value it is based on.
 *   • Priya recomputes the totals, checks the CTR maths and looks up each claim
 *     in the dataset. A claim that does not match is CONTRADICTED; a subject
 *     that does not exist in the data is reported as fabricated.
 *   • Verification is only VERIFIED when nothing contradicts and every numeric
 *     claim matched. Otherwise PARTIAL or FAILED — never a blanket "PASS".
 *   • When no AI provider answers, the deterministic rule engine produces the
 *     findings and the report says `engine: "deterministic-rules"`.
 */

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const FINDING_TYPES = [
  'ctr',
  'ranking',
  'content_gap',
  'technical',
  'internal_linking',
  'trend',
  'brand',
  'opportunity'
];
const METRICS = ['clicks', 'impressions', 'ctr', 'position'];

const SYSTEM_PROMPT = [
  'You are Pooja, the SEO research analyst for PANIKA JEEVAN SATHI, a 100% free',
  'community matrimonial website for the Panika / Manikpuri / Kabirpanthi / Adivasi',
  'communities in India. You are given REAL Google Search Console data.',
  '',
  'Rules you must follow:',
  '- Use only the numbers in the data. Never invent queries, pages, clicks,',
  '  impressions, CTR or positions.',
  '- Every finding must include "claims": the exact rows it is based on, as',
  '  {subject_kind, subject, metric, value} using the values from the data.',
  '- Suggestions for NEW keywords are allowed but must be listed under',
  '  keyword_opportunities with "verified": false — they are hypotheses, not data.',
  '- Keep it practical for a small volunteer-run community site: no paid tools,',
  '  no spam, no link schemes, no scraping.',
  '- Reply with a single JSON object and nothing else.'
].join('\n');

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function pct(value, digits = 2) {
  return round(Number(value || 0) * 100, digits);
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function weightedCtr(rows) {
  const impressions = sum(rows, 'impressions');
  if (!impressions) return 0;
  return sum(rows, 'clicks') / impressions;
}

/** Compact, token-cheap digest of the real data for the model prompt. */
function digest(data, { queries = 40, pages = 25, days = 14 } = {}) {
  const daily = (data.daily || []).slice(-days).map((d) => ({
    date: d.date,
    clicks: d.clicks,
    impressions: d.impressions,
    ctr: round(d.ctr * 100, 2),
    position: round(d.position, 1)
  }));
  return {
    site_url: data.site_url,
    period: data.period,
    days: data.days,
    totals: {
      clicks: data.totals.clicks,
      impressions: data.totals.impressions,
      ctr_percent: pct(data.totals.ctr),
      average_position: round(data.totals.position, 1)
    },
    previous_period: data.previous
      ? {
          clicks: data.previous.clicks,
          impressions: data.previous.impressions,
          ctr_percent: pct(data.previous.ctr),
          average_position: round(data.previous.position, 1)
        }
      : null,
    daily,
    top_queries: (data.queries || []).slice(0, queries).map((q) => ({
      query: q.query,
      clicks: q.clicks,
      impressions: q.impressions,
      ctr_percent: pct(q.ctr),
      position: round(q.position, 1)
    })),
    top_pages: (data.pages || []).slice(0, pages).map((p) => ({
      page: p.page,
      clicks: p.clicks,
      impressions: p.impressions,
      ctr_percent: pct(p.ctr),
      position: round(p.position, 1)
    })),
    row_counts: {
      queries: (data.queries || []).length,
      pages: (data.pages || []).length,
      truncated: Boolean(data.truncated)
    }
  };
}

/* ------------------------------------------------------------------ Pooja */

/** Deterministic findings straight from the real rows. */
function ruleFindings(data) {
  const findings = [];
  const queries = data.queries || [];
  const pages = data.pages || [];
  const siteCtr = data.totals.impressions ? data.totals.ctr : 0;
  const minImpressions = Math.max(10, Math.round(sum(queries, 'impressions') * 0.002));
  let seq = 0;
  const id = (type) => `${type}-${(seq += 1)}`;

  const claim = (kind, subject, metric, value) => ({
    subject_kind: kind,
    subject,
    metric,
    value: round(value, metric === 'ctr' ? 4 : metric === 'position' ? 2 : 0)
  });

  // 1. Impressions without clicks — the cheapest wins on the page.
  const clickless = pages
    .filter((p) => p.impressions >= minImpressions && p.clicks === 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5);
  if (clickless.length) {
    findings.push({
      id: id('content_gap'),
      type: 'content_gap',
      severity: 'high',
      title: `${clickless.length} page(s) earn impressions but zero clicks`,
      summary:
        'Google is showing these pages but nobody clicks. The title and meta description do not answer the searcher, or the page is not the right result for those queries.',
      evidence: clickless.map((p) => `${p.page} — ${p.impressions} impressions, 0 clicks, position ${round(p.position, 1)}`),
      claims: clickless.flatMap((p) => [
        claim('page', p.page, 'impressions', p.impressions),
        claim('page', p.page, 'clicks', p.clicks)
      ]),
      actions: [
        'Rewrite the <title> and meta description of each page around the queries that trigger it.',
        'Check the page is crawlable and indexable (robots.txt, noindex, canonical).',
        'Add the community terms people actually search (Panika, Manikpuri, Kabirpanthi) naturally in the first paragraph.'
      ],
      expected: 'Turning even one of these pages into a clicked result adds real visits at zero cost.'
    });
  }

  // 2. Near-page-one queries (positions 8–20) with volume.
  const nearPageOne = queries
    .filter((q) => q.position >= 8 && q.position <= 20 && q.impressions >= minImpressions)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8);
  if (nearPageOne.length) {
    findings.push({
      id: id('ranking'),
      type: 'ranking',
      severity: 'high',
      title: `${nearPageOne.length} quer(y/ies) sit just outside the top results`,
      summary:
        'These queries already rank on the edge of page one. Small relevance improvements move them into the clicked positions.',
      evidence: nearPageOne.map(
        (q) => `"${q.query}" — position ${round(q.position, 1)}, ${q.impressions} impressions, ${q.clicks} clicks`
      ),
      claims: nearPageOne.flatMap((q) => [
        claim('query', q.query, 'position', q.position),
        claim('query', q.query, 'impressions', q.impressions)
      ]),
      actions: [
        'Expand the target page so it fully answers the query (definitions, steps, local context).',
        'Add an internal link with that exact phrase as anchor text from a stronger page.',
        'Add a clear H2 section that matches the query wording.'
      ],
      expected: 'Page-one positions typically multiply clicks several times over.'
    });
  }

  // 3. Low CTR despite good position.
  const lowCtr = queries
    .filter((q) => q.position <= 10 && q.impressions >= minImpressions && q.ctr < Math.max(0.01, siteCtr * 0.6))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8);
  if (lowCtr.length) {
    findings.push({
      id: id('ctr'),
      type: 'ctr',
      severity: 'medium',
      title: 'Strong rankings with a below-average click-through rate',
      summary: `The site average CTR is ${pct(siteCtr)}%. These queries rank well but convert impressions to clicks far less often.`,
      evidence: lowCtr.map(
        (q) => `"${q.query}" — CTR ${pct(q.ctr)}% at position ${round(q.position, 1)} (${q.impressions} impressions)`
      ),
      claims: lowCtr.flatMap((q) => [
        claim('query', q.query, 'ctr', q.ctr),
        claim('query', q.query, 'position', q.position)
      ]),
      actions: [
        'Put the community name and the benefit in the first 55 characters of the title.',
        'Write a meta description that answers the searcher in one line (free, no payment, family-verified).',
        'Make sure the URL slug matches the query intent.'
      ],
      expected: 'A CTR lift on already-ranked queries is the fastest traffic win available.'
    });
  }

  // 4. Trend: last 7 days vs the 7 days before.
  const daily = data.daily || [];
  if (daily.length >= 14) {
    const recent = daily.slice(-7);
    const before = daily.slice(-14, -7);
    const recentClicks = sum(recent, 'clicks');
    const beforeClicks = sum(before, 'clicks');
    const recentImpressions = sum(recent, 'impressions');
    const beforeImpressions = sum(before, 'impressions');
    const change = (a, b) => (b ? round(((a - b) / b) * 100, 1) : null);
    const clickChange = change(recentClicks, beforeClicks);
    const impressionChange = change(recentImpressions, beforeImpressions);
    if (clickChange !== null && (clickChange <= -20 || impressionChange <= -20)) {
      findings.push({
        id: id('trend'),
        type: 'trend',
        severity: 'critical',
        title: 'Search demand for the site dropped week over week',
        summary: `Clicks ${beforeClicks} → ${recentClicks} (${clickChange}%), impressions ${beforeImpressions} → ${recentImpressions} (${impressionChange}%).`,
        evidence: [
          `last 7 days: ${recentClicks} clicks / ${recentImpressions} impressions`,
          `previous 7 days: ${beforeClicks} clicks / ${beforeImpressions} impressions`
        ],
        claims: [],
        actions: [
          'Check Search Console → Indexing for a coverage loss or manual action.',
          'Confirm robots.txt and sitemap.xml still resolve (this site generates both at /robots.txt and /sitemap.xml).',
          'Check whether a page was redirected or removed in the last two weeks.'
        ],
        expected: 'Catching an indexing loss early prevents months of lost visibility.'
      });
    } else if (clickChange !== null && clickChange >= 20) {
      findings.push({
        id: id('trend'),
        type: 'trend',
        severity: 'low',
        title: 'Search demand is growing week over week',
        summary: `Clicks ${beforeClicks} → ${recentClicks} (+${clickChange}%). Reinforce whatever is working before it plateaus.`,
        evidence: [`last 7 days: ${recentClicks} clicks`, `previous 7 days: ${beforeClicks} clicks`],
        claims: [],
        actions: [
          'Publish one more page in the theme that is growing.',
          'Add internal links from the growing pages to the registration and search pages.'
        ],
        expected: 'Compounding on a rising theme is cheaper than starting a new one.'
      });
    }
  }

  // 5. Content gaps: high-impression queries the site barely serves.
  const gaps = queries
    .filter((q) => q.impressions >= minImpressions && q.position > 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 6);
  if (gaps.length) {
    findings.push({
      id: id('content_gap'),
      type: 'content_gap',
      severity: 'medium',
      title: 'Queries where the site shows up but ranks too low to be seen',
      summary:
        'Google already associates these queries with the site, but the ranking page is not a dedicated answer. A focused page usually wins here.',
      evidence: gaps.map((q) => `"${q.query}" — position ${round(q.position, 1)}, ${q.impressions} impressions`),
      claims: gaps.flatMap((q) => [
        claim('query', q.query, 'position', q.position),
        claim('query', q.query, 'impressions', q.impressions)
      ]),
      actions: [
        'Create one page per theme with the query in the title, H1 and first paragraph.',
        'Link the new page from the footer or an existing high-traffic page.',
        'Add the page to sitemap.xml and request indexing in Search Console.'
      ],
      expected: 'A dedicated page for an existing impression stream is the highest-probability ranking win.'
    });
  }

  // 6. Pages that carry the whole site — protect and extend them.
  const topPages = (pages || []).slice(0, 3).filter((p) => p.clicks > 0);
  if (topPages.length) {
    const share = data.totals.clicks ? round((sum(topPages, 'clicks') / data.totals.clicks) * 100, 1) : 0;
    findings.push({
      id: id('internal_linking'),
      type: 'internal_linking',
      severity: 'low',
      title: `The top ${topPages.length} page(s) produce ${share}% of all clicks`,
      summary:
        'Traffic is concentrated. These pages should push visitors to registration and profile search, and pass authority to weaker pages.',
      evidence: topPages.map((p) => `${p.page} — ${p.clicks} clicks, ${p.impressions} impressions`),
      claims: topPages.flatMap((p) => [
        claim('page', p.page, 'clicks', p.clicks),
        claim('page', p.page, 'impressions', p.impressions)
      ]),
      actions: [
        'Add a visible "Register free" call to action on each of these pages.',
        'Add 2–3 contextual internal links to newer pages that need authority.'
      ],
      expected: 'Converting existing search traffic costs nothing and compounds.'
    });
  }

  if (!findings.length) {
    findings.push({
      id: id('opportunity'),
      type: 'opportunity',
      severity: 'low',
      title: 'Not enough Search Console history yet for pattern detection',
      summary: `The property returned ${queries.length} queries and ${pages.length} pages with ${data.totals.impressions} impressions in this window — below the threshold for automated findings.`,
      evidence: [`${queries.length} query rows`, `${pages.length} page rows`, `${data.totals.impressions} impressions`],
      claims: [claim('property', data.site_url, 'impressions', data.totals.impressions)],
      actions: [
        'Keep the property verified and let data accumulate for at least 28 days.',
        'Submit sitemap.xml and request indexing for the public pages.',
        'Re-run the SEO cycle next week for a wider window.'
      ],
      expected: 'Findings become reliable once the property has a few thousand impressions.'
    });
  }

  // Keyword hypotheses — clearly marked as unverified suggestions.
  const themes = {};
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'of', 'in', 'to', 'is', 'marriage', 'matrimonial',
    'site', 'website', 'free', 'com', 'www', 'https', 'http', 'shadi', 'vivah', 'biyah'
  ]);
  for (const q of queries.slice(0, 200)) {
    for (const token of String(q.query).toLowerCase().split(/[^a-z0-9\u0900-\u097F]+/)) {
      if (!token || token.length < 4 || stopWords.has(token)) continue;
      if (!themes[token]) themes[token] = { theme: token, impressions: 0, clicks: 0, queries: 0 };
      themes[token].impressions += q.impressions;
      themes[token].clicks += q.clicks;
      themes[token].queries += 1;
    }
  }
  const keywordOpportunities = Object.values(themes)
    .filter((t) => t.queries >= 2)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8)
    .map((t) => ({
      theme: t.theme,
      related_queries: t.queries,
      impressions: t.impressions,
      clicks: t.clicks,
      verified: false,
      note: 'Derived from the query rows in this window; the keyword idea itself is a hypothesis, not a measured result.'
    }));

  return { findings, keyword_opportunities: keywordOpportunities };
}

function buildResearchPrompt(data) {
  const json = JSON.stringify(digest(data), null, 1);
  return [
    'Analyse this Google Search Console data for PANIKA JEEVAN SATHI and produce the SEO research.',
    '',
    'DATA (real, from the Search Analytics API):',
    json,
    '',
    'Reply with JSON in exactly this shape:',
    JSON.stringify(
      {
        findings: [
          {
            type: FINDING_TYPES.join(' | '),
            severity: SEVERITIES.join(' | '),
            title: 'short title',
            summary: '2-3 sentences',
            evidence: ['exact rows this is based on'],
            claims: [{ subject_kind: 'query|page|property', subject: 'exact value from the data', metric: METRICS.join('|'), value: 0 }],
            actions: ['concrete step 1', 'concrete step 2'],
            expected: 'what should improve'
          }
        ],
        keyword_opportunities: [
          { theme: 'topic', related_queries: 0, impressions: 0, clicks: 0, verified: false, note: 'why' }
        ],
        notes: 'anything the data cannot answer'
      },
      null,
      1
    ),
    '',
    'Use 4 to 8 findings. Every claim must copy a value that appears in the data above.'
  ].join('\n');
}

/**
 * Pooja — SEO research.
 * Uses the AI router when a provider answers; otherwise the deterministic rule
 * engine. Either way the findings are grounded in the real rows.
 */
async function research({ data, ai, log = () => {} }) {
  const startedAt = Date.now();
  const rules = ruleFindings(data);
  const result = {
    agent: 'Pooja',
    role: 'SEO Research',
    engine: 'deterministic-rules',
    model: null,
    remote: false,
    attempts: [],
    fallback_used: false,
    findings: rules.findings,
    keyword_opportunities: rules.keyword_opportunities,
    notes: '',
    duration_ms: 0
  };

  if (!ai) {
    result.notes = 'No AI router was available for this run; findings come from the deterministic rule engine applied to the real Search Console rows.';
    result.duration_ms = Date.now() - startedAt;
    return result;
  }

  const answer = await ai.complete({
    system: SYSTEM_PROMPT,
    prompt: buildResearchPrompt(data),
    json: true
  });
  result.attempts = answer.attempts || [];

  if (!answer.ok || !answer.parsed) {
    result.notes =
      answer.reason === 'NOT_CONFIGURED'
        ? 'No AI provider is configured on this server; findings come from the deterministic rule engine applied to the real Search Console rows.'
        : 'Every configured AI provider failed; findings come from the deterministic rule engine applied to the real Search Console rows.';
    result.duration_ms = Date.now() - startedAt;
    log(`[seo/pooja] ${result.notes}`);
    return result;
  }

  const parsed = answer.parsed;
  const findings = normaliseFindings(parsed.findings, rules.findings);
  result.engine = answer.engine;
  result.engine_name = answer.engine_name;
  result.model = answer.model;
  result.remote = true;
  result.fallback_used = Boolean(answer.fallback_used);
  result.findings = findings.length ? findings : rules.findings;
  result.keyword_opportunities = Array.isArray(parsed.keyword_opportunities)
    ? parsed.keyword_opportunities.slice(0, 12).map((k) => ({
        theme: String(k.theme || '').slice(0, 120),
        related_queries: Number(k.related_queries || 0),
        impressions: Number(k.impressions || 0),
        clicks: Number(k.clicks || 0),
        // A keyword idea is never "verified data" — Priya keeps it honest.
        verified: false,
        note: String(k.note || 'Model hypothesis, not measured Search Console data.').slice(0, 300)
      }))
    : rules.keyword_opportunities;
  result.notes = String(parsed.notes || '').slice(0, 600);
  result.duration_ms = Date.now() - startedAt;
  if (!findings.length) result.notes = (result.notes ? `${result.notes} ` : '') + 'The model returned no usable findings, so the deterministic rule engine result was used.';
  return result;
}

/** Validate and normalise model output — drop anything structurally wrong. */
function normaliseFindings(raw, fallback) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const title = String(item.title || '').trim();
    if (!title) continue;
    const severity = SEVERITIES.includes(String(item.severity)) ? String(item.severity) : 'medium';
    const type = FINDING_TYPES.includes(String(item.type)) ? String(item.type) : 'opportunity';
    const actions = Array.isArray(item.actions)
      ? item.actions.map((a) => String(a).trim()).filter(Boolean).slice(0, 6)
      : [];
    const claims = Array.isArray(item.claims)
      ? item.claims
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({
            subject_kind: ['query', 'page', 'property'].includes(String(c.subject_kind)) ? String(c.subject_kind) : 'query',
            subject: String(c.subject === undefined || c.subject === null ? '' : c.subject).slice(0, 500),
            metric: METRICS.includes(String(c.metric)) ? String(c.metric) : '',
            value: Number(c.value)
          }))
          .filter((c) => c.subject && c.metric && Number.isFinite(c.value))
      : [];
    out.push({
      id: `ai-${out.length + 1}`,
      type,
      severity,
      title: title.slice(0, 180),
      summary: String(item.summary || '').slice(0, 900),
      evidence: Array.isArray(item.evidence)
        ? item.evidence.map((e) => String(e).slice(0, 300)).slice(0, 8)
        : [],
      claims,
      actions,
      expected: String(item.expected || '').slice(0, 300)
    });
  }
  return out.length ? out : fallback.slice(0, 0).concat([]);
}

/* ------------------------------------------------------------------ Priya */

const TOLERANCE = {
  ctr: 0.002, // 0.2 percentage points
  position: 0.6,
  clicks: 0,
  impressions: 0
};

/**
 * Priya — verification.
 *
 * Everything here is arithmetic against the fetched rows: no model call, no
 * opinion. That is deliberate — the verifier must not share the researcher's
 * blind spots.
 */
function verify({ data, research, period }) {
  const startedAt = Date.now();
  const checks = [];
  const claimResults = [];
  const fabricated = [];

  const queryIndex = new Map((data.queries || []).map((q) => [String(q.query), q]));
  const pageIndex = new Map((data.pages || []).map((p) => [String(p.page), p]));

  const addCheck = (name, passed, detail) => {
    checks.push({ name, status: passed ? 'VERIFIED' : 'FAILED', detail });
    return passed;
  };

  // 1. The data itself must be internally consistent.
  const dailyClicks = sum(data.daily || [], 'clicks');
  const dailyImpressions = sum(data.daily || [], 'impressions');
  const totalsMatch =
    Math.abs(dailyClicks - data.totals.clicks) <= Math.max(2, data.totals.clicks * 0.01) &&
    Math.abs(dailyImpressions - data.totals.impressions) <= Math.max(2, data.totals.impressions * 0.01);
  addCheck(
    'daily rows sum to the totals row',
    totalsMatch,
    `daily: ${dailyClicks} clicks / ${dailyImpressions} impressions · totals row: ${data.totals.clicks} / ${data.totals.impressions}`
  );

  const ctrCheck = data.totals.impressions
    ? Math.abs(data.totals.ctr - data.totals.clicks / data.totals.impressions) <= TOLERANCE.ctr
    : true;
  addCheck(
    'CTR equals clicks ÷ impressions',
    ctrCheck,
    `reported CTR ${pct(data.totals.ctr)}% · computed ${pct(data.totals.clicks / (data.totals.impressions || 1))}%`
  );

  const hasData = data.totals.impressions > 0;
  addCheck(
    'the property actually returned search data',
    hasData,
    hasData
      ? `${data.totals.impressions} impressions and ${data.totals.clicks} clicks in ${data.days} days`
      : 'Search Console returned zero impressions — there is nothing to analyse'
  );

  const periodOk =
    Boolean(period) &&
    period.startDate === data.period.start &&
    period.endDate === data.period.end;
  addCheck(
    'the analysed window matches the requested window',
    periodOk,
    `requested ${period ? `${period.startDate} → ${period.endDate}` : 'unknown'} · analysed ${data.period.start} → ${data.period.end}`
  );

  // 2. Every claim a finding makes must exist in the data.
  const findings = (research && research.findings) || [];
  for (const finding of findings) {
    for (const claim of finding.claims || []) {
      const row =
        claim.subject_kind === 'query'
          ? queryIndex.get(String(claim.subject))
          : claim.subject_kind === 'page'
            ? pageIndex.get(String(claim.subject))
            : null;

      if (claim.subject_kind === 'property') {
        const actual = data.totals[claim.metric];
        const ok = Number.isFinite(actual) && Math.abs(actual - claim.value) <= (TOLERANCE[claim.metric] || 1);
        claimResults.push({
          finding: finding.id,
          subject_kind: 'property',
          subject: claim.subject,
          metric: claim.metric,
          claimed: round(claim.value, 4),
          actual: round(actual, 4),
          status: ok ? 'VERIFIED' : 'CONTRADICTED'
        });
        continue;
      }

      if (!row) {
        claimResults.push({
          finding: finding.id,
          subject_kind: claim.subject_kind,
          subject: claim.subject,
          metric: claim.metric,
          claimed: round(claim.value, 4),
          actual: null,
          status: 'UNVERIFIABLE'
        });
        fabricated.push({ kind: claim.subject_kind, value: String(claim.subject).slice(0, 300), reason: 'not present in the fetched Search Console rows' });
        continue;
      }

      const actual = row[claim.metric];
      const tolerance = TOLERANCE[claim.metric] === undefined ? 1 : TOLERANCE[claim.metric];
      const relative =
        claim.metric === 'clicks' || claim.metric === 'impressions'
          ? Math.max(0, Number(actual) * 0.01) // 1% tolerance for rounding in the API
          : 0;
      const ok = Number.isFinite(actual) && Math.abs(actual - claim.value) <= tolerance + relative;
      claimResults.push({
        finding: finding.id,
        subject_kind: claim.subject_kind,
        subject: String(claim.subject).slice(0, 300),
        metric: claim.metric,
        claimed: round(claim.value, 4),
        actual: round(actual, 4),
        status: ok ? 'VERIFIED' : 'CONTRADICTED'
      });
    }
  }

  const counts = {
    total: claimResults.length,
    verified: claimResults.filter((c) => c.status === 'VERIFIED').length,
    contradicted: claimResults.filter((c) => c.status === 'CONTRADICTED').length,
    unverifiable: claimResults.filter((c) => c.status === 'UNVERIFIABLE').length
  };

  addCheck(
    'every numeric claim matches the fetched data',
    counts.contradicted === 0,
    `${counts.verified}/${counts.total} claims matched the data, ${counts.contradicted} contradicted, ${counts.unverifiable} unverifiable`
  );

  addCheck(
    'no invented queries or pages in the findings',
    fabricated.length === 0,
    fabricated.length ? fabricated.map((f) => `${f.kind}: ${f.value}`).join('; ') : 'all named queries and pages exist in the data'
  );

  // 3. Every finding must be actionable and correctly shaped.
  const shapeOk = findings.every(
    (f) => f.title && SEVERITIES.includes(f.severity) && Array.isArray(f.actions) && f.actions.length > 0
  );
  addCheck(
    'every finding has a severity and at least one action',
    shapeOk,
    `${findings.length} findings inspected`
  );

  const keywordClaims = ((research && research.keyword_opportunities) || []).filter((k) => k.verified === true);
  addCheck(
    'keyword hypotheses are not presented as measured data',
    keywordClaims.length === 0,
    keywordClaims.length
      ? `${keywordClaims.length} keyword suggestion(s) were marked verified`
      : 'all keyword suggestions carry verified:false'
  );

  const dataChecksPassed = checks.filter((c) => c.name.startsWith('the property') === false).length;
  const failed = checks.filter((c) => c.status === 'FAILED');

  let status = 'VERIFIED';
  if (failed.length || counts.contradicted > 0 || fabricated.length > 0) status = 'FAILED';
  else if (counts.unverifiable > 0 || counts.total === 0) status = 'PARTIAL';

  return {
    agent: 'Priya',
    role: 'Verification',
    method: 'deterministic cross-check against the fetched Search Console rows',
    checks,
    claims: claimResults.slice(0, 200),
    counts,
    fabricated_subjects: fabricated.slice(0, 20),
    failed_checks: failed.map((c) => c.name),
    checks_total: dataChecksPassed,
    status,
    duration_ms: Date.now() - startedAt
  };
}

/* ---------------------------------------------------------------- Manager */

const EFFORT = { critical: 'high', high: 'medium', medium: 'medium', low: 'low' };
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function buildManagerPrompt({ data, research, verification }) {
  return [
    'You are the Manager for the PANIKA JEEVAN SATHI SEO Center. Pooja produced',
    'research and Priya verified it. Write the final plan for the site owner.',
    '',
    'VERIFIED DATA:',
    JSON.stringify(
      {
        site: data.site_url,
        period: data.period,
        totals: {
          clicks: data.totals.clicks,
          impressions: data.totals.impressions,
          ctr_percent: pct(data.totals.ctr),
          average_position: round(data.totals.position, 1)
        },
        previous: data.previous
          ? {
              clicks: data.previous.clicks,
              impressions: data.previous.impressions,
              ctr_percent: pct(data.previous.ctr),
              average_position: round(data.previous.position, 1)
            }
          : null
      },
      null,
      1
    ),
    '',
    'POOJA FINDINGS:',
    JSON.stringify(research.findings.map((f) => ({ title: f.title, severity: f.severity, summary: f.summary, actions: f.actions })), null, 1),
    '',
    'PRIYA VERIFICATION:',
    JSON.stringify({ status: verification.status, counts: verification.counts, failed_checks: verification.failed_checks }, null, 1),
    '',
    'Rules: never invent numbers, never recommend paid ads, spam links or scraping,',
    'never propose an automatic production deploy. Reply with JSON only:',
    JSON.stringify(
      {
        summary: '3-5 sentence plain-language summary for the owner',
        priorities: [{ rank: 1, title: '', why: '', action: '', impact: 'high|medium|low', effort: 'low|medium|high' }],
        next_cycle: { focus: '', checks: [''] },
        risks: ['']
      },
      null,
      1
    )
  ].join('\n');
}

/** Deterministic plan used when the model is unavailable or unusable. */
function rulePlan({ data, research, verification }) {
  const ordered = research.findings
    .slice()
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));

  const priorities = ordered.slice(0, 5).map((finding, index) => ({
    rank: index + 1,
    title: finding.title,
    why: finding.summary,
    action: (finding.actions && finding.actions[0]) || 'Review this finding in the report.',
    impact: finding.severity === 'critical' || finding.severity === 'high' ? 'high' : 'medium',
    effort: EFFORT[finding.severity] || 'medium',
    finding_id: finding.id
  }));

  const delta = data.previous
    ? {
        clicks: data.totals.clicks - data.previous.clicks,
        impressions: data.totals.impressions - data.previous.impressions,
        position: round(data.totals.position - data.previous.position, 2)
      }
    : null;

  const direction = delta
    ? delta.clicks > 0
      ? 'up'
      : delta.clicks < 0
        ? 'down'
        : 'flat'
    : 'unknown';

  return {
    summary:
      `Search Console reports ${data.totals.clicks} clicks and ${data.totals.impressions} impressions ` +
      `over ${data.days} days (${data.period.start} → ${data.period.end}) with a CTR of ${pct(data.totals.ctr)}% ` +
      `and an average position of ${round(data.totals.position, 1)}. ` +
      (delta ? `Compared with the previous period, clicks are ${direction} by ${Math.abs(delta.clicks)}. ` : '') +
      `Pooja raised ${research.findings.length} findings and Priya's verification is ${verification.status} ` +
      `(${verification.counts.verified}/${verification.counts.total} numeric claims matched the data).`,
    priorities,
    next_cycle: {
      focus:
        verification.status === 'FAILED'
          ? 'Fix the contradicted findings before acting on anything else.'
          : ordered.length
            ? ordered[0].title
            : 'Accumulate more Search Console history, then re-run the cycle.',
      checks: [
        'Re-run the cycle after the changes are live (Search Console needs 2-3 days to reflect them).',
        'Compare clicks and impressions against this report.',
        'Confirm the site still passes /api/health and the health check.'
      ]
    },
    risks: [
      'Search Console data lags 2-3 days, so the last few days of the window are incomplete.',
      'Ranking moves take weeks; judge a change over at least one full cycle, not one day.'
    ]
  };
}

/**
 * Manager — planning and final recommendations.
 */
async function plan({ data, research, verification, ai, log = () => {} }) {
  const startedAt = Date.now();
  const fallback = rulePlan({ data, research, verification });
  const result = {
    agent: 'Manager',
    role: 'Planning & Final Recommendations',
    engine: 'deterministic-rules',
    model: null,
    remote: false,
    attempts: [],
    summary: fallback.summary,
    priorities: fallback.priorities,
    next_cycle: fallback.next_cycle,
    risks: fallback.risks,
    decisions: {
      production_deploy: 'NOT_TRIGGERED',
      publish: 'MANUAL_REVIEW_REQUIRED',
      auto_deploy_allowed: false
    },
    blocked_reasons: [],
    duration_ms: 0
  };

  if (verification.status === 'FAILED') {
    result.decisions.publish = 'BLOCKED_BY_VERIFICATION';
    result.blocked_reasons.push(
      `Priya's verification FAILED: ${verification.failed_checks.join(', ') || 'contradicted claims'}.`
    );
  }
  if (!data.totals.impressions) {
    result.decisions.publish = 'NO_DATA';
    result.blocked_reasons.push('Search Console returned no impressions for this window.');
  }

  if (ai) {
    const answer = await ai.complete({
      system:
        'You are the Manager of a volunteer-run community website SEO team. Be concrete, honest and conservative. Reply with JSON only.',
      prompt: buildManagerPrompt({ data, research, verification }),
      json: true
    });
    result.attempts = answer.attempts || [];
    if (answer.ok && answer.parsed) {
      const parsed = answer.parsed;
      result.engine = answer.engine;
      result.engine_name = answer.engine_name;
      result.model = answer.model;
      result.remote = true;
      if (String(parsed.summary || '').trim()) result.summary = String(parsed.summary).slice(0, 1200);
      if (Array.isArray(parsed.priorities) && parsed.priorities.length) {
        result.priorities = parsed.priorities
          .slice(0, 8)
          .map((p, index) => ({
            rank: Number(p.rank) || index + 1,
            title: String(p.title || '').slice(0, 180),
            why: String(p.why || '').slice(0, 600),
            action: String(p.action || '').slice(0, 400),
            impact: ['high', 'medium', 'low'].includes(String(p.impact)) ? String(p.impact) : 'medium',
            effort: ['high', 'medium', 'low'].includes(String(p.effort)) ? String(p.effort) : 'medium'
          }))
          .filter((p) => p.title);
      }
      if (parsed.next_cycle && typeof parsed.next_cycle === 'object') {
        result.next_cycle = {
          focus: String(parsed.next_cycle.focus || fallback.next_cycle.focus).slice(0, 400),
          checks: Array.isArray(parsed.next_cycle.checks)
            ? parsed.next_cycle.checks.map((c) => String(c).slice(0, 300)).slice(0, 8)
            : fallback.next_cycle.checks
        };
      }
      if (Array.isArray(parsed.risks) && parsed.risks.length) {
        result.risks = parsed.risks.map((r) => String(r).slice(0, 300)).slice(0, 6);
      }
    } else {
      log('[seo/manager] AI plan unavailable — using the deterministic plan.');
    }
  }

  result.duration_ms = Date.now() - startedAt;
  return result;
}

module.exports = {
  SEVERITIES,
  FINDING_TYPES,
  METRICS,
  SYSTEM_PROMPT,
  digest,
  ruleFindings,
  research,
  verify,
  plan,
  rulePlan,
  normaliseFindings,
  helpers: { round, pct, sum, weightedCtr }
};
