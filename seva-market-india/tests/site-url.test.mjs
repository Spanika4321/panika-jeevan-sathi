/**
 * SEVA MARKET INDIA — canonical site URL guard tests.
 *
 * Covers the SITE_URL trap that the blueprint used to ship: a committed
 * origin that Render's suffixed service name made wrong, with every blueprint
 * sync reverting the dashboard fix. src/site-url.js keeps the resolution
 * pure so every host/env combination is testable without a server.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveSiteUrl, normalizeOrigin, isRenderFreeHost } = require('../src/site-url');

test('an explicit SITE_URL is used verbatim when no host URL is present', () => {
  const { url, warnings } = resolveSiteUrl({
    SITE_URL: 'https://seva-market-india-tast.onrender.com',
  });
  assert.equal(url, 'https://seva-market-india-tast.onrender.com');
  assert.deepEqual(warnings, []);
});

test('SITE_URL matching the host URL produces no warning', () => {
  const { url, warnings } = resolveSiteUrl({
    SITE_URL: 'https://seva-market-india-tast.onrender.com',
    RENDER_EXTERNAL_URL: 'https://seva-market-india-tast.onrender.com',
  });
  assert.equal(url, 'https://seva-market-india-tast.onrender.com');
  assert.deepEqual(warnings, []);
});

test('a stale Render hostname in SITE_URL (the -tast trap) is corrected to the host URL', () => {
  const { url, warnings } = resolveSiteUrl({
    SITE_URL: 'https://seva-market-india.onrender.com',
    RENDER_EXTERNAL_URL: 'https://seva-market-india-tast.onrender.com',
  });
  // Two free hostnames that disagree: only the host-reported one is this
  // instance, so canonical/sitemap URLs must use it rather than advertise a
  // host that does not serve the site.
  assert.equal(url, 'https://seva-market-india-tast.onrender.com');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /SITE_URL is "https:\/\/seva-market-india\.onrender\.com"/);
  assert.match(warnings[0], /served at "https:\/\/seva-market-india-tast\.onrender\.com"/);
  assert.match(warnings[0], /host-provided origin is used/);
  // The warning still tells the operator the exact dashboard fix.
  assert.match(warnings[0], /SITE_URL to "https:\/\/seva-market-india-tast\.onrender\.com"/);
  assert.match(warnings[0], /SEVA_TRUST_SITE_URL=1/);
});

test('SEVA_TRUST_SITE_URL=1 keeps a stale Render pin for debugging', () => {
  const { url, warnings } = resolveSiteUrl({
    SITE_URL: 'https://seva-market-india.onrender.com',
    RENDER_EXTERNAL_URL: 'https://seva-market-india-tast.onrender.com',
    SEVA_TRUST_SITE_URL: '1',
  });
  assert.equal(url, 'https://seva-market-india.onrender.com');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /real custom domain/);
});

test('isRenderFreeHost recognises only Render-generated hostnames', () => {
  assert.equal(isRenderFreeHost('https://seva-market-india-tast.onrender.com'), true);
  assert.equal(isRenderFreeHost('https://seva.example.in'), false);
  assert.equal(isRenderFreeHost('https://onrender.com'), false, 'the bare apex is not a service hostname');
  assert.equal(isRenderFreeHost(''), false);
  assert.equal(isRenderFreeHost('not a url'), false);
});

test('a custom domain differing from the Render URL warns but stays trusted', () => {
  const { url, warnings } = resolveSiteUrl({
    SITE_URL: 'https://seva.example.in',
    RENDER_EXTERNAL_URL: 'https://seva-market-india-tast.onrender.com',
  });
  assert.equal(url, 'https://seva.example.in');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /real custom domain/);
});

test('unset SITE_URL on Render falls back to the host URL and says so', () => {
  const { url, warnings } = resolveSiteUrl({
    RENDER_EXTERNAL_URL: 'https://seva-market-india-tast.onrender.com',
  });
  assert.equal(url, 'https://seva-market-india-tast.onrender.com');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /SITE_URL is not set/);
  assert.match(warnings[0], /using the host-provided origin/);
});

test('nothing set (local dev / tests): empty URL, zero warnings', () => {
  const { url, warnings } = resolveSiteUrl({});
  assert.equal(url, '');
  assert.deepEqual(warnings, []);
});

test('trailing slashes and surrounding whitespace are stripped before comparing', () => {
  const { url, warnings } = resolveSiteUrl({
    SITE_URL: '  https://seva-market-india-tast.onrender.com/  ',
    RENDER_EXTERNAL_URL: 'https://seva-market-india-tast.onrender.com/',
  });
  assert.equal(url, 'https://seva-market-india-tast.onrender.com');
  assert.deepEqual(warnings, []);
});

test('normalizeOrigin only trims origin whitespace/trailing slashes', () => {
  assert.equal(normalizeOrigin('https://x.onrender.com///'), 'https://x.onrender.com');
  assert.equal(normalizeOrigin('  https://x.onrender.com '), 'https://x.onrender.com');
  assert.equal(normalizeOrigin(undefined), '');
});
