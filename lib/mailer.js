'use strict';
/**
 * PANIKA JEEVAN SATHI - email delivery.
 *
 * If `nodemailer` is installed in the project (optional, not required) and the
 * SMTP_* environment variables are set, real emails are sent.
 * Otherwise mail is written to a private data/outbox/*.eml file for local
 * development / administrator-assisted recovery. Tokens are never shown in
 * public API responses, even when delivery is unavailable.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let nodemailer = null;
try {
  // Core pages work without it; production builds install it for recovery emails.
  nodemailer = require('nodemailer'); // eslint-disable-line global-require
} catch (_) {
  nodemailer = null;
}

function smtpConfigured() {
  return Boolean(
    nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
}

function fromAddress() {
  return (
    process.env.MAIL_FROM ||
    `"PANIKA JEEVAN SATHI" <${process.env.SMTP_USER || 'no-reply@panikajeevansathi.com'}>`
  );
}

async function send({ to, subject, text, html }, outboxDir) {
  let deliveryError;
  if (smtpConfigured()) {
    try {
      const port = Number(process.env.SMTP_PORT || 587);
      const secure = String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')) === 'true';
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port, secure,
        requireTLS: !secure,
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      const receipt = await transporter.sendMail({ from: fromAddress(), to, subject, text, html });
      if (!receipt.accepted?.some((address) => String(address?.address || address).toLowerCase() === to.toLowerCase()))
        throw new Error('SMTP did not accept the recipient.');
      // SMTP acceptance is not an inbox delivery receipt.
      return { delivered: true, mode: 'smtp' };
    } catch (err) {
      deliveryError = err.message;
    }
  }

  // No SMTP, or delivery failed: retain a private copy for support/retry.
  try {
    fs.mkdirSync(outboxDir, { recursive: true, mode: 0o700 });
    const file = path.join(
      outboxDir,
      `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${to.replace(/[^a-z0-9.]+/gi, '_').slice(0, 80)}-${subject.slice(0, 30).replace(/[^a-z0-9]+/gi, '-')}.eml`
    );
    const body = [
      `To: ${to}`,
      `From: ${fromAddress()}`,
      `Subject: ${subject}`,
      '',
      text || ''
    ].join('\r\n');
    fs.writeFileSync(file, body, { mode: 0o600 });
  } catch (err) {
    return { delivered: false, error: deliveryError || err.message };
  }
  return { delivered: false, mode: 'outbox', ...(deliveryError ? { error: deliveryError } : {}) };
}

module.exports = { send, smtpConfigured };
