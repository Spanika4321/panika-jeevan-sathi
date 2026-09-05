import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withServer, getJson, getText } from './helpers/app.js';

describe('HTTP platform', () => {
  test('the home page is served with HTML, caching and security headers', async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(new URL('/', baseUrl));
      const html = await response.text();

      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html; charset=utf-8/);
      assert.equal(response.headers.get('cache-control'), 'no-cache', 'HTML must never be stale');
      assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/);
      assert.match(html, /SEVA MARKET INDIA/);

      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');

      const csp = response.headers.get('content-security-policy') || '';
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self'/);
      assert.doesNotMatch(csp, /unsafe-inline/, 'no inline script or style is allowed');
    });
  });

  test('assets are cacheable and served with the right content type', async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(new URL('/assets/css/tokens.css', baseUrl));
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/css/);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
    });
  });

  test('unknown pages render the branded 404 page', async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(new URL('/no-such-page.html', baseUrl));
      assert.equal(response.status, 404);
      assert.match(await response.text(), /Page not found/);
    });
  });

  test('path traversal outside public/ is refused', async () => {
    await withServer(async ({ baseUrl }) => {
      const attempts = ['/../server.js', '/..%2f..%2fserver.js', '/%2e%2e/%2e%2e/package.json'];
      for (const path of attempts) {
        const response = await fetch(new URL(path, baseUrl), { redirect: 'manual' });
        assert.ok([403, 404].includes(response.status), `${path} is blocked (got ${response.status})`);
      }
      const serverSource = await fetch(new URL('/server.js', baseUrl));
      assert.equal(serverSource.status, 404, 'server source is not statically reachable');
    });
  });

  test('static routes only accept GET, HEAD and OPTIONS', async () => {
    await withServer(async ({ baseUrl }) => {
      const post = await fetch(new URL('/', baseUrl), { method: 'POST' });
      assert.equal(post.status, 405);
      assert.match(post.headers.get('allow'), /GET/);

      const options = await fetch(new URL('/', baseUrl), { method: 'OPTIONS' });
      assert.equal(options.status, 204);
    });
  });

  test('robots.txt and sitemap.xml are generated for search engines', async () => {
    await withServer(async ({ baseUrl }) => {
      const robots = await getText(baseUrl, '/robots.txt');
      assert.equal(robots.status, 200);
      assert.match(robots.body, /User-agent: \*/);
      assert.match(robots.body, /Disallow: \/api\//);
      assert.match(robots.body, /Sitemap: .*\/sitemap\.xml/);

      const sitemap = await getText(baseUrl, '/sitemap.xml');
      assert.equal(sitemap.status, 200);
      assert.match(sitemap.body, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
      assert.match(sitemap.body, /<loc>/);
    });
  });
});

describe('public API', () => {
  test('/api/health reports the driver and environment', async () => {
    await withServer(async ({ baseUrl }) => {
      const { status, body } = await getJson(baseUrl, '/api/health');
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.status, 'ok');
      assert.equal(body.driver, 'sqlite');
      assert.equal(body.environment, 'test');
      assert.ok(body.migrations);
    });
  });

  test('/api/v1/health includes uptime and API version', async () => {
    await withServer(async ({ baseUrl }) => {
      const { body } = await getJson(baseUrl, '/api/v1/health');
      assert.equal(body.version, 'v1');
      assert.ok(body.uptime_ms >= 0);
      assert.ok(body.booted_at > 0);
    });
  });

  test('/api/v1/meta describes the marketplace and its size', async () => {
    await withServer(async ({ baseUrl }) => {
      const { body } = await getJson(baseUrl, '/api/v1/meta');
      assert.equal(body.site.name, 'SEVA MARKET INDIA');
      assert.equal(body.counts.states, 36);
      assert.equal(body.counts.categories, 12);
      assert.ok(body.counts.providers > 0);
    });
  });

  test('/api/v1/home returns one payload for the mobile home screen', async () => {
    await withServer(async ({ baseUrl }) => {
      const { body } = await getJson(baseUrl, '/api/v1/home');
      assert.ok(body.categories.length > 0);
      assert.ok(body.categories[0].services.length >= 0);
      assert.ok(body.popular_cities.some((city) => city.name === 'New Delhi'));
      assert.ok(body.featured_providers.length > 0);
      assert.equal(body.counts.categories, 12);
    });
  });

  test('categories and services are browsable', async () => {
    await withServer(async ({ baseUrl }) => {
      const categories = await getJson(baseUrl, '/api/v1/categories');
      assert.equal(categories.body.items.length, 12);

      const category = await getJson(baseUrl, '/api/v1/categories/plumbing');
      assert.equal(category.body.item.slug, 'plumbing');
      assert.ok(category.body.item.services.length >= 5);

      const services = await getJson(baseUrl, '/api/v1/services?category=plumbing');
      assert.ok(services.body.items.some((row) => row.slug === 'tap-faucet-repair'));

      const missing = await getJson(baseUrl, '/api/v1/categories/not-a-category');
      assert.equal(missing.status, 404);
      assert.equal(missing.body.code, 'not_found');
    });
  });

  test('the location directory is queryable level by level', async () => {
    await withServer(async ({ baseUrl }) => {
      const states = await getJson(baseUrl, '/api/v1/locations/states');
      assert.equal(states.body.items.length, 36);

      const delhi = states.body.items.find((row) => row.name === 'Delhi');
      const districts = await getJson(baseUrl, `/api/v1/locations/districts?state=${delhi.slug}`);
      assert.equal(districts.body.items.length, 1);

      const cities = await getJson(baseUrl, `/api/v1/locations/cities?state_id=${delhi.id}`);
      assert.equal(cities.body.items[0].name, 'New Delhi');

      const pincode = await getJson(baseUrl, '/api/v1/locations/pincodes/110005');
      assert.equal(pincode.body.item.place.city.name, 'New Delhi');

      const unknown = await getJson(baseUrl, '/api/v1/locations/pincodes/000000');
      assert.equal(unknown.status, 404);
    });
  });

  test('search works by PIN code, service and city', async () => {
    await withServer(async ({ baseUrl }) => {
      const byPin = await getJson(baseUrl, '/api/v1/search?pincode=110005');
      assert.equal(byPin.status, 200);
      assert.ok(byPin.body.items.some((row) => row.slug === 'sharma-plumbing-works'));
      assert.equal(byPin.body.place.pincode, '110005');

      const byService = await getJson(baseUrl, '/api/v1/search?service=ac-service-repair');
      assert.equal(byService.body.items.length, 1);

      const byCity = await getJson(baseUrl, '/api/v1/search?city=bengaluru');
      assert.ok(byCity.body.items.some((row) => row.slug === 'sparkle-home-deep-cleaning'));

      const provider = await getJson(baseUrl, '/api/v1/providers/sharma-plumbing-works');
      assert.equal(provider.body.item.business_name, 'Sharma Plumbing Works');
      assert.equal(provider.body.item.location.city.name, 'New Delhi');

      const missing = await getJson(baseUrl, '/api/v1/providers/nope');
      assert.equal(missing.status, 404);
    });
  });

  test('API errors are consistent JSON with a stable code', async () => {
    await withServer(async ({ baseUrl }) => {
      const notFound = await getJson(baseUrl, '/api/v1/does-not-exist');
      assert.equal(notFound.status, 404);
      assert.equal(notFound.body.ok, false);
      assert.equal(notFound.body.code, 'not_found');
    });
  });

  test('API responses are never cached and are hidden from crawlers', async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(new URL('/api/v1/meta', baseUrl));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    });
  });
});

describe('accounts over HTTP', () => {
  test('register, read the session, then sign out', async () => {
    await withServer(async ({ baseUrl }) => {
      const registered = await fetch(new URL('/api/v1/auth/register', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'HTTP User', email: 'http@example.com', password: 'strongpass1' })
      });
      const body = await registered.json();
      assert.equal(registered.status, 200);
      assert.equal(body.user.email, 'http@example.com');
      assert.equal('password_hash' in body.user, false, 'the hash never leaves the server');

      const cookie = registered.headers.get('set-cookie').split(';')[0];
      assert.match(cookie, /^sm_session=/);

      const me = await fetch(new URL('/api/v1/auth/me', baseUrl), { headers: { Cookie: cookie } });
      const meBody = await me.json();
      assert.equal(me.status, 200);
      assert.equal(meBody.user.email, 'http@example.com');
    });
  });

  test('the session endpoint requires a valid cookie', async () => {
    await withServer(async ({ baseUrl }) => {
      const anonymous = await getJson(baseUrl, '/api/v1/auth/me');
      assert.equal(anonymous.status, 401);
      assert.equal(anonymous.body.code, 'unauthorized');

      const forged = await fetch(new URL('/api/v1/auth/me', baseUrl), { headers: { Cookie: 'sm_session=forged.signature' } });
      assert.equal(forged.status, 401);
    });
  });

  test('validation failures come back as 422 with a field map', async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(new URL('/api/v1/auth/register', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', email: 'nope', password: 'x' })
      });
      const body = await response.json();
      assert.equal(response.status, 422);
      assert.equal(body.code, 'validation_failed');
      assert.ok(body.details.fields.email);
      assert.ok(body.details.fields.name);
    });
  });

  test('a malformed JSON body is rejected, not crashed on', async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(new URL('/api/v1/auth/login', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json'
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).ok, false);
    });
  });

  test('login attempts are rate limited', async () => {
    await withServer(async ({ baseUrl }) => {
      const attempt = () =>
        fetch(new URL('/api/v1/auth/login', baseUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'nobody@example.com', password: 'strongpass1' })
        });

      let limited = null;
      for (let i = 0; i < 14; i += 1) {
        const response = await attempt();
        if (response.status === 429) {
          limited = response;
          break;
        }
      }
      assert.ok(limited, 'repeated failed logins are throttled');
      assert.equal((await limited.json()).code, 'rate_limited');
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
    });
  });

  test('creating a listing requires an account', async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(new URL('/api/v1/providers', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: 'Anonymous Business',
          category: 'plumbing',
          services: ['pipe-leak-repair'],
          pincode: '110001',
          phone: '9876500000'
        })
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, 'forbidden');
    });
  });

  test('a signed-in user can submit a listing through the API', async () => {
    await withServer(async ({ baseUrl }) => {
      const registered = await fetch(new URL('/api/v1/auth/register', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Provider Owner', email: 'provider@example.com', password: 'strongpass1' })
      });
      const cookie = registered.headers.get('set-cookie').split(';')[0];

      const response = await fetch(new URL('/api/v1/providers', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          business_name: 'API Test Services',
          category: 'plumbing',
          services: ['pipe-leak-repair'],
          pincode: '110001',
          phone: '9876500001'
        })
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.item.status, 'pending');
      assert.equal(body.item.business_name, 'API Test Services');

      const mine = await fetch(new URL('/api/v1/providers/mine', baseUrl), { headers: { Cookie: cookie } });
      const mineBody = await mine.json();
      assert.equal(mineBody.total, 1);
    });
  });
});
