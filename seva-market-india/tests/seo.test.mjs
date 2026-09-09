/**
 * SEVA MARKET INDIA — public search-engine discovery tests.
 *
 * These routes are intentionally tested through the application, not as files:
 * both documents must use the dashboard-owned SITE_URL and only list public
 * pages. A Render-suffixed URL therefore stays correct after a redeploy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, request } from './helpers.mjs';

const ORIGIN = 'https://seva-market-india-tast.onrender.com';
const app = makeApp({ siteUrl: ORIGIN });

test('robots.txt allows public marketplace crawl, blocks private routes, and advertises the canonical sitemap', async () => {
  const res = await request(app, { url: '/robots.txt' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/plain; charset=utf-8$/);
  assert.match(res.body, /^User-agent: \*$/m);
  assert.match(res.body, /^Allow: \/$/m);
  for (const path of ['/account', '/api/', '/login', '/register', '/providers/new']) {
    assert.match(res.body, new RegExp(`^Disallow: ${path.replace('/', '\\/')}`, 'm'));
  }
  assert.match(res.body, new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, 'm'));
  assert.equal(res.headers['cache-control'], 'public, max-age=3600');
});

test('sitemap.xml serves canonical public category, state, provider and service URLs only', async () => {
  const res = await request(app, { url: '/sitemap.xml' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^application\/xml; charset=utf-8$/);
  assert.match(res.body, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(res.body, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);

  const locs = [...res.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(locs.length > 50, 'the sitemap should expose the full launch catalogue, not just a home page');
  assert.equal(new Set(locs).size, locs.length, 'every sitemap URL must be unique');
  assert.ok(locs.every((url) => url.startsWith(`${ORIGIN}/`)), 'a sitemap must never advertise a stale/default Render host');
  for (const url of [
    `${ORIGIN}/`,
    `${ORIGIN}/search?category=plumber`,
    `${ORIGIN}/search?state=assam`,
    `${ORIGIN}/services/bathroom-tap-shower-repair-1`,
    `${ORIGIN}/providers/borah-plumbing-works`,
  ]) assert.ok(locs.includes(url), `missing public SEO page: ${url}`);
  assert.ok(locs.every((url) => !/\/(?:account|api|login|register)(?:\/|$)/.test(url)), 'private/API/auth pages must not appear');
});

test('canonical links are absolute and only curated search landing pages are indexable', async () => {
  const home = await request(app, { url: '/' });
  assert.match(home.body, new RegExp(`<link rel="canonical" href="${ORIGIN}/">`));
  assert.match(home.body, /<meta name="robots" content="index,follow">/);

  const category = await request(app, { url: '/search?category=plumber' });
  assert.match(category.body, new RegExp(`<link rel="canonical" href="${ORIGIN}/search\\?category=plumber">`));
  assert.match(category.body, /<meta name="robots" content="index,follow">/);

  const arbitrary = await request(app, { url: '/search?q=leaky+tap&pin=781001' });
  assert.match(arbitrary.body, new RegExp(`<link rel="canonical" href="${ORIGIN}/search">`));
  assert.match(arbitrary.body, /<meta name="robots" content="noindex,follow">/);

  const login = await request(app, { url: '/login' });
  assert.match(login.body, new RegExp(`<link rel="canonical" href="${ORIGIN}/login">`));
  assert.match(login.body, /<meta name="robots" content="noindex,nofollow">/);
});

test('the sitemap uses lastmod for listings and omits tags Google ignores', async () => {
  const res = await request(app, { url: '/sitemap.xml' });
  assert.doesNotMatch(res.body, /<changefreq>/, 'Google ignores changefreq; do not send it');
  assert.doesNotMatch(res.body, /<priority>/, 'Google ignores priority; do not send it');
  const lastmods = [...res.body.matchAll(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)];
  assert.ok(lastmods.length >= 10, 'listing URLs should carry a lastmod date');
  const serviceEntry = res.body.match(/<url>\s*<loc>[^<]*\/services\/bathroom-tap-shower-repair-1<\/loc>\s*<lastmod>[^<]+<\/lastmod>/s);
  assert.ok(serviceEntry, 'a service URL must appear together with its lastmod');
});

test('the homepage carries WebSite + Organization JSON-LD with a SearchAction', async () => {
  const res = await request(app, { url: '/' });
  const blocks = [...res.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const website = blocks.find((node) => node['@type'] === 'WebSite');
  assert.ok(website, 'WebSite JSON-LD must be present');
  assert.equal(website.url, `${ORIGIN}/`);
  assert.equal(website.potentialAction['@type'], 'SearchAction');
  assert.match(website.potentialAction.target.urlTemplate, /\/search\?q=\{search_term_string\}$/);
  const organization = blocks.find((node) => node['@type'] === 'Organization');
  assert.ok(organization, 'Organization JSON-LD must be present');
  // Open Graph completeness for social sharing.
  assert.match(res.body, new RegExp(`<meta property="og:url" content="${ORIGIN}/">`));
  assert.match(res.body, /<meta property="og:site_name" content="SEVA MARKET INDIA">/);
  assert.match(res.body, /<meta property="og:locale" content="en_IN">/);
  assert.match(res.body, /<meta name="twitter:card" content="summary">/);
});

/** The visible rating the page renders, e.g. "4.7 ★ (12)" → 4.7. */
function providerRating(body) {
  const shown = body.match(/class="rating"[^>]*>([\d.]+) ★ \((\d+)\)</);
  assert.ok(shown, 'the page must visibly show the rating being marked up');
  return shown[1];
}

test('provider pages carry LocalBusiness JSON-LD with the details the page shows', async () => {
  const res = await request(app, { url: '/providers/borah-plumbing-works' });
  const blocks = [...res.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const business = blocks.find((node) => node['@type'] === 'LocalBusiness');
  assert.ok(business, 'LocalBusiness JSON-LD must be present');
  assert.equal(business.name, 'Borah Plumbing Works');
  assert.equal(business.telephone, '+919000000001');
  assert.equal(business.address['@type'], 'PostalAddress');
  assert.equal(business.address.addressCountry, 'IN');
  assert.equal(business.url, `${ORIGIN}/providers/borah-plumbing-works`);
  const crumbs = blocks.find((node) => node['@type'] === 'BreadcrumbList');
  assert.ok(crumbs, 'BreadcrumbList JSON-LD must be present');
  assert.equal(crumbs.itemListElement[0].name, 'Home');
  // Ratings are marked up only when the page shows one, and must match it
  // (Google: structured data is a true representation of page content).
  assert.ok(business.aggregateRating, 'seeded provider shows a rating, so it must be marked up');
  assert.equal(business.aggregateRating['@type'], 'AggregateRating');
  assert.equal(Number(business.aggregateRating.ratingValue), Number(providerRating(res.body)));
  assert.ok(Number(business.aggregateRating.reviewCount) >= 1);
});

test('service pages carry Service and BreadcrumbList JSON-LD', async () => {
  const res = await request(app, { url: '/services/bathroom-tap-shower-repair-1' });
  const blocks = [...res.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const service = blocks.find((node) => node['@type'] === 'Service');
  assert.ok(service, 'Service JSON-LD must be present');
  assert.equal(service.name, 'Bathroom tap & shower repair');
  assert.equal(service.serviceType, 'Plumber');
  assert.equal(service.provider.name, 'Borah Plumbing Works');
  assert.equal(service.offers.priceCurrency, 'INR');
  const crumbs = blocks.find((node) => node['@type'] === 'BreadcrumbList');
  assert.ok(crumbs, 'BreadcrumbList JSON-LD must be present');
  assert.equal(crumbs.itemListElement.length, 3);
});

test('a configured Search Console token renders; no token, no tag', async () => {
  const verifiedApp = makeApp({ siteUrl: ORIGIN, googleSiteVerification: 'abc123-token' });
  const withToken = await request(verifiedApp, { url: '/' });
  assert.match(withToken.body, /<meta name="google-site-verification" content="abc123-token">/);
  const withoutToken = await request(app, { url: '/' });
  assert.doesNotMatch(withoutToken.body, /google-site-verification/);
});
