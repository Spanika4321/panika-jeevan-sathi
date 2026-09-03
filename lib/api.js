'use strict';
/**
 * PANIKA JEEVAN SATHI - REST API (JSON over HTTP, cookie sessions).
 * Zero third-party dependencies.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('./auth');
const profiles = require('./profiles');
const settingsLib = require('./settings');
const mailer = require('./mailer');
const owner = require('./owner');
const photosLib = require('./photos');

const UPLOAD_DIR_NAME = 'uploads';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/* Process start time (epoch ms). Exposed by /api/health as boot_at so an
   external prover can tell a restart/sleep-wake (new boot_at) from a warm
   process (same boot_at). */
const BOOT_AT = Date.now();

/* ------------------------------------------------------------------ utils */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function ok(res, payload) {
  sendJson(res, 200, Object.assign({ ok: true }, payload || {}));
}

function fail(res, status, message, extra) {
  sendJson(res, status, Object.assign({ ok: false, error: message }, extra || {}));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function str(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}

function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${host}`;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ----------------------------------------------------------------- factory */

function createApi(options) {
  const db = options.db;
  const secret = options.secret;
  const dataDir = options.dataDir;
  // Photo storage: a plain folder, or a folder backed by Cloudflare R2 when the
  // host has no persistent disk (Render Free).
  const photos = options.photos || photosLib.createStore({ dataDir, dirName: UPLOAD_DIR_NAME });
  const uploadDir = photos.dir;
  const outboxDir = path.join(dataDir, 'outbox');
  fs.mkdirSync(outboxDir, { recursive: true });

  const rateLimit = new Map();
  function throttled(key, limit, windowMs) {
    const now = Date.now();
    const entry = rateLimit.get(key);
    if (!entry || entry.reset < now) {
      rateLimit.set(key, { count: 1, reset: now + windowMs });
      return false;
    }
    entry.count += 1;
    return entry.count > limit;
  }

  /* ------------------------------------------------------------- entities */

  async function notify(userId, type, title, body, link) {
    if (!userId) return;
    await db.insert('notifications', {
      user_id: userId,
      type,
      title: title || '',
      body: body || '',
      link: link || '',
      is_read: 0,
      created_at: Date.now()
    });
  }

  async function userRow(id) {
    return await db.one('users', { id: Number(id) });
  }

  async function profileRow(userId) {
    return await db.one('profiles', { user_id: Number(userId) });
  }

  function serializeUser(user, opts = {}) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: opts.private ? user.email : undefined,
      role: user.role,
      status: user.status,
      email_verified: Number(user.email_verified) === 1,
      photo: user.photo || null,
      last_login: user.last_login || 0,
      created_at: user.created_at
    };
  }

  /** Attach the owner's user record to a profile row for display purposes. */
  async function decorate(profile) {
    const user = await userRow(profile.user_id);
    if (!user) return null;
    return Object.assign({}, profile, {
      name: user.name,
      email: undefined,
      user_status: user.status,
      photo: user.photo || null,
      created_at: user.created_at
    });
  }

  async function visibleUsers() {
    const rows = await db.all('profiles');
    const out = [];
    for (const row of rows) {
      const user = await userRow(row.user_id);
      if (!user || user.status !== 'active') continue;
      if (row.visibility === 'hidden') continue;
      const full = await decorate(row);
      if (full) out.push(full);
    }
    return out;
  }

  async function acceptedPair(a, b) {
    const row = await db.one('interests', { from_user_id: a, to_user_id: b, status: 'accepted' });
    return Boolean(row) ||
      Boolean(await db.one('interests', { from_user_id: b, to_user_id: a, status: 'accepted' }));
  }

  async function unreadCounts(userId) {
    const messages = await db.count('messages', { receiver_id: userId, read_at: 0 });
    const notifications = await db.count('notifications', { user_id: userId, is_read: 0 });
    const interests = await db.count('interests', { to_user_id: userId, status: 'pending' });
    return { messages, notifications, interests, total: messages + notifications + interests };
  }

  /* ------------------------------------------------------------- sessions */

  async function promoteOwner(user) {
    if (!user || !owner.isOwnerEmail(user.email)) return user;
    if (user.role === 'admin' && user.status === 'active' && Number(user.email_verified) === 1) return user;
    await db.update(
      'users',
      { id: user.id },
      { role: 'admin', status: 'active', email_verified: 1, verification_token: null }
    );
    return await userRow(user.id) || user;
  }

  async function currentUser(req) {
    const cookies = auth.parseCookies(req.headers.cookie);
    const payload = auth.readSession(cookies[auth.SESSION_COOKIE], secret);
    if (!payload) return null;
    let user = await userRow(payload.uid);
    if (!user) return null;
    user = await promoteOwner(user);
    if (user.status !== 'active' && user.role !== 'admin') return null;
    if (Number(user.token_version || 1) !== Number(payload.tv)) return null;
    return user;
  }

  function issueSession(res, user, req) {
    const token = auth.createSession(user.id, Number(user.token_version || 1), secret);
    const secure = String(req.headers['x-forwarded-proto'] || '') === 'https';
    res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure }));
  }

  /* ---------------------------------------------------------------- photos */

  function photoExtension(buffer) {
    if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
      return 'jpg';
    if (
      buffer.length > 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    )
      return 'png';
    if (
      buffer.length > 12 &&
      buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
      buffer.slice(8, 12).toString('ascii') === 'WEBP'
    )
      return 'webp';
    return null;
  }

  async function deletePhotoFile(photoPath) {
    await photos.remove(photoPath);
  }

  async function savePhoto(userId, dataUrl) {
    const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(
      str(dataUrl)
    );
    if (!match) throw Object.assign(new Error('Please choose a JPG, PNG or WEBP image.'), { status: 400 });
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (!buffer.length) throw Object.assign(new Error('That image could not be read.'), { status: 400 });
    if (buffer.length > MAX_PHOTO_BYTES)
      throw Object.assign(new Error('Image is too large (max 4 MB).'), { status: 413 });
    const ext = photoExtension(buffer);
    if (!ext) throw Object.assign(new Error('That file is not a valid image.'), { status: 400 });

    const name = `u${userId}-${Date.now()}.${ext}`;
    const previous = await userRow(userId);
    const url = await photos.save(name, buffer, `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    await db.update('users', { id: userId }, { photo: url });
    // Delete the old object only after the new path is recorded remotely.
    // Reversing this left a window where the DB pointed at a deleted file.
    if (previous && previous.photo && previous.photo !== url) {
      try {
        await deletePhotoFile(previous.photo);
      } catch (_) {
        /* orphan old object is better than a missing current photo */
      }
    }
    return url;
  }

  /* ------------------------------------------------------------- mail */

  async function sendVerificationMail(user, token, req) {
    const link = `${baseUrl(req)}/verify-email.html?token=${encodeURIComponent(token)}`;
    const siteName = await settingsLib.get(db, 'site_name');
    const result = await mailer.send(
      {
        to: user.email,
        subject: `Verify your ${siteName} account`,
        text: `Namaste ${user.name},\n\nPlease verify your email address to activate your matrimonial profile:\n\n${link}\n\nIf you did not create this account, ignore this email.\n\n— ${siteName} (100% free service)`
      },
      outboxDir
    );
    return { link, result };
  }

  async function sendResetMail(user, token, req) {
    const link = `${baseUrl(req)}/reset-password.html?token=${encodeURIComponent(token)}`;
    const siteName = await settingsLib.get(db, 'site_name');
    const result = await mailer.send(
      {
        to: user.email,
        subject: `Reset your ${siteName} password`,
        text: `Namaste ${user.name},\n\nUse this link to set a new password (valid for 1 hour):\n\n${link}\n\nIf you did not request this, you can safely ignore the email.\n\n— ${siteName}`
      },
      outboxDir
    );
    return { link, result };
  }

  /* -------------------------------------------------------------- handlers */

  const routes = [];
  function route(method, pattern, handler) {
    const parts = pattern.split('/').filter(Boolean);
    routes.push({
      method,
      parts,
      pattern,
      handler
    });
  }

  function matchRoute(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    for (const entry of routes) {
      if (entry.method !== method) continue;
      if (entry.parts.length !== parts.length) continue;
      const params = {};
      let matched = true;
      for (let i = 0; i < parts.length; i++) {
        const expected = entry.parts[i];
        if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(parts[i]);
        else if (expected !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: entry.handler, params };
    }
    return null;
  }

  /* ---------------------------------------------------------- public site */

  route('GET', '/api/health', async () => {
    const storage = db.kind || 'unknown';
    const photoKind = photos.kind;
    const durable = (storage === 'supabase' || storage === 'd1') && Boolean(photos.remote);
    return {
      status: 200,
      body: {
      ok: true,
      service: 'panika-jeevan-sathi',
      time: Date.now(),
      boot_at: BOOT_AT,
      storage,
        photos: photoKind,
        durable,
        data_loss_risk: durable ? false : storage === 'sqlite' || storage === 'json' || !photos.remote,
        remote: options.remoteStatus ? options.remoteStatus() : null
      }
    };
  });

  route('GET', '/api/site', async () => ({
    status: 200,
    body: { ok: true, site: await settingsLib.publicSite(db), options: profiles.OPTION_SETS }
  }));

  /*
   * Anonymous aggregate daily analytics — Aman (daily site & member report
   * agent) ise consume karta hai. Sirf totals/counters return hote hain:
   * koi raw IP, koi user data, koi private field nahi. Production Supabase
   * par tables tab tak khali hain jab tak supabase/schema.sql ek baar nahi
   * chalta — tab bhi ye endpoint sirf zeros ke saath kaam karta hai.
   */
  route('GET', '/api/analytics/daily', async (ctx) => {
    const requested = Number(ctx.query.get('days') || '');
    const days = Math.min(90, Math.max(1, Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 14));
    const nowMs = Date.now();
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const start = new Date(nowMs - (days - 1) * 86400000).toISOString().slice(0, 10);
    const dayStartMs = Date.parse(`${today}T00:00:00.000Z`);

    let tracking = true;
    let rows = [];
    try {
      rows = await db.all('site_stats', { day: { gte: start } }, { order: 'day' });
    } catch (err) {
      tracking = false;
      console.error('[analytics] /api/analytics/daily — stats unavailable:', err.message);
    }
    const byDay = new Map();
    for (const r of rows) byDay.set(String(r.day), r);

    const history = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(Date.parse(start + 'T00:00:00.000Z') + i * 86400000).toISOString().slice(0, 10);
      const r = byDay.get(d);
      history.push({
        day: d,
        visits: r ? Number(r.visits || 0) : 0,
        visitors: r ? Number(r.visitors || 0) : 0
      });
    }

    // Live member totals (site counter jaisa hi: profiles = members).
    let members = 0;
    let usersTotal = 0;
    let newMembersToday = 0;
    try {
      members = await db.count('profiles');
    } catch (err) {
      console.error('[analytics] profiles count failed:', err.message);
    }
    try {
      usersTotal = await db.count('users');
    } catch (err) {
      console.error('[analytics] users count failed:', err.message);
    }
    try {
      newMembersToday = await db.count('users', {
        created_at: { gte: dayStartMs },
        role: { ne: 'admin' }
      });
    } catch (err) {
      console.error('[analytics] new-members count failed:', err.message);
    }

    const todayRow = history[history.length - 1] || { day: today, visits: 0, visitors: 0 };
    const yesterdayRow = history.length > 1 ? history[history.length - 2] : null;
    return {
      status: 200,
      body: {
        ok: true,
        tz: 'UTC',
        generated_at: nowMs,
        tracking,
        today,
        today_stats: { visits: todayRow.visits, visitors: todayRow.visitors },
        yesterday_stats: yesterdayRow ? { visits: yesterdayRow.visits, visitors: yesterdayRow.visitors } : null,
        totals: {
          members,
          users: usersTotal,
          new_members_today: newMembersToday
        },
        history,
        note: tracking
          ? undefined
          : 'site_stats/site_visitors tables abhi available nahi hain — supabase/schema.sql ek baar SQL editor mein chalao.'
      }
    };
  });

  route('GET', '/api/stories', async () => ({
    status: 200,
    body: {
      ok: true,
      stories: (await db.all('stories', { approved: 1 }, { order: '-created_at', limit: 12 })).map((s) => ({
          id: s.id,
          title: s.title,
          couple: s.couple,
          location: s.location,
          body: s.body,
          photo: s.photo || null,
          created_at: s.created_at
        }))
    }
  }));

  route('POST', '/api/contact', async (ctx) => {
    const body = ctx.body;
    const name = str(body.name);
    const message = str(body.message);
    if (name.length < 2) return fail(ctx.res, 400, 'Please enter your name.');
    if (message.length < 5) return fail(ctx.res, 400, 'Please write your message.');
    const email = str(body.email);
    if (email && !isEmail(email)) return fail(ctx.res, 400, 'Please enter a valid email address.');
    if (throttled(`contact:${ctx.ip}`, 5, 10 * 60000))
      return fail(ctx.res, 429, 'Too many messages. Please try again later.');
    await db.insert('contact_messages', {
      name,
      email,
      phone: str(body.phone),
      subject: str(body.subject),
      message,
      handled: 0,
      created_at: Date.now()
    });
    return ok(ctx.res, { message: 'Thank you! Our team will contact you shortly.' });
  });

  /* ----------------------------------------------------------------- auth */

  route('POST', '/api/auth/register', async (ctx) => {
    const body = ctx.body;
    const name = str(body.name);
    const email = str(body.email).toLowerCase();
    const password = str(body.password);

    if (name.length < 2) return fail(ctx.res, 400, 'Please enter your full name.');
    if (!isEmail(email)) return fail(ctx.res, 400, 'Please enter a valid email address.');
    const pwProblem = auth.passwordProblem(password);
    if (pwProblem) return fail(ctx.res, 400, pwProblem);
    if (throttled(`register:${ctx.ip}`, 8, 60 * 60000))
      return fail(ctx.res, 429, 'Too many sign-ups from this device. Please try again later.');

    if (await db.one('users', { email }))
      return fail(ctx.res, 409, 'An account with this email already exists. Please log in.');

    const requireVerification = await settingsLib.get(db, 'require_email_verification') === '1';
    const now = Date.now();
    const asAdmin = owner.isOwnerEmail(email);
    const user = await db.insert('users', {
      email,
      password_hash: auth.hashPassword(password),
      name,
      role: asAdmin ? 'admin' : 'user',
      status: 'active',
      email_verified: requireVerification && !asAdmin ? 0 : 1,
      verification_token: auth.randomToken(24),
      reset_token: null,
      reset_expires: 0,
      token_version: 1,
      photo: null,
      last_login: now,
      created_at: now
    });

    await db.insert('profiles', {
      user_id: user.id,
      headline: '',
      phone: '',
      hide_photo: 0,
      hide_contact: 0,
      searchable: 1,
      about_me: '',
      pref_message: '',
      gender: ['male', 'm', 'man'].includes(str(body.gender).toLowerCase())
        ? 'Male'
        : ['female', 'f', 'woman'].includes(str(body.gender).toLowerCase())
          ? 'Female'
          : '',
      city: str(body.city),
      state: str(body.state),
      community: str(body.community),
      religion: str(body.religion),
      pref_gender: ['male', 'm', 'man'].includes(str(body.looking_for).toLowerCase())
        ? 'Male'
        : ['female', 'f', 'woman'].includes(str(body.looking_for).toLowerCase())
          ? 'Female'
          : '',
      visibility: 'members',
      updated_at: now,
      profile_complete: 0
    });

    let verification = null;
    if (requireVerification && !asAdmin) {
      verification = await sendVerificationMail(user, user.verification_token, ctx.req);
      await notify(
        user.id,
        'system',
        'Verify your email address',
        'Your profile becomes searchable once your email is verified.',
        `/verify-email.html?token=${encodeURIComponent(user.verification_token)}`
      );
    } else {
      await notify(
        user.id,
        'system',
        'Welcome to PANIKA JEEVAN SATHI',
        'Complete your profile so families can find you. Every feature is 100% free.',
        '/edit-profile.html'
      );
    }

    issueSession(ctx.res, await db.one('users', { id: user.id }), ctx.req);
    return ok(ctx.res, {
      user: serializeUser(await db.one('users', { id: user.id }), { private: true }),
      email_delivered: Boolean(verification && verification.result.delivered),
      verification_link: verification ? verification.link : null,
      verification_required: requireVerification,
      message: requireVerification
        ? 'Account created. Please verify your email to continue.'
        : 'Account created successfully. Welcome!'
    });
  });

  route('POST', '/api/auth/login', async (ctx) => {
    const body = ctx.body;
    const email = str(body.email).toLowerCase();
    const password = str(body.password);
    if (!isEmail(email) || !password)
      return fail(ctx.res, 400, 'Please enter your email and password.');
    if (throttled(`login:${ctx.ip}:${email}`, 10, 10 * 60000))
      return fail(ctx.res, 429, 'Too many login attempts. Please try again in 10 minutes.');

    let user = await db.one('users', { email });
    if (!user || !auth.verifyPassword(password, user.password_hash))
      return fail(ctx.res, 401, 'Incorrect email or password.');
    user = await promoteOwner(user);
    if (user.status === 'suspended')
      return fail(ctx.res, 403, 'This account has been suspended. Please contact support.');
    if (user.status === 'deleted')
      return fail(ctx.res, 403, 'This account no longer exists.');

    if (Number(user.email_verified) !== 1) {
      const token = user.verification_token || auth.randomToken(24);
      if (!user.verification_token)
        await db.update('users', { id: user.id }, { verification_token: token });
      const verification = await sendVerificationMail(await db.one('users', { id: user.id }), token, ctx.req);
      return fail(ctx.res, 403, 'Please verify your email address before logging in.', {
        code: 'email_not_verified',
        email,
        email_delivered: Boolean(verification.result.delivered),
        verification_link: verification.link
      });
    }

    await db.update('users', { id: user.id }, { last_login: Date.now() });
    const fresh = await db.one('users', { id: user.id });
    issueSession(ctx.res, fresh, ctx.req);
    if (fresh.role === 'admin') {
      await audit(fresh, 'admin.login', { target_type: 'user', target_id: fresh.id, detail: '' });
    }
    return ok(ctx.res, {
      user: serializeUser(fresh, { private: true }),
      counts: await unreadCounts(fresh.id),
      message: `Welcome back, ${fresh.name}!`,
      redirect: fresh.role === 'admin' ? '/admin.html' : '/dashboard.html'
    });
  });

  route('POST', '/api/auth/logout', async (ctx) => {
    const user = ctx.user;
    if (user) {
      if (user.role === 'admin') {
        await audit(user, 'admin.logout', { target_type: 'user', target_id: user.id, detail: '' });
      }
      await db.update('users', { id: user.id }, { token_version: Number(user.token_version || 1) + 1 });
    }
    ctx.res.setHeader('Set-Cookie', auth.clearSessionCookie());
    return ok(ctx.res, { message: 'You have been logged out.' });
  });

  route('GET', '/api/auth/verify', async (ctx) => {
    const token = str(ctx.query.get('token'));
    if (!token) return fail(ctx.res, 400, 'Verification link is invalid.');
    const user = await db.one('users', { verification_token: token });
    if (!user) return fail(ctx.res, 400, 'This verification link is invalid or already used.');
    await db.update(
      'users',
      { id: user.id },
      { email_verified: 1, verification_token: null }
    );
    await notify(user.id, 'system', 'Email verified', 'Your email is verified. Your profile is now live.', '/dashboard.html');
    return ok(ctx.res, { message: 'Email verified successfully. You can log in now.', email: user.email });
  });

  route('POST', '/api/auth/resend-verification', async (ctx) => {
    const email = str(ctx.body.email).toLowerCase();
    const user = await db.one('users', { email });
    if (!user) return fail(ctx.res, 404, 'No account found with that email.');
    if (Number(user.email_verified) === 1)
      return fail(ctx.res, 400, 'This email is already verified. Please log in.');
    const token = auth.randomToken(24);
    await db.update('users', { id: user.id }, { verification_token: token });
    const verification = await sendVerificationMail(user, token, ctx.req);
    return ok(ctx.res, {
      message: 'Verification link sent again.',
      email_delivered: Boolean(verification.result.delivered),
      verification_link: verification.link
    });
  });

  route('POST', '/api/auth/forgot', async (ctx) => {
    const email = str(ctx.body.email).toLowerCase();
    if (!isEmail(email)) return fail(ctx.res, 400, 'Please enter a valid email address.');
    const user = await db.one('users', { email });
    if (!user) {
      // Do not reveal whether the account exists.
      return ok(ctx.res, {
        message: 'If that email is registered, a password reset link has been sent.'
      });
    }
    const token = auth.randomToken(24);
    await db.update('users', { id: user.id }, { reset_token: token, reset_expires: Date.now() + 3600000 });
    const result = await sendResetMail(user, token, ctx.req);
    return ok(ctx.res, {
      message: 'If that email is registered, a password reset link has been sent.',
      email_delivered: Boolean(result.result.delivered),
      reset_link: user.email === email ? result.link : null
    });
  });

  route('POST', '/api/auth/reset', async (ctx) => {
    const token = str(ctx.body.token);
    const password = str(ctx.body.password);
    const problem = auth.passwordProblem(password);
    if (problem) return fail(ctx.res, 400, problem);
    const user = await db.one('users', { reset_token: token });
    if (!user || !user.reset_expires || user.reset_expires < Date.now())
      return fail(ctx.res, 400, 'This reset link is invalid or has expired.');
    await db.update(
      'users',
      { id: user.id },
      {
        password_hash: auth.hashPassword(password),
        reset_token: null,
        reset_expires: 0,
        token_version: Number(user.token_version || 1) + 1
      }
    );
    await notify(user.id, 'system', 'Password changed', 'Your password was reset successfully.', '/settings.html');
    return ok(ctx.res, { message: 'Password updated. You can log in with your new password.' });
  });

  /* ------------------------------------------------------------ my account */

  route('GET', '/api/me', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const user = ctx.user;
    const profile = await profileRow(user.id);
    return ok(ctx.res, {
      user: serializeUser(user, { private: true }),
      profile: profile ? profiles.publicProfile(profile, user.id) : null,
      counts: await unreadCounts(user.id),
      completeness: profiles.completeness(profile),
      options: profiles.OPTION_SETS
    });
  });

  route('POST', '/api/me/password', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const current = str(ctx.body.current_password);
    const next = str(ctx.body.new_password);
    if (!auth.verifyPassword(current, ctx.user.password_hash))
      return fail(ctx.res, 400, 'Your current password is incorrect.');
    const problem = auth.passwordProblem(next);
    if (problem) return fail(ctx.res, 400, problem);
    await db.update(
      'users',
      { id: ctx.user.id },
      {
        password_hash: auth.hashPassword(next),
        token_version: Number(ctx.user.token_version || 1) + 1
      }
    );
    const fresh = await db.one('users', { id: ctx.user.id });
    issueSession(ctx.res, fresh, ctx.req);
    return ok(ctx.res, { message: 'Password updated successfully.' });
  });

  route('POST', '/api/me/name', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const name = str(ctx.body.name);
    if (name.length < 2) return fail(ctx.res, 400, 'Please enter your full name.');
    await db.update('users', { id: ctx.user.id }, { name: name.slice(0, 80) });
    return ok(ctx.res, { message: 'Name updated.' });
  });

  route('DELETE', '/api/me', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    if (ctx.user.role === 'admin')
      return fail(ctx.res, 400, 'Admin accounts cannot be deleted from settings.');
    await deleteUserAccount(ctx.user.id);
    ctx.res.setHeader('Set-Cookie', auth.clearSessionCookie());
    return ok(ctx.res, { message: 'Your account has been deleted.' });
  });

  async function deleteUserAccount(userId) {
    const user = await userRow(userId);
    await deletePhotoFile(user && user.photo);
    await db.remove('profiles', { user_id: userId });
    await db.remove('interests', { from_user_id: userId });
    await db.remove('interests', { to_user_id: userId });
    await db.remove('shortlist', { user_id: userId });
    await db.remove('shortlist', { target_user_id: userId });
    await db.remove('messages', { sender_id: userId });
    await db.remove('messages', { receiver_id: userId });
    await db.remove('notifications', { user_id: userId });
    await db.remove('reports', { reporter_id: userId });
    await db.remove('reports', { target_user_id: userId });
    await db.remove('users', { id: userId });
  }

  /* -------------------------------------------------------------- profile */

  route('GET', '/api/profile', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const profile = await profileRow(ctx.user.id);
    if (!profile) {
      await db.insert('profiles', {
        user_id: ctx.user.id,
        visibility: 'members',
        hide_photo: 0,
        hide_contact: 0,
        searchable: 1,
        profile_complete: 0,
        updated_at: Date.now()
      });
      return ok(ctx.res, { profile: await db.one('profiles', { user_id: ctx.user.id }) });
    }
    return ok(ctx.res, { profile, completeness: profiles.completeness(profile) });
  });

  route('PUT', '/api/profile', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const { data, errors } = profiles.validatePatch(ctx.body);
    if (errors.length) return fail(ctx.res, 400, errors[0], { errors });
    const existing = await profileRow(ctx.user.id);
    data.updated_at = Date.now();
    if (existing) {
      await db.update('profiles', { user_id: ctx.user.id }, data);
    } else {
      await db.insert('profiles', Object.assign({ user_id: ctx.user.id }, data));
    }
    const saved = await profileRow(ctx.user.id);
    await db.update('profiles', { user_id: ctx.user.id }, { profile_complete: profiles.completeness(saved) });
    const updated = await profileRow(ctx.user.id);
    await notify(
      ctx.user.id,
      'system',
      'Profile saved',
      `Your profile is ${profiles.completeness(updated)}% complete.`,
      '/dashboard.html'
    );
    return ok(ctx.res, {
      profile: updated,
      completeness: profiles.completeness(updated),
      message: 'Profile saved successfully.'
    });
  });

  route('POST', '/api/profile/photo', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    try {
      const url = await savePhoto(ctx.user.id, ctx.body.data_url);
      return ok(ctx.res, { photo: url, message: 'Photo updated successfully.' });
    } catch (err) {
      return fail(ctx.res, err.status || 500, err.message);
    }
  });

  route('DELETE', '/api/profile/photo', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    await deletePhotoFile(ctx.user.photo);
    await db.update('users', { id: ctx.user.id }, { photo: null });
    return ok(ctx.res, { message: 'Photo removed.' });
  });

  /* ------------------------------------------------------------ discovery */

  route('GET', '/api/profiles/:id', async (ctx) => {
    const id = Number(ctx.params.id);
    const profile = await profileRow(id);
    if (!profile) return fail(ctx.res, 404, 'Profile not found.');
    const owner = await userRow(id);
    if (!owner || owner.status !== 'active')
      return fail(ctx.res, 404, 'This profile is not available.');
    const viewer = ctx.user;
    if (!viewer && profile.visibility !== 'everyone')
      return fail(ctx.res, 401, 'Please log in to view this profile.');
    if (profile.visibility === 'hidden' && (!viewer || (viewer.id !== id && viewer.role !== 'admin')))
      return fail(ctx.res, 404, 'This profile is not available.');

    const isOwner = viewer && viewer.id === id;
    const publicProfile = profiles.publicProfile(profile, viewer ? viewer.id : null, {
      isAdmin: viewer && viewer.role === 'admin'
    });
    const payload = {
      id: owner.id,
      name: owner.name,
      photo: Number(profile.hide_photo) === 1 && !isOwner ? null : owner.photo || null,
      profile: publicProfile,
      interest_state: null,
      shortlisted: false,
      can_message: false
    };

    if (viewer && !isOwner) {
      const sent = await db.one('interests', { from_user_id: viewer.id, to_user_id: id });
      const received = await db.one('interests', { from_user_id: id, to_user_id: viewer.id });
      payload.interest_state = {
        sent: sent ? sent.status : null,
        received: received ? received : null
      };
      payload.shortlisted = Boolean(
        await db.one('shortlist', { user_id: viewer.id, target_user_id: id })
      );
      payload.can_message = await acceptedPair(viewer.id, id);
      if (Number(profile.searchable) === 1) {
        const link = `/profile.html?id=${viewer.id}`;
        const dayAgo = Date.now() - 86400000;
        const already = (await db.all('notifications', { user_id: id, type: 'view', link })).some(
          (n) => n.created_at > dayAgo
        );
        if (!already) {
          await notify(id, 'view', 'Someone viewed your profile', `${viewer.name} viewed your profile.`, link);
        }
      }
    } else if (isOwner) {
      payload.can_message = false;
    }
    return ok(ctx.res, payload);
  });

  route('GET', '/api/profiles', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to search profiles.');
    const filter = profiles.buildFilter(ctx.queryObject, ctx.user.id);
    const candidates = (await visibleUsers()).filter(
      (p) => Number(p.searchable) === 1 && p.user_id !== ctx.user.id
    );
    const matched = candidates.filter((p) => filter(p, { photo: p.photo }));
    const viewerProfile = await profileRow(ctx.user.id);
    const decorated = [];
    for (const p of matched) {
      const { score, reasons } = profiles.matchScore(viewerProfile, p, { photo: p.photo });
      decorated.push({ card: await cardFor(p, ctx.user.id), score, reasons });
    }

    const sort = String(ctx.query.get('sort') || 'score');
    decorated.sort((a, b) => {
      if (sort === 'age_asc') return (a.card.age || 999) - (b.card.age || 999);
      if (sort === 'age_desc') return (b.card.age || 0) - (a.card.age || 0);
      if (sort === 'recent') return (b.card.created_at || 0) - (a.card.created_at || 0);
      return b.score - a.score || (b.card.created_at || 0) - (a.card.created_at || 0);
    });

    const page = Math.max(1, Number(ctx.query.get('page') || 1));
    const perPage = Math.min(60, Math.max(1, Number(ctx.query.get('per_page') || 12)));
    const start = (page - 1) * perPage;
    return ok(ctx.res, {
      total: decorated.length,
      page,
      per_page: perPage,
      pages: Math.max(1, Math.ceil(decorated.length / perPage)),
      results: decorated.slice(start, start + perPage).map((d) => d.card)
    });
  });

  async function cardFor(p, viewerId) {
    const received = await db.count('interests', { from_user_id: p.user_id, status: 'accepted' });
    let interest = null;
    let shortlisted = false;
    let can_message = false;
    if (viewerId) {
      const sent = await db.one('interests', { from_user_id: viewerId, to_user_id: p.user_id });
      if (sent) interest = sent.status;
      shortlisted = Boolean(await db.one('shortlist', { user_id: viewerId, target_user_id: p.user_id }));
      can_message = await acceptedPair(viewerId, p.user_id);
    }
    return {
      interest,
      shortlisted,
      can_message,
      id: p.user_id,
      name: p.name,
      age: p.age,
      gender: p.gender,
      headline: p.headline,
      city: p.city,
      state: p.state,
      community: p.community,
      religion: p.religion,
      education: p.education,
      occupation: p.occupation,
      marital_status: p.marital_status,
      height_cm: p.height_cm,
      photo: Number(p.hide_photo) === 1 ? null : p.photo || null,
      profile_complete: profiles.completeness(p),
      created_at: p.created_at,
      connections: received
    };
  }

  route('GET', '/api/matches', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to see your matches.');
    const viewerProfile = await profileRow(ctx.user.id) || { user_id: ctx.user.id };
    const limit = Math.min(60, Math.max(1, Number(ctx.query.get('limit') || 12)));
    const candidates = (await visibleUsers()).filter(
      (p) => Number(p.searchable) === 1 && p.user_id !== ctx.user.id
    );
    const scored = [];
    for (const p of candidates) {
      const received = Boolean(
        await db.one('interests', {
          from_user_id: p.user_id,
          to_user_id: ctx.user.id,
          status: { in: ['pending', 'accepted'] }
        })
      );
      const { score, reasons } = profiles.matchScore(viewerProfile, p, {
        photo: p.photo,
        receivedInterest: received
      });
      scored.push({ card: await cardFor(p, ctx.user.id), score, reasons });
    }
    scored.sort((a, b) => b.score - a.score || (b.card.created_at || 0) - (a.card.created_at || 0));
    return ok(ctx.res, { total: scored.length, results: scored.slice(0, limit) });
  });

  /* ------------------------------------------------------------- interests */

  route('POST', '/api/interests', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to send an interest.');
    const targetId = Number(ctx.body.to_user_id || ctx.body.user_id);
    if (!targetId || targetId === ctx.user.id)
      return fail(ctx.res, 400, 'You cannot send an interest to yourself.');
    const target = await userRow(targetId);
    const targetProfile = await profileRow(targetId);
    if (!target || target.status !== 'active' || !targetProfile)
      return fail(ctx.res, 404, 'This profile is not available.');
    if (throttled(`interest:${ctx.user.id}`, 40, 60 * 60000))
      return fail(ctx.res, 429, 'You have sent too many interests. Please try again later.');

    const existing = await db.one('interests', { from_user_id: ctx.user.id, to_user_id: targetId });
    if (existing && existing.status === 'pending')
      return fail(ctx.res, 409, 'You have already sent an interest to this profile.');
    if (existing && existing.status === 'accepted')
      return fail(ctx.res, 409, 'You are already connected with this profile.');

    const message = str(ctx.body.message).slice(0, 500);
    if (existing) {
      await db.update(
        'interests',
        { id: existing.id },
        { status: 'pending', message, created_at: Date.now(), responded_at: 0 }
      );
    } else {
      await db.insert('interests', {
        from_user_id: ctx.user.id,
        to_user_id: targetId,
        message,
        status: 'pending',
        created_at: Date.now(),
        responded_at: 0
      });
    }
    await notify(
      targetId,
      'interest',
      'New interest received',
      `${ctx.user.name} is interested in your profile.`,
      '/interests.html?tab=received'
    );
    return ok(ctx.res, { message: `Interest sent to ${target.name}.` });
  });

  route('GET', '/api/interests', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const direction = ctx.query.get('direction') === 'sent' ? 'sent' : 'received';
    const status = ctx.query.get('status') || '';
    const rows =
      direction === 'sent'
        ? await db.all('interests', { from_user_id: ctx.user.id }, { order: '-created_at' })
        : await db.all('interests', { to_user_id: ctx.user.id }, { order: '-created_at' });
    const out = [];
    for (const r of rows) {
      if (status && r.status !== status) continue;
      const otherId = direction === 'sent' ? r.to_user_id : r.from_user_id;
      const other = await userRow(otherId);
      const otherProfile = await profileRow(otherId);
      if (!other || !otherProfile) continue;
      out.push({
        id: r.id,
        status: r.status,
        message: r.message,
        created_at: r.created_at,
        responded_at: r.responded_at,
        direction,
        user: {
          id: other.id,
          name: other.name,
          photo: Number(otherProfile.hide_photo) === 1 ? null : other.photo || null,
          age: otherProfile.age,
          city: otherProfile.city,
          state: otherProfile.state,
          community: otherProfile.community,
          education: otherProfile.education,
          occupation: otherProfile.occupation
        }
      });
    }
    return ok(ctx.res, { direction, interests: out });
  });

  route('POST', '/api/interests/:id/respond', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const decision = str(ctx.body.decision).toLowerCase();
    if (!['accept', 'decline'].includes(decision))
      return fail(ctx.res, 400, 'Invalid response.');
    const interest = await db.one('interests', { id: Number(ctx.params.id) });
    if (!interest || interest.to_user_id !== ctx.user.id)
      return fail(ctx.res, 404, 'Interest not found.');
    if (interest.status !== 'pending')
      return fail(ctx.res, 409, 'This interest has already been answered.');

    const status = decision === 'accept' ? 'accepted' : 'declined';
    await db.update('interests', { id: interest.id }, { status, responded_at: Date.now() });
    const fromUser = await userRow(interest.from_user_id);
    await notify(
      interest.from_user_id,
      decision === 'accept' ? 'accepted' : 'declined',
      decision === 'accept' ? 'Your interest was accepted' : 'Interest declined',
      decision === 'accept'
        ? `${ctx.user.name} accepted your interest. You can now message each other.`
        : `${ctx.user.name} declined your interest.`,
      decision === 'accept' ? `/messages.html?with=${ctx.user.id}` : '/interests.html?tab=sent'
    );
    return ok(ctx.res, {
      status,
      message:
        decision === 'accept'
          ? `Interest accepted. You can now message ${fromUser ? fromUser.name : 'this member'}.`
          : 'Interest declined.'
    });
  });

  /* ------------------------------------------------------------- shortlist */

  route('POST', '/api/shortlist', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const targetId = Number(ctx.body.user_id);
    if (!targetId || targetId === ctx.user.id)
      return fail(ctx.res, 400, 'Invalid profile.');
    if (!await userRow(targetId)) return fail(ctx.res, 404, 'Profile not found.');
    const existing = await db.one('shortlist', { user_id: ctx.user.id, target_user_id: targetId });
    if (existing) {
      await db.remove('shortlist', { id: existing.id });
      return ok(ctx.res, { shortlisted: false, message: 'Removed from shortlist.' });
    }
    await db.insert('shortlist', {
      user_id: ctx.user.id,
      target_user_id: targetId,
      created_at: Date.now()
    });
    return ok(ctx.res, { shortlisted: true, message: 'Added to shortlist.' });
  });

  route('GET', '/api/shortlist', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const rows = await db.all('shortlist', { user_id: ctx.user.id }, { order: '-created_at' });
    const out = [];
    for (const r of rows) {
      const other = await userRow(r.target_user_id);
      const otherProfile = await profileRow(r.target_user_id);
      if (!other || !otherProfile) continue;
      out.push(
        Object.assign(
          await cardFor(Object.assign({}, otherProfile, { name: other.name, photo: other.photo }), ctx.user.id),
          {
            shortlisted_at: r.created_at,
            photo: Number(otherProfile.hide_photo) === 1 ? null : other.photo || null
          }
        )
      );
    }
    return ok(ctx.res, { results: out });
  });

  /* -------------------------------------------------------------- messages */

  route('GET', '/api/conversations', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const all = (await db.all('messages', { sender_id: ctx.user.id })).concat(
      await db.all('messages', { receiver_id: ctx.user.id })
    );
    const map = new Map();
    for (const m of all) {
      const otherId = m.sender_id === ctx.user.id ? m.receiver_id : m.sender_id;
      const current = map.get(otherId);
      if (!current || m.created_at > current.last.created_at) {
        map.set(otherId, { last: m, unread: (current && current.unread) || 0 });
      } else {
        map.set(otherId, current);
      }
      if (m.receiver_id === ctx.user.id && !m.read_at) {
        const entry = map.get(otherId);
        entry.unread += 1;
      }
    }
    const out = [];
    for (const [otherId, value] of map.entries()) {
      const other = await userRow(otherId);
      const otherProfile = await profileRow(otherId);
      if (!other || !otherProfile) continue;
      out.push({
        user: {
          id: other.id,
          name: other.name,
          photo: Number(otherProfile.hide_photo) === 1 ? null : other.photo || null,
          city: otherProfile.city,
          age: otherProfile.age
        },
        last_message: value.last.body,
        last_at: value.last.created_at,
        last_from_me: value.last.sender_id === ctx.user.id,
        unread: value.unread
      });
    }
    out.sort((a, b) => b.last_at - a.last_at);
    return ok(ctx.res, { conversations: out });
  });

  route('GET', '/api/conversations/:id', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const otherId = Number(ctx.params.id);
    const after = Number(ctx.query.get('after') || 0);
    const rows = (await db.all('messages', { sender_id: ctx.user.id, receiver_id: otherId }))
      .concat(await db.all('messages', { sender_id: otherId, receiver_id: ctx.user.id }))
      .filter((m) => m.created_at > after)
      .sort((a, b) => a.created_at - b.created_at);
    const other = await userRow(otherId);
    const otherProfile = await profileRow(otherId);
    return ok(ctx.res, {
      with: other
        ? {
            id: other.id,
            name: other.name,
            photo: otherProfile && Number(otherProfile.hide_photo) === 1 ? null : other.photo || null,
            city: otherProfile ? otherProfile.city : '',
            age: otherProfile ? otherProfile.age : null
          }
        : null,
      connected: await acceptedPair(ctx.user.id, otherId),
      messages: rows.map((m) => ({
        id: m.id,
        body: m.body,
        created_at: m.created_at,
        mine: m.sender_id === ctx.user.id,
        read: Boolean(m.read_at)
      }))
    });
  });

  route('POST', '/api/messages', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to send messages.');
    const to = Number(ctx.body.to || ctx.body.to_user_id);
    const body = str(ctx.body.body);
    if (!to || to === ctx.user.id) return fail(ctx.res, 400, 'Invalid recipient.');
    if (body.length < 1) return fail(ctx.res, 400, 'Please write a message.');
    if (body.length > 2000) return fail(ctx.res, 400, 'Message is too long (max 2000 characters).');
    const target = await userRow(to);
    if (!target || target.status !== 'active') return fail(ctx.res, 404, 'Recipient not found.');
    if (ctx.user.role !== 'admin' && !await acceptedPair(ctx.user.id, to))
      return fail(
        ctx.res,
        403,
        'You can message this member once your interest is accepted.'
      );
    if (throttled(`message:${ctx.user.id}`, 60, 60000))
      return fail(ctx.res, 429, 'You are sending messages too fast. Please slow down.');

    const now = Date.now();
    await db.insert('messages', {
      sender_id: ctx.user.id,
      receiver_id: to,
      body,
      created_at: now,
      read_at: 0
    });
    await notify(
      to,
      'message',
      'New message',
      `${ctx.user.name}: ${body.slice(0, 80)}`,
      `/messages.html?with=${ctx.user.id}`
    );
    return ok(ctx.res, {
      message: { id: now, body, created_at: now, mine: true, read: false },
      sent_at: now
    });
  });

  route('POST', '/api/conversations/:id/read', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const otherId = Number(ctx.params.id);
    const unread = await db.all('messages', { sender_id: otherId, receiver_id: ctx.user.id, read_at: 0 });
    for (const m of unread) await db.update('messages', { id: m.id }, { read_at: Date.now() });
    return ok(ctx.res, { marked: unread.length });
  });

  route('GET', '/api/unread', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    return ok(ctx.res, { counts: await unreadCounts(ctx.user.id) });
  });

  /* --------------------------------------------------------- notifications */

  route('GET', '/api/notifications', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const rows = await db.all('notifications', { user_id: ctx.user.id }, { order: '-created_at', limit: 60 });
    return ok(ctx.res, { notifications: rows, unread: (await unreadCounts(ctx.user.id)).notifications });
  });

  route('POST', '/api/notifications/:id/read', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    if (ctx.params.id === 'all') {
      const rows = await db.all('notifications', { user_id: ctx.user.id, is_read: 0 });
      for (const n of rows) await db.update('notifications', { id: n.id }, { is_read: 1 });
      return ok(ctx.res, { marked: rows.length });
    }
    await db.update(
      'notifications',
      { id: Number(ctx.params.id), user_id: ctx.user.id },
      { is_read: 1 }
    );
    return ok(ctx.res, { marked: 1 });
  });

  route('DELETE', '/api/notifications/:id', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    await db.remove('notifications', { id: Number(ctx.params.id), user_id: ctx.user.id });
    return ok(ctx.res, { message: 'Notification removed.' });
  });

  /* --------------------------------------------------------------- reports */

  route('POST', '/api/reports', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to report a profile.');
    const targetId = Number(ctx.body.user_id);
    const reason = str(ctx.body.reason);
    if (!targetId) return fail(ctx.res, 400, 'Please choose the profile to report.');
    if (reason.length < 3) return fail(ctx.res, 400, 'Please choose a reason.');
    const existing = await db.one('reports', { reporter_id: ctx.user.id, target_user_id: targetId, status: 'open' });
    if (existing) return fail(ctx.res, 409, 'You have already reported this profile.');
    await db.insert('reports', {
      reporter_id: ctx.user.id,
      target_user_id: targetId,
      reason: reason.slice(0, 120),
      details: str(ctx.body.details).slice(0, 1000),
      status: 'open',
      created_at: Date.now()
    });
    await notify(
      ctx.user.id,
      'system',
      'Report submitted',
      'Our moderation team will review this profile. Thank you for keeping the community safe.',
      '/notifications.html'
    );
    return ok(ctx.res, { message: 'Report submitted. Our team will review it.' });
  });

  /* ----------------------------------------------------------------- admin */

  function requireAdmin(ctx) {
    if (!ctx.user) {
      fail(ctx.res, 401, 'Please log in to continue.');
      return false;
    }
    if (ctx.user.role !== 'admin') {
      fail(ctx.res, 403, 'Admin access required.');
      return false;
    }
    return true;
  }

  async function activeAdmins() {
    return (await db.all('users')).filter((u) => u.role === 'admin' && u.status === 'active');
  }

  async function audit(actor, action, meta) {
    const info = meta || {};
    try {
      await db.insert('audit_logs', {
        actor_id: actor && actor.id ? actor.id : 0,
        actor_email: actor && actor.email ? String(actor.email).slice(0, 160) : '',
        action: String(action || '').slice(0, 80),
        target_type: String(info.target_type || '').slice(0, 40),
        target_id: Number(info.target_id || 0) || 0,
        detail: String(info.detail || '').slice(0, 500),
        created_at: Date.now()
      });
    } catch (_) {
      /* never fail the primary action because the log could not be written */
    }
  }

  route('GET', '/api/admin/stats', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const users = await db.all('users');
    const now = Date.now();
    const day = 86400000;
    const active = users.filter((u) => u.status === 'active').length;
    const suspended = users.filter((u) => u.status === 'suspended').length;
    const admins = users.filter((u) => u.role === 'admin').length;
    const new_24h = users.filter((u) => Number(u.created_at) > now - day).length;
    const new_7d = users.filter((u) => Number(u.created_at) > now - 7 * day).length;
    const recent_users = users
      .slice()
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .slice(0, 8)
      .map((u) => serializeUser(u, { private: true }));
    const recent_logins = users
      .filter((u) => Number(u.last_login) > 0)
      .sort((a, b) => (b.last_login || 0) - (a.last_login || 0))
      .slice(0, 8)
      .map((u) => serializeUser(u, { private: true }));
    return ok(ctx.res, {
      stats: {
        users: users.length,
        active,
        suspended,
        admins,
        new_24h,
        new_7d,
        profiles: await db.count('profiles'),
        male: await db.count('profiles', { gender: 'Male' }),
        female: await db.count('profiles', { gender: 'Female' }),
        interests: await db.count('interests'),
        accepted: await db.count('interests', { status: 'accepted' }),
        messages: await db.count('messages'),
        reports_open: await db.count('reports', { status: 'open' }),
        reports_resolved: await db.count('reports', { status: 'resolved' }),
        stories: await db.count('stories'),
        contact_open: await db.count('contact_messages', { handled: 0 }),
        storage: driverKind(db)
      },
      recent_users,
      recent_logins
    });
  });

  route('GET', '/api/admin/users', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const keyword = String(ctx.query.get('q') || '').trim().toLowerCase();
    const status = String(ctx.query.get('status') || '');
    let rows = await db.all('users', {}, { order: '-created_at' });
    if (keyword) {
      rows = rows.filter(
        (u) =>
          u.email.toLowerCase().includes(keyword) ||
          String(u.name || '').toLowerCase().includes(keyword)
      );
    }
    if (status) rows = rows.filter((u) => u.status === status);
    const role = String(ctx.query.get('role') || '');
    if (role) rows = rows.filter((u) => u.role === role);
    const out = [];
    for (const u of rows) {
      const p = await profileRow(u.id);
      out.push(
        Object.assign(serializeUser(u, { private: true }), {
          profile: p
            ? {
                age: p.age,
                gender: p.gender,
                city: p.city,
                state: p.state,
                community: p.community,
                education: p.education,
                occupation: p.occupation,
                completeness: profiles.completeness(p)
              }
            : null
        })
      );
    }
    return ok(ctx.res, { users: out });
  });

  route('GET', '/api/admin/users/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    const user = await userRow(id);
    if (!user) return fail(ctx.res, 404, 'User not found.');
    const profile = await profileRow(id);
    return ok(ctx.res, {
      user: serializeUser(user, { private: true }),
      profile: profile || null,
      counts: {
        interests_sent: await db.count('interests', { from_user_id: id }),
        interests_received: await db.count('interests', { to_user_id: id }),
        messages: await db.count('messages', { sender_id: id }) + await db.count('messages', { receiver_id: id }),
        reports_against: await db.count('reports', { target_user_id: id }),
        shortlist: await db.count('shortlist', { user_id: id })
      }
    });
  });

  route('PATCH', '/api/admin/users/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    const user = await userRow(id);
    if (!user) return fail(ctx.res, 404, 'User not found.');
    const patch = {};
    if (ctx.body.name !== undefined) patch.name = str(ctx.body.name).slice(0, 80);
    if (ctx.body.role !== undefined) {
      const role = str(ctx.body.role);
      if (!['user', 'admin'].includes(role)) return fail(ctx.res, 400, 'Invalid role.');
      if (user.id === ctx.user.id && role !== 'admin')
        return fail(ctx.res, 400, 'You cannot remove your own admin rights.');
      if (user.role === 'admin' && role !== 'admin' && (await activeAdmins()).length <= 1)
        return fail(ctx.res, 400, 'Cannot remove the last administrator.');
      patch.role = role;
    }
    if (ctx.body.status !== undefined) {
      const status = str(ctx.body.status);
      if (!['active', 'suspended'].includes(status)) return fail(ctx.res, 400, 'Invalid status.');
      if (user.role === 'admin' && status === 'suspended' && (await activeAdmins()).filter((u) => u.id !== user.id).length < 1)
        return fail(ctx.res, 400, 'Cannot suspend the last administrator.');
      patch.status = status;
    }
    if (ctx.body.email_verified !== undefined)
      patch.email_verified = ctx.body.email_verified ? 1 : 0;
    if (ctx.body.password) {
      const problem = auth.passwordProblem(ctx.body.password);
      if (problem) return fail(ctx.res, 400, problem);
      patch.password_hash = auth.hashPassword(str(ctx.body.password));
      patch.token_version = Number(user.token_version || 1) + 1;
    }
    if (Object.keys(patch).length) {
      await db.update('users', { id }, patch);
      await notify(id, 'system', 'Account updated', 'An administrator updated your account.', '/settings.html');
      const bits = [];
      if (patch.role) bits.push('role=' + patch.role);
      if (patch.status) bits.push('status=' + patch.status);
      if (patch.email_verified !== undefined) bits.push(patch.email_verified ? 'verified' : 'unverified');
      if (patch.password_hash) bits.push('password-reset');
      if (patch.name) bits.push('name');
      await audit(ctx.user, 'user.update', {
        target_type: 'user',
        target_id: id,
        detail: bits.join(', ') || 'updated'
      });
    }
    return ok(ctx.res, { user: serializeUser(await db.one('users', { id }), { private: true }), message: 'User updated.' });
  });

  route('PATCH', '/api/admin/users/:id/profile', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    if (!await userRow(id)) return fail(ctx.res, 404, 'User not found.');
    const existing = await profileRow(id);
    if (!existing) return fail(ctx.res, 404, 'Profile not found.');
    const { data, errors } = profiles.validatePatch(ctx.body || {});
    if (errors.length) return fail(ctx.res, 400, errors[0], { errors });
    if (!Object.keys(data).length) return fail(ctx.res, 400, 'No profile fields to update.');
    data.updated_at = Date.now();
    await db.update('profiles', { user_id: id }, data);
    await audit(ctx.user, 'profile.update', {
      target_type: 'user',
      target_id: id,
      detail: Object.keys(data).filter((k) => k !== 'updated_at').join(', ')
    });
    return ok(ctx.res, { profile: await profileRow(id), message: 'Profile updated.' });
  });

  route('DELETE', '/api/admin/users/:id/photo', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    const user = await userRow(id);
    if (!user) return fail(ctx.res, 404, 'User not found.');
    await deletePhotoFile(user.photo);
    await db.update('users', { id }, { photo: null });
    await audit(ctx.user, 'user.photo_removed', { target_type: 'user', target_id: id, detail: user.email || '' });
    return ok(ctx.res, { message: 'Photo removed.' });
  });

  route('DELETE', '/api/admin/users/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    if (id === ctx.user.id) return fail(ctx.res, 400, 'You cannot delete your own admin account.');
    const target = await userRow(id);
    if (!target) return fail(ctx.res, 404, 'User not found.');
    if (target.role === 'admin' && (await activeAdmins()).length <= 1)
      return fail(ctx.res, 400, 'Cannot delete the last administrator.');
    const email = target.email;
    await deleteUserAccount(id);
    await audit(ctx.user, 'user.delete', { target_type: 'user', target_id: id, detail: email });
    return ok(ctx.res, { message: 'User and all related data deleted.' });
  });

  route('GET', '/api/admin/reports', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const status = String(ctx.query.get('status') || '');
    const rows = await db.all('reports', {}, { order: '-created_at' });
    const out = [];
    for (const r of rows) {
      if (status && r.status !== status) continue;
      const reporter = await userRow(r.reporter_id);
      const target = await userRow(r.target_user_id);
      out.push(
        Object.assign({}, r, {
          reporter: reporter ? { id: reporter.id, name: reporter.name, email: reporter.email } : null,
          target: target ? { id: target.id, name: target.name, email: target.email, status: target.status } : null
        })
      );
    }
    return ok(ctx.res, { reports: out });
  });

  route('PATCH', '/api/admin/reports/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    const report = await db.one('reports', { id });
    if (!report) return fail(ctx.res, 404, 'Report not found.');
    const status = str(ctx.body.status);
    if (!['open', 'resolved', 'dismissed'].includes(status))
      return fail(ctx.res, 400, 'Invalid status.');
    await db.update('reports', { id }, { status });
    if (ctx.body.action === 'suspend' && await userRow(report.target_user_id)) {
      await db.update('users', { id: report.target_user_id }, { status: 'suspended' });
      await notify(
        report.target_user_id,
        'system',
        'Account suspended',
        'Your account was suspended after a moderation review.',
        ''
      );
    }
    if (ctx.body.action === 'delete' && await userRow(report.target_user_id)) {
      await deleteUserAccount(report.target_user_id);
    }
    await notify(
      report.reporter_id,
      'system',
      'Report reviewed',
      'Thank you. Our team has reviewed the profile you reported.',
      ''
    );
    await audit(ctx.user, 'report.update', {
      target_type: 'report',
      target_id: id,
      detail: [status, ctx.body.action || '', str(ctx.body.note).slice(0, 200)].filter(Boolean).join(' · ')
    });
    return ok(ctx.res, { message: 'Report updated.' });
  });

  route('GET', '/api/admin/stories', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return ok(ctx.res, { stories: await db.all('stories', {}, { order: '-created_at' }) });
  });

  route('POST', '/api/admin/stories', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const title = str(ctx.body.title);
    const couple = str(ctx.body.couple);
    if (!title || !couple) return fail(ctx.res, 400, 'Title and couple names are required.');
    const story = await db.insert('stories', {
      title: title.slice(0, 140),
      couple: couple.slice(0, 140),
      location: str(ctx.body.location).slice(0, 140),
      body: str(ctx.body.body).slice(0, 4000),
      photo: str(ctx.body.photo).slice(0, 500),
      approved: ctx.body.approved === false || ctx.body.approved === 0 ? 0 : 1,
      created_at: Date.now()
    });
    await audit(ctx.user, 'story.create', { target_type: 'story', target_id: story.id, detail: title.slice(0, 140) });
    return ok(ctx.res, { story, message: 'Success story added.' });
  });

  route('PATCH', '/api/admin/stories/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    if (!await db.one('stories', { id })) return fail(ctx.res, 404, 'Story not found.');
    const patch = {};
    for (const key of ['title', 'couple', 'location', 'body', 'photo']) {
      if (ctx.body[key] !== undefined) patch[key] = str(ctx.body[key]).slice(0, 4000);
    }
    if (ctx.body.approved !== undefined) patch.approved = ctx.body.approved ? 1 : 0;
    await db.update('stories', { id }, patch);
    await audit(ctx.user, 'story.update', { target_type: 'story', target_id: id, detail: Object.keys(patch).join(', ') });
    return ok(ctx.res, { story: await db.one('stories', { id }), message: 'Story updated.' });
  });

  route('DELETE', '/api/admin/stories/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const sid = Number(ctx.params.id);
    await db.remove('stories', { id: sid });
    await audit(ctx.user, 'story.delete', { target_type: 'story', target_id: sid, detail: '' });
    return ok(ctx.res, { message: 'Story deleted.' });
  });

  route('GET', '/api/admin/contact', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return ok(ctx.res, { messages: await db.all('contact_messages', {}, { order: '-created_at' }) });
  });

  route('PATCH', '/api/admin/contact/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await db.update(
      'contact_messages',
      { id: Number(ctx.params.id) },
      { handled: ctx.body.handled ? 1 : 0 }
    );
    return ok(ctx.res, { message: 'Updated.' });
  });

  route('DELETE', '/api/admin/contact/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await db.remove('contact_messages', { id: Number(ctx.params.id) });
    return ok(ctx.res, { message: 'Message deleted.' });
  });

  route('GET', '/api/admin/settings', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return ok(ctx.res, { settings: await settingsLib.all(db) });
  });

  route('PUT', '/api/admin/settings', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const settings = await settingsLib.setMany(db, ctx.body);
    await audit(ctx.user, 'settings.update', {
      target_type: 'settings',
      target_id: 0,
      detail: Object.keys(ctx.body || {}).join(', ').slice(0, 200)
    });
    return ok(ctx.res, { settings, message: 'Website content saved.' });
  });

  route('GET', '/api/admin/audit', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const limit = Math.min(200, Math.max(1, Number(ctx.query.get('limit') || 80)));
    const rows = await db.all('audit_logs', {}, { order: '-created_at', limit });
    return ok(ctx.res, {
      logs: rows.map((r) => ({
        id: r.id,
        actor_id: r.actor_id,
        actor_email: r.actor_email,
        action: r.action,
        target_type: r.target_type,
        target_id: r.target_id,
        detail: r.detail,
        created_at: r.created_at
      }))
    });
  });

  route('GET', '/api/admin/outbox', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    let files = [];
    try {
      files = fs
        .readdirSync(outboxDir)
        .filter((f) => f.endsWith('.eml'))
        .sort()
        .reverse()
        .slice(0, 20)
        .map((f) => ({ file: f, content: fs.readFileSync(path.join(outboxDir, f), 'utf8') }));
    } catch (_) {
      files = [];
    }
    return ok(ctx.res, { emails: files, smtp: mailer.smtpConfigured() });
  });

  /* --------------------------------------------------------------- routing */

  async function handle(req, res, url) {
    const ctx = {
      req,
      res,
      url,
      query: url.searchParams,
      queryObject: Object.fromEntries(url.searchParams.entries()),
      params: {},
      body: {},
      ip: clientIp(req),
      user: null
    };
    ctx.user = await currentUser(req);

    const found = matchRoute(req.method, url.pathname);
    if (!found) return fail(res, 404, 'API endpoint not found.');
    ctx.params = found.params;

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      try {
        ctx.body = await readBody(req);
      } catch (err) {
        return fail(res, err.status || 400, err.message);
      }
    }

    const maintenance = await settingsLib.get(db, 'maintenance') === '1';
    const isAdminRoute = url.pathname.startsWith('/api/admin');
    const isAuthRoute = url.pathname.startsWith('/api/auth') || url.pathname === '/api/site';
    if (maintenance && !isAdminRoute && !isAuthRoute && !(ctx.user && ctx.user.role === 'admin')) {
      return fail(res, 503, 'The site is under maintenance. Please try again shortly.');
    }

    try {
      const result = await found.handler(ctx);
      if (result && result.status) return sendJson(res, result.status, result.body);
      if (!res.headersSent) ok(res, {});
      return undefined;
    } catch (err) {
      console.error('[api]', req.method, url.pathname, err);
      if (!res.headersSent) return fail(res, 500, 'Something went wrong. Please try again.');
      return undefined;
    }
  }

  function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
    return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
  }

  function driverKind(driver) {
    return driver.kind || 'unknown';
  }

  return { handle, uploadDir, outboxDir };
}

module.exports = { createApi, UPLOAD_DIR_NAME };
