'use strict';
/**
 * SEVA MARKET INDIA — transactional mail.
 *
 * This build has no SMTP dependency, so every message is written to
 * `data/outbox/` as a numbered .txt file. That is a feature, not a stub:
 * registration, verification and password-reset links must be *provable*
 * before a mailbox is involved, and an outbox is reviewable.
 *
 * A real transport (Nodemailer, SES, Postmark) can be dropped behind
 * `send()` later without touching a single call site.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let counter = 0;

/** Absolute base URL for links: pinned SITE_URL first, request origin next. */
function baseUrl(config, ctx = null) {
  const pinned = String(config?.site?.url || '').replace(/\/+$/, '');
  if (pinned) return pinned;
  const host = ctx?.req?.headers?.host;
  if (host) return `http://${host}`;
  return '';
}

/**
 * Write one message to the outbox.
 * @returns {{delivered: string, file: string|null, to: string, subject: string}}
 */
function send({ to, subject, text, html = null, config }) {
  const recipient = String(to || '').trim();
  if (!EMAIL_RE.test(recipient)) {
    // Never throw from mail: a bad address must not fail a sign-up.
    return { delivered: 'refused', file: null, to: recipient, subject };
  }
  if (config?.mail?.enabled === false) {
    return { delivered: 'disabled', file: null, to: recipient, subject };
  }

  const dir = config?.mail?.outboxDir || path.join(process.cwd(), 'data', 'outbox');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}-${(counter += 1)}-${crypto.randomBytes(3).toString('hex')}.txt`;
  const body = [
    `Date: ${new Date().toISOString()}`,
    `From: ${config?.mail?.from || 'SEVA MARKET INDIA <no-reply@seva-market.local>'}`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    '',
    String(text || '').trim(),
    html ? `\n--- HTML part ---\n${String(html).trim()}` : '',
    '',
  ].join('\n');

  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, body, { mode: 0o600 });
    return { delivered: 'outbox', file, to: recipient, subject };
  } catch (err) {
    console.error('mail outbox write failed:', err.message);
    return { delivered: 'error', file: null, to: recipient, subject };
  }
}

/* ----------------------------------------------------------- templates */

function verificationMessage({ to, name, link, config }) {
  return send({
    to,
    config,
    subject: 'Confirm your email for SEVA MARKET INDIA',
    text: [
      `Hello ${name},`,
      '',
      'Confirm your email address to finish setting up your account:',
      link,
      '',
      `The link works once and expires within 24 hours. If you did not create`,
      `this account you can ignore this message — nothing else changes.`,
      '',
      '— SEVA MARKET INDIA',
    ].join('\n'),
  });
}

function passwordResetMessage({ to, name, link, minutes = 60, config }) {
  return send({
    to,
    config,
    subject: 'Reset your SEVA MARKET INDIA password',
    text: [
      `Hello ${name},`,
      '',
      'Someone asked to reset the password for this account. Use this link to',
      'choose a new one:',
      link,
      '',
      `It expires in ${minutes} minutes and works once. If this was not you,`,
      'ignore it — your password stays as it is.',
      '',
      '— SEVA MARKET INDIA',
    ].join('\n'),
  });
}

function providerSubmittedMessage({ to, name, business, config, reviewNeeded = true }) {
  return send({
    to,
    config,
    subject: reviewNeeded ? 'Your listing is waiting for review' : 'Your listing is live on SEVA MARKET INDIA',
    text: [
      `Hello ${name},`,
      '',
      reviewNeeded
        ? `We have received "${business}". Our team checks every new listing before it`
        : `"${business}" is published and can be found by customers searching by`,
      reviewNeeded
        ? 'appears in search, then publishes it. You will get an email either way.'
        : 'service, city and PIN code.',
      '',
      'You can manage services, coverage areas and enquiries from your dashboard:',
      `${baseUrl(config)}/dashboard`,
      '',
      '— SEVA MARKET INDIA',
    ].join('\n'),
  });
}

function providerDecisionMessage({ to, name, business, approved, note, config }) {
  return send({
    to,
    config,
    subject: approved ? `Your listing is live: ${business}` : `About your listing on SEVA MARKET INDIA`,
    text: [
      `Hello ${name},`,
      '',
      approved
        ? `Good news — "${business}" is approved and visible to customers searching`
        : `We could not publish "${business}" this time.`,
      approved ? 'your PIN code. Enquiries will appear in your dashboard.' : '',
      note ? `\nNote from the review: ${note}` : '',
      '',
      `${baseUrl(config)}/dashboard`,
      '',
      '— SEVA MARKET INDIA',
    ].join('\n'),
  });
}

function newLeadMessage({ to, business, lead, config }) {
  return send({
    to,
    config,
    subject: `New enquiry for ${business}`,
    text: [
      `A customer sent an enquiry through SEVA MARKET INDIA.`,
      '',
      `Name:    ${lead.name}`,
      `Phone:   ${lead.phone}`,
      lead.email ? `Email:   ${lead.email}` : '',
      lead.pin_code ? `PIN:     ${lead.pin_code}` : '',
      lead.message ? `Message: ${lead.message}` : '',
      '',
      'Answer it from your dashboard: ' + `${baseUrl(config)}/dashboard/enquiries`,
      '',
      '— SEVA MARKET INDIA',
    ].filter(Boolean).join('\n'),
  });
}

module.exports = {
  send,
  baseUrl,
  verificationMessage,
  passwordResetMessage,
  providerSubmittedMessage,
  providerDecisionMessage,
  newLeadMessage,
};
