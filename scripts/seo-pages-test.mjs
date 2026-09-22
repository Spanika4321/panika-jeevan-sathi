import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const locations = require('../lib/locations.js');
const seo = require('../lib/seo-pages.js');

const ORIGIN = 'https://panikajeevansathi.onrender.com';

function visibleWords(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

test('location tree is the single spelling used by pages and the dropdown', () => {
  const tree = locations.dropdownTree();
  assert.equal(tree[0].name, 'Chhattisgarh');
  assert.ok(tree[0].cities.includes('Raipur'));
  assert.ok(tree[0].cities.includes('Bilaspur'));
  assert.equal(locations.STATE_ALIASES.cg, 'Chhattisgarh');
  assert.equal(locations.STATE_ALIASES.orissa, 'Odisha');
  assert.equal(locations.CITY_ALIASES.banaras, 'Varanasi');
  assert.equal(locations.CITY_ALIASES.gauhati, 'Guwahati');
  const slugs = new Set();
  for (const state of locations.STATES) {
    assert.equal(slugs.has(state.slug), false, state.slug);
    slugs.add(state.slug);
    for (const city of state.cities) {
      if (!city.page) continue;
      const hit = seo.lookup(`/locations/${state.slug}/${city.slug}`);
      assert.equal(hit.page.path, `/locations/${state.slug}/${city.slug}`);
      const html = seo.render(hit.page, ORIGIN);
      assert.match(html, new RegExp(`City “${city.name}”`));
      assert.match(html, new RegExp(`State “${state.name}”`));
    }
  }
});

test('indexable pages are unique, linked and not thin doorway copies', () => {
  const paths = seo.indexablePaths();
  assert.ok(paths.includes('/communities/panika'));
  assert.ok(paths.includes('/locations/assam/guwahati'));
  assert.ok(paths.includes('/guides/how-to-create-a-profile'));
  assert.equal(paths.includes('/login.html'), false);
  const titles = new Set();
  const descriptions = new Set();
  const bodies = new Set();
  for (const path of paths) {
    const hit = seo.lookup(path);
    assert.equal(hit.redirect, undefined, path);
    assert.ok(hit.page, path);
    const html = seo.render(hit.page, ORIGIN);
    assert.match(html, new RegExp(`rel="canonical" href="${ORIGIN}${path}"`));
    assert.doesNotMatch(html, /noindex/);
    assert.match(html, /<h1[^>]*>[^<]+<\/h1>/);
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    const description = html.match(/name="description" content="([^"]*)"/)[1];
    assert.equal(titles.has(title), false, title);
    assert.equal(descriptions.has(description), false, description);
    titles.add(title);
    descriptions.add(description);
    assert.ok(description.length >= 40 && description.length <= 180, `${path} description ${description.length}`);
    const text = visibleWords(html).join(' ');
    assert.equal(bodies.has(text), false, path);
    bodies.add(text);
    const min = path.startsWith('/guides/') && path !== '/guides' ? 450
      : path.startsWith('/communities/') && path !== '/communities' ? 320
        : path.split('/').length === 4 ? 280
          : 220;
    assert.ok(visibleWords(html).length >= min, `${path} has ${visibleWords(html).length} words, need ${min}`);
  }
});

test('aliases consolidate to one canonical path', () => {
  assert.deepEqual(seo.lookup('/community/panika'), { redirect: '/communities/panika' });
  assert.deepEqual(seo.lookup('/locations/chhattisgarh/'), { redirect: '/locations/chhattisgarh' });
  assert.deepEqual(seo.lookup('/locations/ASSAM/Guwahati'), { redirect: '/locations/assam/guwahati' });
  assert.deepEqual(seo.lookup('/places'), { redirect: '/locations' });
  assert.equal(seo.lookup('/locations/not-a-place').notFound, true);
  assert.equal(seo.lookup('/dashboard.html'), null);
  assert.equal(seo.lookup('/locations/../server.js'), null);
});
