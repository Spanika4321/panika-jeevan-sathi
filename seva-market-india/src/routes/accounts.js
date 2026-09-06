'use strict';
/**
 * SEVA MARKET INDIA — accounts: register, login, logout, provider signup.
 *
 * Browser-native flows. Every handler is server-rendered and returns either
 * an HTML form (GET) or a 303 redirect after a successful POST (PRG), so
 * refresh never double-submits and no inline JavaScript is needed.
 */

const { layout, esc } = require('../views/layout');
const { readBody, validators, validate } = require('../http/request');
const { serializeCookie } = require('../http/session');
const userModel = require('../models/user');
const sessionModel = require('../models/session');
const providerModel = require('../models/provider');
const categoryModel = require('../models/category');
const locationModel = require('../models/location');
const { isValidPin } = require('../db/values');

/** URL-encode a value for use in a query-string message. */
const q = (value) => encodeURIComponent(String(value ?? ''));

/** Render the outer page shell with the current user's session state. */
function renderPage(config, user, ctx, { title, body, currentPath, description = '' }) {
  return layout({
    title,
    description,
    body,
    currentPath: currentPath || (ctx && ctx.pathname) || '/',
    site: config.site,
    user: user || null,
  });
}

/** Build the Set-Cookie header value for a fresh session. */
function sessionCookie(config, token) {
  return serializeCookie(config.security.cookie.name, token, {
    maxAgeSeconds: config.security.sessionTtlSeconds,
    secure: config.security.cookie.secure,
  });
}

/** Return the redirect shape app.js understands (sets cookies first). */
function redirectWithCookies(config, location, tokens) {
  return {
    redirect: location,
    cookies: tokens.map((token) => sessionCookie(config, token)),
  };
}

function categoryOptions(db, selectedId = null) {
  const rows = categoryModel.tree(db);
  return rows
    .map((parent) => {
      const children = parent.children.map((child) => {
        const sel = Number(child.id) === Number(selectedId) ? ' selected' : '';
        return `          <option value="${child.id}"${sel}>${esc(parent.name)} → ${esc(child.name)}</option>`;
      });
      return `<optgroup label="${esc(parent.name)}">\n${children.join('\n')}\n        </optgroup>`;
    })
    .join('\n');
}

function register(router, { db, config }) {
  /* -------------------------------------------------------------- login */
  router.get('/login', (ctx) => {
    if (ctx.user) return { redirect: '/' };
    const body = `
    <section class="page-head"><div class="container container--narrow">
      <h1 class="page-head__title">Log in</h1>
      <p class="page-head__lede">Access your provider dashboard and enquiries.</p>
    </div></section>
    <section class="section"><div class="container container--narrow">
      ${ctx.query.get('error') ? `<div class="alert alert--error" role="alert">${esc(ctx.query.get('error'))}</div>` : ''}
      <form class="form" action="/login" method="post">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required maxlength="254">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required minlength="8">
        <button class="btn btn--primary" type="submit">Log in</button>
      </form>
      <p class="muted">New here? <a href="/register">Create an account</a> or <a href="/providers/new">list your service</a>.</p>
    </div></section>`;
    return { html: renderPage(config, null, ctx, { title: 'Log in', body, currentPath: '/login' }) };
  });

  router.post('/login', async (ctx) => {
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const user = userModel.findByEmail(db, body.email);
    if (!user || !userModel.verifyPassword(String(body.password || ''), user.password_hash)) {
      return {
        html: renderPage(config, null, ctx, {
          title: 'Log in',
          currentPath: '/login',
          body: `
          <section class="page-head"><div class="container container--narrow">
            <h1 class="page-head__title">Log in</h1>
          </div></section>
          <section class="section"><div class="container container--narrow">
            <div class="alert alert--error" role="alert">Incorrect email or password.</div>
            <p class="muted"><a href="/login">Try again</a></p>
          </div></section>`,
        }),
      };
    }
    if (user.status !== 'active') {
      return {
        html: renderPage(config, null, ctx, {
          title: 'Account pending',
          currentPath: '/login',
          body: `
          <section class="page-head"><div class="container container--narrow">
            <h1 class="page-head__title">Account not active yet</h1>
          </div></section>
          <section class="section"><div class="container container--narrow">
            <p class="prose">Your account is ${esc(user.status)}. Contact support to activate it.</p>
          </div></section>`,
        }),
      };
    }
    const session = sessionModel.create(db, user.id, { ttlSeconds: config.security.sessionTtlSeconds });
    const next = (ctx.query.get('next') || '/').replace(/^\/\//, '/');
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    return redirectWithCookies(config, safeNext, [session.token]);
  });

  /* ----------------------------------------------------------- register */
  router.get('/register', (ctx) => {
    if (ctx.user) return { redirect: '/' };
    const body = `
    <section class="page-head"><div class="container container--narrow">
      <h1 class="page-head__title">Create your account</h1>
      <p class="page-head__lede">Find and compare local service providers near you.</p>
    </div></section>
    <section class="section"><div class="container container--narrow">
      <form class="form" action="/register" method="post">
        <label for="full_name">Your name</label>
        <input id="full_name" name="full_name" required maxlength="120">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required maxlength="254">
        <label for="phone">Mobile (optional)</label>
        <input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="15">
        <label for="password">Password (min 8 characters)</label>
        <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
        <button class="btn btn--primary" type="submit">Create account</button>
      </form>
      <p class="muted">Already have an account? <a href="/login">Log in</a>.</p>
    </div></section>`;
    return { html: renderPage(config, null, ctx, { title: 'Sign up', body, currentPath: '/register' }) };
  });

  router.post('/register', async (ctx) => {
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const { value, errors, valid } = validate({
      fullName: () => validators.text(body.full_name ?? body.fullName, { field: 'full_name', max: 120 }),
      email: () => validators.email(body.email, { field: 'email', required: true }),
      phone: () => validators.phone(body.phone, { field: 'phone', required: false }),
      password: () => validators.text(body.password, { field: 'password', min: 8, max: 200 }),
    });
    if (!valid) {
      return {
        html: renderPage(config, null, ctx, {
          title: 'Sign up',
          currentPath: '/register',
          body: `
          <section class="page-head"><div class="container container--narrow">
            <h1 class="page-head__title">Create your account</h1>
          </div></section>
          <section class="section"><div class="container container--narrow">
            <div class="alert alert--error" role="alert">${esc(Object.values(errors).join(' '))}</div>
            <p class="muted"><a href="/register">Back</a></p>
          </div></section>`,
        }),
      };
    }
    const user = userModel.createUser(db, {
      email: value.email,
      fullName: value.fullName,
      password: value.password,
      phone: value.phone,
      role: 'customer',
      status: 'active',
    });
    const session = sessionModel.create(db, user.user.id, { ttlSeconds: config.security.sessionTtlSeconds });
    return redirectWithCookies(config, '/', [session.token]);
  });

  /* ------------------------------------------------------------- logout */
  router.post('/logout', (ctx) => {
    sessionModel.destroy(db, ctx.token || '');
    const clear = serializeCookie(config.security.cookie.name, '', {
      maxAgeSeconds: 0,
      secure: config.security.cookie.secure,
    });
    return { redirect: '/', status: 303, cookies: [clear] };
  });

  /* --------------------------------------------------- provider signup */
  router.get('/providers/new', (ctx) => {
    // Already a provider? Straight to the dashboard.
    if (ctx.user && providerModel.findByUserId(db, ctx.user.id)) return { redirect: '/dashboard' };
    const body = `
    <section class="page-head"><div class="container container--narrow">
      <h1 class="page-head__title">List your service</h1>
      <p class="page-head__lede">Create your account, tell us what you offer and where you work, and start receiving
        enquiries from customers in your PIN code. Listings go live immediately.</p>
    </div></section>
    <section class="section"><div class="container container--narrow">
      ${ctx.query.get('error') ? `<div class="alert alert--error" role="alert">${esc(ctx.query.get('error'))}</div>` : ''}
      <form class="form" action="/providers/new" method="post">
        <h2 class="form__h">Your business</h2>
        <label for="business_name">Business name</label>
        <input id="business_name" name="business_name" required maxlength="140" placeholder="e.g. Borah Plumbing Works">
        <label for="category_id">What do you do?</label>
        <select id="category_id" name="category_id" required>
          <option value="">Choose a service category…</option>
          ${categoryOptions(db)}
        </select>
        <label for="pin_code">Where do you work? (PIN code)</label>
        <input id="pin_code" name="pin_code" type="text" inputmode="numeric" required maxlength="6"
               placeholder="e.g. 781001" pattern="[1-9][0-9]{5}">
        <label for="experience_years">Years of experience</label>
        <input id="experience_years" name="experience_years" type="number" inputmode="numeric" min="0" max="70" value="0">
        <label for="about">About your service</label>
        <textarea id="about" name="about" rows="4" maxlength="2000"
                  placeholder="What you offer, your team, response time…"></textarea>

        <h2 class="form__h">Your account</h2>
        <label for="contact_name">Your name</label>
        <input id="contact_name" name="contact_name" required maxlength="120">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required maxlength="254">
        <label for="phone">Mobile (shown to customers)</label>
        <input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel" required maxlength="15">
        <label for="password">Password (min 8 characters)</label>
        <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
        <button class="btn btn--primary" type="submit">Create listing &amp; account</button>
      </form>
      <p class="muted">Already have an account? <a href="/login">Log in</a> to add your listing.</p>
    </div></section>`;
    return { html: renderPage(config, ctx.user, ctx, { title: 'List your service', body, currentPath: '/providers/new' }) };
  });

  router.post('/providers/new', async (ctx) => {
    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const { value, errors, valid } = validate({
      businessName: () => validators.text(body.business_name, { field: 'business_name', max: 140 }),
      categoryId: () => validators.int(body.category_id, { field: 'category_id', required: true, min: 1 }),
      pinCode: () => validators.pin(body.pin_code, { field: 'pin_code', required: true }),
      experienceYears: () => validators.int(body.experience_years, { field: 'experience_years', min: 0, max: 70, fallback: 0 }),
      about: () => validators.text(body.about, { field: 'about', required: false, max: 2000 }),
      contactName: () => validators.text(body.contact_name, { field: 'contact_name', max: 120 }),
      email: () => validators.email(body.email, { field: 'email', required: true }),
      phone: () => validators.phone(body.phone, { field: 'phone' }),
      password: () => validators.text(body.password, { field: 'password', min: 8, max: 200 }),
    });

    const pinLocation = isValidPin(value.pinCode)
      ? locationModel.findByPin(db, value.pinCode)
      : null;

    const covered = pinLocation && pinLocation.chain.some((n) => n.kind === 'pincode');
    if (!pinLocation || !covered) {
      errors.pin_code = `We don't cover PIN ${esc(value.pinCode)} yet. Try one of our live areas, or contact us to expand coverage.`;
    }

    if (Object.keys(errors).length) {
      const msg = Object.values(errors).join(' ');
      return { redirect: `/providers/new?error=${q(msg)}`, status: 303 };
    }

    // Category must be a live service category (leaf).
    const category = categoryModel.findById(db, value.categoryId);
    if (!category || category.parent_id === null) {
      return { redirect: `/providers/new?error=${q('Please choose a specific service category.')}`, status: 303 };
    }

    // The pin node is a valid provider location (provider inherits it).
    const location = locationModel.findByPin(db, value.pinCode).node;

    let user = userModel.findByEmail(db, value.email);
    if (user) {
      if (!ctx.user || ctx.user.id !== user.id) {
        return { redirect: `/login?error=${q('That email already has an account. Please log in and then add your listing from your profile.')}`, status: 303 };
      }
      if (user.status !== 'active') userModel.verify(db, user.id);
      if (user.role !== 'provider') userModel.updateRole(db, user.id, 'provider');
    } else {
      const created = userModel.createUser(db, {
        email: value.email,
        fullName: value.contactName,
        password: value.password,
        phone: value.phone,
        role: 'provider',
        status: 'active',
      });
      user = { id: created.user.id };
    }

    const provider = providerModel.createProvider(db, {
      userId: user.id,
      businessName: value.businessName,
      contactName: value.contactName,
      phone: value.phone,
      categoryId: value.categoryId,
      locationId: location.id,
      pinCode: value.pinCode,
      about: value.about,
      experienceYears: value.experienceYears,
      status: 'active',
    });
    providerModel.setServiceAreas(db, provider.id, [value.pinCode]);

    const session = sessionModel.create(db, user.id, { ttlSeconds: config.security.sessionTtlSeconds });
    return redirectWithCookies(config, '/dashboard?welcome=1', [session.token]);
  });
}

module.exports = { register };
