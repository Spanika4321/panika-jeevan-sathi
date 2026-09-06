'use strict';
/**
 * SEVA MARKET INDIA — account pages.
 *
 * The HTML counterpart of `/api/v1/auth/*`: same actions, same errors, no
 * JSON. Form handlers follow the POST-redirect-GET pattern, so reloading a
 * page never re-submits an enquiry or creates a second account.
 */

const authHttp = require('../http/auth');
const authActions = require('../actions/auth');
const authModel = require('../models/auth');
const providers = require('../models/provider');
const mailer = require('../mail/mailer');
const { renderPage, redirectTo, ACCOUNT_TABS } = require('../views/render');
const { loginBody, registerBody, forgotBody, resetBody, verifyBody, accountBody, noticeBody } = require('../views/auth');
const { HttpError } = require('../http/respond');

/** Login/register/forgot are public pages; a signed-in visitor is moved on. */
function alreadySignedIn(ctx, target = '/account') {
  return ctx.user ? { redirect: target } : null;
}

function register(router, { db, config }) {
  /* ------------------------------------------------------------ login */

  const loginView = (ctx, { errors = {}, values = {}, notice = null, status = 200 }) => renderPage(ctx, {
    title: 'Sign in',
    description: 'Sign in to SEVA MARKET INDIA to manage your listing and answer enquiries.',
    body: loginBody({ errors, values, next: ctx.query.get('next') || '/', site: config.site, notice, csrf: ctx.csrfToken || '' }),
    flash: null,
    status,
  });

  router.get('/login', (ctx) => alreadySignedIn(ctx) || loginView(ctx, { notice: ctx.query.get('notice') }));

  router.post('/login', async (ctx) => {
    const body = await ctx.readBody();
    const result = authActions.login(db, config, {
      email: body.email,
      password: body.password,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      linkBase: mailer.baseUrl(config, ctx),
    });
    if (!result.ok) {
      if (result.throttled && result.retryAfterSeconds) ctx.res.setHeader('Retry-After', String(result.retryAfterSeconds));
      return loginView(ctx, { errors: result.errors, values: { email: body.email }, status: result.status || 401 });
    }
    authHttp.startSession(ctx, result.sessionToken);
    const fallback = result.user.role === 'provider' ? '/dashboard' : '/account';
    return { redirect: authHttp.safeNext(ctx.query.get('next'), fallback) };
  });

  /** POST /logout — a real form, never an <a> with a side effect. */
  router.post('/logout', (ctx) => {
    if (ctx.sessionToken) authActions.logout(db, config, ctx.sessionToken);
    authHttp.endSession(ctx);
    return redirectTo('/login', 'signed-out');
  });

  router.get('/logout', (ctx) => ({ redirect: '/login' }));

  /* -------------------------------------------------------- register */

  const registerView = (ctx, { errors = {}, values = {}, status = 200 }) => renderPage(ctx, {
    title: ctx.query.get('intent') === 'provider' ? 'Create your provider account' : 'Create your account',
    description: 'Join SEVA MARKET INDIA as a customer or list your service business.',
    body: registerBody({
      errors,
      values,
      intent: ctx.query.get('intent') === 'provider' ? 'provider' : 'customer',
      site: config.site,
      next: ctx.query.get('next') || '/',
      csrf: ctx.csrfToken || '',
    }),
    flash: null,
    status,
  });

  router.get('/register', (ctx) => alreadySignedIn(ctx) || registerView(ctx, {}));

  router.post('/register', async (ctx) => {
    const body = await ctx.readBody();
    const intent = body.intent === 'provider' ? 'provider' : 'customer';
    const result = authActions.registerAccount(db, config, {
      email: body.email,
      password: body.password,
      fullName: body.full_name,
      phone: body.phone,
      role: intent,
      linkBase: mailer.baseUrl(config, ctx),
      ip: ctx.ip,
    });
    if (!result.ok) {
      return registerView(ctx, { errors: result.errors, values: { ...body, password: undefined }, status: 400 });
    }

    if (result.requiresVerification) {
      return renderPage(ctx, {
        title: 'Confirm your email',
        body: noticeBody({
          title: 'Check your inbox',
          lede: `We sent a one-time link to ${result.user.email}. It works once and expires within 24 hours.`,
          children: `<div class="panel"><p class="prose">Nothing in your inbox? Open the message from the server outbox when SMTP is not configured, or sign in again and we will send a fresh link.</p><p><a class="btn btn--primary" href="/login">Go to sign in</a></p></div>`,
        }),
        flash: null,
      });
    }

    const session = authModel.createSession(db, result.user.id, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      secret: config.security.sessionSecret,
      days: config.auth.sessionDays,
    });
    authHttp.startSession(ctx, session.token);
    if (intent === 'provider') return { redirect: '/providers/new?ok=welcome' };
    return { redirect: authHttp.safeNext(ctx.query.get('next'), '/account?ok=welcome') };
  });

  /* -------------------------------------------------- email verify */

  router.get('/verify-email', (ctx) => {
    const token = ctx.query.get('token') || '';
    const result = authActions.verifyEmail(db, config, token);
    if (!result.ok) {
      return renderPage(ctx, {
        title: 'Email confirmation',
        body: verifyBody({ result }),
        flash: null,
        status: result.status || 400,
      });
    }
    // Verifying from the link also gives the visitor a session: they just
    // proved they control the mailbox and clicked a fresh token.
    if (result.user.status === 'active') {
      const session = authModel.createSession(db, result.user.id, {
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        secret: config.security.sessionSecret,
        days: config.auth.sessionDays,
      });
      authHttp.startSession(ctx, session.token);
    }
    return redirectTo(ctx.user ? '/account' : '/login', 'verified');
  });

  /* --------------------------------------------------- password reset */

  const forgotView = (ctx, { errors = {}, values = {}, sent = false, debugLink = null }) => renderPage(ctx, {
    title: 'Reset your password',
    body: forgotBody({
      errors,
      values,
      sent,
      debugLink,
      csrf: ctx.csrfToken || '',
    }),
    flash: null,
  });

  router.get('/forgot-password', (ctx) => alreadySignedIn(ctx, '/account') || forgotView(ctx, {}));

  router.post('/forgot-password', async (ctx) => {
    const body = await ctx.readBody();
    const result = authActions.requestPasswordReset(db, config, {
      email: body.email,
      linkBase: mailer.baseUrl(config, ctx),
    });
    if (!result.ok) return forgotView(ctx, { errors: result.errors, values: { email: body.email } });
    return forgotView(ctx, {
      values: { email: body.email },
      sent: true,
      // Only ever present when a mailbox is not configured and the app is not
      // in production; the response body is otherwise identical.
      debugLink: !config.isProduction && result.sent && result.debugToken ? `/reset-password?token=${result.debugToken}` : null,
    });
  });

  const resetView = (ctx, { errors = {}, token = '', done = false, error = null, status = 200 }) => renderPage(ctx, {
    title: 'Choose a new password',
    body: resetBody({ errors, token, done, error, csrf: ctx.csrfToken || '' }),
    flash: null,
    status,
  });

  router.get('/reset-password', (ctx) => resetView(ctx, { token: ctx.query.get('token') || '', error: ctx.query.get('err') ? 'That link is no longer valid. Request a new one.' : null }));

  router.post('/reset-password', async (ctx) => {
    const body = await ctx.readBody();
    const result = authActions.confirmPasswordReset(db, config, { token: body.token, password: body.password });
    if (!result.ok) {
      return resetView(ctx, { token: body.token, error: result.error, status: result.status || 400 });
    }
    authHttp.endSession(ctx);
    return redirectTo('/login', 'password-changed');
  });

  /* ---------------------------------------------------------- account */

  router.get('/account', (ctx) => {
    const guard = authHttp.requireUser(ctx);
    if (guard.redirect) return { redirect: guard.redirect };
    const summary = authActions.accountSummary(db, config, ctx.user.id);
    return renderPage(ctx, {
      title: 'My account',
      description: '',
      noIndex: true,
      tabs: ACCOUNT_TABS,
      body: accountBody({
        user: summary.user,
        provider: summary.provider,
        sessions: summary.sessions,
        emailRequired: summary.email_required,
        csrf: ctx.csrfToken,
        site: config.site,
      }),
    });
  });

  router.post('/account/password', async (ctx) => {
    const guard = authHttp.requireUser(ctx);
    if (guard.redirect) return { redirect: guard.redirect };
    const body = await ctx.readBody();
    const result = authActions.changePassword(db, config, {
      userId: ctx.user.id,
      currentPassword: body.current_password,
      newPassword: body.new_password,
    });
    if (!result.ok) {
      const summary = authActions.accountSummary(db, config, ctx.user.id);
      return renderPage(ctx, {
        title: 'My account',
        noIndex: true,
        tabs: ACCOUNT_TABS,
        body: accountBody({
          user: summary.user,
          provider: summary.provider,
          sessions: summary.sessions,
          emailRequired: summary.email_required,
          errors: result.errors || {},
          csrf: ctx.csrfToken,
          site: config.site,
          flash: { kind: 'error', message: Object.values(result.errors || { e: 'The password could not be changed.' })[0] },
        }),
        flash: null,
        status: result.status || 400,
      });
    }
    authHttp.endSession(ctx);
    return redirectTo('/login', 'password-changed');
  });

  router.post('/account/sessions/revoke', (ctx) => {
    const guard = authHttp.requireUser(ctx);
    if (guard.redirect) return { redirect: guard.redirect };
    authModel.revokeAllSessions(db, ctx.user.id);
    authHttp.endSession(ctx);
    return redirectTo('/login', 'sessions-revoked');
  });
}

module.exports = { register };
