'use strict';
/**
 * AI TEAM DASHBOARD — integrated module for PANIKA JEEVAN SATHI.
 *
 * Serves the WhatsApp-style "4 AI Employees" dashboard at /ai-team
 * and a real website-audit API at /api/ai-team/audit.
 *
 * Zero npm dependencies.
 */

const fs = require('node:fs');
const path = require('node:path');

const UI_DIR = path.join(__dirname, '..', 'ai-team-dashboard', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/* ---------------------------------------------------------- audit engine */

function fetchWithTimeout(url, ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal, redirect: 'follow' }).finally(() => clearTimeout(timer));
}

function analyzeHtml(html) {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1] || '';
  return {
    title: title.trim(),
    titleLen: title.trim().length,
    metaDesc: metaDesc.trim(),
    metaDescLen: metaDesc.trim().length,
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    h1Count: (html.match(/<h1[\s>]/gi) || []).length,
    imgs: (html.match(/<img[\s>]/gi) || []).length,
    imgNoAlt: (html.match(/<img(?![^>]*\salt=)[^>]*>/gi) || []).length,
    links: (html.match(/<a[\s][^>]*href/gi) || []).length,
    hasFavicon: /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(html),
    hasOgTags: /<meta[^>]+property=["']og:/i.test(html),
    hasCanonical: /<link[^>]+rel=["']canonical["']/i.test(html)
  };
}

function scoreChecks(checks) {
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.pass ? c.weight : 0), 0);
  const score = Math.round((got / total) * 100);
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  return { score, grade };
}

function buildChecks(a, extras) {
  return [
    { id: 'up', label: 'Site is live & responding', pass: true, detail: `${extras.status} in ${extras.responseTimeMs} ms`, weight: 20 },
    { id: 'title', label: 'SEO title tag', pass: a.titleLen >= 15 && a.titleLen <= 65, detail: a.title ? `"${a.title}" (${a.titleLen} chars)` : 'MISSING', weight: 12 },
    { id: 'desc', label: 'Meta description', pass: a.metaDescLen >= 50 && a.metaDescLen <= 165, detail: a.metaDesc ? `${a.metaDescLen} chars` : 'MISSING', weight: 12 },
    { id: 'robots', label: 'robots.txt', pass: extras.robotsOk, detail: extras.robotsOk ? 'found' : 'not found', weight: 10 },
    { id: 'sitemap', label: 'sitemap.xml', pass: extras.sitemapOk, detail: extras.sitemapOk ? 'found' : 'not found', weight: 10 },
    { id: 'viewport', label: 'Mobile viewport', pass: a.hasViewport, detail: a.hasViewport ? 'present' : 'missing', weight: 8 },
    { id: 'h1', label: 'Exactly one H1 heading', pass: a.h1Count === 1, detail: `${a.h1Count} H1 tag(s)`, weight: 6 },
    { id: 'favicon', label: 'Favicon', pass: a.hasFavicon, detail: a.hasFavicon ? 'present' : 'missing', weight: 4 },
    { id: 'og', label: 'Open Graph / social share tags', pass: a.hasOgTags, detail: a.hasOgTags ? 'present' : 'missing', weight: 6 },
    { id: 'canonical', label: 'Canonical URL', pass: a.hasCanonical, detail: a.hasCanonical ? 'present' : 'missing', weight: 4 },
    { id: 'alt', label: 'Images have alt text', pass: a.imgNoAlt === 0, detail: `${a.imgNoAlt}/${a.imgs} images missing alt`, weight: 8 }
  ];
}

async function liveAudit(origin) {
  const t0 = Date.now();
  const res = await fetchWithTimeout(origin + '/');
  const responseTimeMs = Date.now() - t0;
  const html = await res.text();
  const a = analyzeHtml(html);

  const [robots, sitemap] = await Promise.all([
    fetchWithTimeout(origin + '/robots.txt', 4000).then((r) => r.ok).catch(() => false),
    fetchWithTimeout(origin + '/sitemap.xml', 4000).then((r) => r.ok).catch(() => false)
  ]);

  const checks = buildChecks(a, { status: res.status, responseTimeMs, robotsOk: robots, sitemapOk: sitemap });
  const { score, grade } = scoreChecks(checks);

  const suggestions = [];
  if (!robots) suggestions.push('robots.txt add karo — Google indexing ke liye must hai.');
  if (!sitemap) suggestions.push('sitemap.xml generate karo aur Search Console me submit karo.');
  if (a.metaDescLen < 50 || a.metaDescLen > 165) suggestions.push(`Meta description 50–165 chars ki banayein (abhi ${a.metaDescLen}) — CTR badhega.`);
  if (a.h1Count !== 1) suggestions.push('Homepage par exactly ek H1 rakho.');
  if (a.imgNoAlt > 0) suggestions.push(`${a.imgNoAlt} images me alt text missing hai — SEO + accessibility.`);
  if (!a.hasOgTags) suggestions.push('Open Graph tags add karo — WhatsApp/Facebook share preview ke liye.');
  if (!a.hasCanonical) suggestions.push('Canonical URL tag add karo — duplicate content se bachne ke liye.');
  if (responseTimeMs > 800) suggestions.push(`Response time ${responseTimeMs} ms — caching on karo.`);
  suggestions.push('Design: hero section me bold "100% FREE FOREVER" badge + WhatsApp-green CTA button test karo.');
  suggestions.push('Design: trust badges (No Fees, Verified Profiles, Community) homepage par upar rakho.');

  return {
    ok: true, mode: 'live', url: origin,
    pageKB: Number((Buffer.byteLength(html) / 1024).toFixed(1)),
    links: a.links, images: a.imgs,
    checks, score, grade, suggestions: suggestions.slice(0, 6)
  };
}

function staticAudit(root) {
  const pub = path.join(root, 'public');
  const indexHtml = fs.existsSync(path.join(pub, 'index.html')) ? fs.readFileSync(path.join(pub, 'index.html'), 'utf8') : '';
  const a = analyzeHtml(indexHtml);
  const pages = fs.existsSync(pub) ? fs.readdirSync(pub).filter((f) => f.endsWith('.html')) : [];
  const robotsOk = fs.existsSync(path.join(pub, 'robots.txt'));
  const sitemapOk = fs.existsSync(path.join(pub, 'sitemap.xml'));
  const serverSrc = fs.existsSync(path.join(root, 'server.js')) ? fs.readFileSync(path.join(root, 'server.js'), 'utf8') : '';
  const hasSecurityHeaders = /x-content-type-options/i.test(serverSrc);

  const checks = [
    { id: 'up', label: 'Site server', pass: false, detail: 'site offline raha — static file audit kiya', weight: 20 },
    { id: 'title', label: 'SEO title tag', pass: a.titleLen >= 15 && a.titleLen <= 65, detail: a.title ? `"${a.title}" (${a.titleLen})` : 'MISSING', weight: 12 },
    { id: 'desc', label: 'Meta description', pass: a.metaDescLen >= 50, detail: a.metaDesc ? `${a.metaDescLen} chars` : 'MISSING', weight: 12 },
    { id: 'pages', label: 'Page coverage', pass: pages.length >= 10, detail: `${pages.length} HTML pages`, weight: 10 },
    { id: 'robots', label: 'robots.txt', pass: robotsOk, detail: robotsOk ? 'found' : 'missing', weight: 10 },
    { id: 'sitemap', label: 'sitemap.xml', pass: sitemapOk, detail: sitemapOk ? 'found' : 'missing', weight: 10 },
    { id: 'viewport', label: 'Mobile viewport', pass: a.hasViewport, detail: a.hasViewport ? 'present' : 'missing', weight: 8 },
    { id: 'h1', label: 'Exactly one H1', pass: a.h1Count === 1, detail: `${a.h1Count} H1 tag(s)`, weight: 6 },
    { id: 'security', label: 'Security headers in server.js', pass: hasSecurityHeaders, detail: hasSecurityHeaders ? 'present' : 'missing', weight: 8 },
    { id: 'alt', label: 'Images have alt text', pass: a.imgNoAlt === 0, detail: `${a.imgNoAlt}/${a.imgs} missing alt`, weight: 4 }
  ];
  const { score, grade } = scoreChecks(checks);

  return {
    ok: true, mode: 'static', url: 'static files', pageKB: null,
    links: a.links, images: a.imgs, checks, score, grade,
    suggestions: [
      'Site live nahi thi — live audit ke liye site start karke dobara audit chalana.',
      robotsOk ? 'robots.txt theek hai.' : 'robots.txt missing hai.',
      sitemapOk ? 'sitemap.xml theek hai.' : 'sitemap.xml missing hai — Search Console me submit karna.',
      a.metaDescLen < 50 ? 'Meta description improve karo (50–165 chars).' : 'Meta description theek hai.',
      'Design: homepage hero me community photos + "100% free" badge, WhatsApp-green CTA.'
    ]
  };
}

/* ---------------------------------------------------------- module */

function createAiTeam({ root, origin }) {
  function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(body);
  }

  function sendUi(res, fileName) {
    const filePath = path.join(UI_DIR, fileName);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('AI Team UI not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data);
    });
  }

  async function handle(req, res, url) {
    if (url.pathname === '/api/ai-team/audit') {
      try {
        return sendJson(res, 200, await liveAudit(origin));
      } catch (err) {
        try {
          return sendJson(res, 200, staticAudit(root));
        } catch (err2) {
          return sendJson(res, 500, { ok: false, error: err.message });
        }
      }
    }

    if (url.pathname === '/api/ai-team/health') {
      return sendJson(res, 200, { ok: true, auditTarget: origin, time: new Date().toISOString() });
    }

    if (url.pathname === '/ai-team' || url.pathname === '/ai-team/') return sendUi(res, 'index.html');
    if (url.pathname === '/ai-team/style.css') return sendUi(res, 'style.css');
    if (url.pathname === '/ai-team/app.js') return sendUi(res, 'app.js');
    if (url.pathname === '/ai-team/chrome' || url.pathname === '/ai-team/chrome.html') {
      const single = path.join(root, 'AI-TEAM-DASHBOARD.html');
      if (fs.existsSync(single)) {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        return fs.createReadStream(single).pipe(res);
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }

  return { handle };
}

module.exports = { createAiTeam };
