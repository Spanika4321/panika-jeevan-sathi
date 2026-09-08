'use strict';
/**
 * SEVA MARKET INDIA - transactional email templates.
 *
 * Two messages exist: "confirm this inbox is yours" and "choose a new
 * password". Both are written for a phone screen in India, both are ASCII
 * (so no transfer-encoding dance, see mailer.buildMessage), and both keep the
 * same three safety sentences: the link expires, it works once, and nobody at
 * SEVA MARKET INDIA will ever ask for the password.
 *
 * The HTML half uses inline styles only - email clients strip <style> blocks -
 * and carries no image, no script and no tracking pixel.
 */

const { toAscii } = require('./mailer');
const { esc } = require('../views/escape');

/**
 * Email HTML gets the same single escaping gate as the website: a display
 * name is visitor-controlled data, and an unescaped one would let a signup
 * named `<img src=x onerror=...>` render markup inside somebody's inbox.
 */
const h = esc;

/** "Ramesh Kumar" → "Ramesh"; anything unpronounceable → "there". */
function firstName(fullName) {
  const first = toAscii(fullName, '').split(/\s+/)[0];
  return first && first.length <= 30 ? first : 'there';
}

function hoursLabel(ms) {
  const hours = Math.round(ms / 3_600_000);
  return hours >= 24 ? `${Math.round(hours / 24)} days` : `${hours} hours`;
}

function minutesLabel(ms) {
  return `${Math.max(1, Math.round(ms / 60_000))} minutes`;
}

/** The coloured button every email client renders as a table cell. */
/** `href` must already be escaped by the caller (see `h`). */
function buttonHtml(href, label, colour) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0">
      <tr><td style="border-radius:8px;background:${colour}">
        <a href="${href}" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px">${label}</a>
      </td></tr>
    </table>`;
}

function shellHtml({ heading, paragraphs, button, footnote }) {
  return `<!DOCTYPE html>
<html lang="en-IN"><body style="margin:0;padding:0;background:#f2f5fb">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5fb;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e2e8f4;overflow:hidden">
        <tr><td style="background:#2874f0;padding:18px 24px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:17px;font-weight:bold">SEVA MARKET INDIA</td></tr>
        <tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;color:#16233b;font-size:15px;line-height:1.6">
          <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">${heading}</h1>
          ${paragraphs.map((text) => `<p style="margin:0 0 14px">${text}</p>`).join('\n          ')}
          ${button || ''}
          <p style="margin:0;color:#5b6b86;font-size:13px">${footnote}</p>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f7f9fd;font-family:Arial,Helvetica,sans-serif;color:#7b8aa3;font-size:12px">
          You received this because an account uses this email address on SEVA MARKET INDIA.
          We never ask for your password by email, phone or WhatsApp.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * @param {{siteName: string, fullName?: string, link: string, ttlMs: number}} input
 * @returns {{subject: string, text: string, html: string}}
 */
function verifyEmail({ siteName, fullName = '', link, ttlMs }) {
  const name = firstName(fullName);
  const url = toAscii(link, '');
  const lifetime = hoursLabel(ttlMs);
  const subject = `Confirm your email - ${siteName}`;
  const text = `Namaste ${name},

Welcome to ${siteName}. Please confirm that this email address belongs to you:

  ${url}

The link works once and expires in ${lifetime}.

Why we ask: a confirmed address is how we tell you about enquiries on your
listings, and it is the only way to recover the account if you ever forget
your password.

If you did not create this account, ignore this email - nothing changes and
the address is not added to any list.

--
${siteName}
Local services, verified providers - anywhere in India.`;

  const html = shellHtml({
    heading: `Namaste ${h(name)}, welcome to ${h(siteName)}`,
    paragraphs: [
      'Please confirm that this email address belongs to you. A confirmed address is how we tell you about enquiries on your listings, and the only way to recover the account if you ever forget your password.',
      `<span style="word-break:break-all;color:#5b6b86;font-size:12px">Link: <a href="${h(url)}" style="color:#2874f0">${h(url)}</a></span>`,
    ],
    button: buttonHtml(h(url), 'Confirm my email', '#2874f0'),
    footnote: `The link works once and expires in ${h(lifetime)}. Did not create this account? Ignore this email and nothing changes.`,
  });

  return { subject, text, html };
}

/**
 * @param {{siteName: string, fullName?: string, link: string, ttlMs: number}} input
 * @returns {{subject: string, text: string, html: string}}
 */
function passwordReset({ siteName, fullName = '', link, ttlMs }) {
  const name = firstName(fullName);
  const url = toAscii(link, '');
  const lifetime = minutesLabel(ttlMs);
  const subject = `Reset your password - ${siteName}`;
  const text = `Namaste ${name},

We received a request to reset the password for this email address on
${siteName}. Choose a new one here:

  ${url}

The link works once and expires in ${lifetime}. Resetting signs every device
out, so you will log in again with the new password.

If you did not ask for this, ignore this email - your password stays exactly
as it is. Nobody from ${siteName} will ever call, message or email asking for
your password or for this link.

--
${siteName}
Local services, verified providers - anywhere in India.`;

  const html = shellHtml({
    heading: `Reset your ${h(siteName)} password`,
    paragraphs: [
      `Namaste ${h(name)}, we received a request to reset the password for this email address. Choose a new one using the button below. Resetting signs every device out.`,
      `<span style="word-break:break-all;color:#5b6b86;font-size:12px">Link: <a href="${h(url)}" style="color:#ff6a00">${h(url)}</a></span>`,
    ],
    button: buttonHtml(h(url), 'Choose a new password', '#ff6a00'),
    footnote: `The link works once and expires in ${h(lifetime)}. If you did not ask for this, ignore it - your password does not change.`,
  });

  return { subject, text, html };
}

module.exports = { verifyEmail, passwordReset, firstName, hoursLabel, minutesLabel, shellHtml, buttonHtml };
