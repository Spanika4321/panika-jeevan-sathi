'use strict';
/**
 * AI TEAM DASHBOARD — "4 AI Employees" for PANIKA JEEVAN SATHI
 *
 * WhatsApp-style chat dashboard. The 4 employees can:
 *   - audit the matrimonial website and generate a real report (/api/audit)
 *   - draft social media posts, workload reports, virality analysis
 *   - generate the Daily Growth Update email
 *
 * Zero npm dependencies.  Node.js >= 18.
 *
 *   node server.js         → http://localhost:8080
 *   AUDIT_URL=... node ... → audit a different site URL
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SITE_ROOT = path.join(__dirname, '..');
const AUDIT_URL = (process.env.AUDIT_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

/* ---------------------------------------------------------- audit helpers */

function fetchWithTimeout(url, ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal, redirect: 'follow' })
    .finally(() => clearTimeout(timer));
}

function analyzeHtml(html) {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1] || '';
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  const imgs = (html.match(/<img[\s>]/gi) || []).length;
  const imgNoAlt = (html.match(/<img(?![^>]*\salt=)[^>]*>/gi) || []).length;
  const links = (html.match(/<a[\s][^>]*href/gi) || []).length;
  const hasFavicon = /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(html);
  const hasOgTags = /<meta[^>]+property=["']og:/i.test(html);
  const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  return {
    title: title.trim(),
    titleLen: title.trim().length,
    metaDesc: metaDesc.trim(),
    metaDescLen: metaDesc.trim().length,
    hasViewport, h1Count, imgs, imgNoAlt, links, hasFavicon, hasOgTags, hasCanonical
  };
}

function buildChecks(a, extras) {
  const checks = [];
  const add = (id, label, pass, detail, weight) => checks.push({ id, label, pass, detail, weight });

  add('up', 'Site is live & responding', true, `${extras.status} in ${extras.responseTimeMs} ms`, 20);
  add('title', 'SEO title tag', a.titleLen >= 15 && a.titleLen <= 65,
    a.title ? `"${a.title}" (${a.titleLen} chars)` : 'MISSING', 12);
  add('desc', 'Meta description', a.metaDescLen >= 50 && a.metaDescLen <= 165,
    a.metaDesc ? `${a.metaDescLen} chars` : 'MISSING', 12);
  add('robots', 'robots.txt', extras.robotsOk, extras.robotsOk ? 'found' : 'not found', 10);
  add('sitemap', 'sitemap.xml', extras.sitemapOk, extras.sitemapOk ? 'found' : 'not found', 10);
  add('viewport', 'Mobile viewport', a.hasViewport, a.hasViewport ? 'present' : 'missing', 8);
  add('h1', 'Exactly one H1 heading', a.h1Count === 1, `${a.h1Count} H1 tag(s)`, 6);
  add('favicon', 'Favicon', a.hasFavicon, a.hasFavicon ? 'present' : 'missing', 4);
  add('og', 'Open Graph / social share tags', a.hasOgTags, a.hasOgTags ? 'present' : 'missing', 6);
  add('canonical', 'Canonical URL', a.hasCanonical, a.hasCanonical ? 'present' : 'missing', 4);
  add('alt', 'Images have alt text', a.imgNoAlt === 0, `${a.imgNoAlt}/${a.imgs} images missing alt`, 8);

  return checks;
}

function scoreChecks(checks) {
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.pass ? c.weight : 0), 0);
  const score = Math.round((got / total) * 100);
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  return { score, grade };
}

async function liveAudit() {
  const t0 = Date.now();
  const res = await fetchWithTimeout(AUDIT_URL + '/');
  const responseTimeMs = Date.now() - t0;
  const html = await res.text();
  const a = analyzeHtml(html);

  const [robots, sitemap] = await Promise.all([
    fetchWithTimeout(AUDIT_URL + '/robots.txt', 4000).then((r) => r.ok).catch(() => false),
    fetchWithTimeout(AUDIT_URL + '/sitemap.xml', 4000).then((r) => r.ok).catch(() => false)
  ]);

  const extras = { status: res.status, responseTimeMs, robotsOk: robots, sitemapOk: sitemap };
  const checks = buildChecks(a, extras);
  const { score, grade } = scoreChecks(checks);

  const suggestions = [];
  if (!robots) suggestions.push('robots.txt add karo — Google indexing ke liye must hai.');
  if (!sitemap) suggestions.push('sitemap.xml generate karo aur Search Console me submit karo.');
  if (a.metaDescLen < 50 || a.metaDescLen > 165) suggestions.push('Meta description 50–165 chars ki banayein (abhi ' + a.metaDescLen + ') — CTR badhega.');
  if (a.h1Count !== 1) suggestions.push('Homepage par exactly ek H1 rakho.');
  if (a.imgNoAlt > 0) suggestions.push(`${a.imgNoAlt} images me alt text missing hai — SEO + accessibility.`);
  if (!a.hasOgTags) suggestions.push('Open Graph tags add karo — WhatsApp/Facebook share preview ke liye.');
  if (responseTimeMs > 800) suggestions.push(`Response time ${responseTimeMs} ms — caching on karo.`);
  suggestions.push('Design: hero section me ek bold "100% FREE FOREVER" badge + WhatsApp-green CTA button test karo.');
  suggestions.push('Design: trust badges (No Fees, Verified Profiles, Community) homepage par upar rakho.');

  return {
    ok: true, mode: 'live', url: AUDIT_URL, pageKB: Number((Buffer.byteLength(html) / 1024).toFixed(1)),
    links: a.links, images: a.imgs, checks, score, grade, suggestions: suggestions.slice(0, 6)
  };
}

function staticAudit() {
  const pub = path.join(SITE_ROOT, 'public');
  const exists = (p) => fs.existsSync(p);
  const indexHtml = exists(path.join(pub, 'index.html')) ? fs.readFileSync(path.join(pub, 'index.html'), 'utf8') : '';
  const a = analyzeHtml(indexHtml);

  const pages = fs.existsSync(pub) ? fs.readdirSync(pub).filter((f) => f.endsWith('.html')) : [];
  const robotsOk = exists(path.join(pub, 'robots.txt')) || exists(path.join(SITE_ROOT, 'robots.txt'));
  const sitemapOk = exists(path.join(pub, 'sitemap.xml')) || exists(path.join(SITE_ROOT, 'sitemap.xml'));
  const serverSrc = exists(path.join(SITE_ROOT, 'server.js')) ? fs.readFileSync(path.join(SITE_ROOT, 'server.js'), 'utf8') : '';
  const hasSecurityHeaders = /x-content-type-options/i.test(serverSrc) || /x-frame-options/i.test(serverSrc);

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

  const suggestions = [
    'Site live nahi thi — live audit ke liye site start karke dobara "audit" likhna.',
    robotsOk ? 'robots.txt theek hai.' : 'robots.txt missing hai.',
    sitemapOk ? 'sitemap.xml theek hai.' : 'sitemap.xml missing hai — Search Console submit karna.',
    a.metaDescLen < 50 ? 'Meta description improve karo (50–165 chars).' : 'Meta description theek hai.',
    'Design: homepage hero me community photos + "100% free" badge rakho, WhatsApp-green CTA.'
  ];

  return { ok: true, mode: 'static', url: AUDIT_URL, pageKB: null, links: a.links, images: a.imgs, checks, score, grade, suggestions };
}

/* ----------------------------------------------------------------- server */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/audit') {
    try {
      const result = await liveAudit();
      return sendJson(res, 200, result);
    } catch (err) {
      try {
        return sendJson(res, 200, staticAudit());
      } catch (err2) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }
  }

  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, auditTarget: AUDIT_URL, time: new Date().toISOString() });
  }

  // static files
  let filePath = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[ai-team] dashboard running → http://${HOST}:${PORT}`);
  console.log(`[ai-team] audit target → ${AUDIT_URL}`);
});
