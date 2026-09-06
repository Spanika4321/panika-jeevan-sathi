'use strict';
/**
 * SEVA MARKET INDIA — auth actions.
 *
 * One implementation of every account operation, shared by the JSON API
 * (`/api/v1/auth/*`) and the HTML forms (`/login`, `/register`, ...). Both
 * surfaces therefore enforce exactly the same rules and report exactly the
 * same field errors — a divergence between them is the classic way a login
 * page and an API end up with different security properties.
 *
 * Actions return `{ ok, errors, ... }` instead of throwing for expected
 * failures (bad password, expired token, throttled). They throw only for
 * programmer errors.
 */

const auth = require('../models/auth');
const users = require('../models/user');
const providers = require('../models/provider');
const mail = require('../mail/mailer');
const { cleanText, normalizePhone } = require('../db/values');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const fieldError = (errors, field, message) => {
  errors[field] = message;
};

/* ---------------------------------------------------------- register */

/**
 * @param {object} options
 * @param {'customer'|'provider'} [options.role] admins are never self-served
 * @param {string|null} [options.linkBase] origin used to build email links
 */
function registerAccount(db, config, { email, password, fullName, phone = null, role = 'customer', linkBase = '', ip = null } = {}) {
  const errors = {};
  const cleanEmail = cleanText(email, 254)?.toLowerCase() ?? null;
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) fieldError(errors, 'email', 'Enter a valid email address.');
  if (!cleanText(fullName, 120)) fieldError(errors, 'full_name', 'Full name is required.');

  const problem = users.passwordProblem(password, { minLength: config.auth.minPasswordLength });
  if (problem) fieldError(errors, 'password', problem);

  const digits = phone ? normalizePhone(phone) : null;
  if (phone && !digits) fieldError(errors, 'phone', 'Enter a valid 10-digit Indian mobile number.');

  const safeRole = role === 'provider' ? 'provider' : 'customer';
  if (cleanEmail && users.findByEmail(db, cleanEmail)) {
    fieldError(errors, 'email', 'An account with that email already exists. Try signing in instead.');
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const requiresVerification = Boolean(config.auth.requireEmailVerification);
  const { user } = users.createUser(db, {
    email: cleanEmail,
    fullName,
    password,
    phone: digits,
    role: safeRole,
    // Without mandatory verification the account is usable immediately, and
    // the link is still sent so the address can be confirmed later.
    status: requiresVerification ? 'pending' : 'active',
  });

  const token = auth.issueToken(db, user.id, 'email_verification', {
    secret: config.security.sessionSecret,
    minutes: config.auth.verifyTokenMinutes,
  });
  mail.verificationMessage({
    to: user.email,
    name: user.full_name,
    link: `${linkBase}/verify-email?token=${token}`,
    config,
  });
  auth.audit(db, { actor: `user:${user.id}`, action: 'account.register', entity: 'user', entityId: user.id, detail: `role=${safeRole}` });

  return {
    ok: true,
    user: users.findById(db, user.id),
    requiresVerification,
    // Tokens are returned only outside production so a developer can click
    // the link from the console; the JSON API never echoes it to a client.
    debugToken: config.isProduction ? null : token,
  };
}

/* -------------------------------------------------------------- login */

function login(db, config, { email, password, ip = null, userAgent = null, linkBase = '' } = {}) {
  const errors = {};
  const cleanEmail = cleanText(email, 254)?.toLowerCase() ?? null;
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
    return { ok: false, status: 400, errors: { email: 'Enter a valid email address.' } };
  }

  const key = auth.throttleKey(cleanEmail, ip, config.security.sessionSecret);
  const throttle = auth.checkThrottle(db, key, {
    windowMinutes: config.auth.loginWindowMinutes,
    maxAttempts: config.auth.loginMaxAttempts,
  });
  if (throttle.blocked) {
    return {
      ok: false,
      status: 429,
      throttled: true,
      retryAfterSeconds: throttle.retryAfterSeconds,
      errors: { email: 'Too many failed attempts. Try again in a few minutes.' },
    };
  }

  const attempt = users.authenticate(db, cleanEmail, password);
  if (!attempt.ok) {
    const recorded = auth.recordFailure(db, key, {
      windowMinutes: config.auth.loginWindowMinutes,
      maxAttempts: config.auth.loginMaxAttempts,
    });
    if (attempt.suspended) return { ok: false, status: 403, errors: { email: attempt.error } };
    if (attempt.unverified) {
      // The account exists and the password is right, so it is fair to offer
      // a new link — but the response must not reveal that the password was
      // correct to an attacker still guessing.
      const account = users.findByEmail(db, cleanEmail);
      if (account) {
        const token = auth.issueToken(db, account.id, 'email_verification', {
          secret: config.security.sessionSecret,
          minutes: config.auth.verifyTokenMinutes,
        });
        mail.verificationMessage({
          to: account.email,
          name: account.full_name,
          link: `${linkBase}/verify-email?token=${token}`,
          config,
        });
      }
      return { ok: false, status: 403, unverified: true, errors: { email: attempt.error } };
    }
    return {
      ok: false,
      status: 401,
      attemptsLeft: Math.max(0, config.auth.loginMaxAttempts - recorded.attempts),
      errors: { password: attempt.error },
    };
  }

  auth.clearThrottle(db, key);
  const session = auth.createSession(db, attempt.user.id, {
    ip,
    userAgent,
    secret: config.security.sessionSecret,
    days: config.auth.sessionDays,
  });
  auth.audit(db, { actor: `user:${attempt.user.id}`, action: 'auth.login', entity: 'user', entityId: attempt.user.id });

  return { ok: true, user: attempt.user, sessionToken: session.token, csrfToken: auth.csrfTokenFor(session.token, config.security.sessionSecret) };
}

function logout(db, config, sessionToken) {
  if (!sessionToken) return { ok: true };
  auth.revokeSessionByToken(db, sessionToken, config.security.sessionSecret);
  return { ok: true };
}

/* ---------------------------------------------------- email verification */

function verifyEmail(db, config, token) {
  const result = auth.consumeToken(db, token, 'email_verification', { secret: config.security.sessionSecret });
  if (!result.valid) {
    const messages = {
      used: 'That confirmation link has already been used. Just sign in.',
      expired: 'That confirmation link has expired. Request a new one by signing in.',
      invalid: 'That confirmation link is not valid.',
    };
    return { ok: false, status: 400, reason: result.reason, error: messages[result.reason] || messages.invalid };
  }
  const user = users.markEmailVerified(db, result.userId);
  auth.audit(db, { actor: `user:${result.userId}`, action: 'account.email_verified', entity: 'user', entityId: result.userId });
  return { ok: true, user };
}

/* ------------------------------------------------------- password reset */

/**
 * Always answers the same way, whether or not the address is registered:
 * a "forgot password" form that says "no such account" is a user database.
 */
function requestPasswordReset(db, config, { email, linkBase = '' } = {}) {
  const cleanEmail = cleanText(email, 254)?.toLowerCase() ?? null;
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
    return { ok: false, errors: { email: 'Enter a valid email address.' } };
  }
  const account = users.findByEmail(db, cleanEmail);
  let sent = false;
  let debugToken = null;
  if (account && account.status !== 'suspended') {
    const token = auth.issueToken(db, account.id, 'password_reset', {
      secret: config.security.sessionSecret,
      minutes: config.auth.resetTokenMinutes,
    });
    // Never returned in production; it lets a developer click the link
    // straight out of the console while no SMTP server is wired up.
    if (!config.isProduction) debugToken = token;
    mail.passwordResetMessage({
      to: account.email,
      name: account.full_name,
      link: `${linkBase}/reset-password?token=${token}`,
      minutes: config.auth.resetTokenMinutes,
      config,
    });
    sent = true;
  }
  // The client-visible answer is identical either way; `sent` and
  // `debugToken` are for logs and local development only.
  return { ok: true, sent, debugToken };
}

function confirmPasswordReset(db, config, { token, password }) {
  const result = auth.consumeToken(db, token, 'password_reset', { secret: config.security.sessionSecret });
  if (!result.valid) {
    const messages = {
      used: 'That reset link has already been used. Request a new one.',
      expired: 'That reset link has expired. Request a new one.',
      invalid: 'That reset link is not valid.',
    };
    return { ok: false, status: 400, reason: result.reason, error: messages[result.reason] || messages.invalid };
  }
  const problem = users.passwordProblem(password, { minLength: config.auth.minPasswordLength });
  if (problem) return { ok: false, status: 400, errors: { password: problem } };

  users.setPassword(db, result.userId, password);
  // A password change invalidates every other session: if your account was
  // taken over, changing the password takes it back.
  const revoked = auth.revokeAllSessions(db, result.userId);
  auth.audit(db, { actor: `user:${result.userId}`, action: 'auth.password_reset', entity: 'user', entityId: result.userId, detail: `sessions_revoked=${revoked}` });
  return { ok: true, sessionsRevoked: revoked };
}

function changePassword(db, config, { userId, currentPassword, newPassword }) {
  const account = db.get('SELECT id, email FROM users WHERE id = ?', [userId]);
  if (!account) return { ok: false, status: 401, error: 'Sign in again to change your password.' };
  if (!users.verifyPassword(String(currentPassword ?? ''), db.get('SELECT password_hash FROM users WHERE id = ?', [userId]).password_hash)) {
    return { ok: false, status: 403, errors: { current_password: 'That current password is not correct.' } };
  }
  const problem = users.passwordProblem(newPassword, { minLength: config.auth.minPasswordLength });
  if (problem) return { ok: false, status: 400, errors: { new_password: problem } };
  if (String(currentPassword) === String(newPassword)) {
    return { ok: false, status: 400, errors: { new_password: 'Choose a password you have not used here before.' } };
  }

  users.setPassword(db, userId, newPassword);
  const revoked = auth.revokeAllSessions(db, userId);
  auth.audit(db, { actor: `user:${userId}`, action: 'auth.password_changed', entity: 'user', entityId: userId, detail: `sessions_revoked=${revoked}` });
  return { ok: true, sessionsRevoked: revoked };
}

/** Account overview for `/account` and `GET /api/v1/auth/me`. */
function accountSummary(db, config, userId) {
  const user = users.findById(db, userId);
  if (!user) return null;
  const provider = providers.findForUser(db, userId);
  return {
    user,
    provider,
    is_provider: Boolean(provider),
    sessions: auth.activeSessionCount(db, userId),
    email_required: Boolean(config.auth.requireEmailVerification) && !user.email_verified_at,
  };
}

module.exports = {
  registerAccount,
  login,
  logout,
  verifyEmail,
  requestPasswordReset,
  confirmPasswordReset,
  changePassword,
  accountSummary,
};
