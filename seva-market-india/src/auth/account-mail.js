'use strict';
/**
 * SEVA MARKET INDIA — issuing and mailing one-time account links.
 *
 * Both the sign-up route and the security routes need the same three steps:
 * revoke whatever is outstanding, mint a token, mail the link. Keeping them
 * here means the two flows cannot drift apart on the part that matters —
 * "newest link wins, old ones die".
 *
 * Two rules this module never breaks:
 *
 *   1. It never throws into a request. A signup must not become a 500 because
 *      SMTP is down, and a reset request must not reveal whether the mail
 *      system works. The receipt is returned for logging and for the
 *      development outbox; the caller decides what the visitor sees.
 *   2. It never logs, returns or stores the raw token beyond the one
 *      `link` it hands to the mailer. The database keeps the SHA-256 hash.
 */

const tokenModel = require('../models/account-token');
const templates = require('../mail/templates');
const { hashIp } = require('../models/lead');

/** The IP is stored as a salted HMAC, exactly like an enquiry's. */
function ipFingerprint(ip, config) {
  return hashIp(ip, config?.security?.sessionSecret || '') || null;
}

/**
 * Revoke the outstanding links for one purpose and mint a replacement.
 * @returns {Promise<string>} the raw token — for the email link only
 */
async function issueToken({ store, config, userId, purpose, ip = null }) {
  await store.tokens.revokeForUser(userId, purpose);
  const token = tokenModel.newToken();
  await store.tokens.create({
    userId,
    purpose,
    token,
    ipHash: ipFingerprint(ip, config),
  });
  return token;
}

/** Absolute link: email clients resolve nothing relative. */
function linkFor(config, pathname, token) {
  const origin = String(config.tokens.linkOrigin || '').replace(/\/+$/, '');
  return `${origin}${pathname}?token=${encodeURIComponent(token)}`;
}

/**
 * Send the "confirm this inbox" email.
 * @returns {Promise<{delivered: boolean, mode: string, error?: string}>}
 */
async function sendVerificationEmail({ store, mailer, config, user, ip = null }) {
  try {
    const token = await issueToken({ store, config, userId: user.id, purpose: 'verify_email', ip });
    const message = templates.verifyEmail({
      siteName: config.site.name,
      fullName: user.full_name,
      link: linkFor(config, '/verify-email', token),
      ttlMs: config.tokens.ttl.verify_email,
    });
    return await mailer.send({ to: user.email, ...message });
  } catch (err) {
    return { delivered: false, mode: 'error', error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Send the "choose a new password" email.
 * @returns {Promise<{delivered: boolean, mode: string, error?: string}>}
 */
async function sendPasswordResetEmail({ store, mailer, config, user, ip = null }) {
  try {
    const token = await issueToken({ store, config, userId: user.id, purpose: 'reset_password', ip });
    const message = templates.passwordReset({
      siteName: config.site.name,
      fullName: user.full_name,
      link: linkFor(config, '/reset-password', token),
      ttlMs: config.tokens.ttl.reset_password,
    });
    return await mailer.send({ to: user.email, ...message });
  } catch (err) {
    return { delivered: false, mode: 'error', error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  ipFingerprint,
  issueToken,
  linkFor,
  sendVerificationEmail,
  sendPasswordResetEmail,
};
