/* ==========================================================================
   PANIKA JEEVAN SATHI — shared front-end library
   Auth, API client, site chrome (header / nav / footer), helpers.
   ========================================================================== */

(function () {
  'use strict';

  const PJS = {};
  window.PJS = PJS;

  PJS.site = null;
  PJS.me = null;
  PJS.counts = { messages: 0, notifications: 0, interests: 0, total: 0 };
  PJS.options = null;

  const readyQueue = [];
  let booted = false;

  /* --------------------------------------------------------------- icons */

  const I = {
    heart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z"/></svg>',
    rings:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="14" r="6"/><circle cx="15" cy="14" r="6"/><path d="M12 4.5 13.8 8h-3.6L12 4.5z"/></svg>',
    home:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V21h14V9.8"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
    chat:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8z"/></svg>',
    bell:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15V10a6 6 0 1 0-12 0v5l-2 3h16z"/><path d="M10 21h4"/></svg>',
    user:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    star:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.6H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.7 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.6 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.6H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
    shield:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v6c0 4.4 3 8 7 9 4-1 7-4.6 7-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    pin:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    cap:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-4 9 4-9 4z"/><path d="M7 11v4c0 1.7 2.2 3 5 3s5-1.3 5-3v-4"/></svg>',
    case:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2"/></svg>',
    whatsapp:
      '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3C9.4 3 4 8.3 4 14.9c0 2.6.8 5 2.3 7L4 29l7.3-2.2c1.5.8 3.1 1.2 4.7 1.2 6.6 0 12-5.3 12-11.9S22.6 3 16 3zm0 21.8c-1.6 0-3.1-.4-4.4-1.2l-.5-.3-4.3 1.3 1.3-4.1-.3-.5a9.7 9.7 0 1 1 8.2 4.8zm5.4-7.2c-.3-.2-1.8-.9-2-1-.3-.1-.5-.2-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.1-.2.2-.3.3-.5 0-.2 0-.4-.1-.5l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.3 5.2 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.3-.6-.4z"/></svg>',
    logout:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/></svg>',
    edit:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="m14 6 4 4"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    flag:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h11l-1.5 4H20l-2 5H5"/></svg>',
    inbox:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13h4l2 3h4l2-3h4"/><path d="M4 13 6 5h12l2 8v6H4z"/></svg>',
    users:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.4 3.5-5 6.5-5s5.5 1.6 6.5 5"/><path d="M17 5.5a3.5 3.5 0 0 1 0 7M18.5 15.5c2 .7 3.3 2.2 3.8 4.5"/></svg>'
  };
  PJS.icons = I;

  /* ------------------------------------------------------------- helpers */

  PJS.esc = function (value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  PJS.qs = function (name) {
    return new URLSearchParams(window.location.search).get(name);
  };

  PJS.initials = function (name) {
    const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
  };

  const fmtDate = (ts, opts) =>
    new Date(ts).toLocaleDateString('en-IN', opts || { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  PJS.fmt = {
    date: fmtDate,
    time: fmtTime,
    dateTime: (ts) => `${fmtDate(ts)} · ${fmtTime(ts)}`,
    ago(ts) {
      if (!ts) return '';
      const diff = Date.now() - ts;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins} min ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs} hr ago`;
      const days = Math.floor(hrs / 24);
      if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
      return fmtDate(ts);
    },
    height(cm) {
      if (!cm) return '';
      const totalIn = Math.round(cm / 2.54);
      const ft = Math.floor(totalIn / 12);
      const inch = totalIn % 12;
      return `${ft}'${inch}" (${cm} cm)`;
    },
    age(a) {
      return a ? `${a} yrs` : '';
    }
  };

  /* ------------------------------------------------------------ api client */

  PJS.api = async function (method, urlPath, body) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(urlPath, options);
    } catch (err) {
      return { ok: false, status: 0, error: 'Network error. Please check your connection.' };
    }
    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      json = null;
    }
    if (!json) json = { ok: res.ok, error: res.ok ? '' : `Request failed (${res.status})` };
    json.status = res.status;
    return json;
  };

  PJS.get = (p) => PJS.api('GET', p);
  PJS.post = (p, b) => PJS.api('POST', p, b || {});
  PJS.put = (p, b) => PJS.api('PUT', p, b || {});
  PJS.patch = (p, b) => PJS.api('PATCH', p, b || {});
  PJS.del = (p, b) => PJS.api('DELETE', p, b || {});

  /* ---------------------------------------------------------------- toast */

  PJS.toast = function (message, type) {
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

  /* ---------------------------------------------------------------- modal */

  PJS.openModal = function (html, onMount) {
    let back = document.querySelector('.modal-back');
    if (!back) {
      back = document.createElement('div');
      back.className = 'modal-back';
      document.body.appendChild(back);
      back.addEventListener('click', (e) => {
        if (e.target === back) PJS.closeModal();
      });
    }
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    back.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (onMount) onMount(back.querySelector('.modal'));
    return back;
  };

  PJS.closeModal = function () {
    const back = document.querySelector('.modal-back');
    if (back) {
      back.classList.remove('open');
      back.innerHTML = '';
    }
    document.body.style.overflow = '';
  };

  PJS.confirm = function (title, message, confirmLabel, danger) {
    return new Promise((resolve) => {
      PJS.openModal(
        `<h3>${PJS.esc(title)}</h3>
         <p class="muted">${PJS.esc(message)}</p>
         <div class="btn-row" style="justify-content:flex-end;margin-top:18px">
           <button class="btn ghost" data-x="cancel">Cancel</button>
           <button class="btn ${danger ? 'danger' : ''}" data-x="ok">${PJS.esc(confirmLabel || 'Confirm')}</button>
         </div>`,
        (modal) => {
          modal.querySelector('[data-x="cancel"]').onclick = () => {
            PJS.closeModal();
            resolve(false);
          };
          modal.querySelector('[data-x="ok"]').onclick = () => {
            PJS.closeModal();
            resolve(true);
          };
        }
      );
    });
  };

  /* --------------------------------------------------------------- avatar */

  PJS.avatar = function (name, photo, cls) {
    if (photo) return `<span class="avatar ${cls || ''}"><img src="${PJS.esc(photo)}" alt="${PJS.esc(name)}" loading="lazy"></span>`;
    return `<span class="avatar ${cls || ''}">${PJS.esc(PJS.initials(name))}</span>`;
  };

  /* ---------------------------------------------------------------- chrome */

  const NAV = [
    { href: '/dashboard.html', label: 'Dashboard', icon: 'home' },
    { href: '/matches.html', label: 'Matches', icon: 'rings' },
    { href: '/search.html', label: 'Search', icon: 'search' },
    { href: '/interests.html', label: 'Interests', icon: 'heart', badge: 'interests' },
    { href: '/messages.html', label: 'Messages', icon: 'chat', badge: 'messages' },
    { href: '/shortlist.html', label: 'Shortlist', icon: 'star' }
  ];

  const MOBILE_NAV = [
    { href: '/dashboard.html', label: 'Home', icon: 'home' },
    { href: '/matches.html', label: 'Matches', icon: 'rings' },
    { href: '/messages.html', label: 'Messages', icon: 'chat', badge: 'messages' },
    { href: '/interests.html', label: 'Interests', icon: 'heart', badge: 'interests' },
    { href: '/dashboard.html#profile', label: 'Profile', icon: 'user' }
  ];

  function brandHtml() {
    return `<a class="brand" href="${PJS.me ? '/dashboard.html' : '/index.html'}">
      <span class="brand-mark">${I.rings}</span>
      <span>
        <span class="brand-name">${PJS.esc((PJS.site && PJS.site.site_name) || 'PANIKA JEEVAN SATHI')}</span>
        <span class="brand-sub">100% Free Matrimonial</span>
      </span>
    </a>`;
  }

  function renderHeader() {
    const holder = document.getElementById('siteHeader');
    if (!holder) return;
    const current = window.location.pathname;
    if (!PJS.me) {
      holder.innerHTML = `<header class="site-header"><div class="bar">${brandHtml()}
        <div class="header-cta">
          <a class="btn ghost sm" href="/login.html">Log in</a>
          <a class="btn sm" href="/login.html?tab=register">Register free</a>
        </div></div></header>`;
      return;
    }
    const links = NAV.map((item) => {
      const active = current === item.href ? ' active' : '';
      const badgeKey = item.badge;
      const badge = badgeKey && PJS.counts[badgeKey] ? `<span class="nav-badge" data-badge="${badgeKey}">${PJS.counts[badgeKey]}</span>` : '';
      return `<a href="${item.href}" class="${active.trim()}">${item.label}${badge}</a>`;
    }).join('');
    const extra = PJS.me.role === 'admin' ? `<a href="/admin.html" class="${current === '/admin.html' ? 'active' : ''}">Admin</a>` : '';
    holder.innerHTML = `<header class="site-header"><div class="bar">${brandHtml()}
      <nav class="nav-desktop">${links}${extra}
        <a href="/notifications.html" class="${current === '/notifications.html' ? 'active' : ''}">Alerts${
          PJS.counts.notifications ? `<span class="nav-badge">${PJS.counts.notifications}</span>` : ''
        }</a>
      </nav>
      <div class="header-cta" style="margin-left:0">
        <a class="btn ghost sm" href="/edit-profile.html">${I.edit} Edit profile</a>
        <button class="avatar-btn" id="accountBtn" aria-label="Account">
          ${PJS.me.photo ? `<img src="${PJS.esc(PJS.me.photo)}" alt="">` : PJS.esc(PJS.initials(PJS.me.name))}
          ${PJS.counts.total ? '<span class="dot"></span>' : ''}
        </button>
        <button class="menu-btn" id="menuBtn" aria-label="Menu"><span></span></button>
      </div></div></header>
      <div class="drawer" id="drawer"><div class="drawer-panel">
        <div class="row mb-2">${PJS.avatar(PJS.me.name, PJS.me.photo)}
          <div><b>${PJS.esc(PJS.me.name)}</b><div class="tiny muted">${PJS.esc(PJS.me.email)}</div></div>
        </div>
        <a href="/dashboard.html">${I.home} Dashboard</a>
        <a href="/edit-profile.html">${I.edit} My profile</a>
        <a href="/matches.html">${I.rings} Recommended matches</a>
        <a href="/search.html">${I.search} Search profiles</a>
        <a href="/interests.html">${I.heart} Interests ${PJS.counts.interests ? `<span class="badge">${PJS.counts.interests}</span>` : ''}</a>
        <a href="/messages.html">${I.chat} Messages ${PJS.counts.messages ? `<span class="badge">${PJS.counts.messages}</span>` : ''}</a>
        <a href="/shortlist.html">${I.star} Shortlist</a>
        <a href="/notifications.html">${I.bell} Notifications ${PJS.counts.notifications ? `<span class="badge">${PJS.counts.notifications}</span>` : ''}</a>
        <div class="sep"></div>
        <a href="/contact.html">${I.whatsapp} Contact / WhatsApp</a>
        ${PJS.me.role === 'admin' ? `<a href="/admin.html">${I.shield} Admin panel</a>` : ''}
        <a href="/settings.html">${I.settings} Settings</a>
        <a href="#" id="drawerLogout">${I.logout} Log out</a>
      </div></div>`;

    const drawer = document.getElementById('drawer');
    document.getElementById('menuBtn').onclick = () => drawer.classList.add('open');
    drawer.onclick = (e) => {
      if (e.target === drawer) drawer.classList.remove('open');
    };
    document.getElementById('drawerLogout').onclick = (e) => {
      e.preventDefault();
      PJS.logout();
    };
    document.getElementById('accountBtn').onclick = () => {
      window.location.href = '/settings.html';
    };
  }

  function renderBottomNav() {
    const holder = document.getElementById('bottomNav');
    if (!holder) return;
    if (!PJS.me) {
      holder.innerHTML = '';
      return;
    }
    const current = window.location.pathname;
    holder.innerHTML = `<nav class="bottom-nav">${MOBILE_NAV.map((item) => {
      const active = current === item.href.split('#')[0] ? ' active' : '';
      const badge = item.badge && PJS.counts[item.badge]
        ? `<span class="b-dot">${PJS.counts[item.badge] > 9 ? '9+' : PJS.counts[item.badge]}</span>`
        : '';
      return `<a href="${item.href}" class="${active.trim()}">${I[item.icon]}<span>${item.label}</span>${badge}</a>`;
    }).join('')}</nav>`;
  }

  function renderFooter() {
    const holder = document.getElementById('siteFooter');
    if (!holder) return;
    const s = PJS.site || {};
    holder.innerHTML = `<footer class="site-footer"><div class="container">
      <div class="footer-grid">
        <div>
          <div class="row mb-2" style="color:#fff">
            <span class="brand-mark">${I.rings}</span>
            <span><b style="font-family:var(--serif);font-size:16px">${PJS.esc(s.site_name || 'PANIKA JEEVAN SATHI')}</b>
            <span class="brand-sub" style="color:#e0c98f;display:block">Community matrimonial service</span></span>
          </div>
          <p style="color:#dcc6d0;font-size:14px;max-width:38ch">${PJS.esc(s.tagline || '')}</p>
          <span class="free-pill">${I.check} Everything free · No hidden charges</span>
        </div>
        <div>
          <h4>Members</h4>
          <a href="${PJS.me ? '/dashboard.html' : '/login.html?tab=register'}">Dashboard</a>
          <a href="${PJS.me ? '/search.html' : '/login.html?tab=register'}">Search profiles</a>
          <a href="${PJS.me ? '/matches.html' : '/login.html?tab=register'}">Recommended matches</a>
          <a href="${PJS.me ? '/messages.html' : '/login.html'}">Messages</a>
          <a href="/login.html?tab=forgot">Forgot password</a>
        </div>
        <div>
          <h4>Support</h4>
          <a href="/contact.html">Contact us</a>
          <a href="/about.html">About us</a>
          <a href="/privacy.html">Privacy policy</a>
          <a href="/terms.html">Terms of use</a>
          <a href="https://wa.me/${PJS.esc(s.whatsapp_number || '918099834725')}?text=${encodeURIComponent('Hello PANIKA JEEVAN SATHI, I need help.')}" target="_blank" rel="noopener">WhatsApp support</a>
          <a href="https://www.producthunt.com/products?q=PANIKA%20JEEVAN%20SATHI" target="_blank" rel="noopener">Product Hunt</a>
          <a href="https://github.com/Spanika4321/panika-jeevan-sathi" target="_blank" rel="noopener">GitHub</a>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} ${PJS.esc(s.site_name || 'PANIKA JEEVAN SATHI')}. ${PJS.esc(s.footer_note || '')}</span>
        <span>Support: ${PJS.esc(s.whatsapp_display || '+91 80998 34725')}</span>
      </div>
    </div></footer>`;
  }

  function renderWhatsApp() {
    if (document.getElementById('whatsappFloat')) return;
    const s = PJS.site || {};
    const a = document.createElement('a');
    a.id = 'whatsappFloat';
    a.className = 'whatsapp-float';
    a.target = '_blank';
    a.rel = 'noopener';
    a.href = `https://wa.me/${s.whatsapp_number || '918099834725'}?text=${encodeURIComponent(
      `Hello ${s.site_name || 'PANIKA JEEVAN SATHI'} team, I need help with my matrimonial profile.`
    )}`;
    a.setAttribute('aria-label', 'Chat on WhatsApp');
    a.innerHTML = I.whatsapp;
    document.body.appendChild(a);
  }

  /* ----------------------------------------------------------------- boot */

  PJS.requireAuth = function () {
    if (!PJS.me) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?next=${next}`);
      return false;
    }
    return true;
  };

  PJS.logout = async function () {
    await PJS.post('/api/auth/logout');
    window.location.href = '/index.html?loggedout=1';
  };

  async function refreshCounts() {
    if (!PJS.me) return;
    const res = await PJS.get('/api/unread');
    if (res.ok) {
      PJS.counts = res.counts;
      document.querySelectorAll('[data-badge]').forEach((el) => {
        const key = el.getAttribute('data-badge');
        el.textContent = PJS.counts[key] || '';
        el.classList.toggle('hide', !PJS.counts[key]);
      });
      const ev = new CustomEvent('pjs:counts', { detail: PJS.counts });
      window.dispatchEvent(ev);
    }
  }

  PJS.refreshCounts = refreshCounts;

  PJS.whatsAppLink = function (message) {
    const number = (PJS.site && PJS.site.whatsapp_number) || '918099834725';
    return `https://wa.me/${number}?text=${encodeURIComponent(
      message || `Hello ${((PJS.site && PJS.site.site_name) || 'PANIKA JEEVAN SATHI')} team, I need help.`
    )}`;
  };

  PJS.onReady = function (fn) {
    if (booted) fn();
    else readyQueue.push(fn);
  };

  async function boot() {
    document.documentElement.style.scrollBehavior = 'smooth';
    const [siteRes, meRes] = await Promise.all([PJS.get('/api/site'), PJS.get('/api/me')]);
    if (siteRes && siteRes.ok) {
      PJS.site = siteRes.site;
      PJS.options = siteRes.options;
    }
    if (meRes && meRes.ok) {
      PJS.me = meRes.user;
      PJS.me.profile = meRes.profile;
      PJS.completeness = meRes.completeness;
      PJS.counts = meRes.counts || PJS.counts;
    } else {
      PJS.me = null;
    }

    const title = document.title;
    if (PJS.site && title && !title.includes(PJS.site.site_name)) {
      document.title = title;
    }

    renderHeader();
    renderFooter();
    renderBottomNav();
    renderWhatsApp();

    booted = true;
    readyQueue.splice(0).forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    });

    if (PJS.me) {
      setInterval(refreshCounts, 20000);
      window.addEventListener('focus', refreshCounts);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
