'use strict';
/**
 * SEVA MARKET INDIA — sign-up, login, logout (server-rendered).
 *
 * Accounts are role-aware: customers hire, providers list. Registration is
 * open and free; a provider's business profile is created from the account
 * dashboard afterwards. Passwords are hashed with scrypt by the user model
 * and sessions are signed HttpOnly cookies (see src/auth/session.js).
 */

const { layout, esc } = require('../views/layout');
const { field, alertMarkup } = require('../views/ui');
const userModel = require('../models/user');
const { sessionCookie, clearCookie, claimsFor } = require('../auth/session');
const { assertSameOrigin } = require('../http/security');

/* ----------------------------------------------------- helpers --- */

/** Only allow redirect targets that stay on this site. */
function safePath(raw, fallback = '/account') {
  const value = String(raw || '').trim();
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value.slice(0, 500);
}

/** Failed-login throttle per IP: 8 tries, then a 15 minute cooldown. */
const loginAttempts = new Map();
function loginBlocked(ip) {
  const entry = loginAttempts.get(ip || '');
  return Boolean(entry && entry.blockedUntil && Date.now() < entry.blockedUntil);
}
function noteLoginFailure(ip) {
  const entry = loginAttempts.get(ip || '') || { fails: 0 };
  entry.fails += 1;
  if (entry.fails >= 8) entry.blockedUntil = Date.now() + 15 * 60 * 1000;
  loginAttempts.set(ip || '', entry);
}
function clearLoginFailures(ip) {
  loginAttempts.delete(ip || '');
}

/** Best-effort audit trail — never let a log write break the response. */
function logAudit(store, actorId, action, entity, entityId, detail) {
  Promise.resolve(store.audit.log({
    actor: actorId ? `user:${actorId}` : 'guest',
    action,
    entity,
    entityId,
    detail: JSON.stringify(detail || {}),
  })).catch(() => {});
}

function roleCardMarkup(role, checkedRole) {
  const isCustomer = role === 'customer';
  const checked = checkedRole === role ? ' checked' : '';
  return `
    <label class="role-card${checked ? ' role-card--on' : ''}">
      <input type="radio" name="role" value="${role}"${checked}>
      <span class="role-card__icon" aria-hidden="true">${isCustomer ? '🏠' : '🧰'}</span>
      <span class="role-card__body">
        <strong>${isCustomer ? 'I need services' : 'I provide services'}</strong>
        <span>${isCustomer ? 'Find & hire verified local pros' : 'List my business & get enquiries'}</span>
      </span>
    </label>`;
}

function authShellMarkup(card) {
  return `
    <section class="auth">
      <div class="auth__panel" aria-hidden="true">
        <p class="auth__panel-brand">से Seva Market <em>India</em></p>
        <p class="auth__panel-title">One account for the whole neighbourhood.</p>
        <ul>
          <li>🛡️ Every provider checked before the Verified badge</li>
          <li>📞 Customers contact you directly — no commission</li>
          <li>📍 Listings reach your city, locality &amp; PIN code</li>
          <li>💸 Free registration, free listing, free enquiries</li>
        </ul>
      </div>
      ${card}
    </section>`;
}

function panelTitle(role) {
  return role === 'provider'
    ? 'Your business deserves to be found.'
    : 'Every service you need, one search away.';
}

function registerCardMarkup({ role, next, values = {}, errors = {} }) {
  const message = errors.form || (Object.keys(errors).length ? 'Please correct the highlighted fields.' : '');
  return `
    <div class="auth__card">
      ${alertMarkup(message, { tone: errors.form || Object.keys(errors).length ? 'err' : 'ok' })}
      <h1 class="auth__title">Create your free account</h1>
      <p class="auth__lede">Join 100% free. No credit card, no hidden charge.</p>
      <form class="form-stack" action="/register" method="post" novalidate>
        <input type="hidden" name="next" value="${esc(next || '')}">
        <fieldset class="role-pick">
          <legend class="sr-only">I am joining as</legend>
          ${roleCardMarkup('customer', role)}
          ${roleCardMarkup('provider', role)}
        </fieldset>
        ${field({ id: 'full_name', name: 'full_name', label: 'Full name', required: true, value: values.full_name || '', autocomplete: 'name', placeholder: 'e.g. Ramesh Kumar', error: errors.full_name })}
        ${field({ id: 'email', type: 'email', name: 'email', label: 'Email address', required: true, value: values.email || '', autocomplete: 'email', placeholder: 'you@example.com', error: errors.email })}
        ${field({ id: 'phone', type: 'tel', name: 'phone', label: 'Mobile number', required: true, value: values.phone || '', autocomplete: 'tel', inputmode: 'numeric', maxlength: 10, hint: '10-digit Indian mobile — customers use it to reach you.', error: errors.phone })}
        ${field({ id: 'password', type: 'password', name: 'password', label: 'Password', required: true, autocomplete: 'new-password', hint: 'At least 8 characters.', error: errors.password })}
        <button class="btn btn--orange btn--block btn--lg" type="submit">Create account</button>
      </form>
      <p class="auth__switch">Already have an account? <a href="/login${next ? `?next=${encodeURIComponent(next)}` : ''}">Log in</a></p>
      <p class="auth__fine">By continuing you agree to our <a href="/terms">Terms</a> &amp; <a href="/privacy">Privacy</a>.</p>
    </div>`;
}

/* ----------------------------------------------------- routes --- */

function register(router, { store, config, session }) {
  // Account entry pages are useful to people but should not compete with
  // provider/service landing pages in search results.
  const page = (title, description, body, currentPath) => ({
    html: layout({ title, description, body, currentPath, robots: 'noindex,nofollow', site: config.site }),
  });

  /* ---------------------------------------------------- GET /register */
  router.get('/register', (ctx) => {
    const role = ctx.query.get('role') === 'provider' ? 'provider' : 'customer';
    const next = safePath(ctx.query.get('next'), null);
    return page(
      'Create a free account',
      'Register free on SEVA MARKET INDIA to hire local service providers or list your own service.',
      authShellMarkup(registerCardMarkup({ role, next })),
      '/register',
    );
  });

  /* --------------------------------------------------- POST /register */
  router.post('/register', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    const { readBody, validators, validate } = require('../http/request');
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const role = body.role === 'provider' ? 'provider' : 'customer';
    const next = safePath(body.next, null);

    const { value, errors, valid } = validate({
      fullName: () => validators.text(body.full_name, { field: 'Full name', max: 120 }),
      email: () => validators.email(body.email, { field: 'Email address', required: true }),
      phone: () => validators.phone(body.phone, { field: 'Mobile number' }),
      password: () => validators.text(body.password, { field: 'Password', min: 8, max: 128 }),
    });

    if (!valid) {
      const fieldErrors = {
        full_name: errors.fullName,
        email: errors.email,
        phone: errors.phone,
        password: errors.password,
      };
      return page(
        'Create a free account',
        '',
        authShellMarkup(registerCardMarkup({ role, next, values: body, errors: fieldErrors })),
        '/register',
      );
    }

    try {
      const { user } = await store.users.create({
        email: value.email,
        fullName: value.fullName,
        phone: value.phone,
        password: value.password,
        role,
      });
      // Accounts activate on signup in this build (email verification and
      // the provider badge ship with the onboarding milestone).
      const active = user.status === 'active' ? user : await store.users.setStatus(user.id, 'active');
      clearLoginFailures(ctx.ip);
      logAudit(store, active.id, 'auth.register', 'user', active.id, { role });
      return {
        redirect: next || (role === 'provider' ? '/account/provider' : '/account'),
        headers: { 'Set-Cookie': sessionCookie(claimsFor(active), session.secret, { secure: session.secure }) },
      };
    } catch (err) {
      const errors2 = {};
      const message = String(err && err.message ? err.message : err);
      if (/already exists/i.test(message)) {
        errors2.email = 'An account with this email already exists. Try logging in instead.';
      } else if (/password/i.test(message)) {
        errors2.password = message;
      } else {
        errors2.form = message;
      }
      return page(
        'Create a free account',
        '',
        authShellMarkup(registerCardMarkup({ role, next, values: body, errors: errors2 })),
        '/register',
      );
    }
  });

  /* -------------------------------------------------------- GET /login */
  router.get('/login', (ctx) => {
    const next = safePath(ctx.query.get('next'), '/account');
    const banner = ctx.query.get('created') === '1'
      ? alertMarkup('Account created — you are logged in.', { tone: 'ok' })
      : (ctx.query.get('expired') === '1' ? alertMarkup('Session expired — log in to continue.', { tone: 'err' }) : '');
    const body = `
    <section class="auth">
      <div class="auth__panel" aria-hidden="true">
        <p class="auth__panel-brand">से Seva Market <em>India</em></p>
        <p class="auth__panel-title">Welcome back. Your neighbourhood is waiting.</p>
        <ul>
          <li>🔑 Check your enquiries &amp; leads in one dashboard</li>
          <li>🛠️ Manage your services, prices and availability</li>
          <li>🏠 Hire verified pros near you in minutes</li>
        </ul>
      </div>
      <div class="auth__card">
        ${banner}
        <h1 class="auth__title">Log in to your account</h1>
        <p class="auth__lede">Customers and providers share one account system.</p>
        <form class="form-stack" action="/login" method="post">
          <input type="hidden" name="next" value="${esc(next)}">
          ${field({ id: 'email', type: 'email', name: 'email', label: 'Email address', required: true, autocomplete: 'email', placeholder: 'you@example.com' })}
          ${field({ id: 'password', type: 'password', name: 'password', label: 'Password', required: true, autocomplete: 'current-password' })}
          <button class="btn btn--primary btn--block btn--lg" type="submit">Log in</button>
        </form>
        <p class="auth__switch">New to ${esc(config.site.name)}? <a href="/register">Create a free account</a></p>
      </div>
    </section>`;
    return page('Log in', `Log in to ${config.site.name} — customers and service providers.`, body, '/login');
  });

  /* ------------------------------------------------------- POST /login */
  router.post('/login', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    const { readBody } = require('../http/request');
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const next = safePath(body.next, '/account');
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (loginBlocked(ctx.ip)) {
      return loginErrorPage(config, email, next, 'Too many failed attempts. Try again in 15 minutes.');
    }

    const account = email && password
      ? await store.users.findByEmail(email).catch(() => null)
      : null;
    const ok = account && userModel.verifyPassword(password, account.password_hash || '');
    if (!ok) {
      noteLoginFailure(ctx.ip);
      return loginErrorPage(config, email, next, 'Incorrect email or password. Please try again.');
    }
    if (account.status === 'suspended') {
      return loginErrorPage(config, email, next, 'This account is suspended. Contact support for help.');
    }

    clearLoginFailures(ctx.ip);
    logAudit(store, account.id, 'auth.login', 'user', account.id, {});
    return {
      redirect: next,
      headers: { 'Set-Cookie': sessionCookie(claimsFor(account), session.secret, { secure: session.secure }) },
    };
  });

  function loginErrorPage(config, email, next, message) {
    const body = `
    <section class="auth">
      <div class="auth__panel" aria-hidden="true">
        <p class="auth__panel-brand">से Seva Market <em>India</em></p>
        <p class="auth__panel-title">Welcome back. Your neighbourhood is waiting.</p>
        <ul>
          <li>🔑 Check your enquiries &amp; leads in one dashboard</li>
          <li>🛠️ Manage your services, prices and availability</li>
          <li>🏠 Hire verified pros near you in minutes</li>
        </ul>
      </div>
      <div class="auth__card">
        ${alertMarkup(message, { tone: 'err' })}
        <h1 class="auth__title">Log in to your account</h1>
        <p class="auth__lede">Customers and providers share one account system.</p>
        <form class="form-stack" action="/login" method="post" novalidate>
          <input type="hidden" name="next" value="${esc(next)}">
          ${field({ id: 'email', type: 'email', name: 'email', label: 'Email address', required: true, autocomplete: 'email', value: email || '' })}
          ${field({ id: 'password', type: 'password', name: 'password', label: 'Password', required: true, autocomplete: 'current-password' })}
          <button class="btn btn--primary btn--block btn--lg" type="submit">Log in</button>
        </form>
        <p class="auth__switch">New to ${esc(config.site.name)}? <a href="/register">Create a free account</a></p>
      </div>
    </section>`;
    return {
      html: layout({ title: 'Log in', description: '', body, currentPath: '/login', robots: 'noindex,nofollow', site: config.site }),
    };
  }

  /* ------------------------------------------------------ POST /logout */
  router.post('/logout', (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    logAudit(store, ctx.auth ? ctx.auth.uid : null, 'auth.logout', 'user', ctx.auth ? ctx.auth.uid : null, {});
    return {
      redirect: '/',
      headers: { 'Set-Cookie': clearCookie(session.secure) },
    };
  });
}

module.exports = { register, safePath, loginBlocked, noteLoginFailure, clearLoginFailures };
