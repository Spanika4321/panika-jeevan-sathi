'use strict';
/**
 * SEVA MARKET INDIA — HTML escaping + page layout.
 *
 * Server-rendered, dependency-free templates. Every dynamic value goes
 * through `esc()`, and the strict CSP forbids inline scripts, so the
 * templates never emit an event handler attribute — signing out is a real
 * form POST, not an `onclick`.
 */

const { esc } = require('./escape');

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/search', label: 'Browse services' },
  { href: '/categories', label: 'Categories' },
  { href: '/locations', label: 'Locations' },
  { href: '/providers/new', label: 'List your service', cta: true },
];

/** Signed-in users get a different set; providers see their dashboard first. */
function accountNav(user) {
  if (!user) return [];
  const links = [{ href: '/account', label: 'My account' }];
  if (user.role === 'provider' || user.role === 'admin') links.unshift({ href: '/dashboard', label: 'Dashboard' });
  if (user.role === 'admin') links.push({ href: '/admin', label: 'Review queue' });
  return links;
}

function navMarkup(currentPath = '/', user = null) {
  const items = [...NAV, ...accountNav(user)];
  const publicLinks = items
    .map((item) => {
      // Exact match only: `/admin` would otherwise look active on every
      // `/admin/...` page, and `/` matches everything.
      const isActive = item.href === currentPath;
      const className = item.cta && !user ? 'nav__link nav__link--cta' : 'nav__link';
      return `<a class="${className}" href="${esc(item.href)}"${isActive ? ' aria-current="page"' : ''}>${esc(item.label)}</a>`;
    })
    .join('\n        ');
  return publicLinks;
}

/** The right-hand cluster: sign in, or the account menu with a real form. */
function headerAuthMarkup({ user, csrf, currentPath }) {
  if (!user) {
    return `
        <a class="nav__link${currentPath === '/login' ? ' nav__link--current' : ''}" href="/login">Sign in</a>`;
  }
  const initial = esc(String(user.full_name || user.email || 'A').trim().charAt(0).toUpperCase());
  return `
        <div class="account">
          <span class="account__avatar" aria-hidden="true">${initial}</span>
          <span class="account__name">${esc(user.full_name || user.email)}</span>
          <form class="account__form" action="/logout" method="post">
            <input type="hidden" name="_csrf" value="${esc(csrf || '')}">
            <button class="btn btn--ghost btn--sm" type="submit">Sign out</button>
          </form>
        </div>`;
}

function flashMarkup(flash) {
  if (!flash || !flash.message) return '';
  const kind = flash.kind === 'error' ? 'error' : 'ok';
  return `
    <div class="container">
      <div class="alert alert--${kind}" role="${kind === 'error' ? 'alert' : 'status'}">
        <p class="alert__title">${esc(flash.message)}</p>
      </div>
    </div>`;
}

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {string} options.body  inner HTML for <main>
 * @param {string} [options.currentPath]
 * @param {{name: string, tagline: string}} options.site
 * @param {object} [options.user]       the signed-in account, if any
 * @param {string} [options.csrf]       CSRF proof for this session
 * @param {{kind: string, message: string}} [options.flash]
 * @param {boolean} [options.noIndex]   dashboard/admin pages are not for Google
 * @param {Array<{href:string,label:string}>} [options.tabs] section navigation
 */
function layout({ title, description = '', body, currentPath = '/', site, user = null, csrf = '', flash = null, noIndex = false, tabs = null }) {
  const year = new Date().getFullYear();
  const tabsMarkup = tabs && tabs.length
    ? `
    <nav class="tabs" aria-label="Section">
      <div class="container">
        ${tabs.map((tab) => `<a class="tabs__link${tab.href === currentPath ? ' is-current' : ''}" href="${esc(tab.href)}"${tab.href === currentPath ? ' aria-current="page"' : ''}>${esc(tab.label)}</a>`).join('')}
      </div>
    </nav>`
    : '';

  return `<!DOCTYPE html>
<html lang="en-IN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)} | ${esc(site.name)}</title>
  <meta name="description" content="${esc(description || site.tagline)}">
  <meta name="theme-color" content="#0b6b5b">
  ${noIndex || user ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow">'}
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
        ${navMarkup(currentPath, user)}
        ${headerAuthMarkup({ user, csrf, currentPath })}
      </nav>
    </div>
  </header>

  <main id="main" class="site-main">
${flashMarkup(flash)}
${tabsMarkup}
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
          <li><a href="/search">Browse services</a></li>
          <li><a href="/categories">All categories</a></li>
          <li><a href="/locations">States &amp; cities</a></li>
        </ul>
      </nav>
      <nav aria-label="Providers">
        <p class="site-footer__heading">For providers</p>
        <ul>
          <li><a href="/providers/new">List your service</a></li>
          <li><a href="/dashboard">Provider dashboard</a></li>
          <li><a href="/about">About us</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </nav>
      <nav aria-label="Account">
        <p class="site-footer__heading">Account</p>
        <ul>
          <li><a href="/login">Sign in</a></li>
          <li><a href="/register">Create an account</a></li>
          <li><a href="/forgot-password">Reset password</a></li>
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

module.exports = { layout, navMarkup, headerAuthMarkup, accountNav, flashMarkup, NAV, esc };
