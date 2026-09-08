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
const { field, alertMarkup, authShellMarkup } = require('../views/ui');
const userModel = require('../models/user');
const tokenModel = require('../models/account-token');
const { sendVerificationEmail } = require('../auth/account-mail');
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

/**
 * The one-line notice above the login form. Each of these is the visible end
 * of a flow that started somewhere else — a confirmation link, a reset link,
 * an expired session — so the wording says what just happened, not what to do.
 */
function loginBanner(query) {
  const banners = {
    created: ['Account created — you are logged in.', 'ok'],
    verified: ['Email address confirmed ✓ Log in to continue.', 'ok'],
    reset: ['Password changed. Log in with your new password — every other device was signed out.', 'ok'],
    expired: ['Session expired — log in to continue.', 'err'],
  };
  for (const [key, [message, tone]] of Object.entries(banners)) {
    if (query.get(key) === '1') return alertMarkup(message, { tone });
  }
  return '';
}

/** Brand-panel copy, one list per page family (see views/ui.authShellMarkup). */
const REGISTER_PANEL = {
  title: 'One account for the whole neighbourhood.',
  lines: [
    '🛡️ Every provider checked before the Verified badge',
    '📞 Customers contact you directly — no commission',
    '📍 Listings reach your city, locality &amp; PIN code',
    '💸 Free registration, free listing, free enquiries',
  ],
};

const LOGIN_PANEL = {
  title: 'Welcome back. Your neighbourhood is waiting.',
  lines: [
    '🔑 Check your enquiries &amp; leads in one dashboard',
    '🛠️ Manage your services, prices and availability',
    '🏠 Hire verified pros near you in minutes',
  ],
};

/**
 * The login card: banner, form, and the two escape hatches people actually
 * need when they cannot get in — "create an account" and "forgot password".
 */
function loginCardMarkup({ banner = '', next = '/account', email = '', novalidate = false } = {}) {
  return `
      <div class="auth__card">
        ${banner}
        <h1 class="auth__title">Log in to your account</h1>
        <p class="auth__lede">Customers and providers share one account system.</p>
        <form class="form-stack" action="/login" method="post"${novalidate ? ' novalidate' : ''}>
          <input type="hidden" name="next" value="${esc(next)}">
          ${field({ id: 'email', type: 'email', name: 'email', label: 'Email address', required: true, autocomplete: 'email', placeholder: 'you@example.com', value: email || '' })}
          ${field({ id: 'password', type: 'password', name: 'password', label: 'Password', required: true, autocomplete: 'current-password' })}
          <button class="btn btn--primary btn--block btn--lg" type="submit">Log in</button>
        </form>
        <p class="auth__switch"><a href="/forgot-password">Forgot your password?</a></p>
        <p class="auth__switch">New here? <a href="/register">Create a free account</a></p>
      </div>`;
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

function register(router, { store, config, session, mailer }) {
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
      authShellMarkup(registerCardMarkup({ role, next }), REGISTER_PANEL),
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

    // The `field` label only shapes the message ("Mobile number is
    // required."); validate() keys the error by the shape key, which is the
    // name the form template reads.
    const { value, errors, valid } = validate({
      full_name: () => validators.text(body.full_name, { field: 'Full name', max: 120 }),
      email: () => validators.email(body.email, { field: 'Email address', required: true }),
      phone: () => validators.phone(body.phone, { field: 'Mobile number' }),
      password: () => validators.text(body.password, { field: 'Password', min: 8, max: 128 }),
    });

    if (!valid) {
      const fieldErrors = { ...errors };
      return page(
        'Create a free account',
        '',
        authShellMarkup(registerCardMarkup({ role, next, values: body, errors: fieldErrors }), REGISTER_PANEL),
        '/register',
      );
    }

    try {
      const { user } = await store.users.create({
        email: value.email,
        fullName: value.full_name,
        phone: value.phone,
        password: value.password,
        role,
      });
      // Accounts activate on signup: a confirmed address is asked for, not
      // demanded, and the dashboard keeps offering the link until it is used.
      const active = user.status === 'active' ? user : await store.users.setStatus(user.id, 'active');

      // Confirmation email. Deliberately after the account exists and never
      // fatal: `sendVerificationEmail` swallows its own errors, so an SMTP
      // outage cannot turn a successful signup into a failure the visitor
      // would retry (and duplicate).
      const receipt = await sendVerificationEmail({ store, mailer, config, user: active, ip: ctx.ip });

      clearLoginFailures(ctx.ip);
      logAudit(store, active.id, 'auth.register', 'user', active.id, { role });
      logAudit(store, active.id, 'auth.verify_email.requested', 'user', active.id, { mode: receipt.mode });
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
        authShellMarkup(registerCardMarkup({ role, next, values: body, errors: errors2 }), REGISTER_PANEL),
        '/register',
      );
    }
  });

  /* -------------------------------------------------------- GET /login */
  router.get('/login', (ctx) => {
    const next = safePath(ctx.query.get('next'), '/account');
    const banner = loginBanner(ctx.query);
    const body = authShellMarkup(loginCardMarkup({ banner, next, email: '' }), LOGIN_PANEL);
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
    const body = authShellMarkup(
      loginCardMarkup({ banner: alertMarkup(message, { tone: 'err' }), next, email, novalidate: true }),
      LOGIN_PANEL,
    );
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
