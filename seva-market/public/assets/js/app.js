/**
 * SEVA MARKET INDIA — shared app shell.
 *
 * Renders the header, the mobile drawer, the bottom navigation and the footer
 * into every page, and exposes the small helpers the page scripts share:
 *   SEVA.api      — JSON client for /api/v1 (same-origin relative URLs)
 *   SEVA.icon()   — inline SVG markup (no icon font, no extra request)
 *   SEVA.format   — Indian money/phone formatting
 *   SEVA.session  — current account (or null)
 *
 * Styling is class-based only: the content security policy forbids inline
 * styles, so nothing here writes to `element.style`.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------- icons */

  const PATHS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    phone: '<path d="M5 3h3l2 5-2.2 1.4a12 12 0 0 0 6.8 6.8L16 14l5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.2A2 2 0 0 1 5 3Z"/>',
    whatsapp:
      '<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3Z"/><path d="M8.8 8.9c.2-.4.4-.4.6-.4h.5c.2 0 .4 0 .6.5l.7 1.7c0 .2 0 .3-.1.4l-.4.5c-.1.2-.3.3-.1.6a7 7 0 0 0 3 2.6c.3.1.5.1.6 0l.6-.7c.2-.2.3-.2.5-.1l1.6.8c.2.1.4.2.4.3v.9c-.1.3-.6.8-1.1.9-.5.1-1 .1-3.3-.8a10 10 0 0 1-4.3-3.9C8 10.6 8 10 8.3 9.6l.5-.7Z"/>',
    star: '<path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9L12 3.5Z"/>',
    verified:
      '<path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h10"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    /* category icons */
    droplet: '<path d="M12 3s6 6.6 6 10.5A6 6 0 0 1 6 13.5C6 9.6 12 3 12 3Z"/>',
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 1 0 5 5L21 12l-7 7-3-3-2 2-3-3 3-3-2-2 3-3 2 2 2.7-2.7Z"/>',
    scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 18M8 16.5 20 6"/>',
    hammer: '<path d="m14 6 4-4 4 4-4 4-2-2-6 6-4-4 6-6-2-2"/><path d="m4 18 2 2"/>',
    shield: '<path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3Z"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2V5Z"/><path d="M8 7h7M8 11h7"/>',
    car: '<path d="M5 16h14M4 16v3h2v-3m12 0v3h2v-3"/><path d="M6 16 7.5 8h9L18 16"/><circle cx="7.5" cy="18" r="1"/><circle cx="16.5" cy="18" r="1"/>',
    truck: '<path d="M3 7h10v9H3z"/><path d="M13 11h4l3 3v2h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    heart: '<path d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.6c0 5-7 9.4-7 9.4Z"/>',
    brush: '<path d="M14 4l6 6-8 8-6-6 8-8Z"/><path d="M6 14l-2 6 6-2"/>'
  };

  function icon(name, { size = 20, className = '' } = {}) {
    const path = PATHS[name] || PATHS.grid;
    return (
      '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"' +
      (className ? ' class="' + className + '"' : '') +
      '>' + path + '</svg>'
    );
  }

  /* --------------------------------------------------------------- API */

  async function request(path, { params, method = 'GET', body } = {}) {
    const url = new URL(path, window.location.origin);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, value);
      }
    }
    const options = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url.pathname + url.search, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      throw new Error('The server returned an unreadable response.');
    }
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload && payload.error ? payload.error : 'Request failed');
      error.status = response.status;
      error.code = payload && payload.code;
      error.details = payload && payload.details;
      throw error;
    }
    return payload;
  }

  const api = {
    get: (path, params) => request(path, { params }),
    post: (path, body) => request(path, { method: 'POST', body: body || {} }),
    meta: () => request('/api/v1/meta'),
    home: () => request('/api/v1/home'),
    categories: (params) => request('/api/v1/categories', { params }),
    services: (params) => request('/api/v1/services', { params }),
    search: (params) => request('/api/v1/search', { params }),
    provider: (slug) => request('/api/v1/providers/' + encodeURIComponent(slug)),
    resolve: (params) => request('/api/v1/locations/resolve', { params }),
    me: () => request('/api/v1/auth/me'),
    login: (body) => request('/api/v1/auth/login', { method: 'POST', body }),
    register: (body) => request('/api/v1/auth/register', { method: 'POST', body }),
    logout: () => request('/api/v1/auth/logout', { method: 'POST', body: {} }),
    createProvider: (body) => request('/api/v1/providers', { method: 'POST', body })
  };

  /* ----------------------------------------------------------- formatting */

  const format = {
    /** Paise (integer) → "₹1,299". Returns null for missing prices. */
    money(paise) {
      if (paise === null || paise === undefined) return null;
      const rupees = Math.round(Number(paise) / 100);
      return '₹' + rupees.toLocaleString('en-IN');
    },
    priceRange(from, to, unit) {
      const low = format.money(from);
      const high = format.money(to);
      if (!low && !high) return null;
      const suffix = unit && unit !== 'visit' ? '/' + unit : '';
      if (low && high && low !== high) return low + ' – ' + high + suffix;
      return (low || high) + (suffix || (unit === 'visit' ? '' : ''));
    },
    phone(value) {
      const digits = String(value || '').replace(/\D/g, '').slice(-10);
      if (digits.length !== 10) return String(value || '');
      return '+91 ' + digits.slice(0, 5) + ' ' + digits.slice(5);
    },
    rating(value, count) {
      if (!count) return 'New';
      return Number(value || 0).toFixed(1);
    },
    verification(level) {
      return { trusted: 'Verified', document: 'ID checked', phone: 'Phone verified', unverified: 'Unverified' }[level] || 'Unverified';
    },
    initials(name) {
      return String(name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0].toUpperCase())
        .join('');
    }
  };

  /* --------------------------------------------------------------- shell */

  const NAV = [
    { label: 'Home', href: '/', icon: 'home' },
    { label: 'Services', href: '/#categories', icon: 'grid' },
    { label: 'Search', href: '/search.html', icon: 'search' },
    { label: 'Account', href: '/account.html', icon: 'user' }
  ];

  function currentPath() {
    return window.location.pathname.replace(/index\.html$/, '');
  }

  function isCurrent(item) {
    if (item.href === '/') return currentPath() === '/' || currentPath() === '';
    return currentPath().indexOf(item.href.split('#')[0]) === 0;
  }

  function headerMarkup() {
    return (
      '<header class="site-header">' +
      '<div class="container site-header__bar">' +
      '<a class="brand" href="/" aria-label="SEVA MARKET INDIA — home">' +
      '<svg class="brand__mark" viewBox="0 0 40 40" aria-hidden="true">' +
      '<rect width="40" height="40" rx="10" fill="#123c8f"/>' +
      '<path d="M9 26.5 20 10l11 16.5" fill="none" stroke="#ff7a1a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="20" cy="29.5" r="2.6" fill="#fff"/>' +
      '</svg>' +
      '<span class="brand__text"><span class="brand__name">SEVA MARKET</span>' +
      '<span class="brand__tag">INDIA</span></span>' +
      '</a>' +
      '<nav class="main-nav" aria-label="Primary">' +
      '<ul class="main-nav__list">' +
      NAV.map(function (item) {
        return (
          '<li><a class="main-nav__link" href="' + item.href + '"' +
          (isCurrent(item) ? ' aria-current="page"' : '') +
          '>' + item.label + '</a></li>'
        );
      }).join('') +
      '</ul></nav>' +
      '<div class="header__actions">' +
      '<a class="btn btn--sm btn--accent only-desktop" href="/account.html#provider">List your business</a>' +
      '<button class="icon-button menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="seva-drawer">' +
      icon('menu') + '</button>' +
      '</div></div></header>'
    );
  }

  function drawerMarkup() {
    return (
      '<div class="drawer" id="seva-drawer" data-open="false">' +
      '<button class="drawer__backdrop" type="button" aria-label="Close menu"></button>' +
      '<div class="drawer__panel" role="dialog" aria-modal="true" aria-label="Menu">' +
      '<div class="row row-between">' +
      '<span class="strong">Menu</span>' +
      '<button class="icon-button" type="button" data-close-drawer aria-label="Close menu">' + icon('close') + '</button>' +
      '</div>' +
      '<p class="drawer__title mt-4">Browse</p>' +
      '<ul class="drawer__list">' +
      NAV.map(function (item) {
        return '<li><a href="' + item.href + '">' + item.label + '</a></li>';
      }).join('') +
      '<li><a href="/account.html#provider">List your business</a></li>' +
      '</ul>' +
      '<div data-account-slot></div>' +
      '</div></div>'
    );
  }

  function bottomNavMarkup() {
    return (
      '<nav class="bottom-nav" aria-label="Sections">' +
      NAV.map(function (item) {
        return (
          '<a class="bottom-nav__item" href="' + item.href + '"' +
          (isCurrent(item) ? ' aria-current="page"' : '') +
          '>' + icon(item.icon, { size: 21 }) + '<span>' + item.label + '</span></a>'
        );
      }).join('') +
      '</nav>'
    );
  }

  function footerMarkup() {
    return (
      '<footer class="site-footer">' +
      '<div class="container">' +
      '<div class="site-footer__grid">' +
      '<div>' +
      '<h3>SEVA MARKET INDIA</h3>' +
      '<p class="small">India-wide local services marketplace. Find trusted providers by service, city, locality or PIN code — free for customers.</p>' +
      '</div>' +
      '<div><h3>Popular services</h3><ul>' +
      '<li><a href="/search.html?service=tap-faucet-repair">Plumbing</a></li>' +
      '<li><a href="/search.html?service=ac-service-repair">AC &amp; Appliance Repair</a></li>' +
      '<li><a href="/search.html?service=full-home-deep-cleaning">Home Deep Cleaning</a></li>' +
      '<li><a href="/search.html?service=home-tutor-primary">Home Tutors</a></li>' +
      '</ul></div>' +
      '<div><h3>Company</h3><ul>' +
      '<li><a href="/#how">How it works</a></li>' +
      '<li><a href="/#for-providers">For service providers</a></li>' +
      '<li><a href="/account.html">Sign in / Register</a></li>' +
      '<li><a href="/search.html">Browse providers</a></li>' +
      '</ul></div>' +
      '</div>' +
      '<p class="site-footer__bottom">© <span data-year></span> SEVA MARKET INDIA · Built in India 🇮🇳 · No payments are processed on this site.</p>' +
      '</div></footer>'
    );
  }

  function mountShell() {
    const headerSlot = document.getElementById('siteHeader');
    const footerSlot = document.getElementById('siteFooter');
    const navSlot = document.getElementById('bottomNav');

    if (headerSlot) headerSlot.innerHTML = headerMarkup();
    if (footerSlot) footerSlot.innerHTML = footerMarkup();
    if (navSlot) navSlot.innerHTML = bottomNavMarkup();
    if (headerSlot) {
      const drawer = document.createElement('div');
      drawer.innerHTML = drawerMarkup();
      document.body.appendChild(drawer.firstElementChild);
      wireDrawer();
    }

    const yearSlot = document.querySelector('[data-year]');
    if (yearSlot) yearSlot.textContent = String(new Date().getFullYear());

    refreshSession();
  }

  function wireDrawer() {
    const drawer = document.getElementById('seva-drawer');
    if (!drawer) return;
    const toggle = document.querySelector('.menu-toggle');
    const close = () => {
      drawer.setAttribute('data-open', 'false');
      document.body.classList.remove('drawer-open');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      drawer.setAttribute('data-open', 'true');
      document.body.classList.add('drawer-open');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
      const first = drawer.querySelector('a, button');
      if (first) first.focus();
    };
    if (toggle) toggle.addEventListener('click', () => (drawer.getAttribute('data-open') === 'true' ? close() : open()));
    drawer.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-drawer]') || event.target.classList.contains('drawer__backdrop')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && drawer.getAttribute('data-open') === 'true') close();
    });
    drawer.addEventListener('click', (event) => {
      if (event.target.tagName === 'A') close();
    });
  }

  /* ------------------------------------------------------------- session */

  const state = { session: null };

  async function refreshSession() {
    try {
      const payload = await api.me();
      state.session = payload.user;
    } catch (_) {
      state.session = null;
    }
    renderSession();
    return state.session;
  }

  function renderSession() {
    const slot = document.querySelector('[data-account-slot]');
    if (!slot) return;
    if (state.session) {
      slot.innerHTML =
        '<p class="drawer__title">Account</p>' +
        '<p class="small strong mb-0">' + escapeHtml(state.session.name || state.session.email) + '</p>' +
        '<p class="small muted mb-3">' + escapeHtml(state.session.email) + '</p>' +
        '<button class="btn btn--sm btn--ghost btn--block" type="button" data-logout>' +
        icon('logout', { size: 16 }) + ' Sign out</button>';
      const button = slot.querySelector('[data-logout]');
      if (button) {
        button.addEventListener('click', async () => {
          try {
            await api.logout();
          } catch (_) {
            /* clearing locally is enough */
          }
          state.session = null;
          renderSession();
          window.location.reload();
        });
      }
    } else {
      slot.innerHTML =
        '<p class="drawer__title">Account</p>' +
        '<a class="btn btn--sm btn--block" href="/account.html">Sign in / Register</a>';
    }
  }

  /* -------------------------------------------------------------- helpers */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function errorMessage(error, fallback) {
    if (!error) return fallback;
    if (error.details && error.details.fields) {
      return Object.values(error.details.fields).join(' · ');
    }
    return error.message || fallback;
  }

  function providerCard(provider) {
    const rating = format.rating(provider.rating, provider.rating_count);
    const services = (provider.services || []).slice(0, 3);
    const place = provider.location || {};
    const where = [place.locality && place.locality.name, place.city && place.city.name, place.state && place.state.name]
      .filter(Boolean)
      .join(', ');

    return (
      '<article class="provider-card">' +
      '<div class="provider-card__head">' +
      '<div class="provider-card__avatar" aria-hidden="true">' + escapeHtml(format.initials(provider.business_name)) + '</div>' +
      '<div><h3 class="provider-card__title"><a href="/provider.html?p=' + encodeURIComponent(provider.slug) + '">' +
      escapeHtml(provider.business_name) + '</a></h3>' +
      '<p class="provider-card__sub">' + escapeHtml(where || 'India') + '</p></div>' +
      '</div>' +
      '<div class="row row-wrap small">' +
      '<span class="rating' + (provider.rating ? '' : ' rating--empty') + '">' + icon('star', { size: 14 }) + ' ' + escapeHtml(rating) +
      (provider.rating_count ? ' <span class="muted">(' + provider.rating_count + ')</span>' : '') + '</span>' +
      '<span class="chip chip--ok">' + icon('verified', { size: 13 }) + ' ' + escapeHtml(format.verification(provider.verification_level)) + '</span>' +
      (provider.experience_years ? '<span class="chip">' + provider.experience_years + ' yrs</span>' : '') +
      '</div>' +
      '<div class="provider-card__tags">' +
      services.map(function (service) {
        return '<span class="chip">' + escapeHtml(service.name) + '</span>';
      }).join('') +
      '</div>' +
      '<div class="provider-card__foot">' +
      (provider.phone
        ? '<a class="btn btn--sm" href="tel:+91' + escapeHtml(String(provider.phone).replace(/\D/g, '').slice(-10)) + '">' +
          icon('phone', { size: 15 }) + ' Call</a>'
        : '') +
      (provider.phone
        ? '<a class="btn btn--sm btn--ghost" href="https://wa.me/91' + escapeHtml(String(provider.phone).replace(/\D/g, '').slice(-10)) +
          '" rel="noopener noreferrer" target="_blank">' + icon('whatsapp', { size: 15 }) + ' WhatsApp</a>'
        : '') +
      '<a class="btn btn--sm btn--ghost" href="/provider.html?p=' + encodeURIComponent(provider.slug) + '">Profile</a>' +
      '</div></article>'
    );
  }

  window.SEVA = { icon, api, format, escapeHtml, errorMessage, providerCard, refreshSession, state, mountShell };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountShell);
  } else {
    mountShell();
  }
})();
