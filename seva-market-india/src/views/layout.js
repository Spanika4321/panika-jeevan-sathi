'use strict';
/**
 * SEVA MARKET INDIA — HTML escaping + page layout.
 *
 * Server-rendered, dependency-free templates. Every dynamic value goes
 * through `esc()`, and the strict CSP forbids inline scripts, so the
 * templates never emit an event handler attribute.
 *
 * Header design follows the big-Indian-marketplace pattern: a coloured top
 * row with brand + search + account actions, then a navigation row; on
 * mobile the search drops to its own row and the nav becomes a sheet.
 */

const { esc } = require('./escape');
const { avatarMarkup } = require('./ui');

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/search', label: 'Browse services' },
  { href: '/categories', label: 'Categories' },
  { href: '/locations', label: 'States & cities' },
  { href: '/providers/new', label: 'List your service', cta: true },
];

function navMarkup(currentPath = '/') {
  return NAV.map((item) => {
    const isActive = item.href === currentPath ? ' aria-current="page"' : '';
    const className = item.cta ? 'nav__link nav__link--cta' : 'nav__link';
    return `<a class="${className}" href="${esc(item.href)}"${isActive}>${esc(item.label)}</a>`;
  }).join('\n        ');
}

/** Search form used in the header (q-only; the hero search adds place + PIN). */
function headerSearchMarkup() {
  return `
    <form class="hdr-search" action="/search" method="get" role="search" data-header-search>
      <label class="sr-only" for="hdr-q">Search services</label>
      <input id="hdr-q" name="q" type="search" autocomplete="off"
             placeholder="Search services near you — plumber, tutor, AC repair…" maxlength="80">
      <button type="submit" aria-label="Search">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/>
        </svg>
        <span>Search</span>
      </button>
    </form>`;
}

/** Signed-in chip (name + dropdown), or Login/Sign-up pills. */
function authMarkup(claims, currentPath) {
  if (!claims) {
    const next = currentPath === '/login' || currentPath === '/register' ? '/' : currentPath;
    return `
      <div class="hdr-actions">
        <a class="hdr-link" href="/login${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}">Login</a>
        <a class="btn btn--yellow btn--sm hdr-signup" href="/register${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}">Sign up</a>
      </div>`;
  }
  const links = [
    { href: '/account', label: 'My dashboard' },
    ...(claims.rl === 'provider'
      ? [
          { href: '/account/provider', label: 'My business' },
          { href: '/account/services', label: 'My services' },
          { href: '/account/leads', label: 'Enquiries' },
        ]
      : [
          { href: '/register?role=provider', label: 'Become a provider' },
          { href: '/search', label: 'Browse services' },
        ]),
  ];
  return `
    <details class="acct">
      <summary class="acct__btn" aria-label="Account menu for ${esc(claims.nm)}">
        ${avatarMarkup(claims.nm, 'avatar--sm')}
        <span class="acct__name">${esc(claims.nm.split(' ')[0])}</span>
        <svg class="acct__caret" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>
      </summary>
      <div class="acct__menu">
        <p class="acct__menu-head">${esc(claims.nm)}<br><span>${esc(claims.rl === 'provider' ? 'Service provider' : 'Customer')}</span></p>
        ${links.map((link) => `<a href="${esc(link.href)}">${esc(link.label)}</a>`).join('')}
        <form method="post" action="/logout">
          <button class="acct__logout" type="submit">Log out</button>
        </form>
      </div>
    </details>`;
}

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {string} options.body        inner HTML for <main>
 * @param {string} [options.currentPath]
 * @param {string} [options.robots]
 * @param {object|null} [options.user] verified session claims ({uid,nm,rl})
 * @param {{name: string, tagline: string, url?: string}} options.site
 * @param {Array<object>} [options.jsonLd] schema.org objects (Google's
 *   recommended structured-data format) rendered as JSON-LD script tags
 * @param {string} [options.googleSiteVerification] Search Console ownership
 *   token; rendered only when configured, never a placeholder
 */
function canonicalUrl(site, currentPath) {
  const path = String(currentPath || '/');
  try {
    const origin = new URL(String(site?.url || '')).origin;
    const target = new URL(path, `${origin}/`);
    return target.origin === origin ? target.href : origin;
  } catch (_) {
    // Local development has no public SITE_URL. A relative canonical remains
    // correct there; production always supplies its Render/custom-domain URL.
    return path;
  }
}

function layout({
  title, description = '', body, currentPath = '/', robots = 'index,follow',
  user = null, site, jsonLd = [], googleSiteVerification = '',
}) {
  const year = new Date().getFullYear();
  const canonical = canonicalUrl(site, currentPath);
  // JSON-LD must be raw JSON, not HTML-escaped. Escaping "<" as \u003C keeps
  // the JSON valid while preventing a "</script>" breakout from page data.
  const jsonLdTags = jsonLd.length
    ? `\n  <script type="application/ld+json">${jsonLd.map((node) => JSON.stringify(node).replace(/</g, '\\u003C')).join('</script>\n  <script type="application/ld+json">')}</script>`
    : '';
  return `<!DOCTYPE html>
<html lang="en-IN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)} | ${esc(site.name)}</title>
  <meta name="description" content="${esc(description || site.tagline)}">
  <meta name="theme-color" content="#2874f0">
  <meta name="robots" content="${esc(robots)}">${googleSiteVerification ? `
  <meta name="google-site-verification" content="${esc(googleSiteVerification)}">` : ''}
  <link rel="canonical" href="${esc(canonical)}">
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/css/main.css">
  <meta property="og:title" content="${esc(title)} | ${esc(site.name)}">
  <meta property="og:description" content="${esc(description || site.tagline)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:site_name" content="${esc(site.name)}">
  <meta property="og:locale" content="en_IN">
  <meta name="twitter:card" content="summary">${jsonLdTags}
</head>
<body>
  <a class="skip-link" href="#main">Skip to main content</a>

  <header class="site-header" id="top">
    <div class="site-header__main container">
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-nav"
              data-nav-toggle>
        <span class="nav-toggle__bar" aria-hidden="true"></span>
        <span class="nav-toggle__bar" aria-hidden="true"></span>
        <span class="nav-toggle__bar" aria-hidden="true"></span>
        <span class="sr-only">Menu</span>
      </button>

      <a class="brand" href="/" aria-label="${esc(site.name)} home">
        <span class="brand__mark" aria-hidden="true">से</span>
        <span class="brand__text">
          <span class="brand__name">Seva <span class="brand__plus">Market</span> <em>India</em></span>
          <span class="brand__sub">Local services marketplace</span>
        </span>
      </a>

      ${headerSearchMarkup()}

      ${authMarkup(user, currentPath)}
    </div>

    <nav class="nav container" id="primary-nav" aria-label="Primary" data-nav>
      ${navMarkup(currentPath)}
    </nav>
  </header>

  <main id="main" class="site-main">
${body}
  </main>

  <footer class="site-footer">
    <div class="site-footer__promise container">
      <p><span aria-hidden="true">🛡️</span> Verified providers</p>
      <p><span aria-hidden="true">🤝</span> Contact directly, zero commission</p>
      <p><span aria-hidden="true">🇮🇳</span> Built for every PIN code in India</p>
    </div>
    <div class="container site-footer__grid">
      <div class="site-footer__about">
        <p class="site-footer__brand">Seva Market <em>India</em></p>
        <p class="site-footer__note">${esc(site.tagline)} Find plumbers, electricians, tutors, photographers and more — organised by state, district, city, locality and PIN code.</p>
      </div>
      <nav aria-label="Marketplace">
        <p class="site-footer__heading">Marketplace</p>
        <ul>
          <li><a href="/search">Browse services</a></li>
          <li><a href="/categories">All categories</a></li>
          <li><a href="/locations">States &amp; cities</a></li>
        </ul>
      </nav>
      <nav aria-label="Providers">
        <p class="site-footer__heading">For providers</p>
        <ul>
          <li><a href="/providers/new">List your service</a></li>
          <li><a href="/register?role=provider">Create free account</a></li>
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
      <p class="site-footer__india" aria-hidden="true">Made in India 🇮🇳</p>
    </div>
  </footer>

  <script src="/assets/js/main.js" defer></script>
</body>
</html>`;
}

module.exports = { layout, canonicalUrl, navMarkup, NAV, esc };
