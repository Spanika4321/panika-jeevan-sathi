'use strict';
/**
 * SEVA MARKET INDIA — crawl-control documents.
 *
 * Search engines discovered the live Render service but could not find a
 * robots.txt or sitemap.xml document. Those two public documents make the
 * canonical marketplace pages discoverable without exposing account pages,
 * dashboard URLs, API responses, or customer enquiries.
 */

const categoryModel = require('../models/category');
const locationModel = require('../models/location');

const FALLBACK_ORIGIN = 'https://seva-market-india.invalid';
const MAX_LISTING_URLS = 20_000; // comfortably below sitemap.xml's 50,000 URL limit

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * SITE_URL is controlled by Render, not request Host headers. That prevents a
 * forged Host header from making the sitemap advertise someone else's domain.
 * The fallback exists for local development/tests only; production config uses
 * the Render-provided (or custom-domain) canonical origin.
 */
function canonicalOrigin(site) {
  try {
    const url = new URL(String(site?.url || ''));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid origin');
    return url.origin;
  } catch (_) {
    return FALLBACK_ORIGIN;
  }
}

function urlFor(origin, pathname, query = null) {
  const url = new URL(pathname, origin);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== null && value !== undefined && String(value)) url.searchParams.set(key, String(value));
  }
  return url.href;
}

/**
 * One <url> entry. Google documents that it ignores changefreq and priority;
 * it does use lastmod when present and accurate, so listings carry the row's
 * own updated_at and static pages carry no date rather than a fabricated one.
 */
function entry(loc, { lastmod } = {}) {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : '',
    '  </url>',
  ].filter(Boolean).join('\n');
}

/** Public, stable pages only — never accounts, dashboards, leads or APIs. */
function sitemapUrls(db, site) {
  const origin = canonicalOrigin(site);
  const urls = [];
  const seen = new Set();
  const add = (pathname, options, query) => {
    const loc = urlFor(origin, pathname, query);
    if (!seen.has(loc)) {
      seen.add(loc);
      urls.push({ loc, ...options });
    }
  };

  add('/');
  add('/categories');
  add('/locations');
  add('/about');
  add('/contact');
  add('/privacy');
  add('/terms');

  // Category and state searches are curated, meaningful landing pages. Do not
  // include arbitrary text, PIN, page, or sort queries supplied by visitors.
  for (const category of categoryModel.findAll(db)) {
    add('/search', {}, { category: category.slug });
  }
  // Generating a sitemap must remain read-only. The ordinary boot seed creates
  // this root; if an unseeded development database has none, simply omit state
  // landing pages instead of changing data because a crawler visited.
  const india = locationModel.findBySlug(db, 'country', 'india');
  if (india?.is_active) {
    for (const state of locationModel.findChildren(db, india.id, 'state')) {
      add('/search', {}, { state: state.slug });
    }
  }

  // The detailed pages contain real provider/service content. Active status is
  // required twice for service pages so suspended providers are never indexed.
  // lastmod comes from each row's own updated_at, so recrawls track edits.
  const services = db.all(
    `SELECT services.slug, services.updated_at, services.created_at FROM services
     INNER JOIN providers ON providers.id = services.provider_id
     WHERE services.status = 'active' AND providers.status = 'active'
     ORDER BY services.id LIMIT ?`,
    [MAX_LISTING_URLS],
  );
  for (const service of services) {
    add(`/services/${encodeURIComponent(service.slug)}`, { lastmod: isoDate(service.updated_at ?? service.created_at) });
  }

  const remaining = Math.max(0, MAX_LISTING_URLS - services.length);
  const providers = remaining ? db.all(
    `SELECT slug, updated_at, created_at FROM providers WHERE status = 'active' ORDER BY id LIMIT ?`,
    [remaining],
  ) : [];
  for (const provider of providers) {
    add(`/providers/${encodeURIComponent(provider.slug)}`, { lastmod: isoDate(provider.updated_at ?? provider.created_at) });
  }

  return urls;
}

/** Normalise a stored timestamp (epoch ms or ISO string) to YYYY-MM-DD. */
function isoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function robotsText(site) {
  const origin = canonicalOrigin(site);
  return [
    '# SEVA MARKET INDIA — public marketplace pages may be crawled.',
    'User-agent: *',
    'Allow: /',
    'Disallow: /account',
    'Disallow: /api/',
    'Disallow: /login',
    'Disallow: /register',
    'Disallow: /providers/new',
    // Token-carrying and credential pages: indexing one would put a
    // single-use link (or a login form) in a search result.
    'Disallow: /verify-email',
    'Disallow: /forgot-password',
    'Disallow: /reset-password',
    '',
    `Sitemap: ${urlFor(origin, '/sitemap.xml')}`,
    '',
  ].join('\n');
}

function sitemapXml(db, site) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapUrls(db, site).map(({ loc, ...options }) => entry(loc, options)),
    '</urlset>',
    '',
  ].join('\n');
}

function register(router, { db, config }) {
  router.get('/robots.txt', () => ({
    raw: {
      body: robotsText(config.site),
      contentType: 'text/plain; charset=utf-8',
      cacheControl: 'public, max-age=3600',
    },
  }));
  router.get('/sitemap.xml', () => ({
    raw: {
      body: sitemapXml(db, config.site),
      contentType: 'application/xml; charset=utf-8',
      cacheControl: 'public, max-age=3600',
    },
  }));
}

module.exports = { register, canonicalOrigin, escapeXml, robotsText, sitemapUrls, sitemapXml };
