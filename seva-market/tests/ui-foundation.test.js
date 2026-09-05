import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from '../lib/config.js';

const PAGES = fs.readdirSync(PUBLIC_DIR).filter((name) => name.endsWith('.html'));
const read = (file) => fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');

/**
 * These checks protect the mobile-first, production-ready UI foundation:
 * phone layout first, no inline styles (the CSP forbids them), and no link
 * that points at a page we have not built.
 */
describe('mobile-first UI foundation', () => {
  test('every page declares a mobile viewport and a theme colour', () => {
    for (const page of PAGES) {
      const html = read(page);
      assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/, `${page} viewport`);
      assert.match(html, /<meta name="theme-color" content="#123c8f"\s*\/?>/, `${page} theme colour`);
      assert.match(html, /<html lang="en-IN">/, `${page} declares the Indian English locale`);
    }
  });

  test('no page uses inline styles or inline event handlers', () => {
    for (const page of PAGES) {
      const html = read(page);
      assert.doesNotMatch(html, /\sstyle\s*=/i, `${page} must not use inline styles (CSP)`);
      assert.doesNotMatch(html, /\son(click|load|change|submit|error)\s*=/i, `${page} must not use inline handlers (CSP)`);
    }
  });

  test('pages load stylesheets and scripts from /assets only', () => {
    for (const page of PAGES) {
      const html = read(page);
      for (const match of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
        const reference = match[1].split('#')[0].split('?')[0];
        if (reference.startsWith('/api/')) continue;
        assert.ok(
          reference.startsWith('/assets/') || PAGES.some((p) => '/' + p === reference) || reference === '/',
          `${page} → ${reference}`
        );
      }
    }
  });

  test('every local asset referenced by a page exists on disk', () => {
    for (const page of PAGES) {
      const html = read(page);
      for (const match of html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)) {
        const file = path.join(PUBLIC_DIR, match[1].replace(/^\//, ''));
        assert.ok(fs.existsSync(file), `${page} references missing asset ${match[1]}`);
      }
    }
  });

  test('internal links only point at pages that exist', () => {
    const urls = new Set();
    for (const page of PAGES) {
      const html = read(page);
      for (const match of html.matchAll(/href="(\/[^"#?]*)"/g)) {
        if (match[1].startsWith('/api/') || match[1].startsWith('/assets/')) continue;
        urls.add(match[1] === '/' ? '/index.html' : match[1]);
      }
    }
    for (const url of urls) {
      const file = path.join(PUBLIC_DIR, url.replace(/^\//, ''));
      assert.ok(fs.existsSync(file), `link target missing: ${url}`);
    }
  });

  test('the app shell renders a header, primary nav and mobile bottom navigation', () => {
    const shell = fs.readFileSync(path.join(PUBLIC_DIR, 'assets/js/app.js'), 'utf8');
    assert.match(shell, /class="site-header"/, 'sticky header');
    assert.match(shell, /class="main-nav"/, 'desktop primary navigation');
    assert.match(shell, /class="bottom-nav"/, 'mobile bottom navigation');
    assert.match(shell, /class="drawer"/, 'mobile drawer menu');
    assert.match(shell, /menu-toggle/, 'hamburger toggle');
    assert.match(shell, /SEVA MARKET/, 'brand');
    assert.match(shell, /aria-label="Primary"/, 'the nav is labelled for screen readers');
    assert.match(shell, /skip-link|aria-current/, 'accessibility affordances');
  });

  test('the bottom navigation is hidden on desktop only', () => {
    const css = fs.readFileSync(path.join(PUBLIC_DIR, 'assets/css/components.css'), 'utf8');
    assert.match(css, /@media \(min-width: 900px\)[\s\S]{0,200}\.bottom-nav \{\s*display: none;/);
  });

  test('CSS is written mobile-first: breakpoints only add at min-width', () => {
    const files = ['tokens.css', 'base.css', 'components.css'];
    for (const file of files) {
      const css = fs.readFileSync(path.join(PUBLIC_DIR, 'assets/css', file), 'utf8');
      const queries = [...css.matchAll(/@media\s*\(?([^{)]+)\)?/g)].map((match) => match[1]);
      for (const query of queries) {
        assert.match(query.trim(), /^(min-width|prefers-reduced-motion)/, `${file}: "${query}" must be mobile-first`);
      }
    }
  });

  test('design tokens define the brand, spacing and tap-target scale', () => {
    const tokens = fs.readFileSync(path.join(PUBLIC_DIR, 'assets/css/tokens.css'), 'utf8');
    for (const token of ['--brand', '--accent', '--ink', '--surface', '--line', '--radius', '--tap', '--header-h', '--bottom-nav-h']) {
      assert.match(tokens, new RegExp(`${token}:`), `token ${token} is defined`);
    }
    assert.match(tokens, /--tap: 44px/, 'touch targets meet the 44px guideline');
    assert.match(tokens, /--brand: #123c8f/);
  });

  test('the home page carries the hero, search, categories and structured data', () => {
    const html = read('index.html');
    assert.match(html, /<section class="hero">/);
    assert.match(html, /id="searchForm"/);
    assert.match(html, /id="service"/);
    assert.match(html, /id="place"/, 'location / PIN code input');
    assert.match(html, /id="categoryGrid"/);
    assert.match(html, /id="featuredGrid"/);
    assert.match(html, /id="how"/);
    assert.match(html, /id="for-providers"/);
    assert.match(html, /<script type="application\/ld\+json">/);
    assert.match(html, /Search providers/);
  });

  test('the home page JSON-LD is valid and describes the organisation and site', () => {
    const html = read('index.html');
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    const data = JSON.parse(block);
    const types = data['@graph'].map((node) => node['@type']);
    assert.ok(types.includes('Organization'));
    assert.ok(types.includes('WebSite'));
    const site = data['@graph'].find((node) => node['@type'] === 'WebSite');
    assert.equal(site.inLanguage, 'en-IN');
  });

  test('the search page is result-driven and shareable from the URL', () => {
    const html = read('search.html');
    assert.match(html, /id="results"/);
    assert.match(html, /id="sort"/);
    assert.match(html, /id="results"/, 'results container');
    const script = fs.readFileSync(path.join(PUBLIC_DIR, 'assets/js/search.js'), 'utf8');
    assert.match(script, /new URLSearchParams\(window\.location\.search\)/, 'reads filters from the URL');
    assert.match(script, /history\.replaceState/, 'keeps the URL shareable');
  });

  test('browser code never contacts localhost or another origin', () => {
    for (const file of fs.readdirSync(path.join(PUBLIC_DIR, 'assets/js'))) {
      const js = fs.readFileSync(path.join(PUBLIC_DIR, 'assets/js', file), 'utf8');
      assert.doesNotMatch(js, /https?:\/\/(localhost|127\.0\.0\.1)/, `${file} must use same-origin relative URLs`);
      assert.doesNotMatch(js, /fetch\('http/, `${file} fetches must be relative`);
    }
  });

  test('no payment, UPI, QR or advertising code is present yet', () => {
    const files = [
      ...PAGES.map((page) => path.join(PUBLIC_DIR, page)),
      ...fs.readdirSync(path.join(PUBLIC_DIR, 'assets/js')).map((file) => path.join(PUBLIC_DIR, 'assets/js', file)),
      ...fs.readdirSync(path.join(PUBLIC_DIR, 'assets/css')).map((file) => path.join(PUBLIC_DIR, 'assets/css', file))
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(
        source,
        /upi:|pay\?pn=|razorpay|stripe|adsbygoogle|googlesyndication|ca-pub-|adsense/i,
        `${path.relative(PUBLIC_DIR, file)} must stay free of payments and advertising`
      );
    }
  });
});
