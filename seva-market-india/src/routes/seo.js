'use strict';
/**
 * SEVA MARKET INDIA — SEO surface: robots.txt + sitemap.xml.
 *
 * The marketplace is fully server-rendered and indexable, so a sitemap is a
 * meaningful investment. It enumerates the stable pages, every category, the
 * state landing pages, and every live provider & service.
 *
 * Absolute URLs require SITE_URL. Until it is set in development we emit a
 * placeholder host so the documents stay valid; deploy with SITE_URL set.
 */

const categoryModel = require('../models/category');
const locationModel = require('../models/location');
const providerModel = require('../models/provider');
const serviceModel = require('../models/service');

function siteOrigin(config) {
  const url = (config.site && config.site.url) || 'https://seva-market.example';
  return String(url).replace(/\/$/, '');
}

function register(router, { db, config }) {
  router.get('/robots.txt', () => {
    return {
      text: `User-agent: *
Allow: /
Disallow: /login
Disallow: /register
Disallow: /dashboard
Disallow: /providers/new

Sitemap: ${siteOrigin(config)}/sitemap.xml
`,
    };
  });

  router.get('/sitemap.xml', () => {
    const origin = siteOrigin(config);
    const now = new Date().toISOString().slice(0, 10);
    const urls = [];

    const push = (path) => urls.push(`  <url>\n    <loc>${origin}${path}</loc>\n    <lastmod>${now}</lastmod>\n  </url>`);

    for (const path of ['/', '/search', '/categories', '/locations', '/about', '/contact', '/privacy', '/terms']) {
      push(path);
    }
    for (const category of categoryModel.findAll(db)) {
      push(`/search?category=${category.slug}`);
    }
    const india = locationModel.ensureIndia(db);
    for (const state of locationModel.findChildren(db, india.id, 'state')) {
      push(`/search?state=${state.slug}`);
    }
    for (const provider of providerModel.searchProviders(db, { limit: 10000 }).items) {
      push(`/providers/${provider.slug}`);
    }
    for (const service of serviceModel.searchServices(db, { limit: 10000 }).items) {
      push(`/services/${service.slug}`);
    }

    return {
      xml: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`,
    };
  });
}

module.exports = { register, siteOrigin };
