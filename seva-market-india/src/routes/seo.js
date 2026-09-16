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
  // The provider-acquisition landing page: public, stable, unique content, and
  // linked from the site header on every page. It was previously Disallow-ed,
  // which is what made Google report it as "Blocked by robots.txt".
  add('/providers/new');

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

/**
 * robots.txt.
 *
 * The rule that shapes this file: **Disallow hides the page's own `noindex`
 * from Google.** A URL that is blocked but still linked from a crawlable page
 * shows up in Search Console's Pages report as "Blocked by robots.txt" — a
 * new-reason alert for the owner — and Google may index the bare URL with no
 * snippet, because it was never allowed to read the page that says "don't".
 *
 * So only two kinds of path are disallowed here:
 *
 *   • paths with no rendered HTML worth reading (`/api/`, uploaded files);
 *   • session-only paths that a crawler can never reach anyway, because they
 *     302 to /login (`/account…`).
 *
 * Every other private page — /login, /register, /verify-email,
 * /forgot-password, /reset-password — stays **crawlable** and carries
 * `noindex,nofollow` in its own HTML. That is the combination Google asks for:
 * the exclusion is visible, so the Pages report says "Excluded by 'noindex'
 * tag" (intentional) instead of "Blocked by robots.txt" (a warning).
 *
 * `/providers/new` and `/register` are additionally *public marketing pages*
 * linked from the site header and the homepage CTA; blocking those cost
 * provider signups found through Google, not just a report entry.
 */
function robotsText(site) {
  const origin = canonicalOrigin(site);
  return [
    '# SEVA MARKET INDIA — public marketplace pages may be crawled.',
    '# Private pages are crawlable on purpose: their own noindex meta tag is',
    '# what keeps them out of search results, and a Disallow would hide it.',
    'User-agent: *',
    'Allow: /',
    '# JSON API — no rendered page to index.',
    'Disallow: /api/',
    '# Provider/customer uploads.',
    'Disallow: /uploads/',
    '# Session-only dashboard: always a 302 to /login for a crawler.',
    'Disallow: /account',
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
