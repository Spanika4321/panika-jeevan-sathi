/**
 * SEVA MARKET INDIA — rendered page tests.
 *
 * Asserts the mobile-first UI foundation: the header/nav, the search form,
 * data-driven content, escaping, and that no inline script survives (the
 * CSP forbids it, so a regression here would blank the whole site).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeApp, request } from './helpers.mjs';

const require = createRequire(import.meta.url);
const categories = require('../src/models/category');
const locations = require('../src/models/location');
const providers = require('../src/models/provider');
const services = require('../src/models/service');
const { esc } = require('../src/views/escape');

const app = makeApp();

/* ------------------------------------------------------------ homepage */

test('the homepage renders a valid document with a mobile viewport', async () => {
  const res = await request(app, { url: '/' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html; charset=utf-8/);
  assert.ok(res.body.startsWith('<!DOCTYPE html>'), 'must start with a doctype');
  assert.match(res.body, /<html lang="en-IN">/);
  assert.match(res.body, /name="viewport" content="width=device-width, initial-scale=1/);
  assert.match(res.body, /<title>.*SEVA MARKET INDIA<\/title>/s);
});

test('the header carries the brand, a working nav and a menu toggle', async () => {
  const res = await request(app, { url: '/' });
  assert.match(res.body, /<header class="site-header"/);
  assert.match(res.body, /SEVA MARKET INDIA/);
  assert.match(res.body, /data-nav-toggle/);
  assert.match(res.body, /aria-controls="primary-nav"/);
  for (const href of ['/', '/search', '/categories', '/locations', '/providers/new']) {
    assert.ok(res.body.includes(`href="${href}"`), `nav must link to ${href}`);
  }
  // The active page is marked for screen readers.
  assert.match(res.body, /href="\/" aria-current="page"/);
});

test('every navigation link resolves to a 200 page', async () => {
  const { NAV } = require('../src/views/layout');
  for (const item of NAV) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, { url: item.href });
    assert.equal(res.statusCode, 200, `${item.href} should render`);
  }
});

test('the hero search form submits service, place and PIN as a GET', async () => {
  const res = await request(app, { url: '/' });
  assert.match(res.body, /action="\/search" method="get"/);
  for (const id of ['q', 'place', 'pin']) {
    assert.match(res.body, new RegExp(`id="${id}"`), `search field #${id} missing`);
    assert.match(res.body, new RegExp(`name="${id}"`), `search field name=${id} missing`);
  }
  // Every input has a real <label>, so the form is usable without a mouse.
  assert.match(res.body, /<label for="pin">PIN code<\/label>/);
  assert.match(res.body, /pattern="\[1-9\]\[0-9\]\{5\}"/);
});

test('the homepage stats come from the database, not from hard-coded text', async () => {
  const res = await request(app, { url: '/' });
  const totals = locations.stats(app.db);
  const categoryCount = categories.count(app.db);
  assert.ok(totals.state >= 8);
  assert.ok(res.body.includes(`<span class="stat__value">${totals.state}</span>`), 'state count should be rendered');
  assert.ok(res.body.includes(`<span class="stat__value">${totals.pincode}</span>`), 'PIN count should be rendered');
  assert.ok(res.body.includes(`<span class="stat__value">${categoryCount}</span>`), 'category count should be rendered');
});

test('the homepage shows a real category grid from live services', async () => {
  const res = await request(app, { url: '/' });
  const popular = services.popularCategories(app.db, 8);
  assert.ok(popular.length > 0);
  for (const category of popular) {
    assert.ok(res.body.includes(`href="/search?category=${category.slug}"`), `category ${category.slug} missing from grid`);
  }
  assert.match(res.body, /service(s)?<\/span>/);
});

test('the homepage explains the hierarchy the product is built on', async () => {
  const res = await request(app, { url: '/' });
  assert.match(res.body, /State/);
  assert.match(res.body, /PIN code/);
  assert.match(res.body, /How SEVA MARKET INDIA works/);
});

test('the footer links to legal and marketplace pages', async () => {
  const res = await request(app, { url: '/' });
  for (const href of ['/privacy', '/terms', '/about', '/contact', '/categories', '/locations']) {
    assert.ok(res.body.includes(`href="${href}"`), `footer must link to ${href}`);
  }
  for (const href of ['/privacy', '/terms', '/about', '/contact']) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await request(app, { url: href })).statusCode, 200, `${href} should not be a dead link`);
  }
});

test('no inline script or inline event handler survives into the HTML', async () => {
  const res = await request(app, { url: '/' });
  // Inert data blocks are allowed: JSON-LD (type="application/ld+json") is
  // structured data Google parses from the raw HTML — browsers never execute
  // it, so the strict CSP is untouched. Anything else without src= is not.
  const inlineScripts = res.body.match(/<script(?![^>]*\ssrc=)(?![^>]*\stype="application\/ld\+json")[^>]*>/g) || [];
  assert.deepEqual(inlineScripts, [], 'CSP forbids inline <script>; use /assets/js/main.js');
  const jsonLdBlocks = res.body.match(/<script type="application\/ld\+json">/g) || [];
  assert.ok(jsonLdBlocks.length >= 1, 'the homepage is expected to carry JSON-LD structured data');
  for (const handler of ['onclick=', 'onsubmit=', 'onload=', 'onerror=']) {
    assert.ok(!res.body.includes(handler), `inline handler ${handler} must not be emitted`);
  }
  assert.match(res.body, /<script src="\/assets\/js\/main\.js" defer><\/script>/);
});

test('the page is accessible: skip link, landmarks and one h1', async () => {
  const res = await request(app, { url: '/' });
  assert.match(res.body, /class="skip-link" href="#main"/);
  assert.equal((res.body.match(/<h1/g) || []).length, 1, 'exactly one h1 per page');
  assert.match(res.body, /<main id="main"/);
  assert.match(res.body, /<footer/);
});

/* -------------------------------------------------------------- search */

test('the search page renders matching services with contact details', async () => {
  const res = await request(app, { url: '/search?category=plumber&pin=781001' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /result-card/);
  assert.match(res.body, /Plumber/);
  assert.match(res.body, /781001/);
  assert.match(res.body, /href="tel:\+91\d{10}"/, 'a call button must be present');
  assert.match(res.body, /badge--verified/, 'verified providers should be badged');
});

test('the search heading describes the active filters', async () => {
  const res = await request(app, { url: '/search?category=plumber&pin=781001' });
  assert.match(res.body, /<h1 class="page-head__title">Plumber near 781001<\/h1>/);
});

test('a search with no results renders an empty state, not an error', async () => {
  const res = await request(app, { url: '/search?q=astrologer&pin=999998' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /No services matched your search/);
  assert.match(res.body, /0 services available/);
});

test('an invalid PIN on the search page is rejected with 400', async () => {
  const res = await request(app, { url: '/search?pin=000000' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().ok, false);
  assert.match(res.json().error.message, /PIN code must be 6 digits/);
});

test('prices render as a readable range in rupees', async () => {
  const res = await request(app, { url: '/search?category=plumber&pin=781001' });
  assert.match(res.body, /₹299–₹699\/visit/);
});

/* ---------------------------------------------------------- other pages */

test('the categories page lists every top-level category', async () => {
  const res = await request(app, { url: '/categories' });
  assert.equal(res.statusCode, 200);
  for (const parent of categories.tree(app.db)) {
    // The page HTML-escapes, so "&" is rendered as "&amp;".
    assert.ok(res.body.includes(esc(parent.name)), `${parent.name} missing`);
  }
  assert.match(res.body, /category-block/);
});

test('the locations page reports coverage for every level', async () => {
  const res = await request(app, { url: '/locations' });
  const totals = locations.stats(app.db);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, new RegExp(`${totals.state} states`));
  assert.match(res.body, new RegExp(`${totals.district} districts`));
  assert.match(res.body, new RegExp(`${totals.city} cities`));
  assert.match(res.body, new RegExp(`${totals.locality} localities`));
  assert.match(res.body, new RegExp(`${totals.pincode} PIN codes`));
});

/* ------------------------------------------------------------- escaping */

test('provider-supplied text is escaped, never executed', async () => {
  const category = categories.findBySlug(app.db, 'electrician');
  const place = locations.findByPin(app.db, '781006').chain[4];
  const provider = providers.createProvider(app.db, {
    businessName: 'Borah <script>alert(1)</script> Electrics',
    categoryId: category.id,
    locationId: place.id,
    phone: '9000012399',
    about: '"><img src=x onerror=alert(2)>',
    status: 'active',
  });
  services.createService(app.db, {
    providerId: provider.id,
    categoryId: category.id,
    locationId: place.id,
    title: 'Wiring check "urgent" <b>now</b>',
    status: 'active',
  });

  const res = await request(app, { url: '/search?q=Borah' });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.ok(res.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'the name should be escaped, not dropped');
  assert.ok(!res.body.includes('onerror=alert(2)'), 'attribute breakout must be escaped');
  assert.ok(!res.body.includes('<b>now</b>'), 'service titles must be escaped too');
});

test('the unit escaper covers every dangerous character', () => {
  const { esc } = require('../src/views/escape');
  assert.equal(esc('<script>"a" & \'b\' `c`</script>'), '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39; &#96;c&#96;&lt;/script&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

/* -------------------------------------------------------- mobile-first */

test('the stylesheet is mobile-first: base rules then min-width additions', async () => {
  const res = await request(app, { url: '/assets/css/main.css' });
  const css = res.body;
  // Match a real rule, not the prose in the header comment.
  const firstMediaQuery = css.search(/@media \(min-width:[^)]*\)\s*\{/);
  const firstNavToggle = css.indexOf('.nav-toggle');
  assert.ok(firstNavToggle > -1, 'the mobile nav toggle must have base styles');
  assert.ok(firstMediaQuery > -1, 'a min-width breakpoint must exist');
  assert.ok(firstMediaQuery > firstNavToggle, 'base (mobile) rules must precede the first breakpoint');
  assert.ok(!css.includes('max-width: 599px'), 'avoid max-width-first media queries');
  // Tap targets must not shrink below the 44px guideline.
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('the layout switches to a horizontal nav only at 900px and up', async () => {
  const css = (await request(app, { url: '/assets/css/main.css' })).body;
  assert.match(css, /\.nav \{[^}]*display: none/s, 'the sheet is hidden by default on mobile');
  assert.match(css, /\.nav\.is-open \{ display: flex; \}/);
  const desktopBlock = css.slice(css.indexOf('@media (min-width: 900px)'));
  assert.match(desktopBlock, /\.nav-toggle \{ display: none; \}/);
  assert.match(desktopBlock, /\.nav \{[^}]*position: static/s);
});
