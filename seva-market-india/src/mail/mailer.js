'use strict';
/**
 * SEVA MARKET INDIA — email delivery, zero dependencies.
 *
 * WHY THIS FILE IS A SMALL SMTP CLIENT
 * ------------------------------------
 * Email verification and password reset both need a message to reach a real
 * inbox. The rest of this app is deliberately dependency-free, so instead of
 * pulling in nodemailer the SMTP conversation is spoken directly over
 * `node:net` / `node:tls`: greeting → EHLO → STARTTLS → AUTH → MAIL FROM →
 * RCPT TO → DATA. That is ~200 lines and it is testable against a real socket
 * (tests/mail.test.mjs runs a local SMTP server and asserts the transcript).
 *
 * WHAT HAPPENS WHEN SMTP IS NOT CONFIGURED
 * ----------------------------------------
 * Nothing breaks and nothing lies. `send()` resolves with
 * `{ delivered: false, mode: 'outbox' }` and the message is written to a
 * private `data/outbox/*.eml` file (0600, inside an ignored directory) so
 * local development can still click a verification link. In production the
 * outbox is off by default — an ephemeral disk is not a mail queue — and the
 * boot log says plainly that account email is disabled until SMTP_* is set.
 *
 * `send()` never throws: a mail outage must not turn a signup into a 500, and
 * a reset request must not reveal whether delivery worked.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

const DEFAULTS = Object.freeze({ timeoutMs: 15_000, port: 587 });

class MailError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'MailError';
    Object.assign(this, extra);
  }
}

/* ------------------------------------------------------- configuration --- */

const TRUTHY = ['1', 'true', 'yes', 'on'];

/**
 * Split `"SEVA MARKET INDIA" <no-reply@example.com>` into its two halves.
 *
 * A bare address has no display name: without the bracket check below, the
 * lazy prefix group would happily call the address itself a name and the From
 * header would read `"no-reply@x.co" <no-reply@x.co>`.
 */
function parseAddress(value) {
  const raw = String(value || '').trim().replace(/[\r\n]+/g, ' ');
  if (!raw) return { name: '', address: '' };
  // Anything after the closing bracket is dropped, not appended: a value like
  // `Seva <a@b.co> Bcc: evil@z.co` must yield one address, never two.
  const bracketed = /^(.*?)\s*<([^>]+)>/.exec(raw);
  if (!bracketed) {
    return { name: '', address: raw.toLowerCase() };
  }
  return {
    name: bracketed[1].trim().replace(/^["']|["']$/g, ''),
    address: bracketed[2].trim().toLowerCase(),
  };
}

/**
 * Read the SMTP settings from the environment exactly once.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {{isProduction?: boolean, root?: string}} [options]
 */
function readMailConfig(env = process.env, { isProduction = false, root = process.cwd() } = {}) {
  const host = String(env.SMTP_HOST || '').trim();
  const user = String(env.SMTP_USER || '').trim();
  const pass = String(env.SMTP_PASS || '');
  const secureFlag = String(env.SMTP_SECURE || '').trim().toLowerCase();

  const port = Number(env.SMTP_PORT || 0) > 0 ? Number(env.SMTP_PORT) : 0;
  // SMTP_SECURE wins; without it, port 465 means implicit TLS and 587 means
  // plaintext-then-STARTTLS — the two shapes every Indian host offers.
  const secure = secureFlag
    ? TRUTHY.includes(secureFlag)
    : (port || DEFAULTS.port) === 465;

  const from = parseAddress(env.MAIL_FROM || (user ? `SEVA MARKET INDIA <${user}>` : ''));
  const configured = Boolean(host && user && pass && from.address);
  // A From address is required to build a message at all. Without SMTP the
  // outbox copy still has to be a well-formed .eml, so fall back to a
  // clearly-local address rather than refusing to render the email.
  if (!from.address) from.address = 'no-reply@seva-market-india.local';

  // A development outbox is a convenience; on an ephemeral production host it
  // would be a mail queue that the next deploy deletes, so it stays opt-in.
  const outboxRequested = TRUTHY.includes(String(env.SEVA_MAIL_OUTBOX || '').trim().toLowerCase());
  const outboxDir = (!isProduction || outboxRequested)
    ? path.resolve(String(env.SEVA_MAIL_OUTBOX_DIR || '').trim() || path.join(root, 'data', 'outbox'))
    : null;

  return {
    host,
    port: port || (secure ? 465 : DEFAULTS.port),
    secure,
    user,
    pass,
    from,
    fromName: from.name || 'SEVA MARKET INDIA',
    timeoutMs: Number(env.SMTP_TIMEOUT_MS || 0) > 0 ? Number(env.SMTP_TIMEOUT_MS) : DEFAULTS.timeoutMs,
    configured,
    outboxDir,
  };
}

/* --------------------------------------------------------- message build --- */

/**
 * Keep printable ASCII only, collapsing newlines — for single-line values
 * such as a display name, a subject or a URL. Newlines are removed here on
 * purpose: a value that reaches a header must not be able to carry one.
 */
function toAscii(value, fallback = '') {
  const ascii = String(value ?? '').replace(/[^\x20-\x7E\t]/g, '').replace(/[\r\n]+/g, ' ').trim();
  return ascii || fallback;
}

/**
 * The same filter for a *body*: printable ASCII, with newlines preserved so
 * the message keeps its paragraphs. Everything else (control characters,
 * non-ASCII) is dropped, which is what lets the body be sent as 7bit without
 * a transfer encoding.
 */
function toAsciiText(value, fallback = '') {
  const ascii = String(value ?? '')
    .replace(/\r\n?/g, '\n')          // normalise to LF first
    .replace(/[^\x20-\x7E\t\n]/g, '')  // drop control + non-ASCII bytes
    .replace(/\n{3,}/g, '\n\n')         // never a wall of blank lines
    .replace(/[ \t]+$/gm, '')
    .trim();
  return ascii || fallback;
}

/**
 * RFC 2047 encode only when the subject is not plain ASCII.
 *
 * Control characters are removed first: a subject is a header, and a newline
 * in one would forge the headers below it. Everything printable — including
 * the rupee sign and Devanagari — survives, encoded rather than mangled.
 */
function encodeSubject(subject) {
  const value = String(subject || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** A header value cannot contain a newline — that is how injection happens. */
function assertSingleLine(name, value) {
  if (/[\r\n]/.test(String(value ?? ''))) throw new MailError(`The ${name} header must be a single line.`);
  return String(value);
}

/** Fold a long header so no line exceeds the RFC 5322 limit. */
function foldHeader(name, value) {
  const line = `${name}: ${value}`;
  if (line.length <= 78) return line;
  const parts = [];
  let rest = value;
  parts.push(`${name}: ${rest.slice(0, Math.max(10, 78 - name.length - 2))}`);
  rest = rest.slice(Math.max(10, 78 - name.length - 2));
  while (rest.length) {
    parts.push(` ${rest.slice(0, 76)}`);
    rest = rest.slice(76);
  }
  return parts.join('\r\n');
}

/** Wrap body text at 76 columns without breaking URLs mid-token. */
function wrapText(text, width = 76) {
  const out = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.join('\r\n');
}

/**
 * Build the RFC 5322 message that goes down the wire (and into the outbox).
 *
 * @param {{from: {name?: string, address: string}, to: string, subject: string,
 *          text: string, html?: string, date?: Date, messageId?: string}} input
 * @returns {string} CRLF-terminated message source
 */
function buildMessage({ from, to, subject, text, html = null, date = new Date(), messageId = null }) {
  const sender = typeof from === 'string' ? parseAddress(from) : { name: '', ...from };
  if (!sender.address) throw new MailError('An email needs a From address.');
  const recipient = parseAddress(to).address;
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(recipient)) {
    throw new MailError(`Refusing to send to "${to}": not an email address.`);
  }
  const body = toAsciiText(text, '');
  if (!body) throw new MailError('An email needs a text body.');

  const domain = sender.address.split('@')[1] || 'localhost';
  const id = messageId || `<${crypto.randomBytes(12).toString('hex')}@${domain}>`;
  const fromHeader = sender.name
    ? `"${assertSingleLine('From', toAscii(sender.name, 'SEVA MARKET INDIA'))}" <${sender.address}>`
    : sender.address;

  const headers = [
    foldHeader('From', fromHeader),
    foldHeader('To', recipient),
    foldHeader('Subject', encodeSubject(subject) || 'Message from SEVA MARKET INDIA'),
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${assertSingleLine('Message-ID', id)}`,
    'MIME-Version: 1.0',
  ];

  if (!html) {
    headers.push('Content-Type: text/plain; charset=us-ascii; format=flowed');
    headers.push('Content-Transfer-Encoding: 7bit');
    return `${headers.join('\r\n')}\r\n\r\n${wrapText(body)}\r\n`;
  }

  const boundary = `seva-${crypto.randomBytes(12).toString('hex')}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const htmlBody = toAsciiText(html, '');
  return [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=us-ascii',
    'Content-Transfer-Encoding: 7bit',
    '',
    wrapText(body),
    `--${boundary}`,
    'Content-Type: text/html; charset=us-ascii',
    'Content-Transfer-Encoding: 7bit',
    '',
    wrapText(htmlBody.replace(/\n/g, ' '), 900),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** DATA transparency: a line starting with "." is escaped as "..". */
function stuffDots(raw) {
  return String(raw)
    .replace(/\r?\n/g, '\r\n')
    .replace(/^\./gm, '..');
}

/* ------------------------------------------------------------ transport --- */

function defaultConnect(options) {
  return options.secure ? tls.connect(options) : net.connect(options);
}

/** Resolve once the socket is usable (and reject on timeout/error). */
function whenReady(socket, { secure, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const readyEvent = secure ? 'secureConnect' : 'connect';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new MailError(`SMTP connection timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    socket.once(readyEvent, () => done(resolve, socket));
    // A plaintext socket also emits 'connect'; 'timeout' needs a manual destroy.
    socket.on('timeout', () => {
      socket.destroy();
      done(reject, new MailError(`SMTP connection timed out after ${timeoutMs}ms.`));
    });
    // `on`, not `once`: an error that arrives after this attempt has settled —
    // a RST answering our own destroy() — would otherwise be an 'error' event
    // with no listener left, which Node turns into an uncaught exception that
    // takes the whole process (and every other in-flight request) down.
    socket.on('error', (err) => done(reject, new MailError(`SMTP connection failed: ${err.message}`)));
  });
}

/**
 * Line-oriented reply reader. One SMTP reply may span several lines
 * (`250-STARTTLS` … `250 OK`), and the last line of the group has a space
 * after the code.
 */
function createReplyReader(socket, timeoutMs) {
  let buffer = '';
  const waiting = [];

  const failAll = (error) => {
    while (waiting.length) waiting.shift().reject(error);
  };

  function drain() {
    for (;;) {
      const lines = buffer.split('\r\n');
      const complete = lines.slice(0, -1); // the tail may be a partial line
      if (!complete.length) return;
      let end = -1;
      for (let i = 0; i < complete.length; i += 1) {
        // Either the final line of a reply, or something we cannot parse —
        // surface both rather than waiting for a terminator that never comes.
        if (/^\d{3}(?:\s.*)?$/.test(complete[i]) || !/^\d{3}-/.test(complete[i])) { end = i; break; }
      }
      if (end === -1) return;
      const group = complete.slice(0, end + 1);
      buffer = lines.slice(end + 1).join('\r\n');
      const waiter = waiting.shift();
      if (waiter) {
        waiter.resolve({
          code: Number(group[group.length - 1].slice(0, 3)),
          lines: group,
          text: group.join('\r\n'),
        });
      }
    }
  }

  socket.on('data', (chunk) => { buffer += chunk.toString('utf8'); drain(); });
  socket.on('error', (err) => failAll(new MailError(`SMTP connection error: ${err.message}`)));
  socket.on('close', () => failAll(new MailError('The SMTP connection closed before the message was accepted.')));

  return {
    read() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new MailError(`SMTP timed out after ${timeoutMs}ms waiting for a reply.`));
          try { socket.destroy(); } catch (_) { /* already gone */ }
        }, timeoutMs);
        waiting.push({
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        drain();
      });
    },
    write(line) { socket.write(`${line}\r\n`); },
    writeRaw(data) { socket.write(data); },
    destroy() { try { socket.destroy(); } catch (_) { /* already gone */ } },
    get socket() { return socket; },
  };
}

/**
 * Send one message over SMTP.
 *
 * @param {string} raw     message source from buildMessage()
 * @param {{to: string, config: object, connect?: Function}} options
 */
async function smtpDeliver(raw, { to, config, connect = defaultConnect }) {
  const timeoutMs = config.timeoutMs;
  const ehloHost = config.from.address.split('@')[1] || 'localhost';

  let socket = connect({
    host: config.host,
    port: config.port,
    secure: config.secure,
    servername: config.secure ? config.host : undefined,
    timeout: timeoutMs,
    // Certificate problems must fail the delivery, never be swallowed: a
    // downgraded connection would hand the reset link to whoever is listening.
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  });
  await whenReady(socket, { secure: config.secure, timeoutMs });

  let conn = createReplyReader(socket, timeoutMs);
  const command = async (line, expected, what) => {
    conn.write(line);
    const reply = await conn.read();
    if (!expected.includes(reply.code)) {
      throw new MailError(`SMTP ${what} was refused (${reply.code}): ${reply.lines[reply.lines.length - 1].slice(0, 160)}`);
    }
    return reply;
  };

  try {
    const greeting = await conn.read();
    if (greeting.code !== 220) throw new MailError(`SMTP greeting was ${greeting.code}, expected 220.`);

    let capabilities = (await command(`EHLO ${ehloHost}`, [250], 'EHLO')).text.toUpperCase();

    if (!config.secure && capabilities.includes('STARTTLS')) {
      await command('STARTTLS', [220], 'STARTTLS');
      const upgraded = tls.connect({
        socket,
        servername: config.host,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      });
      await whenReady(upgraded, { secure: true, timeoutMs });
      conn = createReplyReader(upgraded, timeoutMs);
      socket = upgraded;
      capabilities = (await command(`EHLO ${ehloHost}`, [250], 'EHLO after STARTTLS')).text.toUpperCase();
    }

    if (config.user && config.pass) {
      // The credential itself is never part of an error message or a log line.
      if (capabilities.includes('AUTH') && capabilities.includes('PLAIN')) {
        const credential = Buffer.from(`\u0000${config.user}\u0000${config.pass}`, 'utf8').toString('base64');
        await command(`AUTH PLAIN ${credential}`, [235], 'authentication');
      } else {
        await command('AUTH LOGIN', [334], 'authentication');
        await command(Buffer.from(config.user, 'utf8').toString('base64'), [334], 'authentication');
        await command(Buffer.from(config.pass, 'utf8').toString('base64'), [235], 'authentication');
      }
    }

    await command(`MAIL FROM:<${config.from.address}>`, [250], 'MAIL FROM');
    await command(`RCPT TO:<${to}>`, [250, 251], `RCPT TO for ${to}`);
    await command('DATA', [354], 'DATA');
    conn.writeRaw(`${stuffDots(raw)}\r\n.\r\n`);
    const accepted = await conn.read();
    if (accepted.code !== 250) {
      throw new MailError(`The server refused the message (${accepted.code}): ${accepted.lines[accepted.lines.length - 1].slice(0, 160)}`);
    }
    try { await command('QUIT', [221], 'QUIT'); } catch (_) { /* the message is already accepted */ }
    return { delivered: true, mode: 'smtp' };
  } finally {
    conn.destroy();
  }
}

/* --------------------------------------------------------------- outbox --- */

/** Write the message to a private file so a developer can still click a link. */
function writeToOutbox(dir, raw, to, subject) {
  if (!dir) return null;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const safeTo = String(to).replace(/[^a-z0-9.]+/gi, '_').slice(0, 80);
    const safeSubject = String(subject).replace(/[^a-z0-9]+/gi, '-').slice(0, 40).replace(/^-|-$/g, '') || 'message';
    const file = path.join(dir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeTo}-${safeSubject}.eml`);
    fs.writeFileSync(file, raw, { mode: 0o600 });
    return file;
  } catch (_) {
    return null; // an unwritable outbox must never break the request
  }
}

/** Mask a recipient for logs: `ramesh@example.com` → `r*****h@example.com`. */
function maskRecipient(address) {
  const [local, domain] = String(address || '').split('@');
  if (!domain) return '(unknown)';
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(5, local.length - 2))}${local[local.length - 1]}@${domain}`;
}

/**
 * @param {object} options
 * @param {object} options.config   `config.mail` from src/config.js
 * @param {Function} [options.log]  warnings go here (never tokens)
 * @param {Function} [options.connect] injected in tests
 */
function createMailer({ config, log = () => {}, connect = defaultConnect } = {}) {
  const mail = config || readMailConfig(process.env);
  let warned = false;

  return {
    configured: mail.configured,
    /** 'smtp' when a server is configured, otherwise where messages go. */
    mode: mail.configured ? 'smtp' : (mail.outboxDir ? 'outbox' : 'disabled'),

    /**
     * Deliver one message. Resolves with a receipt; never throws.
     * @returns {Promise<{delivered: boolean, mode: string, file?: string|null, error?: string}>}
     */
    async send({ to, subject, text, html = null }) {
      const recipient = parseAddress(to).address;
      let raw;
      try {
        raw = buildMessage({ from: mail.from, to: recipient, subject, text, html });
      } catch (err) {
        log(`[mail] refused to build a message for ${maskRecipient(recipient)}: ${err.message}`);
        return { delivered: false, mode: 'rejected', error: err.message };
      }

      let deliveryError = null;
      if (mail.configured) {
        try {
          return await smtpDeliver(raw, { to: recipient, config: mail, connect });
        } catch (err) {
          deliveryError = err.message;
          log(`[mail] SMTP delivery to ${maskRecipient(recipient)} failed: ${err.message}`);
        }
      } else if (!warned) {
        warned = true;
        log(
          '[mail] SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS), so account email '
          + `is not being delivered. ${mail.outboxDir ? `Messages are written to ${mail.outboxDir} instead.` : 'Set them to enable verification and password-reset email.'}`,
        );
      }

      const file = writeToOutbox(mail.outboxDir, raw, recipient, subject);
      return { delivered: false, mode: file ? 'outbox' : 'disabled', file, ...(deliveryError ? { error: deliveryError } : {}) };
    },
  };
}

module.exports = {
  MailError,
  DEFAULTS,
  readMailConfig,
  parseAddress,
  encodeSubject,
  buildMessage,
  stuffDots,
  wrapText,
  toAscii,
  toAsciiText,
  smtpDeliver,
  createReplyReader,
  writeToOutbox,
  maskRecipient,
  createMailer,
};
