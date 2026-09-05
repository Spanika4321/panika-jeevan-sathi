'use strict';
/**
 * SEVA MARKET INDIA — JSON API.
 *
 * One router, no framework. Every route validates its input, writes are
 * same-origin + JSON only, and authorisation is checked on the server for
 * every request that touches a booking or a provider record.
 */

const fs = require('node:fs');
const path = require('node:path');
const auth = require('./auth');
const { createRateLimiter, sameOrigin, isJson, clientIp } = require('./http-security');
const seed = require('./seed-data');

const MAX_BODY_BYTES = 256 * 1024;

function str(value, max = 500) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function emailOf(value) {
  const email = str(value, 190).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function intOf(value, fallback = 0, min = -Infinity, max = Infinity) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function createApi(options) {
  const db = options.db;
  const dataDir = options.dataDir;
  const limit = createRateLimiter();
  const trustProxyHops = intOf(process.env.TRUST_PROXY_HOPS, 0, 0, 4);
  const routes = [];

  function route(method, pattern, handler, meta = {}) {
    const keys = [];
    const source = pattern.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler, meta });
  }

  /* ------------------------------------------------------------- plumbing */
  function send(res, status, body, extraHeaders = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }, extraHeaders));
    res.end(payload);
  }

  const ok = (res, body, headers) => send(res, 200, Object.assign({ ok: true }, body), headers);
  const fail = (res, status, error) => send(res, status, { ok: false, error });

  async function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(Object.assign(new Error('Request too large.'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve({});
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
        } catch (_) {
          reject(Object.assign(new Error('Invalid JSON body.'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  function match(method, pathname) {
    for (const entry of routes) {
      if (entry.method !== method) continue;
      const found = entry.regex.exec(pathname);
      if (!found) continue;
      const params = {};
      entry.keys.forEach((key, index) => { params[key] = decodeURIComponent(found[index + 1]); });
      return { entry, params };
    }
    return null;
  }

  /* ----------------------------------------------------------------- auth */
  function requireUser(ctx) {
    if (!ctx.user) throw Object.assign(new Error('Please log in to continue.'), { status: 401 });
    return ctx.user;
  }

  function requireRole(ctx, role) {
    const user = requireUser(ctx);
    if (user.role !== role) throw Object.assign(new Error('You do not have access to this section.'), { status: 403 });
    return user;
  }

  /* --------------------------------------------------------------- routes */
  route('GET', '/api/health', async () => ({
    status: 200,
    body: {
      ok: true,
      service: 'seva-market-india',
      time: Date.now(),
      storage: 'sqlite',
      version: options.version || '1.0.0',
      counts: {
        categories: db.get('SELECT COUNT(*) AS n FROM categories').n,
        providers: db.get("SELECT COUNT(*) AS n FROM providers WHERE status = 'approved'").n,
        bookings: db.get('SELECT COUNT(*) AS n FROM bookings').n
      }
    }
  }));

  route('GET', '/api/site', async () => ({
    status: 200,
    body: {
      ok: true,
      site: {
        name: 'SEVA MARKET INDIA',
        tagline: 'Trusted local services, booked in a minute',
        support_phone: '+91 80998 34725',
        support_email: 'support@sevamarketindia.in'
      },
      categories: db.categories(),
      cities: db.cities(),
      slots: seed.SLOTS,
      trust: seed.TRUST_POINTS,
      steps: seed.STEPS,
      counts: {
        providers: db.get("SELECT COUNT(*) AS n FROM providers WHERE status = 'approved'").n,
        cities: db.get('SELECT COUNT(*) AS n FROM cities').n,
        categories: db.get('SELECT COUNT(*) AS n FROM categories').n,
        jobs_completed: db.get("SELECT COUNT(*) AS n FROM bookings WHERE status = 'completed'").n
      }
    }
  }));

  route('GET', '/api/categories', async () => ({ status: 200, body: { ok: true, categories: db.categories() } }));

  route('GET', '/api/services', async (ctx) => {
    const slug = str(ctx.query.get('category'), 60);
    const category = slug ? db.categoryBySlug(slug) : null;
    if (slug && !category) throw Object.assign(new Error('Category not found.'), { status: 404 });
    const where = category ? 'WHERE s.category_id = ?' : '';
    const params = category ? [category.id] : [];
    return {
      status: 200,
      body: {
        ok: true,
        services: db.all(
          `SELECT s.id, s.name, s.base_price, s.duration_min, c.slug AS category_slug, c.name AS category_name
             FROM services s JOIN categories c ON c.id = s.category_id ${where}
            ORDER BY c.name ASC, s.base_price ASC`,
          params
        )
      }
    };
  });

  route('GET', '/api/providers', async (ctx) => ({
    status: 200,
    body: Object.assign({ ok: true }, db.searchProviders({
      category: str(ctx.query.get('category'), 60),
      city: str(ctx.query.get('city'), 60),
      q: str(ctx.query.get('q'), 80),
      min_rating: Number(ctx.query.get('min_rating')) || 0,
      max_price: Number(ctx.query.get('max_price')) || 0,
      verified: ctx.query.get('verified') === '1',
      sort: str(ctx.query.get('sort'), 20),
      page: Number(ctx.query.get('page')) || 1,
      per_page: Number(ctx.query.get('per_page')) || 12
    }))
  }));

  route('GET', '/api/providers/:id', async (ctx) => {
    const provider = db.providerDetail(intOf(ctx.params.id, 0, 1));
    if (!provider) throw Object.assign(new Error('Professional not found.'), { status: 404 });
    return { status: 200, body: { ok: true, provider } };
  });

  /* ---------------------------------------------------------- auth routes */
  route('POST', '/api/auth/register', async (ctx) => {
    const email = emailOf(ctx.body.email);
    const password = String(ctx.body.password || '');
    const name = str(ctx.body.name, 80);
    const role = str(ctx.body.role, 20) === 'provider' ? 'provider' : 'customer';
    if (!email) throw Object.assign(new Error('Please enter a valid email address.'), { status: 400 });
    if (password.length < 8) throw Object.assign(new Error('Password must be at least 8 characters.'), { status: 400 });
    if (name.length < 2) throw Object.assign(new Error('Please enter your full name.'), { status: 400 });
    if (db.userByEmail(email)) throw Object.assign(new Error('An account with this email already exists.'), { status: 409 });

    const hashed = auth.hashPassword(password);
    const userId = db.createUser({
      email, name, role,
      password_hash: hashed.hash,
      salt: hashed.salt,
      phone: str(ctx.body.phone, 20),
      city: str(ctx.body.city, 60)
    });

    let providerId = null;
    if (role === 'provider') {
      const category = db.categoryBySlug(str(ctx.body.category, 60));
      if (!category) throw Object.assign(new Error('Please choose a service category.'), { status: 400 });
      const city = str(ctx.body.city, 60);
      if (!city) throw Object.assign(new Error('Please enter your city.'), { status: 400 });
      providerId = db.createProvider({
        user_id: userId,
        business_name: str(ctx.body.business_name, 120) || name,
        category_id: category.id,
        city,
        area: str(ctx.body.area, 80),
        headline: str(ctx.body.headline, 200),
        experience_years: intOf(ctx.body.experience_years, 0, 0, 60)
      });
    }

    const session = auth.createSession(db, userId);
    return {
      status: 200,
      headers: { 'Set-Cookie': auth.cookieHeader(session.token, session.expiresAt) },
      body: { ok: true, user: publicUser(db.userById(userId)), provider_id: providerId }
    };
  }, { rate: { max: 8, windowMs: 10 * 60 * 1000 } });

  route('POST', '/api/auth/login', async (ctx) => {
    const email = emailOf(ctx.body.email);
    const user = email ? db.userByEmail(email) : null;
    if (!user || !auth.verifyPassword(String(ctx.body.password || ''), user.salt, user.password_hash)) {
      throw Object.assign(new Error('Email or password is incorrect.'), { status: 401 });
    }
    if (user.status !== 'active') throw Object.assign(new Error('This account is not active. Please contact support.'), { status: 403 });
    const session = auth.createSession(db, user.id);
    return {
      status: 200,
      headers: { 'Set-Cookie': auth.cookieHeader(session.token, session.expiresAt) },
      body: { ok: true, user: publicUser(user) }
    };
  }, { rate: { max: 12, windowMs: 10 * 60 * 1000 } });

  route('POST', '/api/auth/logout', async (ctx) => {
    const token = auth.readCookie(ctx.req.headers.cookie);
    auth.destroySession(db, token);
    return { status: 200, headers: { 'Set-Cookie': auth.clearCookieHeader() }, body: { ok: true } };
  });

  route('GET', '/api/me', async (ctx) => {
    if (!ctx.user) return { status: 200, body: { ok: true, user: null } };
    const body = { ok: true, user: publicUser(ctx.user) };
    if (ctx.user.role === 'provider') {
      const provider = db.providerByUser(ctx.user.id);
      if (provider) {
        body.provider = db.providerDetail(provider.id);
        body.provider.bookings = db.bookingsForProvider(provider.id);
      }
    }
    if (ctx.user.role === 'customer') {
      body.bookings = db.bookingsForCustomer(ctx.user.id);
    }
    return { status: 200, body };
  });

  function publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      city: user.city,
      provider_id: user.provider_id || null,
      provider_status: user.provider_status || null
    };
  }

  /* ------------------------------------------------------------- bookings */
  route('POST', '/api/bookings', async (ctx) => {
    const user = requireRole(ctx, 'customer');
    const providerId = intOf(ctx.body.provider_id, 0, 1);
    const serviceId = intOf(ctx.body.service_id, 0, 1);
    const provider = db.get("SELECT * FROM providers WHERE id = ? AND status = 'approved'", [providerId]);
    if (!provider) throw Object.assign(new Error('This professional is not available right now.'), { status: 404 });

    const service = db.get(
      'SELECT s.* FROM services s JOIN provider_services ps ON ps.service_id = s.id AND ps.provider_id = ? WHERE s.id = ?',
      [providerId, serviceId]
    );
    if (!service) throw Object.assign(new Error('Please choose a service from this professional.'), { status: 400 });

    const date = str(ctx.body.date, 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('Please choose a valid date.'), { status: 400 });
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (Date.parse(`${date}T00:00:00`) < startOfToday.getTime()) {
      throw Object.assign(new Error('Please choose today or a future date.'), { status: 400 });
    }

    const slot = str(ctx.body.slot, 60);
    if (!seed.SLOTS.includes(slot)) throw Object.assign(new Error('Please choose a time slot.'), { status: 400 });

    const address = str(ctx.body.address, 300);
    if (address.length < 10) throw Object.assign(new Error('Please enter the full service address.'), { status: 400 });

    const id = db.createBooking({
      customer_id: user.id,
      provider_id: providerId,
      service_id: serviceId,
      date,
      slot,
      address,
      notes: str(ctx.body.notes, 500),
      price: db.priceFor(providerId, serviceId)
    });
    return { status: 200, body: { ok: true, booking: db.bookingById(id) } };
  }, { rate: { max: 20, windowMs: 10 * 60 * 1000 } });

  route('GET', '/api/bookings', async (ctx) => {
    const user = requireUser(ctx);
    if (user.role === 'provider') {
      const provider = db.providerByUser(user.id);
      return { status: 200, body: { ok: true, bookings: provider ? db.bookingsForProvider(provider.id) : [] } };
    }
    return { status: 200, body: { ok: true, bookings: db.bookingsForCustomer(user.id) } };
  });

  route('PATCH', '/api/bookings/:id', async (ctx) => {
    const user = requireUser(ctx);
    const id = intOf(ctx.params.id, 0, 1);
    const booking = db.bookingById(id);
    if (!booking) throw Object.assign(new Error('Booking not found.'), { status: 404 });
    const status = str(ctx.body.status, 20);
    const provider = user.role === 'provider' ? db.providerByUser(user.id) : null;
    const isOwner = user.role === 'customer' && booking.customer_id === user.id;
    const isProvider = provider && booking.provider_id === provider.id;
    if (!isOwner && !isProvider && user.role !== 'admin') {
      throw Object.assign(new Error('You cannot change this booking.'), { status: 403 });
    }

    const allowedForProvider = { requested: ['accepted', 'declined'], accepted: ['completed', 'cancelled'] };
    const allowedForCustomer = { requested: ['cancelled'], accepted: ['cancelled'] };

    if (isProvider || user.role === 'admin') {
      if (!(allowedForProvider[booking.status] || []).includes(status)) {
        throw Object.assign(new Error('This booking cannot be moved to that status.'), { status: 409 });
      }
    } else if (!(allowedForCustomer[booking.status] || []).includes(status)) {
      throw Object.assign(new Error('This booking cannot be cancelled now.'), { status: 409 });
    }

    db.setBookingStatus(id, status);
    return { status: 200, body: { ok: true, booking: db.bookingById(id) } };
  });

  route('POST', '/api/reviews', async (ctx) => {
    const user = requireRole(ctx, 'customer');
    const bookingId = intOf(ctx.body.booking_id, 0, 1);
    const booking = db.bookingById(bookingId);
    if (!booking) throw Object.assign(new Error('Booking not found.'), { status: 404 });
    if (booking.customer_id !== user.id) throw Object.assign(new Error('You can only review your own bookings.'), { status: 403 });
    if (booking.status !== 'completed') throw Object.assign(new Error('You can review after the work is completed.'), { status: 409 });
    const rating = intOf(ctx.body.rating, 0, 1, 5);
    if (!rating) throw Object.assign(new Error('Please choose a rating.'), { status: 400 });
    const id = db.addReview({
      booking_id: bookingId,
      provider_id: booking.provider_id,
      customer_id: user.id,
      rating,
      comment: str(ctx.body.comment, 500)
    });
    if (!id) throw Object.assign(new Error('You have already reviewed this booking.'), { status: 409 });
    return { status: 200, body: { ok: true, review_id: id } };
  });

  /* ------------------------------------------------------------- provider */
  route('PUT', '/api/provider/me', async (ctx) => {
    const user = requireRole(ctx, 'provider');
    const provider = db.providerByUser(user.id);
    if (!provider) throw Object.assign(new Error('Provider profile not found.'), { status: 404 });
    const patch = {};
    if (ctx.body.business_name !== undefined) patch.business_name = str(ctx.body.business_name, 120);
    if (ctx.body.city !== undefined) patch.city = str(ctx.body.city, 60);
    if (ctx.body.area !== undefined) patch.area = str(ctx.body.area, 80);
    if (ctx.body.headline !== undefined) patch.headline = str(ctx.body.headline, 200);
    if (ctx.body.bio !== undefined) patch.bio = str(ctx.body.bio, 1200);
    if (ctx.body.experience_years !== undefined) patch.experience_years = intOf(ctx.body.experience_years, 0, 0, 60);
    if (ctx.body.price_from !== undefined) patch.price_from = intOf(ctx.body.price_from, 0, 0, 100000);
    if (ctx.body.category !== undefined) {
      const category = db.categoryBySlug(str(ctx.body.category, 60));
      if (!category) throw Object.assign(new Error('Unknown category.'), { status: 400 });
      patch.category_id = category.id;
    }
    db.updateProvider(provider.id, patch);
    return { status: 200, body: { ok: true, provider: db.providerDetail(provider.id) } };
  });

  /* ---------------------------------------------------------------- admin */
  route('GET', '/api/admin/stats', async (ctx) => {
    requireRole(ctx, 'admin');
    return {
      status: 200,
      body: {
        ok: true,
        stats: db.stats(),
        recent: db.recentBookings(12),
        top_categories: db.topCategories(),
        pending_providers: db.listProviders({ status: 'pending' })
      }
    };
  });

  route('GET', '/api/admin/providers', async (ctx) => {
    requireRole(ctx, 'admin');
    return { status: 200, body: { ok: true, providers: db.listProviders({ status: str(ctx.query.get('status'), 20) }) } };
  });

  route('PATCH', '/api/admin/providers/:id', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = intOf(ctx.params.id, 0, 1);
    const status = str(ctx.body.status, 20);
    if (!['pending', 'approved', 'suspended'].includes(status)) {
      throw Object.assign(new Error('Unknown status.'), { status: 400 });
    }
    const patch = { status };
    if (ctx.body.verified !== undefined) patch.verified = ctx.body.verified ? 1 : 0;
    db.updateProvider(id, patch);
    return { status: 200, body: { ok: true } };
  });

  route('GET', '/api/admin/bookings', async (ctx) => {
    requireRole(ctx, 'admin');
    return { status: 200, body: { ok: true, bookings: db.recentBookings(100) } };
  });

  /* --------------------------------------------------------------- contact */
  route('POST', '/api/contact', async (ctx) => {
    const name = str(ctx.body.name, 80);
    const email = emailOf(ctx.body.email);
    const message = str(ctx.body.message, 2000);
    if (name.length < 2 || !email || message.length < 10) {
      throw Object.assign(new Error('Please enter your name, a valid email and a message.'), { status: 400 });
    }
    const file = path.join(dataDir, 'contacts.jsonl');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: Date.now(), name, email, message })}\n`, { mode: 0o600 });
    return { status: 200, body: { ok: true, message: 'Thank you — our team will reply within one working day.' } };
  }, { rate: { max: 6, windowMs: 10 * 60 * 1000 } });

  /* ---------------------------------------------------------------- handle */
  async function handle(req, res, url) {
    const found = match(req.method, url.pathname);
    if (!found) return fail(res, 404, 'Not found');

    const ip = clientIp(req, trustProxyHops);
    const { entry, params } = found;
    const ctx = {
      req, res, url, params,
      query: url.searchParams,
      ip,
      body: {},
      user: auth.userForRequest(db, auth.readCookie(req.headers.cookie))
    };

    if (entry.meta.rate) {
      const key = `${entry.method}:${url.pathname}:${ip}`;
      if (!limit(key, entry.meta.rate.max, entry.meta.rate.windowMs)) {
        return fail(res, 429, 'Too many requests. Please wait a few minutes and try again.');
      }
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!isJson(req) || !sameOrigin(req)) {
        return fail(res, 403, 'This request was blocked for security reasons.');
      }
      try {
        ctx.body = await readBody(req);
      } catch (error) {
        return fail(res, error.status || 400, error.message);
      }
    }

    try {
      const result = await entry.handler(ctx);
      return send(res, result.status || 200, result.body, result.headers);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(`[api] ${req.method} ${url.pathname}:`, error.message);
      return fail(res, status, status >= 500 ? 'Something went wrong. Please try again.' : error.message);
    }
  }

  return { handle };
}

module.exports = { createApi };
