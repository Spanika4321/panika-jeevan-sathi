'use strict';
/**
 * API: authentication.
 *
 * Same actions as the HTML forms, so the rules cannot drift apart. Three
 * details are deliberate and each is covered by a test:
 *   - the session token travels ONLY in a HttpOnly cookie, never in JSON;
 *   - "forgot password" answers identically for a registered and an
 *     unregistered address;
 *   - every state-changing route behind a session needs the CSRF proof, which
 *     `src/app.js` enforces before the handler is ever reached.
 */

const { HttpError } = require('../../http/respond');
const authHttp = require('../../http/auth');
const authActions = require('../../actions/auth');
const authModel = require('../../models/auth');
const mailer = require('../../mail/mailer');
const providers = require('../../models/provider');
const { validators } = require('../../http/request');

/** The public shape of an account. No hash, no token, no IP. */
function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    status: user.status,
    email_verified_at: user.email_verified_at ?? null,
    last_login_at: user.last_login_at ?? null,
  };
}

function fail(result, fallback) {
  if (result && result.ok) return null;
  const errors = result && result.errors ? result.errors : null;
  const message = (result && (result.error || (errors && Object.values(errors)[0]))) || fallback;
  return new HttpError((result && result.status) || 400, message, errors || undefined);
}

function register(router, { db, config }) {
  /** GET /api/v1/auth/me — who am I, and does my listing exist yet? */
  router.get('/api/v1/auth/me', (ctx) => {
    if (!ctx.user) return { signed_in: false, user: null, provider: null };
    const provider = providers.findForUser(db, ctx.user.id);
    return {
      signed_in: true,
      user: publicUser(ctx.user),
      // The browser needs this to call the write endpoints; it is derived
      // from the HttpOnly session token, so only this tab can read it.
      csrf_token: ctx.csrfToken,
      provider: provider ? { ...provider, pending: provider.status !== 'active' } : null,
      session: { expires_at: ctx.session.expires_at },
    };
  });

  /** POST /api/v1/auth/register — role is customer or provider only. */
  router.post('/api/v1/auth/register', async (ctx) => {
    const body = await ctx.readBody();
    const result = authActions.registerAccount(db, config, {
      email: body.email,
      password: body.password,
      fullName: body.full_name ?? body.fullName,
      phone: body.phone ?? null,
      role: body.role === 'provider' ? 'provider' : 'customer',
      linkBase: mailer.baseUrl(config, ctx),
      ip: ctx.ip,
    });
    const error = fail(result, 'We could not create that account.');
    if (error) throw error;

    const data = {
      user: publicUser(result.user),
      requires_verification: result.requiresVerification,
      signed_in: false,
    };
    // Email verification off (the local default) means the account is usable
    // now, so sign them straight in instead of stranding them on a form.
    if (result.user.status === 'active') {
      const session = authModel.createSession(db, result.user.id, {
        ip: ctx.ip,
        userAgent: ctx.req.headers['user-agent'] || null,
        secret: config.security.sessionSecret,
        days: config.auth.sessionDays,
      });
      authHttp.startSession(ctx, session.token);
      data.signed_in = true;
      data.csrf_token = authModel.csrfTokenFor(session.token, config.security.sessionSecret);
    }
    return { __status: 201, data };
  });

  /** POST /api/v1/auth/login */
  router.post('/api/v1/auth/login', async (ctx) => {
    const body = await ctx.readBody();
    const result = authActions.login(db, config, {
      email: body.email,
      password: body.password,
      ip: ctx.ip,
      userAgent: ctx.req.headers['user-agent'] || null,
      linkBase: mailer.baseUrl(config, ctx),
    });
    if (!result.ok) {
      if (result.throttled && result.retryAfterSeconds) {
        ctx.res.setHeader('Retry-After', String(result.retryAfterSeconds));
      }
      throw fail(result, 'Sign in failed.');
    }
    authHttp.startSession(ctx, result.sessionToken);
    return {
      user: publicUser(result.user),
      csrf_token: result.csrfToken,
      // Named `after_login_url`, not `redirect`: app.js reads `redirect` as a
      // real HTTP redirect, and a login response must not invent one.
      after_login_url: result.user.role === 'provider' ? '/dashboard' : '/account',
    };
  });

  /** POST /api/v1/auth/logout — revokes this session, always succeeds. */
  router.post('/api/v1/auth/logout', (ctx) => {
    if (ctx.sessionToken) authActions.logout(db, config, ctx.sessionToken);
    authHttp.endSession(ctx);
    return { signed_out: true };
  });

  /** POST /api/v1/auth/verify-email — consumes a single-use token. */
  router.post('/api/v1/auth/verify-email', async (ctx) => {
    const body = await ctx.readBody();
    const token = validators.text(body.token, { field: 'token', max: 128 });
    const result = authActions.verifyEmail(db, config, token);
    const error = fail(result, 'That verification link could not be used.');
    if (error) throw error;
    return { verified: true, user: publicUser(result.user) };
  });

  /** POST /api/v1/auth/password/forgot — the answer never varies. */
  router.post('/api/v1/auth/password/forgot', async (ctx) => {
    const body = await ctx.readBody();
    const result = authActions.requestPasswordReset(db, config, {
      email: body.email,
      linkBase: mailer.baseUrl(config, ctx),
    });
    const error = fail(result, 'Enter a valid email address.');
    if (error) throw error;
    // `sent` is not echoed: it would confirm whether the address is registered.
    return {
      status: 'if_that_email_is_registered_a_reset_link_has_been_sent',
      // Outside production only, so a developer can follow the link without
      // an inbox. `config.isProduction` is the single gate here.
      ...(config.isProduction || !result.debugToken ? {} : { debug_token: result.debugToken }),
    };
  });

  /** POST /api/v1/auth/password/reset */
  router.post('/api/v1/auth/password/reset', async (ctx) => {
    const body = await ctx.readBody();
    const result = authActions.confirmPasswordReset(db, config, {
      token: body.token,
      password: body.password ?? body.new_password,
    });
    const error = fail(result, 'That reset link could not be used.');
    if (error) throw error;
    authHttp.endSession(ctx);
    return { password_changed: true, sessions_revoked: result.sessionsRevoked };
  });

  /** POST /api/v1/auth/password/change — signs every other device out. */
  router.post('/api/v1/auth/password/change', async (ctx) => {
    const guard = authHttp.requireUser(ctx);
    if (guard.redirect) return { redirect: guard.redirect };
    const body = await ctx.readBody();
    const result = authActions.changePassword(db, config, {
      userId: ctx.user.id,
      currentPassword: body.current_password ?? body.currentPassword,
      newPassword: body.new_password ?? body.newPassword,
    });
    const error = fail(result, 'The password could not be changed.');
    if (error) throw error;
    authHttp.endSession(ctx);
    return { password_changed: true, sessions_revoked: result.sessionsRevoked, signed_out: true };
  });

  /** POST /api/v1/auth/sessions/revoke — sign out everywhere. */
  router.post('/api/v1/auth/sessions/revoke', (ctx) => {
    const guard = authHttp.requireUser(ctx);
    if (guard.redirect) return { redirect: guard.redirect };
    const revoked = authModel.revokeAllSessions(db, ctx.user.id);
    authHttp.endSession(ctx);
    return { sessions_revoked: revoked };
  });
}

module.exports = { register, publicUser };
