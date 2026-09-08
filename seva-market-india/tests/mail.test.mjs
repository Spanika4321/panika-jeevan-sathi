/**
 * SEVA MARKET INDIA — the mailer.
 *
 * Email is the only part of this app that speaks a protocol to something it
 * does not control, so it is tested against a real socket: a minimal SMTP
 * server runs on 127.0.0.1 and the transcript it receives is asserted line by
 * line. That is what proves EHLO/STARTTLS/AUTH/MAIL FROM/RCPT TO/DATA are
 * actually emitted in that order, rather than a mock agreeing with the code.
 *
 * The other half of the suite is the failure half: a refused connection, a
 * rejected recipient and a broken TLS upgrade must all resolve with a receipt
 * instead of throwing, because `send()` sits inside the signup request path.
 *
 * One rule for anyone adding a case here: never point the outbox at a path
 * outside a temp directory. `writeToOutbox` uses `fs.mkdirSync`, and a
 * synchronous mkdir against a kernel filesystem such as /proc does not return
 * on every platform — it takes the whole test process with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  readMailConfig, parseAddress, encodeSubject, buildMessage, stuffDots,
  wrapText, maskRecipient, createMailer, createReplyReader, toAsciiText,
} = require('../src/mail/mailer');
const templates = require('../src/mail/templates');

/* -------------------------------------------------- a minimal SMTP server --- */

/**
 * @param {object} [options]
 * @param {string[]} [options.capabilities] lines returned after EHLO
 * @param {number} [options.rcptCode] reply code for RCPT TO (550 = refused)
 * @param {boolean} [options.dropAfterGreeting] hang up immediately
 */
function startSmtpServer({ capabilities = ['AUTH PLAIN LOGIN', '8BITMIME'], rcptCode = 250, dropAfterGreeting = false } = {}) {
  const transcript = [];
  const messages = [];
  const sockets = new Set();

  const server = net.createServer((socket) => {
    // Tracked so close() can end a half-open connection: a client that
    // destroys its socket mid-conversation can otherwise leave the server
    // waiting for a connection that will never finish.
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 test.smtp ESMTP ready\r\n');
    if (dropAfterGreeting) { socket.end(); return; }

    let buffer = '';
    let inData = false;
    let dataChunks = [];
    let authStep = 0;

    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      // eslint-disable-next-line no-cond-assign
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push(dataChunks.join('\r\n'));
            dataChunks = [];
            socket.write('250 2.0.0 Ok: queued\r\n');
          } else {
            dataChunks.push(line);
          }
          continue;
        }

        transcript.push(line);
        const upper = line.toUpperCase();

        if (upper.startsWith('EHLO')) {
          socket.write(capabilities.map((cap, i) =>
            `${i === capabilities.length - 1 ? '250 ' : '250-'}${cap}\r\n`).join(''));
        } else if (upper.startsWith('HELO')) {
          socket.write('250 test.smtp\r\n');
        } else if (upper.startsWith('AUTH PLAIN')) {
          socket.write('235 2.7.0 Authentication successful\r\n');
        } else if (upper.startsWith('AUTH LOGIN')) {
          authStep = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (authStep === 1) {
          authStep = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (authStep === 2) {
          authStep = 0;
          socket.write('235 2.7.0 Authentication successful\r\n');
        } else if (upper.startsWith('MAIL FROM')) {
          socket.write('250 2.1.0 Ok\r\n');
        } else if (upper.startsWith('RCPT TO')) {
          socket.write(`${rcptCode} ${rcptCode === 250 ? '2.1.5 Ok' : '5.1.1 No such user'}\r\n`);
        } else if (upper === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else if (upper === 'RSET') {
          socket.write('250 2.0.0 Ok\r\n');
        } else {
          socket.write('500 5.5.2 Error: command not recognized\r\n');
        }
      }
    });
    socket.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        transcript,
        messages,
        close: () => new Promise((done) => {
          for (const socket of sockets) socket.destroy();
          sockets.clear();
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(done);
        }),
      });
    });
  });
}

/** A config pointing at the local test server. */
function smtpEnv(port, overrides = {}) {
  return {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_USER: 'mailer@seva.test',
    SMTP_PASS: 'correct-horse-battery',
    MAIL_FROM: 'SEVA MARKET INDIA <no-reply@seva.test>',
    SEVA_MAIL_OUTBOX_DIR: overrides.outboxDir || '',
    ...overrides,
  };
}

const sampleMessage = () => templates.verifyEmail({
  siteName: 'SEVA MARKET INDIA',
  fullName: 'Asha Devi',
  link: 'https://seva.test/verify-email?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  ttlMs: 48 * 60 * 60 * 1000,
});

/* ---------------------------------------------------------- configuration --- */

test('SMTP settings are read once, and the two port shapes are understood', () => {
  const starttls = readMailConfig({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'a@b.co' });
  assert.equal(starttls.port, 587);
  assert.equal(starttls.secure, false, 'port 587 means plaintext then STARTTLS');
  assert.equal(starttls.configured, true);

  const implicit = readMailConfig({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p' });
  assert.equal(implicit.secure, true, 'port 465 means implicit TLS');
  assert.equal(implicit.from.address, 'u', 'MAIL_FROM falls back to the SMTP user');

  const forced = readMailConfig({ SMTP_HOST: 'h', SMTP_PORT: '2525', SMTP_SECURE: 'true', SMTP_USER: 'u', SMTP_PASS: 'p' });
  assert.equal(forced.secure, true, 'SMTP_SECURE overrides the port heuristic');

  const partial = readMailConfig({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u' });
  assert.equal(partial.configured, false, 'a password is not optional');
  assert.equal(readMailConfig({}).configured, false);
});

test('the outbox exists in development and not on an ephemeral production host', () => {
  const dev = readMailConfig({}, { isProduction: false, root: '/srv/app' });
  assert.equal(dev.outboxDir, '/srv/app/data/outbox');

  const prod = readMailConfig({}, { isProduction: true, root: '/srv/app' });
  assert.equal(prod.outboxDir, null, 'a disk that is wiped at the next deploy is not a mail queue');

  const opted = readMailConfig({ SEVA_MAIL_OUTBOX: '1' }, { isProduction: true, root: '/srv/app' });
  assert.ok(opted.outboxDir, 'SEVA_MAIL_OUTBOX=1 opts back in deliberately');
});

test('a From address is parsed into a display name and an address', () => {
  assert.deepEqual(parseAddress('"SEVA MARKET INDIA" <No-Reply@Seva.test>'), { name: 'SEVA MARKET INDIA', address: 'no-reply@seva.test' });
  assert.deepEqual(parseAddress('no-reply@seva.test'), { name: '', address: 'no-reply@seva.test' });
  assert.deepEqual(parseAddress('Seva <a@b.co>\r\nBcc: evil@z.co'), { name: 'Seva', address: 'a@b.co' }, 'newlines cannot survive into a header');
});

/* --------------------------------------------------------- message building --- */

test('the wire message is CRLF, 7-bit ASCII and complete', () => {
  const message = sampleMessage();
  const raw = buildMessage({
    from: { name: 'SEVA MARKET INDIA', address: 'no-reply@seva.test' },
    to: 'asha@example.com',
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  assert.ok(raw.includes('\r\n'), 'headers are CRLF terminated');
  assert.ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(raw), 'nothing outside printable ASCII reaches the wire');
  for (const header of ['From: ', 'To: asha@example.com', 'Subject: ', 'Date: ', 'Message-ID: ', 'MIME-Version: 1.0']) {
    assert.ok(raw.includes(header), `missing ${header}`);
  }
  assert.ok(Math.max(...raw.split('\r\n').map((line) => line.length)) <= 998, 'no line may exceed the RFC limit');

  const headerEnd = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, headerEnd);
  const body = raw.slice(headerEnd + 4);
  const boundary = /boundary="(seva-[0-9a-f]{24})"/.exec(head)[1];
  const parts = body.split(`--${boundary}`).slice(1, 3);
  assert.equal(parts.length, 2, 'a text part and an HTML part');
  assert.match(parts[0], /Content-Type: text\/plain/);
  assert.match(parts[0], /Content-Transfer-Encoding: 7bit/);
  assert.match(parts[0], /verify-email\?token=AAAA/, 'the link survives into the text part');
  assert.match(parts[1], /Content-Type: text\/html/);
  assert.match(parts[1], /Confirm my email/, 'the button survives into the HTML part');
  assert.ok(body.endsWith(`--${boundary}--\r\n`), 'the multipart is closed');
});

test('a text-only message stays a single part', () => {
  const raw = buildMessage({ from: 'no-reply@seva.test', to: 'a@b.co', subject: 'Hello', text: 'Body line one.\n\nBody line two.' });
  assert.match(raw, /Content-Type: text\/plain; charset=us-ascii/);
  assert.doesNotMatch(raw, /multipart/);
  assert.match(raw, /\r\n\r\nBody line one\.\r\n\r\nBody line two\.\r\n$/);
});

test('a header cannot be forged through the subject or the recipient', () => {
  const raw = buildMessage({ from: 'no-reply@seva.test', to: 'a@b.co', subject: 'Hi\r\nBcc: evil@z.co', text: 'body' });
  const headers = raw.split('\r\n\r\n')[0].split('\r\n');
  assert.equal(headers.filter((line) => /^Bcc:/i.test(line)).length, 0, 'the injected Bcc must not become a header');
  assert.equal(headers.filter((line) => /^Subject:/i.test(line)).length, 1);

  assert.throws(
    () => buildMessage({ from: 'no-reply@seva.test', to: 'a@b.co\r\nBcc: evil@z.co', subject: 'x', text: 'y' }),
    /not an email address/,
  );
  assert.throws(() => buildMessage({ from: '', to: 'a@b.co', subject: 'x', text: 'y' }), /From address/);
  assert.throws(() => buildMessage({ from: 'a@b.co', to: 'a@b.co', subject: 'x', text: '   ' }), /text body/);
});

test('a non-ASCII subject is encoded, not mangled', () => {
  assert.equal(encodeSubject('Reset your password'), 'Reset your password');
  const encoded = encodeSubject('आपका पासवर्ड');
  assert.match(encoded, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  assert.equal(Buffer.from(encoded.slice(10, -2), 'base64').toString('utf8'), 'आपका पासवर्ड');
});

test('body text keeps its paragraphs, dot-stuffing and word wrapping', () => {
  assert.equal(toAsciiText('one\n\n\n\ntwo'), 'one\n\ntwo');
  assert.equal(toAsciiText('caf\u00e9 na\u00efve'), 'caf nave', 'non-ASCII is dropped so 7bit stays honest');
  assert.equal(stuffDots('.hidden\nnormal\n..double'), '..hidden\r\nnormal\r\n...double');
  const wrapped = wrapText(`word ${'x'.repeat(120)} tail`, 76);
  assert.ok(wrapped.split('\r\n').every((line, i) => i === 1 || line.length <= 76), 'a long token stays on its own line');
});

test('recipients are masked before they reach a log line', () => {
  assert.equal(maskRecipient('ramesh@example.com'), 'r****h@example.com', 'six-letter local part');
  assert.equal(maskRecipient('asha@example.com'), 'a**a@example.com');
  assert.equal(maskRecipient('ab@example.com'), 'a***@example.com');
  assert.equal(maskRecipient(''), '(unknown)');
  assert.ok(!maskRecipient('ramesh@example.com').includes('amesh'), 'the local part is not recoverable');
});

/* ------------------------------------------------------------ real SMTP --- */

test('a configured server receives the whole conversation in order', async () => {
  const server = await startSmtpServer();
  const logs = [];
  const mailer = createMailer({
    config: readMailConfig(smtpEnv(server.port), { isProduction: true }),
    log: (line) => logs.push(String(line)),
  });
  assert.equal(mailer.mode, 'smtp');

  const receipt = await mailer.send({ to: 'asha@example.com', ...sampleMessage() });
  assert.deepEqual(receipt, { delivered: true, mode: 'smtp' });

  const commands = server.transcript.filter((line) => !line.startsWith('.') && !/^[A-Za-z0-9+/=]{8,}$/.test(line));
  assert.match(commands[0], /^EHLO seva\.test$/, 'the EHLO domain comes from the From address');
  assert.ok(commands.some((line) => line.startsWith('AUTH ')), 'credentials are offered');
  assert.ok(commands.includes('MAIL FROM:<no-reply@seva.test>'));
  assert.ok(commands.includes('RCPT TO:<asha@example.com>'));
  assert.ok(commands.includes('DATA'));
  assert.ok(commands.includes('QUIT'));

  assert.equal(server.messages.length, 1);
  assert.match(server.messages[0], /^To: asha@example.com/m, 'the message the server queued is the one we built');
  assert.match(server.messages[0], /verify-email\?token=/);
  assert.deepEqual(logs, [], 'a successful send logs nothing');

  await server.close();
});

test('AUTH LOGIN is used when the server does not offer PLAIN', async () => {
  const server = await startSmtpServer({ capabilities: ['AUTH LOGIN', '8BITMIME'] });
  const mailer = createMailer({ config: readMailConfig(smtpEnv(server.port), { isProduction: true }) });

  const receipt = await mailer.send({ to: 'asha@example.com', ...sampleMessage() });
  assert.deepEqual(receipt, { delivered: true, mode: 'smtp' });

  const authIndex = server.transcript.findIndex((line) => line === 'AUTH LOGIN');
  assert.ok(authIndex > -1);
  assert.equal(server.transcript[authIndex + 1], Buffer.from('mailer@seva.test').toString('base64'));
  assert.equal(server.transcript[authIndex + 2], Buffer.from('correct-horse-battery').toString('base64'));

  await server.close();
});

test('STARTTLS is attempted when the server offers it', async () => {
  // The upgrade will fail: the test server is plaintext. What matters is that
  // the client asked, and that a failed handshake degrades to a receipt
  // instead of an exception or a silently downgraded connection.
  const outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'seva-mail-'));
  const server = await startSmtpServer({ capabilities: ['STARTTLS', 'AUTH PLAIN'] });
  const logs = [];
  const mailer = createMailer({
    config: readMailConfig(smtpEnv(server.port, { SEVA_MAIL_OUTBOX_DIR: outbox }), { isProduction: false }),
    log: (line) => logs.push(String(line)),
  });

  const receipt = await mailer.send({ to: 'asha@example.com', ...sampleMessage() });
  assert.equal(receipt.delivered, false, 'a plaintext server cannot complete a TLS upgrade');
  assert.ok(server.transcript.includes('STARTTLS'), 'the client upgraded rather than sending credentials in the clear');
  assert.ok(!server.transcript.some((line) => line.startsWith('AUTH ')), 'no credentials were sent before the upgrade');
  assert.equal(receipt.mode, 'outbox', 'the message is still recoverable locally');
  assert.ok(receipt.file && fs.existsSync(receipt.file));
  assert.match(logs.join('\n'), /SMTP delivery to a\*\*a@example\.com failed/, 'the failure is logged with a masked recipient');

  await server.close();
  fs.rmSync(outbox, { recursive: true, force: true });
});

test('a refused recipient is reported, not retried into oblivion', async () => {
  const server = await startSmtpServer({ rcptCode: 550 });
  const logs = [];
  const mailer = createMailer({
    config: readMailConfig(smtpEnv(server.port), { isProduction: true }),
    log: (line) => logs.push(String(line)),
  });

  const receipt = await mailer.send({ to: 'nobody@example.com', ...sampleMessage() });
  assert.equal(receipt.delivered, false);
  assert.equal(receipt.mode, 'disabled', 'production has no outbox to fall back on');
  assert.match(receipt.error, /RCPT TO .* was refused \(550\)/);
  assert.equal(server.messages.length, 0, 'nothing was queued for an address the server rejected');
  assert.equal(server.transcript.filter((line) => line === 'DATA').length, 0, 'the client stops before DATA');

  await server.close();
});

test('an unreachable SMTP server produces a receipt, not an exception', async () => {
  const logs = [];
  // Port 1 is closed: the connection is refused before any byte is written.
  const mailer = createMailer({
    config: readMailConfig({ ...smtpEnv(1), SMTP_TIMEOUT_MS: '800' }, { isProduction: true }),
    log: (line) => logs.push(String(line)),
  });

  const receipt = await mailer.send({ to: 'asha@example.com', ...sampleMessage() });
  assert.equal(receipt.delivered, false);
  assert.equal(receipt.mode, 'disabled', 'production has no outbox to fall back on');
  assert.match(receipt.error, /ECONNREFUSED|connection failed/i);
  assert.ok(!logs.join('\n').includes('correct-horse-battery'), 'a credential never reaches the log');
  assert.ok(!logs.join('\n').includes('token=AAAA'), 'a token never reaches the log');
});

test('a server that disappears mid-conversation is handled by the reply reader', async () => {
  // Driven by a fake socket rather than a real half-closed one: the interesting
  // behaviour is the reader's (an unterminated multi-line reply, a reply that
  // never comes, a peer that hangs up), and a fake socket makes all three
  // deterministic instead of racing the kernel's FIN/RST timing.
  const { EventEmitter } = await import('node:events');
  const socket = new EventEmitter();
  socket.setEncoding = () => {};
  socket.destroy = () => { socket.destroyed = true; };

  const reader = createReplyReader(socket, 80);

  // A continuation line ("250-…") is not a complete reply: the reader waits.
  socket.emit('data', Buffer.from('250-test.smtp\r\n250-STARTTLS\r\n'));
  const pending = reader.read();
  socket.emit('data', Buffer.from('250 OK\r\n'));
  const reply = await pending;
  assert.equal(reply.code, 250);
  assert.deepEqual(reply.lines, ['250-test.smtp', '250-STARTTLS', '250 OK']);

  // Two replies in one TCP segment are delivered to two separate waiters.
  const first = reader.read();
  const second = reader.read();
  socket.emit('data', Buffer.from('220 Ready\r\n221 Bye\r\n'));
  assert.equal((await first).code, 220);
  assert.equal((await second).code, 221);

  // No reply at all: the waiter is rejected and the socket is torn down.
  await assert.rejects(() => reader.read(), /timed out after 80ms/);
  assert.equal(socket.destroyed, true);

  // A peer that hangs up rejects the waiter instead of leaving it pending.
  const other = new EventEmitter();
  other.setEncoding = () => {};
  other.destroy = () => {};
  const waiting = createReplyReader(other, 5000).read();
  other.emit('close');
  await assert.rejects(() => waiting, /closed before the message was accepted/);
});

test('a malformed recipient is rejected before a socket is opened', async () => {
  const mailer = createMailer({
    config: readMailConfig(smtpEnv(1), { isProduction: true }),
    // A connect attempt here would throw and fail the test: the address is
    // refused while the message is still being built, before any transport.
    connect: () => { throw new Error('the transport must not be reached for a bad address'); },
  });

  const receipt = await mailer.send({ to: 'not-an-address', subject: 'x', text: 'y' });
  assert.equal(receipt.delivered, false);
  assert.equal(receipt.mode, 'rejected');

  const injection = await mailer.send({ to: 'a@b.co\r\nBcc: evil@z.co', subject: 'x', text: 'y' });
  assert.equal(injection.mode, 'rejected', 'a recipient with a newline is not an address');
});

test('without SMTP the message lands in a private outbox file', async () => {
  const outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'seva-mail-'));
  const logs = [];
  const mailer = createMailer({
    config: readMailConfig({ SEVA_MAIL_OUTBOX_DIR: outbox }, { isProduction: false }),
    log: (line) => logs.push(String(line)),
  });
  assert.equal(mailer.mode, 'outbox');
  assert.equal(mailer.configured, false);

  const receipt = await mailer.send({ to: 'asha@example.com', ...sampleMessage() });
  assert.equal(receipt.delivered, false);
  assert.equal(receipt.mode, 'outbox');

  const files = fs.readdirSync(outbox);
  assert.equal(files.length, 1);
  const saved = fs.readFileSync(path.join(outbox, files[0]), 'utf8');
  assert.match(saved, /^To: asha@example.com\r$/m);
  assert.match(saved, /verify-email\?token=/, 'a developer can still click the link locally');
  assert.equal(fs.statSync(path.join(outbox, files[0])).mode & 0o077, 0, 'the file is owner-only');

  assert.match(logs.join('\n'), /SMTP is not configured/, 'the boot-style warning explains where the mail went');
  assert.ok(!logs.join('\n').includes('token='), 'the log names the file, not the link');

  await mailer.send({ to: 'second@example.com', ...sampleMessage() });
  assert.equal(logs.filter((line) => line.includes('SMTP is not configured')).length, 1, 'said once, not per message');

  fs.rmSync(outbox, { recursive: true, force: true });
});

test('an unwritable outbox is not a failed request', async () => {
  // The outbox directory sits underneath a regular file, so mkdir fails with
  // ENOTDIR. (A kernel filesystem such as /proc is not usable here: a
  // synchronous mkdir against it never returns, and `writeToOutbox` is sync.)
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seva-blocker-')), 'not-a-dir.txt');
  fs.writeFileSync(blocker, 'x');

  const mailer = createMailer({
    config: readMailConfig({ SEVA_MAIL_OUTBOX_DIR: path.join(blocker, 'outbox') }, { isProduction: false }),
  });
  const receipt = await mailer.send({ to: 'asha@example.com', ...sampleMessage() });
  assert.equal(receipt.delivered, false);
  assert.equal(receipt.mode, 'disabled', 'a broken outbox degrades to "not delivered"');
  assert.equal(receipt.file, null);

  fs.rmSync(path.dirname(blocker), { recursive: true, force: true });
});

test('the two templates carry the link, the lifetime and the do-not-share warning', () => {
  const verify = templates.verifyEmail({ siteName: 'SEVA MARKET INDIA', fullName: 'Asha Devi', link: 'https://seva.test/verify-email?token=T', ttlMs: 48 * 3600 * 1000 });
  assert.match(verify.subject, /Confirm your email/);
  assert.match(verify.text, /https:\/\/seva\.test\/verify-email\?token=T/);
  assert.match(verify.text, /works once and expires in 2 days/);
  assert.match(verify.text, /ignore this email/);
  assert.match(verify.html, /Confirm my email/);

  const reset = templates.passwordReset({ siteName: 'SEVA MARKET INDIA', fullName: '', link: 'https://seva.test/reset-password?token=T', ttlMs: 3600 * 1000 });
  assert.match(reset.subject, /Reset your password/);
  assert.match(reset.text, /expires in 60 minutes/);
  assert.match(reset.text, /Namaste there/, 'a missing name degrades instead of printing "undefined"');
  assert.match(reset.text, /never ask for your password|will ever call/i);

  const hostile = templates.verifyEmail({ siteName: 'SEVA', fullName: '<img src=x onerror=alert(1)>', link: 'https://seva.test/v?token=T', ttlMs: 1000 });
  assert.ok(!hostile.html.includes('onerror=alert'), 'a display name cannot inject markup into an inbox');
  assert.ok(hostile.html.includes('&lt;img'), 'it is escaped, not dropped');
});

