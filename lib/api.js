'use strict';
/**
 * TEERNOVA — REST API (JSON over HTTP, cookie sessions).
 *
 * Live Teer Results • Smart Statistics • Trusted Information
 *
 * Removed: All matrimonial functionality from PANIKA JEEVAN SATHI.
 * Added: Teer result system, session management, demo play, admin controls.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('./auth');
const settingsLib = require('./settings');

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

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
    .replace(/\"/g, '&quot;');
}

function createApi(options) {
  const db = options.db;
  const secret = options.secret;
  const dataDir = options.dataDir;
  const photos = options.photos;
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

  function notify(userId, type, title, body, link) {
    if (!userId) return;
    db.insert('notifications', {
      user_id: userId,
      type,
      title: title || '',
      body: body || '',
      link: link || '',
      is_read: 0,
      created_at: Date.now()
    });
  }

  function userRow(id) {
    return db.one('users', { id: Number(id) });
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
      created_at: user.created_at
    };
  }

  function currentUser(req) {
    const cookies = auth.parseCookies(req.headers.cookie);
    const payload = auth.readSession(cookies[auth.SESSION_COOKIE], secret);
    if (!payload) return null;
    let user = userRow(payload.uid);
    if (!user) return null;
    if (user.status !== 'active' && user.role !== 'admin') return null;
    if (Number(user.token_version || 1) !== Number(payload.tv)) return null;
    return user;
  }

  function issueSession(res, user, req) {
    const token = auth.createSession(user.id, Number(user.token_version || 1), secret);
    const secure = String(req.headers['x-forwarded-proto'] || '') === 'https';
    res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure }));
  }

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

  const routes = [];
  function route(method, pattern, handler) {
    const parts = pattern.split('/').filter(Boolean);
    routes.push({ method, parts, pattern, handler });
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
        else if (expected !== parts[i]) { matched = false; break; }
      }
      if (matched) return { handler: entry.handler, params };
    }
    return null;
  }

  /* ---------------------------------------------------------- public site */

  route('GET', '/api/health', async () => ({
    status: 200,
    body: {
      ok: true,
      service: 'teernova',
      time: Date.now(),
      storage: db.kind || 'unknown',
      photos: photos.kind
    }
  }));

  route('GET', '/api/site', async () => ({
    status: 200,
    body: { ok: true, site: settingsLib.publicSite(db), options: {} }
  }));

  route('GET', '/api/announcements', async () => ({
    status: 200,
    body: {
      ok: true,
      announcements: db.all('announcements', { is_active: 1 }, { order: '-created_at' })
    }
  }));

  /* ---------------------------------------------------------- auth (keep basic auth) */

  route('POST', '/api/auth/register', async (ctx) => {
    const body = ctx.body;
    const name = str(body.name);
    const email = str(body.email).toLowerCase();
    const password = str(body.password);

    if (name.length < 2) return fail(ctx.res, 400, 'Please enter your name.');
    if (!isEmail(email)) return fail(ctx.res, 400, 'Please enter a valid email address.');
    const pwProblem = auth.passwordProblem(password);
    if (pwProblem) return fail(ctx.res, 400, pwProblem);
    if (throttled(`register:${ctx.ip}`, 8, 60 * 60000))
      return fail(ctx.res, 429, 'Too many sign-ups. Please try again later.');

    if (db.one('users', { email }))
      return fail(ctx.res, 409, 'An account with this email already exists.');

    const requireVerification = settingsLib.get(db, 'require_email_verification') === '1';
    const now = Date.now();
    const user = db.insert('users', {
      email,
      password_hash: auth.hashPassword(password),
      name,
      role: 'user',
      status: 'active',
      email_verified: requireVerification ? 0 : 1,
      verification_token: auth.randomToken(24),
      reset_token: null,
      reset_expires: 0,
      token_version: 1,
      photo: null,
      last_login: now,
      created_at: now
    });

    issueSession(ctx.res, db.one('users', { id: user.id }), ctx.req);
    return ok(ctx.res, {
      user: serializeUser(db.one('users', { id: user.id }), { private: true }),
      message: 'Account created successfully. Welcome to TEERNOVA!'
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

    let user = db.one('users', { email });
    if (!user || !auth.verifyPassword(password, user.password_hash))
      return fail(ctx.res, 401, 'Incorrect email or password.');
    if (user.status === 'suspended')
      return fail(ctx.res, 403, 'This account has been suspended.');
    if (user.status === 'deleted')
      return fail(ctx.res, 403, 'This account no longer exists.');

    if (Number(user.email_verified) !== 1) {
      return fail(ctx.res, 403, 'Please verify your email address before logging in.', {
        code: 'email_not_verified'
      });
    }

    db.update('users', { id: user.id }, { last_login: Date.now() });
    const fresh = db.one('users', { id: user.id });
    issueSession(ctx.res, fresh, ctx.req);
    return ok(ctx.res, {
      user: serializeUser(fresh, { private: true }),
      message: `Welcome back, ${fresh.name}!`
    });
  });

  route('POST', '/api/auth/logout', async (ctx) => {
    const user = ctx.user;
    if (user) {
      db.update('users', { id: user.id }, { token_version: Number(user.token_version || 1) + 1 });
    }
    ctx.res.setHeader('Set-Cookie', auth.clearSessionCookie());
    return ok(ctx.res, { message: 'You have been logged out.' });
  });

  route('GET', '/api/auth/me', async (ctx) => {
    const user = currentUser(ctx.req);
    if (!user) return sendJson(ctx.res, 401, { ok: false, error: 'Not logged in' });
    return ok(ctx.res, { user: serializeUser(user, { private: true }) });
  });

  route('POST', '/api/auth/forgot', async (ctx) => {
    const email = str(ctx.body.email).toLowerCase();
    if (!isEmail(email)) return fail(ctx.res, 400, 'Please enter a valid email address.');
    const user = db.one('users', { email });
    if (!user) {
      return ok(ctx.res, { message: 'If that email is registered, a password reset link has been sent.' });
    }
    const token = auth.randomToken(24);
    db.update('users', { id: user.id }, { reset_token: token, reset_expires: Date.now() + 3600000 });
    return ok(ctx.res, { message: 'If that email is registered, a password reset link has been sent.' });
  });

  route('POST', '/api/auth/reset', async (ctx) => {
    const token = str(ctx.body.token);
    const password = str(ctx.body.password);
    const problem = auth.passwordProblem(password);
    if (problem) return fail(ctx.res, 400, problem);
    const user = db.one('users', { reset_token: token });
    if (!user || !user.reset_expires || user.reset_expires < Date.now())
      return fail(ctx.res, 400, 'This reset link is invalid or has expired.');
    db.update('users', { id: user.id }, {
      password_hash: auth.hashPassword(password),
      reset_token: null,
      reset_expires: 0,
      token_version: Number(user.token_version || 1) + 1
    });
    return ok(ctx.res, { message: 'Password updated. You can log in with your new password.' });
  });

  route('GET', '/api/me', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const user = ctx.user;
    return ok(ctx.res, { user: serializeUser(user, { private: true }) });
  });

  route('POST', '/api/me/password', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    const current = str(ctx.body.current_password);
    const next = str(ctx.body.new_password);
    if (!auth.verifyPassword(current, ctx.user.password_hash))
      return fail(ctx.res, 400, 'Your current password is incorrect.');
    const problem = auth.passwordProblem(next);
    if (problem) return fail(ctx.res, 400, problem);
    db.update('users', { id: ctx.user.id }, {
      password_hash: auth.hashPassword(next),
      token_version: Number(ctx.user.token_version || 1) + 1
    });
    return ok(ctx.res, { message: 'Password updated successfully.' });
  });

  route('DELETE', '/api/me', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in to continue.');
    if (ctx.user.role === 'admin')
      return fail(ctx.res, 400, 'Admin accounts cannot be deleted.');
    db.remove('users', { id: ctx.user.id });
    ctx.res.setHeader('Set-Cookie', auth.clearSessionCookie());
    return ok(ctx.res, { message: 'Your account has been deleted.' });
  });

  /* ---------------------------------------------------------- sessions */

  route('GET', '/api/sessions', async (ctx) => {
    const active = db.all('sessions', { is_active: 1 }, { order: 'display_order ASC, created_at DESC' });
    return ok(ctx.res, { sessions: active.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      state: s.state,
      description: s.description,
      is_active: Boolean(s.is_active),
      display_order: s.display_order
    }))});
  });

  route('GET', '/api/sessions/:id', async (ctx) => {
    const id = Number(ctx.params.id);
    const session = db.one('sessions', { id });
    if (!session) return fail(ctx.res, 404, 'Session not found.');
    const schedules = db.all('session_schedules', { session_id: id, is_active: 1 }, { order: '-date' });
    return ok(ctx.res, {
      session: {
        id: session.id,
        name: session.name,
        category: session.category,
        state: session.state,
        description: session.description,
        is_active: Boolean(session.is_active),
        display_order: session.display_order
      },
      schedules: schedules.map((s) => ({
        id: s.id,
        date: s.date,
        fr_time: s.fr_time,
        sr_time: s.sr_time,
        timezone: s.timezone,
        is_active: Boolean(s.is_active)
      }))
    });
  });

  route('POST', '/api/sessions', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const body = ctx.body;
    const name = str(body.name);
    if (!name) return fail(ctx.res, 400, 'Session name is required.');
    const session = db.insert('sessions', {
      name,
      category: str(body.category) || 'day',
      state: str(body.state) || 'assam',
      description: str(body.description),
      is_active: body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
      display_order: Number(body.display_order) || 0,
      created_at: Date.now(),
      updated_at: Date.now()
    });
    notify(0, 'system', 'New session created', `${name} session created.`, '/admin.html');
    return ok(ctx.res, { session, message: 'Session created.' });
  });

  route('PATCH', '/api/sessions/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    const existing = db.one('sessions', { id });
    if (!existing) return fail(ctx.res, 404, 'Session not found.');
    const patch = {};
    if (ctx.body.name !== undefined) patch.name = str(ctx.body.name);
    if (ctx.body.category !== undefined) patch.category = str(ctx.body.category);
    if (ctx.body.state !== undefined) patch.state = str(ctx.body.state);
    if (ctx.body.description !== undefined) patch.description = str(ctx.body.description);
    if (ctx.body.is_active !== undefined) patch.is_active = ctx.body.is_active ? 1 : 0;
    if (ctx.body.display_order !== undefined) patch.display_order = Number(ctx.body.display_order);
    patch.updated_at = Date.now();
    db.update('sessions', { id }, patch);
    return ok(ctx.res, { session: db.one('sessions', { id }), message: 'Session updated.' });
  });

  /* ---------------------------------------------------------- session schedules */

  route('GET', '/api/session-schedules', async (ctx) => {
    const date = str(ctx.query.get('date'));
    const sessionId = ctx.query.get('session_id');
    const where = {};
    if (date) where.date = date;
    if (sessionId) where.session_id = Number(sessionId);
    const schedules = db.all('session_schedules', where, { order: '-date' });
    return ok(ctx.res, { schedules });
  });

  route('POST', '/api/session-schedules', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const body = ctx.body;
    const sessionId = Number(body.session_id);
    const date = str(body.date);
    if (!sessionId || !date) return fail(ctx.res, 400, 'Session and date are required.');
    const existing = db.one('session_schedules', { session_id: sessionId, date });
    if (existing) return fail(ctx.res, 409, 'Schedule already exists for this session and date.');
    const schedule = db.insert('session_schedules', {
      session_id: sessionId,
      date,
      fr_time: str(body.fr_time) || '',
      sr_time: str(body.sr_time) || '',
      timezone: str(body.timezone) || 'Asia/Kolkata',
      is_active: body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
      created_at: Date.now()
    });
    return ok(ctx.res, { schedule, message: 'Schedule created.' });
  });

  /* ---------------------------------------------------------- official results */

  route('GET', '/api/results', async (ctx) => {
    const date = str(ctx.query.get('date'));
    const sessionId = ctx.query.get('session_id');
    const round = ctx.query.get('round');
    const status = ctx.query.get('status');
    const where = {};
    if (date) where.date = date;
    if (sessionId) where.session_id = Number(sessionId);
    if (round) where.round = round;
    if (status) where.status = status;
    const results = db.all('official_results', where, { order: '-date DESC' });
    return ok(ctx.res, {
      results: results.map((r) => ({
        id: r.id,
        session_id: r.session_id,
        schedule_id: r.schedule_id,
        date: r.date,
        round: r.round,
        result: r.result,
        house: r.house,
        ending: r.ending,
        source: r.source,
        status: r.status,
        verified_by: r.verified_by,
        verified_at: r.verified_at,
        published_at: r.published_at
      }))
    });
  });

  route('GET', '/api/results/:id', async (ctx) => {
    const id = Number(ctx.params.id);
    const result = db.one('official_results', { id });
    if (!result) return fail(ctx.res, 404, 'Result not found.');
    const session = db.one('sessions', { id: result.session_id });
    const verification = db.one('result_verifications', { result_id: id });
    const corrections = db.all('result_corrections', { result_id: id }, { order: '-created_at' });
    return ok(ctx.res, {
      result: {
        id: result.id,
        session_id: result.session_id,
        schedule_id: result.schedule_id,
        date: result.date,
        round: result.round,
        result: result.result,
        house: result.house,
        ending: result.ending,
        source: result.source,
        status: result.status,
        verified_by: result.verified_by,
        verified_at: result.verified_at,
        published_at: result.published_at
      },
      session: session ? {
        id: session.id,
        name: session.name,
        category: session.category
      } : null,
      verification: verification ? {
        id: verification.id,
        status: verification.status,
        verified_by: verification.verified_by,
        verified_at: verification.verified_at
      } : null,
      corrections: corrections.map((c) => ({
        id: c.id,
        old_result: c.old_result,
        new_result: c.new_result,
        old_house: c.old_house,
        new_house: c.new_house,
        old_ending: c.old_ending,
        new_ending: c.new_ending,
        reason: c.reason,
        corrected_by: c.corrected_by,
        corrected_at: c.corrected_at
      }))
    });
  });

  route('POST', '/api/results', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const body = ctx.body;
    const sessionId = Number(body.session_id);
    const scheduleId = Number(body.schedule_id);
    const date = str(body.date);
    const round = str(body.round).toUpperCase();
    const result = Number(body.result);

    if (!sessionId || !scheduleId || !date || !round || !result)
      return fail(ctx.res, 400, 'All fields are required.');
    if (!['FR', 'SR'].includes(round))
      return fail(ctx.res, 400, 'Round must be FR or SR.');
    if (result < 0 || result > 99)
      return fail(ctx.res, 400, 'Result must be between 0 and 99.');

    const house = Math.floor(result / 10);
    const ending = result % 10;

    const existing = db.one('official_results', { session_id: sessionId, schedule_id: scheduleId, round });
    if (existing && existing.status === 'published')
      return fail(ctx.res, 409, 'Result already published. Use correction if needed.');

    const now = Date.now();
    const resultRecord = db.insert('official_results', {
      session_id: sessionId,
      schedule_id: scheduleId,
      date,
      round,
      result,
      house,
      ending,
      source: str(body.source) || 'manual',
      status: 'fetched',
      created_at: now,
      updated_at: now
    });

    db.insert('result_verifications', {
      result_id: resultRecord.id,
      status: 'pending',
      created_at: now
    });

    notify(0, 'system', 'New result fetched', `Result for ${date} ${round} fetched.`, '/admin.html');
    return ok(ctx.res, { result: resultRecord, message: 'Result saved. Pending verification.' });
  });

  route('PATCH', '/api/results/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    const existing = db.one('official_results', { id });
    if (!existing) return fail(ctx.res, 404, 'Result not found.');

    const patch = {};
    if (ctx.body.status !== undefined) patch.status = str(ctx.body.status);
    if (ctx.body.source !== undefined) patch.source = str(ctx.body.source);

    if (patch.status) {
      const allowed = ['fetched', 'pending_verification', 'verified', 'published', 'correction_required'];
      if (!allowed.includes(patch.status))
        return fail(ctx.res, 400, 'Invalid status.');
    }

    patch.updated_at = Date.now();

    if (patch.status === 'verified') {
      patch.verified_by = ctx.user.id;
      patch.verified_at = Date.now();
      db.insert('result_verifications', {
        result_id: id,
        status: 'verified',
        verified_by: ctx.user.id,
        verified_at: Date.now(),
        created_at: Date.now()
      });
    }

    if (patch.status === 'published') {
      patch.published_at = Date.now();
    }

    db.update('official_results', { id }, patch);
    return ok(ctx.res, { result: db.one('official_results', { id }), message: 'Result updated.' });
  });

  route('POST', '/api/results/:id/correct', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    const existing = db.one('official_results', { id });
    if (!existing) return fail(ctx.res, 404, 'Result not found.');

    const newResult = Number(ctx.body.new_result);
    const reason = str(ctx.body.reason);
    if (!newResult || newResult < 0 || newResult > 99)
      return fail(ctx.res, 400, 'New result must be between 0 and 99.');

    const newHouse = Math.floor(newResult / 10);
    const newEnding = newResult % 10;
    const now = Date.now();

    db.insert('result_corrections', {
      result_id: id,
      old_result: existing.result,
      new_result: newResult,
      old_house: existing.house,
      new_house: newHouse,
      old_ending: existing.ending,
      new_ending: newEnding,
      reason,
      corrected_by: ctx.user.id,
      corrected_at: now,
      created_at: now
    });

    db.update('official_results', { id }, {
      result: newResult,
      house: newHouse,
      ending: newEnding,
      status: 'correction_required',
      updated_at: now
    });

    db.insert('result_verifications', {
      result_id: id,
      status: 'pending',
      verified_by: ctx.user.id,
      verified_at: now,
      reason: `Correction: ${reason}`,
      created_at: now
    });

    notify(0, 'system', 'Result corrected', `Result #${id} corrected.`, '/admin.html');
    return ok(ctx.res, {
      result: db.one('official_results', { id }),
      correction: db.one('result_corrections', { id: db.one('result_corrections', { result_id: id })?.id }),
      message: 'Result corrected.'
    });
  });

  /* ---------------------------------------------------------- result sources */

  route('GET', '/api/result-sources', async (ctx) => {
    const sources = db.all('result_sources', { is_active: 1 }, { order: '-priority' });
    return ok(ctx.res, { sources });
  });

  route('POST', '/api/result-sources', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const body = ctx.body;
    const name = str(body.name);
    if (!name) return fail(ctx.res, 400, 'Source name is required.');
    const source = db.insert('result_sources', {
      name,
      source_url: str(body.source_url),
      parser_type: str(body.parser_type) || 'manual',
      is_active: body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
      priority: Number(body.priority) || 0,
      last_checked: null,
      last_successful_fetch: null,
      error_count: 0,
      status: 'active',
      created_at: Date.now(),
      updated_at: Date.now()
    });
    return ok(ctx.res, { source, message: 'Source created.' });
  });

  route('PATCH', '/api/result-sources/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    const existing = db.one('result_sources', { id });
    if (!existing) return fail(ctx.res, 404, 'Source not found.');
    const patch = {};
    if (ctx.body.name !== undefined) patch.name = str(ctx.body.name);
    if (ctx.body.source_url !== undefined) patch.source_url = str(ctx.body.source_url);
    if (ctx.body.parser_type !== undefined) patch.parser_type = str(ctx.body.parser_type);
    if (ctx.body.is_active !== undefined) patch.is_active = ctx.body.is_active ? 1 : 0;
    if (ctx.body.priority !== undefined) patch.priority = Number(ctx.body.priority);
    patch.updated_at = Date.now();
    db.update('result_sources', { id }, patch);
    return ok(ctx.res, { source: db.one('result_sources', { id }), message: 'Source updated.' });
  });

  /* ---------------------------------------------------------- announcements */

  route('GET', '/api/announcements', async (ctx) => {
    const announcements = db.all('announcements', { is_active: 1 }, { order: '-created_at' });
    return ok(ctx.res, {
      announcements: announcements.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        is_active: Boolean(a.is_active),
        created_at: a.created_at
      }))
    });
  });

  route('POST', '/api/announcements', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const body = ctx.body;
    const title = str(body.title);
    const message = str(body.body);
    if (!title || !message) return fail(ctx.res, 400, 'Title and body are required.');
    const now = Date.now();
    const announcement = db.insert('announcements', {
      title,
      body: message,
      is_active: body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
      created_at: now,
      updated_at: now
    });
    return ok(ctx.res, { announcement, message: 'Announcement created.' });
  });

  route('PATCH', '/api/announcements/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    const existing = db.one('announcements', { id });
    if (!existing) return fail(ctx.res, 404, 'Announcement not found.');
    const patch = {};
    if (ctx.body.title !== undefined) patch.title = str(ctx.body.title);
    if (ctx.body.body !== undefined) patch.body = str(ctx.body.body);
    if (ctx.body.is_active !== undefined) patch.is_active = ctx.body.is_active ? 1 : 0;
    patch.updated_at = Date.now();
    db.update('announcements', { id }, patch);
    return ok(ctx.res, { announcement: db.one('announcements', { id }), message: 'Announcement updated.' });
  });

  /* ---------------------------------------------------------- demo play */

  route('GET', '/api/demo-sessions', async (ctx) => {
    const sessions = db.all('demo_sessions', { is_active: 1 }, { order: '-start_time' });
    return ok(ctx.res, { sessions });
  });

  route('POST', '/api/demo-sessions', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const body = ctx.body;
    const name = str(body.name);
    if (!name) return fail(ctx.res, 400, 'Session name is required.');
    const now = Date.now();
    const session = db.insert('demo_sessions', {
      name,
      description: str(body.description),
      start_time: Number(body.start_time) || now,
      end_time: Number(body.end_time) || now + 3600000,
      credit_amount: Number(body.credit_amount) || 100,
      is_active: body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
      created_at: now
    });
    return ok(ctx.res, { session, message: 'Demo session created.' });
  });

  route('GET', '/api/demo-entries', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in.');
    const entries = db.all('demo_entries', { user_id: ctx.user.id }, { order: '-created_at' });
    return ok(ctx.res, {
      entries: entries.map((e) => ({
        id: e.id,
        demo_session_id: e.demo_session_id,
        selected_number: e.selected_number,
        credit_used: e.credit_used,
        status: e.status,
        created_at: e.created_at
      }))
    });
  });

  route('POST', '/api/demo-entries', async (ctx) => {
    if (!ctx.user) return fail(ctx.res, 401, 'Please log in.');
    const body = ctx.body;
    const demoSessionId = Number(body.demo_session_id);
    const selectedNumber = Number(body.selected_number);

    if (!demoSessionId || !selectedNumber)
      return fail(ctx.res, 400, 'Session and number are required.');
    if (selectedNumber < 0 || selectedNumber > 99)
      return fail(ctx.res, 400, 'Number must be between 0 and 99.');

    const session = db.one('demo_sessions', { id: demoSessionId, is_active: 1 });
    if (!session)
      return fail(ctx.res, 400, 'Demo session not found or inactive.');

    const now = Date.now();
    if (now < session.start_time || now > session.end_time)
      return fail(ctx.res, 400, 'Demo session is not active.');

    const entry = db.insert('demo_entries', {
      user_id: ctx.user.id,
      demo_session_id: demoSessionId,
      selected_number: selectedNumber,
      credit_used: session.credit_amount,
      status: 'pending',
      created_at: now
    });

    return ok(ctx.res, { entry, message: 'Demo entry submitted. Wait for result.' });
  });

  route('POST', '/api/demo-results', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const body = ctx.body;
    const demoSessionId = Number(body.demo_session_id);
    const winningNumber = Number(body.winning_number);

    if (!demoSessionId || !winningNumber)
      return fail(ctx.res, 400, 'Session and winning number are required.');
    if (winningNumber < 0 || winningNumber > 99)
      return fail(ctx.res, 400, 'Winning number must be between 0 and 99.');

    const session = db.one('demo_sessions', { id: demoSessionId, is_active: 1 });
    if (!session)
      return fail(ctx.res, 400, 'Demo session not found or inactive.');

    const now = Date.now();
    const result = db.insert('demo_results', {
      demo_session_id: demoSessionId,
      winning_number: winningNumber,
      created_at: now
    });

    const entries = db.all('demo_entries', { demo_session_id: demoSessionId, status: 'pending' });
    for (const entry of entries) {
      const won = entry.selected_number === winningNumber;
      db.update('demo_entries', { id: entry.id }, {
        status: won ? 'won' : 'lost',
        created_at: now
      });
    }

    return ok(ctx.res, { result, message: `Demo result published. ${entries.filter(e => e.selected_number === winningNumber).length} winner(s).` });
  });

  /* ---------------------------------------------------------- admin */

  route('GET', '/api/admin/stats', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const users = db.all('users');
    const todaySessions = db.all('sessions', { is_active: 1 }, { order: 'display_order' });
    const pendingResults = db.count('official_results', { status: 'fetched' });
    const verifiedResults = db.count('official_results', { status: 'verified' });
    const publishedResults = db.count('official_results', { status: 'published' });
    const todayResults = db.all('official_results', { date: todayStr });
    const sources = db.all('result_sources', { is_active: 1 });
    const failedSources = db.count('result_sources', { status: 'error' });

    return ok(ctx.res, {
      stats: {
        users: users.length,
        today_sessions: todaySessions.length,
        pending_results: pendingResults,
        verified_results: verifiedResults,
        published_results: publishedResults,
        today_results: todayResults.length,
        active_sources: sources.length,
        failed_sources: failedSources
      },
      today_sessions: todaySessions.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        is_active: Boolean(s.is_active)
      })),
      today_results: todayResults.map((r) => ({
        id: r.id,
        session_id: r.session_id,
        round: r.round,
        result: r.result,
        house: r.house,
        ending: r.ending,
        status: r.status
      }))
    });
  });

  route('GET', '/api/admin/sessions', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const sessions = db.all('sessions', {}, { order: 'display_order ASC, created_at DESC' });
    return ok(ctx.res, { sessions });
  });

  route('GET', '/api/admin/results', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const date = str(ctx.query.get('date'));
    const sessionId = ctx.query.get('session_id');
    const status = ctx.query.get('status');
    const where = {};
    if (date) where.date = date;
    if (sessionId) where.session_id = Number(sessionId);
    if (status) where.status = status;
    const results = db.all('official_results', where, { order: '-date DESC' });
    return ok(ctx.res, { results });
  });

  route('GET', '/api/admin/sources', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const sources = db.all('result_sources', {}, { order: '-priority' });
    return ok(ctx.res, { sources });
  });

  route('GET', '/api/admin/announcements', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const announcements = db.all('announcements', {}, { order: '-created_at' });
    return ok(ctx.res, { announcements });
  });

  route('GET', '/api/admin/audit', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const limit = Math.min(200, Math.max(1, Number(ctx.query.get('limit') || 80)));
    const logs = db.all('audit_logs', {}, { order: '-created_at', limit });
    return ok(ctx.res, { logs: logs.map((r) => ({
      id: r.id,
      actor_id: r.actor_id,
      actor_email: r.actor_email,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      detail: r.detail,
      created_at: r.created_at
    }))});
  });

  route('GET', '/api/admin/demo-sessions', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const sessions = db.all('demo_sessions', {}, { order: '-start_time' });
    return ok(ctx.res, { sessions });
  });

  route('GET', '/api/admin/demo-results', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const sessionId = Number(ctx.query.get('session_id'));
    const where = sessionId ? { demo_session_id: sessionId } : {};
    const results = db.all('demo_results', where, { order: '-created_at' });
    return ok(ctx.res, { results });
  });

  route('DELETE', '/api/admin/sessions/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    db.remove('sessions', { id });
    return ok(ctx.res, { message: 'Session deleted.' });
  });

  route('DELETE', '/api/admin/result-sources/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    db.remove('result_sources', { id });
    return ok(ctx.res, { message: 'Source deleted.' });
  });

  route('DELETE', '/api/admin/announcements/:id', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    db.update('announcements', { id }, { is_active: 0, updated_at: Date.now() });
    return ok(ctx.res, { message: 'Announcement deactivated.' });
  });

  /* ---------------------------------------------------------- Statistics API */

  route('GET', '/api/statistics/frequency', async (ctx) => {
    // Top result numbers (FR)
    const topFr = db.raw(`
      SELECT result AS result, COUNT(*) AS count
      FROM official_results
      WHERE round = 'FR' AND status IN ('published','verified')
      GROUP BY result
      ORDER BY count DESC
      LIMIT 15
    `);

    // House frequency
    const houseFreq = db.raw(`
      SELECT house AS house, COUNT(*) AS count
      FROM official_results
      WHERE round = 'FR' AND status IN ('published','verified') AND house IS NOT NULL
      GROUP BY house
      ORDER BY count DESC
      LIMIT 10
    `);

    // Ending digit frequency
    const endingFreq = db.raw(`
      SELECT CAST(result % 10 AS INTEGER) AS ending, COUNT(*) AS count
      FROM official_results
      WHERE round = 'FR' AND status IN ('published','verified')
      GROUP BY ending
      ORDER BY count DESC
      LIMIT 10
    `);

    // SR frequency
    const topSr = db.raw(`
      SELECT result AS result, COUNT(*) AS count
      FROM official_results
      WHERE round = 'SR' AND status IN ('published','verified')
      GROUP BY result
      ORDER BY count DESC
      LIMIT 10
    `);

    return ok(ctx.res, {
      top_results: topFr.map(r => ({ result: Number(r.result), count: Number(r.count) })),
      top_sr: topSr.map(r => ({ result: Number(r.result), count: Number(r.count) })),
      house_freq: houseFreq.map(h => ({ house: Number(h.house), count: Number(h.count) })),
      ending_freq: endingFreq.map(e => ({ ending: Number(e.ending), count: Number(e.count) })),
    });
  });

  /* ---------------------------------------------------------- TEERNOVA Pay (custom payment gateway) */

  route('GET', '/api/payments/plans', async (ctx) => {
    const plans = {};
    for (const [key, plan] of Object.entries(require('./payments').PLANS)) {
      plans[key] = {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        currency: plan.currency,
        description: plan.description,
        features: plan.features,
        credits: plan.credits,
        duration_days: plan.duration_days,
      };
    }
    return ok(ctx.res, { plans });
  });

  route('POST', '/api/payments/create-intent', async (ctx) => {
    const user = currentUser(ctx.req);
    if (!user) return fail(ctx.res, 401, 'Please log in to create a payment.');

    const body = ctx.body || {};
    const planId = str(body.plan_id);
    const plan = require('./payments').PLANS[planId];
    if (!plan) return fail(ctx.res, 400, 'Invalid plan selected.');

    const intent = require('./payments').createPaymentIntent(
      db, user.id, user.email, planId, {
        notes: body.notes || '',
        metadata: body.metadata || {},
      }
    );

    return ok(ctx.res, {
      intent: {
        id: intent.id,
        plan_id: intent.plan_id,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        demo_credits: intent.demo_credits,
        duration_days: intent.duration_days,
        upi_intent_url: intent.upi_intent_url,
        payment_instructions: JSON.parse(intent.payment_instructions || '{}'),
        qrcode_data: JSON.parse(intent.qrcode_data || '{}'),
        created_at: intent.created_at,
        expires_at: intent.expires_at,
      }
    });
  });

  route('GET', '/api/payments/intent/:id', async (ctx) => {
    const intentId = str(ctx.params.id);
    const intent = db.one('payment_intents', { id: intentId });
    if (!intent) return fail(ctx.res, 404, 'Payment intent not found.');

    // Only the owner or admin can view
    const user = currentUser(ctx.req);
    if (!user || (user.role !== 'admin' && String(intent.user_id) !== String(user.id))) {
      return fail(ctx.res, 403, 'Not authorized to view this payment.');
    }

    return ok(ctx.res, {
      intent: {
        id: intent.id,
        plan_id: intent.plan_id,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        demo_credits: intent.demo_credits,
        duration_days: intent.duration_days,
        upi_intent_url: intent.upi_intent_url,
        transaction_id: intent.transaction_id,
        created_at: intent.created_at,
        expires_at: intent.expires_at,
      }
    });
  });

  route('POST', '/api/payments/verify', async (ctx) => {
    const user = currentUser(ctx.req);
    if (!user) return fail(ctx.res, 401, 'Please log in to verify payment.');

    const body = ctx.body || {};
    const intentId = str(body.intent_id);
    const transactionId = str(body.transaction_id || '');

    if (!intentId) return fail(ctx.res, 400, 'Payment intent ID required.');

    const intent = db.one('payment_intents', { id: intentId });
    if (!intent) return fail(ctx.res, 404, 'Payment intent not found.');
    if (String(intent.user_id) !== String(user.id) && user.role !== 'admin') {
      return fail(ctx.res, 403, 'Not authorized to verify this payment.');
    }
    if (intent.status === require('./payments').PAYMENT_STATUS.COMPLETED) {
      return ok(ctx.res, { message: 'Payment already completed.', status: 'completed' });
    }
    if (Date.now() > intent.expires_at) {
      return fail(ctx.res, 410, 'Payment intent has expired.');
    }

    try {
      const result = require('./payments').completePayment(
        db, intentId, transactionId, {
          upi_transaction_id: body.upi_transaction_id || '',
          payment_method: body.payment_method || 'upi',
          notes: body.notes || '',
          metadata: body.metadata || {},
        }
      );

      // Notify user
      if (user) {
        require('./payments');
        // notification handled within completePayment indirectly
      }

      return ok(ctx.res, {
        message: 'Payment verified successfully!',
        status: 'completed',
        payment: {
          id: result.payment.id,
          plan_id: result.payment.plan_id,
          amount: result.payment.amount,
          status: result.payment.status,
          demo_credits: result.payment.demo_credits,
        },
        subscription_activated: result.subscription_activated,
      });
    } catch (err) {
      return fail(ctx.res, 400, err.message);
    }
  });

  route('GET', '/api/payments/history', async (ctx) => {
    const user = currentUser(ctx.req);
    if (!user) return fail(ctx.res, 401, 'Please log in to view payment history.');

    const history = require('./payments').getPaymentHistory(db, user.id, {
      limit: Number(ctx.query.get('limit')) || 50,
      offset: Number(ctx.query.get('offset')) || 0,
    });

    const subscription = require('./payments').getUserSubscription(db, user.id);

    return ok(ctx.res, {
      payments: history,
      subscription: subscription || null,
      credit_balance: (() => {
        const credits = db.one('user_credits', { user_id: user.id });
        return credits ? credits.balance : 0;
      })(),
    });
  });

  /* ---------------------------------------------------------- admin: payments */

  route('GET', '/api/admin/payments', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const payments = require('./payments').getAllPayments(db, {
      limit: Number(ctx.query.get('limit')) || 100,
      offset: Number(ctx.query.get('offset')) || 0,
    });
    return ok(ctx.res, { payments, total: payments.length });
  });

  route('GET', '/api/admin/payments/stats', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const stats = require('./payments').getPaymentStats(db);
    return ok(ctx.res, { stats });
  });

  route('POST', '/api/admin/payments/:id/confirm', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = str(ctx.params.id);
    const body = ctx.body || {};

    const intent = db.one('payment_intents', { id });
    if (!intent) return fail(ctx.res, 404, 'Payment intent not found.');
    if (intent.status === require('./payments').PAYMENT_STATUS.COMPLETED) {
      return ok(ctx.res, { message: 'Payment already completed.' });
    }

    try {
      const result = require('./payments').completePayment(
        db, id, body.transaction_id || `ADMIN-CONFIRM-${Date.now()}`,
        {
          payment_method: 'manual',
          notes: body.notes || 'Admin confirmed payment',
        }
      );
      return ok(ctx.res, {
        message: 'Payment confirmed by admin.',
        payment: result.payment,
      });
    } catch (err) {
      return fail(ctx.res, 400, err.message);
    }
  });

  route('POST', '/api/admin/payments/:id/refund', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = str(ctx.params.id);
    const payment = db.one('payments', { id });
    if (!payment) return fail(ctx.res, 404, 'Payment not found.');
    if (payment.status !== require('./payments').PAYMENT_STATUS.COMPLETED) {
      return fail(ctx.res, 400, 'Only completed payments can be refunded.');
    }

    db.update('payments', { id }, {
      status: require('./payments').PAYMENT_STATUS.REFUNDED,
      updated_at: Date.now(),
    });

    return ok(ctx.res, { message: 'Payment refunded.', payment_id: id });
  });

  route('GET', '/api/admin/subscriptions', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const subscriptions = db.all('subscriptions', {}, {
      order: '-created_at',
      limit: Number(ctx.query.get('limit')) || 100,
    });
    return ok(ctx.res, { subscriptions });
  });

  route('POST', '/api/admin/subscriptions/:id/cancel', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = str(ctx.params.id);
    try {
      require('./payments').cancelSubscription(db, id);
      return ok(ctx.res, { message: 'Subscription cancelled.' });
    } catch (err) {
      return fail(ctx.res, 400, err.message);
    }
  });

  route('GET', '/api/admin/user-credits', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const credits = db.all('user_credits', {}, { order: '-balance' });
    return ok(ctx.res, { credits });
  });

  /* ---------------------------------------------------------- routing */

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
    ctx.user = currentUser(req);

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

  return { handle, uploadDir: dataDir };
}

module.exports = { createApi, UPLOAD_DIR_NAME: 'uploads' };
