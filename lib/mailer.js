'use strict';
/**
 * PANIKA JEEVAN SATHI - email delivery.
 *
 * If `nodemailer` is installed in the project (optional, not required) and the
 * SMTP_* environment variables are set, real emails are sent.
 * Otherwise mail is written to data/outbox/*.eml and the generated link is
 * returned to the caller so the site can show it on screen (dev / no-SMTP mode).
 */

const fs = require('node:fs');
const path = require('node:path');

let nodemailer = null;
try {
  // optional dependency - the site works perfectly without it
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
  if (smtpConfigured()) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '') === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      await transporter.sendMail({ from: fromAddress(), to, subject, text, html });
      return { delivered: true };
    } catch (err) {
      return { delivered: false, error: err.message };
    }
  }

  // No SMTP configured: keep a local copy so nothing is silently lost.
  try {
    fs.mkdirSync(outboxDir, { recursive: true });
    const file = path.join(
      outboxDir,
      `${Date.now()}-${to.replace(/[^a-z0-9.]+/gi, '_')}-${subject.slice(0, 30).replace(/[^a-z0-9]+/gi, '-')}.eml`
    );
    const body = [
      `To: ${to}`,
      `From: ${fromAddress()}`,
      `Subject: ${subject}`,
      '',
      text || ''
    ].join('\r\n');
    fs.writeFileSync(file, body);
  } catch (_) {
    /* ignore */
  }
  return { delivered: false, mode: 'outbox' };
}

module.exports = { send, smtpConfigured };
