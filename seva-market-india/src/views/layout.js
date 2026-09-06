'use strict';
/**
 * SEVA MARKET INDIA — HTML escaping + page layout.
 *
 * Server-rendered, dependency-free templates. Every dynamic value goes
 * through `esc()`, and the strict CSP forbids inline scripts, so the
 * templates never emit an event handler attribute.
 */

const { esc } = require('./escape');

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/services', label: 'Services' },
  { href: '/categories', label: 'Categories' },
  { href: '/search', label: 'Browse providers' },
  { href: '/locations', label: 'Locations' },
  { href: '/providers/new', label: 'List your service', cta: true },
];

function navMarkup(currentPath = '/') {
  return NAV.map((item) => {
    const isActive = item.href === currentPath ? ' aria-current="page"' : '';
    const className = item.cta ? 'nav__link nav__link--cta' : 'nav__link';
    return `<a class="${className}" href="${esc(item.href)}"${isActive}>${esc(item.label)}</a>`;
  }).join('\n        ');
}

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {string} options.body  inner HTML for <main>
 * @param {string} [options.currentPath]
 * @param {{name: string, tagline: string}} options.site
 */
function layout({ title, description = '', body, currentPath = '/', site }) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en-IN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)} | ${esc(site.name)}</title>
  <meta name="description" content="${esc(description || site.tagline)}">
  <meta name="theme-color" content="#0b6b5b">
  <link rel="canonical" href="${esc(currentPath)}">
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/css/main.css">
  <meta property="og:title" content="${esc(title)} | ${esc(site.name)}">
  <meta property="og:description" content="${esc(description || site.tagline)}">
  <meta property="og:type" content="website">
</head>
<body>
  <a class="skip-link" href="#main">Skip to main content</a>

  <header class="site-header" id="top">
    <div class="container site-header__inner">
      <a class="brand" href="/" aria-label="${esc(site.name)} home">
        <span class="brand__mark" aria-hidden="true">से</span>
        <span class="brand__text">
          <span class="brand__name">${esc(site.name)}</span>
          <span class="brand__sub">Local services marketplace</span>
        </span>
      </a>

      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-nav"
              data-nav-toggle>
        <span class="nav-toggle__bar" aria-hidden="true"></span>
        <span class="nav-toggle__bar" aria-hidden="true"></span>
        <span class="nav-toggle__bar" aria-hidden="true"></span>
        <span class="sr-only">Menu</span>
      </button>

      <nav class="nav" id="primary-nav" aria-label="Primary" data-nav>
        ${navMarkup(currentPath)}
      </nav>
    </div>
  </header>

  <main id="main" class="site-main">
${body}
  </main>

  <footer class="site-footer">
    <div class="container site-footer__grid">
      <div>
        <p class="site-footer__brand">${esc(site.name)}</p>
        <p class="site-footer__note">${esc(site.tagline)}</p>
      </div>
      <nav aria-label="Marketplace">
        <p class="site-footer__heading">Marketplace</p>
        <ul>
          <li><a href="/services">All services</a></li>
          <li><a href="/categories">All categories</a></li>
          <li><a href="/search">Browse providers</a></li>
          <li><a href="/locations">States &amp; cities</a></li>
        </ul>
      </nav>
      <nav aria-label="Providers">
        <p class="site-footer__heading">For providers</p>
        <ul>
          <li><a href="/providers/new">List your service</a></li>
          <li><a href="/about">About us</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </nav>
      <nav aria-label="Legal">
        <p class="site-footer__heading">Legal</p>
        <ul>
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/terms">Terms</a></li>
        </ul>
      </nav>
    </div>
    <div class="container site-footer__base">
      <p>&copy; ${year} ${esc(site.name)}. Built for every PIN code in India.</p>
    </div>
  </footer>

  <script src="/assets/js/main.js" defer></script>
</body>
</html>`;
}

module.exports = { layout, navMarkup, NAV, esc };
