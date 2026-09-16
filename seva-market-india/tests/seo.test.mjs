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

test('robots.txt blocks only what has no readable page, and advertises the canonical sitemap', async () => {
  const res = await request(app, { url: '/robots.txt' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/plain; charset=utf-8$/);
  assert.match(res.body, /^User-agent: \*$/m);
  assert.match(res.body, /^Allow: \/$/m);

  // Only three things are disallowed: the JSON API, uploaded files, and the
  // session-only dashboard (which is a 302 to /login for any crawler).
  for (const path of ['/api/', '/uploads/', '/account']) {
    assert.match(res.body, new RegExp(`^Disallow: ${path.replace(/\//g, '\\/')}$`, 'm'), `${path} must be disallowed`);
  }
  assert.match(res.body, new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, 'm'));
  assert.equal(res.headers['cache-control'], 'public, max-age=3600');
  assert.match(res.body, /^# /m, 'the file says why it looks like this, for the next reader');
});

/**
 * The regression Google Search Console reported as "New reason preventing your
 * pages from being indexed → Blocked by robots.txt".
 *
 * A `Disallow` hides the page's own `noindex` from Google, so every URL that
 * is linked from a crawlable page but blocked comes back as a *new* exclusion
 * reason in the Pages report — and Google may index the bare URL with no
 * snippet. So: anything that renders HTML and asks not to be indexed must be
 * crawlable, and anything public must not be blocked at all.
 */
test('no page that renders HTML is blocked from reading its own robots meta tag', async () => {
  const robots = (await request(app, { url: '/robots.txt' })).body;
  const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((match) => match[1]);
  const blocked = (path) => disallowed.some((prefix) => path.startsWith(prefix));

  // Private pages: crawlable, and carrying noindex themselves.
  for (const path of ['/login', '/register', '/register?role=provider', '/verify-email', '/forgot-password', '/reset-password']) {
    assert.ok(!blocked(path.split('?')[0]), `${path} must not be Disallow-ed — Google could not read its noindex`);
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, { url: path });
    assert.equal(res.statusCode, 200, `${path} renders`);
    assert.match(res.body, /<meta name="robots" content="noindex,nofollow">/, `${path} excludes itself`);
  }

  // Public pages linked from the header/homepage: must be indexable, i.e.
  // neither Disallow-ed nor noindex.
  for (const path of ['/', '/providers/new', '/categories', '/locations', '/about', '/contact', '/privacy', '/terms', '/search?category=plumber']) {
    assert.ok(!blocked(path.split('?')[0]), `${path} is public — it must not be Disallow-ed`);
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, { url: path });
    assert.equal(res.statusCode, 200, `${path} renders`);
    assert.match(res.body, /<meta name="robots" content="index,follow">/, `${path} must be indexable`);
  }
});

test('every sitemap URL is crawlable and indexable — the sitemap never fights robots.txt', async () => {
  const robots = (await request(app, { url: '/robots.txt' })).body;
  const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((match) => match[1]);
  const locs = [...(await request(app, { url: '/sitemap.xml' })).body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  assert.ok(locs.length > 50);
  for (const loc of locs) {
    const path = new URL(loc).pathname + new URL(loc).search;
    assert.ok(
      !disallowed.some((prefix) => new URL(loc).pathname.startsWith(prefix)),
      `sitemap advertises ${path}, which robots.txt disallows`,
    );
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, { url: path });
    assert.equal(res.statusCode, 200, `${path} must be live`);
    assert.match(res.body, /<meta name="robots" content="index,follow">/, `${path} is in the sitemap, so it must be indexable`);
  }
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
  // Explicitly empty — the committed default token must still be overridable.
  const bareApp = makeApp({ siteUrl: ORIGIN, googleSiteVerification: '' });
  const withoutToken = await request(bareApp, { url: '/' });
  assert.doesNotMatch(withoutToken.body, /google-site-verification/);
  // The committed default (the real Search Console token) renders as-is.
  const live = await request(app, { url: '/' });
  assert.match(live.body, /<meta name="google-site-verification" content="[A-Za-z0-9_-]+">/);
});
