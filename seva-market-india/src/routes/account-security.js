'use strict';
/**
 * SEVA MARKET INDIA — email verification and password recovery.
 *
 *   GET  /verify-email            confirm a link, or show the resend card
 *   POST /verify-email/resend     mail a fresh link (signed in, throttled)
 *   GET  /forgot-password         ask for a reset link
 *   POST /forgot-password         mail one — the same answer either way
 *   GET  /reset-password?token=   the new-password form
 *   POST /reset-password          spend the token, set the password
 *
 * THE THREE THINGS THAT MUST NOT GO WRONG
 * ---------------------------------------
 * 1. Enumeration. Whether an address has an account is not public knowledge,
 *    so POST /forgot-password renders one identical page for a known address,
 *    an unknown one, a suspended one and a throttled one. Only a malformed
 *    email or an IP-level rate limit looks different, and neither reveals an
 *    account.
 * 2. Replay. A token is single use: `consume()` is the atomic gate, and the
 *    second of two racing submissions finds zero rows to stamp and is told the
 *    link was already used. Issuing a new token revokes the old ones.
 * 3. Leakage. The raw token exists only in the email and in the clicked URL.
 *    The database stores a SHA-256 hash, no token is ever logged or rendered
 *    back into a page, and every page here is `noindex,nofollow`.
 *
 * Password reset deliberately signs the browser out (the session cookie is
 * cleared): if the reason for the reset is "somebody else knew my password",
 * their session should not survive it.
 */

const { layout, esc } = require('../views/layout');
const { field, alertMarkup, authShellMarkup } = require('../views/ui');
const { clearCookie } = require('../auth/session');
const { assertSameOrigin } = require('../http/security');
const { readBody, validators, validate } = require('../http/request');
const tokenModel = require('../models/account-token');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../auth/account-mail');

const PANEL = {
  title: 'Your account, protected.',
  lines: [
    '✉️ One click confirms the address is yours',
    '🔑 A reset link expires in an hour and works once',
    '🛡️ We never ask for your password by phone or email',
    '📵 Locked out? Reset is free and takes a minute',
  ],
};

/** How many links one connection may request per hour, per flow. */
const IP_LIMIT = Object.freeze({ verify_email: 10, reset_password: 5 });
const IP_WINDOW_MS = 60 * 60 * 1000;

/**
 * In-memory per-IP counters.
 *
 * The per-*account* limit is counted in the database (durable, and correct
 * across instances); this one only stops a single connection from hammering
 * the form, which is a best-effort job — a restart or a second instance
 * resets it, and that is acceptable for a rate limit that sits behind the
 * durable one.
 */
const ipRequests = new Map();

/** True when this IP has used its allowance; otherwise records one request. */
function takeIpAllowance(purpose, ip, now = Date.now()) {
  const key = `${purpose}:${ip || 'unknown'}`;
  const entry = ipRequests.get(key);
  if (!entry || entry.resetAt <= now) {
    ipRequests.set(key, { count: 1, resetAt: now + IP_WINDOW_MS });
    return true;
  }
  if (entry.count >= (IP_LIMIT[purpose] ?? 5)) return false;
  entry.count += 1;
  return true;
}

/** Drop finished windows — the map must not grow without bound. */
function sweepIpAllowance(now = Date.now()) {
  for (const [key, entry] of ipRequests) {
    if (entry.resetAt <= now) ipRequests.delete(key);
  }
}

function register(router, { store, config, session, mailer }) {
  const limitFor = (purpose) => config.tokens.hourlyLimit[purpose] ?? 5;

  /** Account pages are for people, not for search results. */
  const page = (ctx, title, description, body) => ({
    html: layout({
      title,
      description,
      body,
      currentPath: ctx.pathname,
      user: ctx.auth,
      robots: 'noindex,nofollow',
      site: config.site,
    }),
  });

  const card = ({ title, lede, banner = '', form = '', actions = '', fine = '' }) => `
      <div class="auth__card">
        ${banner}
        <h1 class="auth__title">${esc(title)}</h1>
        ${lede ? `<p class="auth__lede">${esc(lede)}</p>` : ''}
        ${form}
        ${actions}
        ${fine}
      </div>`;

  const shell = (parts) => authShellMarkup(card(parts), PANEL);

  /** The logged-in user row, or null (suspended accounts count as null). */
  async function currentUser(ctx) {
    const claims = ctx.auth;
    if (!claims || !claims.uid) return null;
    const user = await store.users.findById(claims.uid).catch(() => null);
    if (!user || user.status === 'suspended') return null;
    return user;
  }

  /** Best-effort audit trail — a log write must never break the response. */
  function logAudit(actorId, action, entityId, detail) {
    Promise.resolve(store.audit.log({
      actor: actorId ? `user:${actorId}` : 'guest',
      action,
      entity: 'user',
      entityId: entityId ?? actorId ?? null,
      detail: JSON.stringify(detail || {}),
    })).catch(() => {});
  }

  /**
   * Local development has no SMTP server, and a developer still needs the
   * link. Say so on the page instead of leaving them waiting for an email
   * that was written to data/outbox. Never rendered in production, where the
   * delivery mode of somebody else's mail is nobody's business.
   */
  function outboxNote() {
    if (config.isProduction || !mailer || mailer.mode === 'smtp') return '';
    return alertMarkup(
      'Development server: SMTP is not configured, so this link was written to data/outbox instead of being emailed.',
      { tone: 'warn' },
    );
  }

  /* ------------------------------------------------ GET /verify-email --- */

  router.get('/verify-email', async (ctx) => {
    const token = String(ctx.query.get('token') || '').trim();

    if (token) {
      const row = tokenModel.isTokenShape(token)
        ? await store.tokens.findValid({ purpose: 'verify_email', token }).catch(() => null)
        : null;
      // consume() is the single-use gate: exactly one caller can stamp it.
      const spent = row ? await store.tokens.consume(row.id).catch(() => 0) : 0;

      if (row && spent) {
        await store.users.setEmailVerified(row.user_id).catch(() => null);
        logAudit(row.user_id, 'auth.email_verified', row.user_id, {});
        // Already signed in as this account? Straight to the dashboard.
        // Otherwise the confirmed address earns a login, not a free session:
        // a forwarded link should not silently become a signed-in browser.
        const ownSession = ctx.auth && Number(ctx.auth.uid) === Number(row.user_id);
        return { redirect: ownSession ? '/account?ok=email-verified' : '/login?verified=1' };
      }

      const user = await currentUser(ctx);
      const canResend = Boolean(user && !user.email_verified_at);
      return page(ctx, 'Confirm your email', '', shell({
        title: 'That confirmation link does not work',
        lede: 'It has already been used, or it expired. Links last 48 hours and work once.',
        banner: alertMarkup('Ask for a new link and the old ones stop working.', { tone: 'err' }),
        form: canResend ? `
        <form class="form-stack" action="/verify-email/resend" method="post">
          <button class="btn btn--primary btn--block btn--lg" type="submit">Email me a new link</button>
        </form>` : '',
        actions: `
        <p class="auth__switch">${canResend
    ? `Signed in as ${esc(user.email)}. <a href="/account">Back to my dashboard</a>`
    : '<a href="/login">Log in</a> to request a new confirmation link'}</p>`,
      }));
    }

    /* No token: the signed-in status page, with a resend button. */
    const user = await currentUser(ctx);
    if (!user) {
      return page(ctx, 'Confirm your email', '', shell({
        title: 'Confirm your email address',
        lede: 'We sent a confirmation link when the account was created.',
        banner: ctx.query.get('sent') === '1'
          ? alertMarkup('Check your inbox — a new confirmation link is on its way.', { tone: 'ok' })
          : '',
        actions: `
        <p class="auth__switch"><a href="/login">Log in</a> to resend the link, or
          <a href="/forgot-password">reset your password</a> if you cannot get in.</p>`,
        fine: '<p class="auth__fine">A confirmed address is how we tell you about enquiries, and the only way to recover the account later.</p>',
      }));
    }

    if (user.email_verified_at) {
      return page(ctx, 'Email confirmed', '', shell({
        title: 'Your email is confirmed ✓',
        lede: user.email,
        banner: alertMarkup('Nothing left to do here.', { tone: 'ok' }),
        actions: '<p class="auth__switch"><a href="/account">Back to my dashboard</a></p>',
      }));
    }

    const recent = await store.tokens
      .recentCount({ purpose: 'verify_email', userId: user.id, minutes: 60 })
      .catch(() => 0);
    return page(ctx, 'Confirm your email', '', shell({
      title: 'Confirm your email address',
      lede: user.email,
      banner: [
        ctx.query.get('sent') === '1'
          ? alertMarkup('We sent a new confirmation link. It can take a minute — and check the spam folder.', { tone: 'ok' })
          : '',
        alertMarkup('Until the address is confirmed you cannot recover the account if you forget your password.', { tone: 'warn' }),
        ctx.query.get('sent') === '1' ? outboxNote() : '',
      ].filter(Boolean).join(''),
      form: `
        <form class="form-stack" action="/verify-email/resend" method="post">
          <button class="btn btn--primary btn--block btn--lg" type="submit"${recent >= limitFor('verify_email') ? ' disabled' : ''}>
            ${recent >= limitFor('verify_email') ? 'Too many requests — try again in an hour' : 'Resend the confirmation email'}
          </button>
        </form>`,
      actions: '<p class="auth__switch"><a href="/account">Back to my dashboard</a></p>',
      fine: `<p class="auth__fine">You can request ${esc(limitFor('verify_email'))} links per hour. Each new link cancels the previous one.</p>`,
    }));
  });

  /* ----------------------------------------- POST /verify-email/resend --- */

  router.post('/verify-email/resend', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    sweepIpAllowance();

    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/verify-email' };
    if (user.email_verified_at) return { redirect: '/account?ok=email-verified' };

    if (!takeIpAllowance('verify_email', ctx.ip)) {
      return page(ctx, 'Confirm your email', '', shell({
        title: 'Too many requests',
        lede: user.email,
        banner: alertMarkup('That is enough links for one hour. Please try again later.', { tone: 'err' }),
        actions: '<p class="auth__switch"><a href="/account">Back to my dashboard</a></p>',
      }));
    }

    const recent = await store.tokens
      .recentCount({ purpose: 'verify_email', userId: user.id, minutes: 60 })
      .catch(() => 0);
    if (recent >= limitFor('verify_email')) {
      return page(ctx, 'Confirm your email', '', shell({
        title: 'You already have a link',
        lede: user.email,
        banner: alertMarkup(`${esc(recent)} links were sent in the last hour. The newest one is still valid — check your inbox and spam folder.`, { tone: 'err' }),
        actions: '<p class="auth__switch"><a href="/account">Back to my dashboard</a></p>',
      }));
    }

    const receipt = await sendVerificationEmail({ store, mailer, config, user, ip: ctx.ip });
    logAudit(user.id, 'auth.verify_email.requested', user.id, { mode: receipt.mode });

    if (receipt.mode === 'error') {
      return page(ctx, 'Confirm your email', '', shell({
        title: 'We could not send that email',
        lede: user.email,
        banner: alertMarkup('The mail server did not accept the message. Please try again in a few minutes.', { tone: 'err' }),
        form: `
        <form class="form-stack" action="/verify-email/resend" method="post">
          <button class="btn btn--primary btn--block btn--lg" type="submit">Try again</button>
        </form>`,
        actions: '<p class="auth__switch"><a href="/account">Back to my dashboard</a></p>',
      }));
    }
    return { redirect: '/verify-email?sent=1' };
  });

  /* -------------------------------------------- GET /forgot-password --- */

  router.get('/forgot-password', (ctx) => {
    const banner = ctx.query.get('sent') === '1'
      ? alertMarkup(
        'If an account uses that email address, a reset link is on its way. It expires in an hour and works once — check the spam folder too.',
        { tone: 'ok' },
      )
      : '';
    return page(ctx, 'Forgot your password', '', shell({
      title: 'Reset your password',
      lede: 'Enter the email address on your account and we will send a reset link.',
      banner,
      form: `
        <form class="form-stack" action="/forgot-password" method="post" novalidate>
          ${field({ id: 'email', type: 'email', name: 'email', label: 'Email address', required: true, autocomplete: 'email', placeholder: 'you@example.com' })}
          <button class="btn btn--orange btn--block btn--lg" type="submit">Email me a reset link</button>
        </form>`,
      actions: '<p class="auth__switch">Remembered it? <a href="/login">Log in</a></p>',
      fine: '<p class="auth__fine">For your safety the answer is the same whether or not the address has an account.</p>',
    }));
  });

  /* ------------------------------------------- POST /forgot-password --- */

  router.post('/forgot-password', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    sweepIpAllowance();
    const body = await readBody(ctx.req, config.http.maxBodyBytes);

    const { value, errors, valid } = validate({
      email: () => validators.email(body.email, { field: 'Email address', required: true }),
    });

    if (!valid) {
      return page(ctx, 'Forgot your password', '', shell({
        title: 'Reset your password',
        lede: 'Enter the email address on your account and we will send a reset link.',
        banner: alertMarkup(errors.email, { tone: 'err' }),
        form: `
        <form class="form-stack" action="/forgot-password" method="post" novalidate>
          ${field({ id: 'email', type: 'email', name: 'email', label: 'Email address', required: true, autocomplete: 'email', value: String(body.email || ''), error: errors.email })}
          <button class="btn btn--orange btn--block btn--lg" type="submit">Email me a reset link</button>
        </form>`,
        actions: '<p class="auth__switch">Remembered it? <a href="/login">Log in</a></p>',
      }));
    }

    if (!takeIpAllowance('reset_password', ctx.ip)) {
      return page(ctx, 'Forgot your password', '', shell({
        title: 'Too many requests',
        lede: 'This connection has asked for several reset links.',
        banner: alertMarkup('Please wait an hour before asking again.', { tone: 'err' }),
        actions: '<p class="auth__switch"><a href="/login">Back to login</a></p>',
      }));
    }

    // Look the account up, but never let the answer reach the browser.
    const account = await store.users.findByEmail(value.email).catch(() => null);
    if (account && account.status !== 'suspended') {
      const recent = await store.tokens
        .recentCount({ purpose: 'reset_password', userId: account.id, minutes: 60 })
        .catch(() => 0);
      if (recent < limitFor('reset_password')) {
        const receipt = await sendPasswordResetEmail({ store, mailer, config, user: account, ip: ctx.ip });
        logAudit(account.id, 'auth.password_reset.requested', account.id, { mode: receipt.mode, delivered: Boolean(receipt.delivered) });
      }
    }

    // Identical for every outcome above — this is the anti-enumeration rule.
    return { redirect: '/forgot-password?sent=1' };
  });

  /* -------------------------------------------- GET /reset-password --- */

  // Passwords are never echoed back into the form: a value attribute here
  // would survive a screenshot, a shared screen and the browser history.
  function resetFormPage(ctx, { token, banner = '', errors = {} }) {
    return page(ctx, 'Choose a new password', '', shell({
      title: 'Choose a new password',
      lede: 'Pick something you do not use anywhere else. You will be signed out everywhere else.',
      banner,
      form: `
        <form class="form-stack" action="/reset-password" method="post" novalidate>
          <input type="hidden" name="token" value="${esc(token)}">
          ${field({ id: 'password', type: 'password', name: 'password', label: 'New password', required: true, autocomplete: 'new-password', hint: 'At least 8 characters.', error: errors.password })}
          ${field({ id: 'password_confirm', type: 'password', name: 'password_confirm', label: 'Type it again', required: true, autocomplete: 'new-password', error: errors.password_confirm })}
          <button class="btn btn--orange btn--block btn--lg" type="submit">Save my new password</button>
        </form>`,
      actions: '<p class="auth__switch"><a href="/login">Cancel and log in</a></p>',
    }));
  }

  function resetInvalidPage(ctx, message) {
    return page(ctx, 'Reset link', '', shell({
      title: 'That reset link does not work',
      lede: 'Reset links expire after an hour and can only be used once.',
      banner: alertMarkup(message, { tone: 'err' }),
      actions: `
        <p class="cta-card__actions">
          <a class="btn btn--orange btn--lg" href="/forgot-password">Email me a new link</a>
          <a class="btn btn--ghost btn--lg" href="/login">Log in instead</a>
        </p>`,
      fine: '<p class="auth__fine">Tip: some mail apps rewrite long links. Copy the whole address from the email if the button does not work.</p>',
    }));
  }

  router.get('/reset-password', async (ctx) => {
    const token = String(ctx.query.get('token') || '').trim();
    const row = tokenModel.isTokenShape(token)
      ? await store.tokens.findValid({ purpose: 'reset_password', token }).catch(() => null)
      : null;
    if (!row) {
      return token
        ? resetInvalidPage(ctx, 'This link has expired or was already used.')
        : resetInvalidPage(ctx, 'Open the link from the email we sent you.');
    }
    return resetFormPage(ctx, { token });
  });

  /* ------------------------------------------- POST /reset-password --- */

  router.post('/reset-password', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const token = String(body.token || '').trim();

    const { value, errors, valid } = validate({
      password: () => validators.text(body.password, { field: 'New password', min: 8, max: 128 }),
    });
    const confirm = String(body.password_confirm || '');
    if (valid && confirm !== value.password) {
      errors.password_confirm = 'Both passwords must match.';
    }
    const formValid = valid && !errors.password_confirm;

    const row = tokenModel.isTokenShape(token)
      ? await store.tokens.findValid({ purpose: 'reset_password', token }).catch(() => null)
      : null;
    if (!row) return resetInvalidPage(ctx, 'This link has expired or was already used.');
    if (!formValid) {
      return resetFormPage(ctx, {
        token,
        errors: { password: errors.password, password_confirm: errors.password_confirm },
      });
    }

    // Spending the token is the gate: two racing submits both read a valid
    // row, but only one of them stamps it, and the other is told the truth.
    const spent = await store.tokens.consume(row.id).catch(() => 0);
    if (!spent) return resetInvalidPage(ctx, 'This link has already been used.');

    try {
      await store.users.setPassword(row.user_id, value.password);
    } catch (err) {
      logAudit(row.user_id, 'auth.password_reset.failed', row.user_id, { reason: 'setPassword' });
      return resetInvalidPage(ctx, String(err && err.message ? err.message : 'The password could not be saved.'));
    }

    // A reset link proves control of the inbox, so it confirms the address too.
    const user = await store.users.findById(row.user_id).catch(() => null);
    if (user && !user.email_verified_at) {
      await store.users.setEmailVerified(row.user_id).catch(() => null);
    }
    // Kill any sibling links, then sign this browser out: the next login uses
    // the new password, and a stolen session does not survive the reset.
    await store.tokens.revokeForUser(row.user_id, 'reset_password').catch(() => 0);
    logAudit(row.user_id, 'auth.password_reset', row.user_id, {});

    return {
      redirect: '/login?reset=1',
      headers: { 'Set-Cookie': clearCookie(session.secure) },
    };
  });
}

module.exports = { register, takeIpAllowance, sweepIpAllowance, IP_LIMIT, IP_WINDOW_MS };
