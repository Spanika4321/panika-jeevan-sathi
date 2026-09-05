/* ==========================================================================
   SEVA MARKET INDIA — shared front-end library
   Icons, API client, page chrome (header / footer), formatting helpers.
   ========================================================================== */

(function () {
  'use strict';

  const SMI = {};
  window.SMI = SMI;

  SMI.site = null;
  SMI.me = null;
  SMI.categories = [];
  SMI.cities = [];

  /* ------------------------------------------------------------------ icons */
  const svg = (paths, size) =>
    `<svg viewBox="0 0 24 24" width="${size || 24}" height="${size || 24}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

  const ICONS = {
    brand: '<path d="M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    tick: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    star: '<path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L3.6 9.8l6.5-.9z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
    briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 12h18"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    home: '<path d="M4 11l8-7 8 7v9a2 2 0 01-2 2H6a2 2 0 01-2-2z"/>',
    logout: '<path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M12 3H6a2 2 0 00-2 2v14a2 2 0 002 2h6"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>',
    chat: '<path d="M21 12a8 8 0 01-8 8H8l-5 3 1.5-4.5A8 8 0 1121 12z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    inbox: '<path d="M3 13h5l1 3h6l1-3h5"/><path d="M5 5h14l2 8v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z"/>',
    tools: '<path d="M14 6l4 4-8 8-4-4z"/><path d="M6 6l3 3"/><path d="M17 3l4 4-2 2-4-4z"/>'
  };

  const CATEGORY_ICONS = {
    plumbing: '<path d="M12 3c3 3.5 4 6 4 8a4 4 0 01-8 0c0-2 1-4.5 4-8z"/><path d="M7 20h10"/>',
    electrical: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    'ac-repair': '<path d="M3 6h18v7a3 3 0 01-3 3h-1l-1 4h-4l1-4H9l1 4H6l1-4H6a3 3 0 01-3-3z"/><path d="M7 10h10"/>',
    cleaning: '<path d="M9 3h6l1 3H8z"/><path d="M6 6h12l-1 15H7z"/><path d="M9 12l2 2 4-4"/>',
    'pest-control': '<circle cx="12" cy="12" r="7"/><path d="M9 9l6 6M15 9l-6 6"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
    carpentry: '<path d="M4 20l6-16 4 4-4 4 4 4z"/><path d="M14 20l6-8"/>',
    painting: '<path d="M4 20h16"/><path d="M7 20V9l5-5 5 5v11"/><path d="M12 14h.01"/>',
    'salon-at-home': '<path d="M6 21c0-4 3-7 6-7s6 3 6 7"/><circle cx="12" cy="7" r="4"/>',
    appliance: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="14" r="4"/><path d="M8 7h2"/>',
    'packers-movers': '<rect x="3" y="8" width="12" height="10" rx="1"/><path d="M15 12h4l2 3v3h-6z"/><circle cx="7" cy="19" r="1.6"/><circle cx="18" cy="19" r="1.6"/>',
    tutoring: '<path d="M3 6l9-3 9 3-9 3z"/><path d="M7 9v5c0 1.5 2.2 3 5 3s5-1.5 5-3V9"/><path d="M12 17v4"/>',
    'vehicle-service': '<path d="M5 16h14v-4l-2-5H7L5 12z"/><circle cx="8" cy="18" r="1.8"/><circle cx="16" cy="18" r="1.8"/><path d="M5 12h14"/>'
  };

  SMI.icon = (name, size) => svg(ICONS[name] || '', size || 24);
  SMI.categoryIcon = (slug, size) => svg(CATEGORY_ICONS[slug] || CATEGORY_ICONS.tools, size || 24);

  /* -------------------------------------------------------------- helpers */
  SMI.esc = function (value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  SMI.money = (value) => '₹' + Number(value || 0).toLocaleString('en-IN');

  SMI.initials = function (name) {
    const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
  };

  SMI.stars = function (rating) {
    const value = Math.round(Number(rating) || 0);
    return '★★★★★'.slice(0, value) + '☆☆☆☆☆'.slice(0, 5 - value);
  };

  SMI.qs = (name) => new URLSearchParams(window.location.search).get(name);

  SMI.fmtDate = (value) => {
    const time = Date.parse(value);
    return Number.isFinite(time)
      ? new Date(time).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : String(value || '');
  };

  SMI.ago = function (value) {
    const time = Number(value);
    if (!Number.isFinite(time) || !time) return '';
    const days = Math.floor((Date.now() - time) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? 'last month' : `${months} months ago`;
  };

  SMI.statusBadge = function (status) {
    const map = {
      requested: ['badge-amber', 'Requested'],
      accepted: ['badge-blue', 'Accepted'],
      completed: ['badge', 'Completed'],
      cancelled: ['badge-grey', 'Cancelled'],
      declined: ['badge-red', 'Declined'],
      pending: ['badge-amber', 'Pending approval'],
      approved: ['badge', 'Approved'],
      suspended: ['badge-red', 'Suspended']
    };
    const entry = map[status] || ['badge-grey', String(status || '')];
    return `<span class="badge ${entry[0]}">${SMI.esc(entry[1])}</span>`;
  };

  /* ----------------------------------------------------------- api client */
  SMI.api = async function (method, urlPath, body) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SMI' },
      credentials: 'same-origin'
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(urlPath, options);
    } catch (_) {
      return { ok: false, status: 0, error: 'Network error. Please check your connection.' };
    }
    let json = null;
    try { json = await res.json(); } catch (_) { json = null; }
    if (!json) json = { ok: res.ok, error: res.ok ? '' : `Request failed (${res.status})` };
    json.status = res.status;
    return json;
  };

  SMI.get = (p) => SMI.api('GET', p);
  SMI.post = (p, b) => SMI.api('POST', p, b || {});
  SMI.put = (p, b) => SMI.api('PUT', p, b || {});
  SMI.patch = (p, b) => SMI.api('PATCH', p, b || {});

  /* ------------------------------------------------------------- toasts */
  SMI.toast = function (message, type) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = `toast ${type || ''}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 320);
    }, 3600);
  };

  /* --------------------------------------------------------------- chrome */
  const NAV = [
    { href: '/', label: 'Home' },
    { href: '/services.html', label: 'Services' },
    { href: '/providers.html', label: 'Professionals' },
    { href: '/about.html', label: 'About' },
    { href: '/contact.html', label: 'Contact' }
  ];

  function headerHtml() {
    const path = window.location.pathname.replace(/index\.html$/, '');
    const links = NAV.map((item) => {
      const active = item.href === '/' ? path === '/' : path.startsWith(item.href.replace('.html', ''));
      return `<a href="${item.href}" class="${active ? 'active' : ''}">${SMI.esc(item.label)}</a>`;
    }).join('');

    let account;
    if (!SMI.me) {
      account = `<a class="btn btn-ghost btn-sm" href="/login.html">Log in</a>
                 <a class="btn btn-primary btn-sm" href="/login.html?tab=register">Join as pro</a>`;
    } else if (SMI.me.role === 'admin') {
      account = `<a class="btn btn-ghost btn-sm" href="/admin.html">Admin</a>
                 <button class="btn btn-ghost btn-sm" data-x="logout">Log out</button>`;
    } else if (SMI.me.role === 'provider') {
      account = `<a class="btn btn-ghost btn-sm" href="/provider-dashboard.html">My jobs</a>
                 <button class="btn btn-ghost btn-sm" data-x="logout">Log out</button>`;
    } else {
      account = `<a class="btn btn-ghost btn-sm" href="/dashboard.html">My bookings</a>
                 <button class="btn btn-ghost btn-sm" data-x="logout">Log out</button>`;
    }

    return `
      <div class="container bar">
        <a class="brand" href="/">
          <span class="brand-mark">${SMI.icon("brand")}</span>
          <span>
            <span class="brand-name">SEVA MARKET</span><br>
            <span class="brand-sub">India</span>
          </span>
        </a>
        <nav class="nav">${links}</nav>
        <div class="header-cta">${account}</div>
        <button class="menu-btn" data-x="menu" aria-label="Menu"><span></span></button>
      </div>
      <div class="drawer" data-x="drawer">
        <div class="drawer-panel">
          ${NAV.map((i) => `<a href="${i.href}">${SMI.esc(i.label)}</a>`).join('')}
          <div class="sep"></div>
          ${SMI.me
            ? (SMI.me.role === 'provider'
                ? '<a href="/provider-dashboard.html">My jobs</a>'
                : SMI.me.role === 'admin' ? '<a href="/admin.html">Admin panel</a>' : '<a href="/dashboard.html">My bookings</a>')
            : '<a href="/login.html">Log in</a><a href="/login.html?tab=register">Join as professional</a>'}
          ${SMI.me ? '<a href="#" data-x="logout">Log out</a>' : ''}
        </div>
      </div>`;
  }

  function footerHtml() {
    const year = new Date().getFullYear();
    const cats = SMI.categories.slice(0, 6)
      .map((c) => `<a href="/providers.html?category=${encodeURIComponent(c.slug)}">${SMI.esc(c.name)}</a>`).join('');
    return `
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="footer-brand">
              <span class="brand-mark">${SMI.icon("brand")}</span>
              <span><strong>SEVA MARKET INDIA</strong></span>
            </div>
            <p class="small" style="color:#94a3b8;margin-top:14px">
              A marketplace for trusted local service professionals — transparent pricing,
              verified partners and a rework guarantee on every completed job.
            </p>
          </div>
          <div>
            <h4>Popular services</h4>
            ${cats || '<a href="/services.html">All services</a>'}
          </div>
          <div>
            <h4>Company</h4>
            <a href="/about.html">About us</a>
            <a href="/contact.html">Contact &amp; support</a>
            <a href="/terms.html">Terms of service</a>
            <a href="/privacy.html">Privacy policy</a>
          </div>
          <div>
            <h4>Get in touch</h4>
            <a href="tel:+918099834725">+91 80998 34725</a>
            <a href="mailto:support@sevamarketindia.in">support@sevamarketindia.in</a>
            <a href="/login.html?tab=register">Work with us</a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${year} SEVA MARKET INDIA. All rights reserved.</span>
          <span>Made in India 🇮🇳 · Pay only after the work is done.</span>
        </div>
      </div>`;
  }

  function wireChrome() {
    const header = document.getElementById('siteHeader');
    const footer = document.getElementById('siteFooter');
    if (header) header.innerHTML = headerHtml();
    if (footer) footer.innerHTML = footerHtml();

    document.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-x]');
      if (!target) return;
      const action = target.getAttribute('data-x');

      if (action === 'menu') {
        const drawer = document.querySelector('[data-x="drawer"]');
        if (drawer) drawer.classList.add('open');
      } else if (action === 'logout') {
        event.preventDefault();
        await SMI.post('/api/auth/logout');
        SMI.toast('Logged out.');
        setTimeout(() => { window.location.href = '/'; }, 400);
      }
    });

    document.addEventListener('click', (event) => {
      const drawer = document.querySelector('[data-x="drawer"]');
      if (drawer && event.target === drawer) drawer.classList.remove('open');
    });
  }

  /* ----------------------------------------------------------------- boot */
  SMI.boot = async function () {
    const site = await SMI.get('/api/site');
    if (site.ok) {
      SMI.site = site.site;
      SMI.categories = site.categories || [];
      SMI.cities = site.cities || [];
    }
    const me = await SMI.get('/api/me');
    if (me.ok) SMI.me = me.user;
    wireChrome();
    document.dispatchEvent(new CustomEvent('smi:ready'));
    return SMI;
  };

  SMI.ready = function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  };
}());
