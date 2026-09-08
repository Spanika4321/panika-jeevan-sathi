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
