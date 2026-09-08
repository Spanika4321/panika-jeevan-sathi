'use strict';
/**
 * SEVA MARKET INDIA — account & provider dashboard.
 *
 *   GET  /account                     dashboard (role-aware)
 *   POST /account/role/provider       customer → provider account mode
 *   GET/POST /account/provider        create or edit the business profile
 *   GET  /account/services            manage services
 *   GET/POST /account/services/new    add a service
 *   GET/POST /account/services/:id/edit
 *   POST /account/services/:id/status publish / pause / archive
 *   GET  /account/leads               enquiries received
 *   POST /account/leads/:id/status    mark contacted / closed / spam
 *
 * Ownership model: a user owns at most one business profile (the row with
 * user_id = account id) and everything downstream hangs off that row, so
 * every mutation here is guarded by one `ownedProvider()` lookup.
 */

const { layout, esc } = require('../views/layout');
const {
  field, textareaField, selectField, alertMarkup, ratingMarkup, verifiedMarkup,
  serviceStatusMarkup, leadStatusMarkup, initials, priceLabel, tintIndex,
} = require('../views/ui');
const { sessionCookie, claimsFor } = require('../auth/session');
const { assertSameOrigin } = require('../http/security');
const { readBody, validators, validate } = require('../http/request');

function register(router, { db, store, config, session }) {
  /* -------------------------------------------------- tiny helpers --- */

  const modelCategory = require('../models/category');
  const modelLocation = require('../models/location');
  const modelProvider = require('../models/provider');
  const modelService = require('../models/service');

  /** The logged-in user row (from the store), or null. */
  async function currentUser(ctx) {
    const claims = ctx.auth;
    if (!claims || !claims.uid) return null;
    const user = await store.users.findById(claims.uid).catch(() => null);
    if (!user || user.status === 'suspended') return null;
    return user;
  }

  /** The user's owned business profile row, or null. */
  function ownedProvider(user) {
    if (!user || user.role !== 'provider') return null;
    const rows = modelProvider.byUserId(db, user.id);
    return rows.length ? rows[0] : null;
  }

  const redirect = (location, okCode) => ({ redirect: `${location}?ok=${encodeURIComponent(okCode)}` });

  function page(ctx, { title, description = '', body, currentPath = null }) {
    return layout({
      title,
      description,
      body,
      currentPath: currentPath || ctx.pathname,
      user: ctx.auth,
      site: config.site,
    });
  }

  function shell(ctx, { title, active, body, description = '' }) {
    const inner = `
      <div class="acct">
        <nav class="acct-nav" aria-label="Account">
          <a href="/account" class="${active === 'home' ? 'is-active' : ''}">📊 Dashboard</a>
          ${ctx.auth && ctx.auth.rl === 'provider' ? `
            <a href="/account/provider" class="${active === 'provider' ? 'is-active' : ''}">🏪 My business</a>
            <a href="/account/services" class="${active === 'services' ? 'is-active' : ''}">🛠️ My services</a>
            <a href="/account/leads" class="${active === 'leads' ? 'is-active' : ''}">📥 Enquiries</a>
          ` : ''}
          <a href="/providers/new" class="${active === 'listing' ? 'is-active' : ''}">📢 List your service</a>
        </nav>
        <div class="acct-main">${body}</div>
      </div>`;
    return { html: page(ctx, { title, description, body: inner }) };
  }

  function alertFromOk(query, map) {
    const code = query.get('ok');
    return code && map[code] ? alertMarkup(map[code], { tone: 'ok' }) : '';
  }

  function logAudit(store2, actorId, action, entity, entityId, detail) {
    Promise.resolve(store2.audit.log({
      actor: actorId ? `user:${actorId}` : 'guest', action, entity, entityId,
      detail: JSON.stringify(detail || {}),
    })).catch(() => {});
  }

  /* ---------------------------------------------- account shared data */

  const leafCategoryGroups = () => modelCategory.tree(db).map((parent) => ({
    label: parent.name,
    options: (parent.children || []).map((child) => ({
      value: child.id,
      label: `${child.name}`,
    })),
  }));

  /** City-grouped localities with their PIN; data-city enables chained JS. */
  const localityGroups = () => {
    const india = modelLocation.ensureIndia(db);
    const states = modelLocation.findChildren(db, india.id, 'state');
    const groups = [];
    for (const state of states) {
      for (const district of modelLocation.findChildren(db, state.id, 'district')) {
        const cities = modelLocation.findChildren(db, district.id, 'city');
        for (const city of cities) {
          const localities = modelLocation.findChildren(db, city.id, 'locality').map((locality) => {
            const pin = db.scalar(
              `SELECT pin_code FROM locations WHERE parent_id = ? AND kind = 'pincode' AND is_active = 1 LIMIT 1`,
              [locality.id],
            );
            return {
              value: locality.id,
              label: pin ? `${locality.name} (${pin})` : locality.name,
              data: { city: String(city.id) },
            };
          });
          if (localities.length) {
            groups.push({
              label: `${city.name} — ${state.name}`,
              options: localities,
            });
          }
        }
      }
    }
    return groups;
  };

  /* -------------------------------------------------- GET /account --- */

  router.get('/account', async (ctx) => {
    if (!ctx.auth) return { redirect: '/login?next=/account' };
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account&expired=1' };

    if (user.role === 'provider') {
      const provider = ownedProvider(user);
      if (!provider) {
        const body = `
          <div class="panel">
            <p class="cta-card__kicker">Welcome, ${esc(user.full_name)} 🎉</p>
            <h1 class="panel__title panel__title--xl">Your provider account is ready</h1>
            <p class="prose">Now add your business details — name, category, area and phone — so customers can find you.
              It takes about two minutes and you can edit it any time.</p>
            <div class="cta-card__actions">
              <a class="btn btn--yellow btn--lg" href="/account/provider">Set up my business →</a>
              <a class="btn btn--ghost btn--lg" href="/providers/new">What happens next?</a>
            </div>
          </div>`;
        return shell(ctx, { title: 'Dashboard', active: 'home', body });
      }

      const services = modelService.byProviderAll(db, provider.id);
      const live = services.filter((row) => row.status === 'active').length;
      const leads = await store.leads.byProvider(provider.id, { limit: 100 }).catch(() => []);
      const newLeads = leads.filter((row) => row.status === 'new').length;

      const recentLeads = leads.slice(0, 5);
      const recentServices = services.slice(0, 5);
      const metric = (label, value, accent) => `
        <div class="metric metric--${esc(accent)}"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;

      const body = `
        ${alertFromOk(ctx.query, {
          created: 'Business profile created — you are now listed on the marketplace!',
          saved: 'Business profile updated.',
        })}
        <h1 class="acct-title">Namaste, ${esc(user.full_name.split(' ')[0])} 👋</h1>
        <p class="acct-lede">Here is how your business is doing on ${esc(config.site.name)}.</p>
        <div class="metrics">
          ${metric('Live services', live, 'blue')}
          ${metric('All services', services.length, 'grey')}
          ${metric('New enquiries', newLeads, 'green')}
          ${metric('Total enquiries', leads.length, 'orange')}
        </div>

        <div class="panel acct-quick">
          <h2 class="panel__title">Quick actions</h2>
          <div class="cta-card__actions">
            <a class="btn btn--yellow" href="/account/services/new">+ Add a service</a>
            <a class="btn btn--ghost" href="/account/services">Manage services</a>
            <a class="btn btn--ghost" href="/account/provider">Edit business profile</a>
            <a class="btn btn--white-line-blue" href="/providers/${esc(provider.slug)}">View public profile ↗</a>
          </div>
        </div>

        <div class="acct-cols">
          <div class="panel">
            <div class="acct-panel-head">
              <h2 class="panel__title">Latest enquiries</h2>
              <a href="/account/leads">View all →</a>
            </div>
            ${recentLeads.length ? `
            <ul class="lead-list">${recentLeads.map((lead) => `
              <li class="${lead.status === 'new' ? 'is-new' : ''}">
                <div class="lead-list__who">
                  <strong>${esc(lead.name)}</strong>
                  <a href="tel:+91${esc(lead.phone)}">${esc(lead.phone)}</a>
                </div>
                <div class="lead-list__msg">${esc(lead.message || '—')}</div>
                <div class="lead-list__meta">${leadStatusMarkup(lead.status)}
                  <time>${esc(friendlyDate(lead.created_at))}</time></div>
              </li>`).join('')}</ul>
            ` : `<p class="empty">No enquiries yet. Share your public profile to get your first one! 🚀</p>`}
          </div>

          <div class="panel">
            <div class="acct-panel-head">
              <h2 class="panel__title">Your services</h2>
              <a href="/account/services">Manage →</a>
            </div>
            ${recentServices.length ? `
            <ul class="mini-list">${recentServices.map((service) => `
              <li>
                <span class="mini-list__title">
                  ${service.status === 'active'
                    ? `<a href="/services/${esc(service.slug)}">${esc(service.title)}</a>`
                    : esc(service.title)}
                </span>
                ${serviceStatusMarkup(service.status)}
                <span class="mini-list__price">${esc(priceLabel(service))}</span>
              </li>`).join('')}</ul>
            ` : '<p class="empty">Nothing listed yet.</p>'}
            <p class="acct-note">Customers see only <strong>Live</strong> services. Drafts and paused ones stay private.</p>
          </div>
        </div>`;
      return shell(ctx, { title: 'Dashboard', active: 'home', body });
    }

    /* customer dashboard */
    const body = `
      ${alertFromOk(ctx.query, { switched: 'Account switched to provider mode — set up your business below.' })}
      <h1 class="acct-title">Namaste, ${esc(user.full_name.split(' ')[0])} 👋</h1>
      <p class="acct-lede">Your ${esc(config.site.name)} customer account is ready.</p>

      <div class="panel">
        <h2 class="panel__title">Account details</h2>
        <dl class="acct-details">
          <div><dt>Name</dt><dd>${esc(user.full_name)}</dd></div>
          <div><dt>Email</dt><dd>${esc(user.email)}</dd></div>
          <div><dt>Mobile</dt><dd>${esc(user.phone || '—')}</dd></div>
          <div><dt>Role</dt><dd><span class="badge badge--customer">Customer</span></dd></div>
        </dl>
      </div>

      <div class="panel">
        <h2 class="panel__title">Hire a service in three taps</h2>
        <ol class="steps steps--compact">
          <li class="step tint-0"><span class="step__num" aria-hidden="true">1</span>
            <h3 class="step__title">Search</h3>
            <p class="step__text">Type a service and your city or PIN on the home page.</p></li>
          <li class="step tint-1"><span class="step__num" aria-hidden="true">2</span>
            <h3 class="step__title">Compare</h3>
            <p class="step__text">Check verified badges, ratings and up-front prices.</p></li>
          <li class="step tint-2"><span class="step__num" aria-hidden="true">3</span>
            <h3 class="step__title">Call or enquire</h3>
            <p class="step__text">Contact the provider directly — free, no middleman.</p></li>
        </ol>
        <div class="cta-card__actions">
          <a class="btn btn--primary btn--lg" href="/search">Browse services now</a>
        </div>
      </div>

      <div class="panel panel--offer">
        <div>
          <h2 class="panel__title">Do you also provide a service?</h2>
          <p class="prose">One account can do both: hire a plumber today, list your own service tomorrow.
            Switching is instant and free.</p>
        </div>
        <form method="post" action="/account/role/provider">
          <button class="btn btn--orange btn--lg" type="submit">Switch to provider mode</button>
        </form>
      </div>`;
    return shell(ctx, { title: 'Dashboard', active: 'home', body });
  });

  /* ------------------------------------------ POST role switch ------ */

  router.post('/account/role/provider', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account/provider' };
    if (user.role !== 'provider') {
      const updated = await store.users.setRole(user.id, 'provider');
      logAudit(store, user.id, 'account.role.provider', 'user', user.id, {});
      return {
        redirect: '/account/provider',
        headers: { 'Set-Cookie': sessionCookie(claimsFor(updated), session.secret, { secure: session.secure }) },
      };
    }
    return { redirect: '/account/provider' };
  });

  /* ---------------------------------------- business profile --------- */

  function providerFormMarkup({ provider = null, values = {}, errors = {}, ctxPath = '' }) {
    const existing = provider && provider.business_name;
    const data = provider || {};
    const selectedCategory = values.category_id || data.category_id || '';
    const selectedLocality = values.locality_id || data.location_id || '';
    const areas = values.areas ?? (provider ? modelProvider.serviceAreas(db, provider.id).join(', ') : '');
    const formValues = {
      business_name: values.business_name ?? data.business_name ?? '',
      contact_name: values.contact_name ?? data.contact_name ?? '',
      phone: values.phone ?? data.phone ?? '',
      alt_phone: values.alt_phone ?? data.alt_phone ?? '',
      email: values.email ?? data.email ?? '',
      experience_years: values.experience_years ?? data.experience_years ?? '',
      address_line: values.address_line ?? data.address_line ?? '',
      about: values.about ?? data.about ?? '',
    };
    return `
    <form class="panel form-stack" action="/account/provider" method="post" data-provider-form>
      <div class="acct-panel-head">
        <h2 class="panel__title">${existing ? 'Edit your business profile' : 'Create your business profile'}</h2>
        <span class="hint-pill">${existing ? 'Profile ID ' + esc(data.slug) : 'One per account'}</span>
      </div>
      <p class="prose">${existing
        ? 'Changes save instantly. Your public profile stays live while you edit.'
        : 'This is the profile customers see on the marketplace. You can change everything later.'}</p>
      ${errors.form ? alertMarkup(errors.form, { tone: 'err' }) : ''}
      <div class="form-row">
        ${field({ id: 'business_name', label: 'Business name', required: true, value: formValues.business_name, placeholder: 'e.g. Sharma Plumbing Works', error: errors.business_name, autocomplete: 'organization' })}
        ${field({ id: 'contact_name', label: 'Contact person', value: formValues.contact_name, placeholder: 'e.g. Ramesh Sharma', error: errors.contact_name, autocomplete: 'name' })}
      </div>
      <div class="form-row">
        ${field({ id: 'phone', type: 'tel', label: 'Mobile number', required: true, value: formValues.phone, error: errors.phone, inputmode: 'numeric', maxlength: 10, autocomplete: 'tel', hint: 'Customers call this number.' })}
        ${field({ id: 'alt_phone', type: 'tel', label: 'Alternate number (optional)', value: formValues.alt_phone, error: errors.alt_phone, inputmode: 'numeric', maxlength: 10, autocomplete: 'tel' })}
      </div>
      <div class="form-row">
        ${field({ id: 'email', type: 'email', label: 'Business email (optional)', value: formValues.email, error: errors.email, autocomplete: 'email' })}
        ${field({ id: 'experience_years', type: 'number', label: 'Years of experience', value: formValues.experience_years, error: errors.experience_years, min: 0, max: 60, inputmode: 'numeric', suffix: 'yrs' })}
      </div>
      ${selectField({
        id: 'category_id', label: 'What service do you provide?', required: true,
        value: selectedCategory, error: errors.category_id,
        groups: leafCategoryGroups(),
        hint: 'Pick the closest match — you can add more services later.',
      })}
      ${selectField({
        id: 'locality_id', label: 'Where do you work? (city → locality)', required: true,
        value: selectedLocality, error: errors.locality_id,
        groups: localityGroups(),
        hint: 'Customers near this area will find you. Your PIN comes from the locality.',
        dataPrefix: '',
      })}
      <div class="field">
        <label for="areas">Also serve these PIN codes (optional)</label>
        <input id="areas" name="areas" value="${esc(areas || '')}" placeholder="e.g. 781001, 781006" maxlength="120">
        ${errors.areas ? `<p class="field__error" role="alert">${esc(errors.areas)}</p>` : ''}
        <p class="field__hint">Comma-separated 6-digit PIN codes around you. Leave empty to serve only your own area.</p>
      </div>
      ${textareaField({ id: 'about', label: 'About your business', value: formValues.about, rows: 4, maxlength: 2000, placeholder: 'What you do best, your team, tools, response time…', error: errors.about })}
      ${field({ id: 'address_line', label: 'Street address (optional, shown only to you)', value: formValues.address_line, error: errors.address_line, placeholder: 'Shop 12, Main Market…' })}
      <input type="hidden" name="existing_id" value="${esc(data.id || '')}">
      <div class="form-actions">
        <button class="btn btn--orange btn--lg" type="submit">${existing ? 'Save changes' : 'Create & go live'}</button>
        <a class="btn btn--ghost btn--lg" href="${ctxPath}">Cancel</a>
      </div>
    </form>`;
  }

  router.get('/account/provider', async (ctx) => {
    if (!ctx.auth) return { redirect: '/login?next=/account/provider' };
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account/provider' };
    if (user.role !== 'provider') {
      return shell(ctx, { title: 'My business', active: 'provider', body: `
        <div class="panel">
          <h1 class="panel__title panel__title--xl">Switch to provider mode first</h1>
          <p class="prose">Your account is a customer account. Switch it to provider mode to create a business profile — it takes one click and you can keep hiring too.</p>
          <form method="post" action="/account/role/provider"><button class="btn btn--orange btn--lg" type="submit">Switch to provider mode</button></form>
        </div>` });
    }

    const provider = ownedProvider(user);
    const banner = alertFromOk(ctx.query, {
      created: '🎉 Your business is live on the marketplace! Now add your first service.',
      saved: 'Business profile saved.',
    });
    const body = `
      <h1 class="acct-title">My business</h1>
      ${banner}
      ${provider ? `
      <div class="panel acct-profile-summary">
        <div class="acct-profile-summary__head">
          <span class="detail-card__icon tint-${tintIndex(provider.category_slug || '')}" aria-hidden="true">${esc(provider.category_icon || '🧰')}</span>
          <div>
            <h2 class="panel__title">${esc(provider.business_name)}</h2>
            <p class="detail-card__provider">${esc(provider.category_name)} ${verifiedMarkup(provider)} ${ratingMarkup(provider)}</p>
          </div>
        </div>
        <p class="prose">${esc(provider.about || 'No description yet.')}</p>
        <dl class="acct-details acct-details--grid">
          <div><dt>📞 Phone</dt><dd><a href="tel:+91${esc(provider.phone)}">${esc(provider.phone)}</a></dd></div>
          <div><dt>📍 Location</dt><dd>${esc(provider.location_label || '—')}${provider.pin_code ? ` (${esc(provider.pin_code)})` : ''}</dd></div>
          <div><dt>⏱️ Experience</dt><dd>${esc(provider.experience_years || 0)} years</dd></div>
          <div><dt>Status</dt><dd><span class="badge badge--live">Live on marketplace</span></dd></div>
        </dl>
        <div class="cta-card__actions">
          <a class="btn btn--yellow" href="/account/services/new">+ Add a service</a>
          <a class="btn btn--white-line-blue" href="/providers/${esc(provider.slug)}">View public profile ↗</a>
        </div>
      </div>
      <details class="panel panel--edit" ${ctx.query.get('edit') === '1' ? 'open' : ''}>
        <summary class="panel__summary">✏️ Edit business details</summary>
        ${providerFormMarkup({ provider, ctxPath: '/account/provider' })}
      </details>`
      : providerFormMarkup({ ctxPath: '/account' })}
    `;
    return shell(ctx, { title: 'My business', active: 'provider', body });
  });

  router.post('/account/provider', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account/provider' };
    if (user.role !== 'provider') return { redirect: '/login?next=/account/provider' };

    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const errors = {};
    const clean = (name, max) => validators.text(body[name], { field: name, required: false, max });

    const businessName = cleanValue(body.business_name, errors, 'business_name', { required: true, max: 140 });
    const contactName = cleanValue(body.contact_name, errors, 'contact_name', { max: 120 });
    const phone = cleanValue(body.phone, errors, 'phone', { required: true, phone: true });
    const altPhone = body.alt_phone ? cleanValue(body.alt_phone, errors, 'alt_phone', { phone: true }) : null;
    const email = body.email ? cleanValue(body.email, errors, 'email', { email: true }) : null;
    const categoryId = Number(body.category_id);
    const localityId = Number(body.locality_id);
    const experienceYears = body.experience_years ? Number(body.experience_years) : 0;
    const addressLine = cleanValue(body.address_line, errors, 'address_line', { max: 200 });
    const about = cleanValue(body.about, errors, 'about', { max: 2000 });
    if (Number.isNaN(experienceYears) || experienceYears < 0 || experienceYears > 60) {
      errors.experience_years = 'Experience must be 0–60 years.';
    }

    const category = categoryId > 0 ? modelCategory.findById(db, categoryId) : null;
    const locality = localityId > 0 ? db.get('SELECT id, name FROM locations WHERE id = ? AND kind = ? AND is_active = 1', [localityId, 'locality']) : null;
    if (!category) errors.category_id = 'Choose the service you provide.';
    if (!locality) errors.locality_id = 'Choose the locality where you work.';
    if (!businessName) errors.business_name = 'Business name is required.';

    const rawPins = String(body.areas || '').split(/[,;\s]+/).map((pin) => pin.trim()).filter(Boolean);
    const areaPins = [];
    for (const pin of rawPins) {
      if (!/^[1-9][0-9]{5}$/.test(pin)) {
        errors.areas = `"${pin}" is not a valid PIN code.`;
        break;
      }
      areaPins.push(pin);
    }

    const pin = db.scalar(`SELECT pin_code FROM locations WHERE parent_id = ? AND kind = 'pincode' AND is_active = 1 LIMIT 1`, [localityId]);

    if (Object.keys(errors).length) {
      const bodyValues = { ...body, category_id: categoryId, locality_id: localityId, experience_years: body.experience_years || 0, areas: String(body.areas || '') };
      return shell(ctx, {
        title: 'My business', active: 'provider',
        body: `<h1 class="acct-title">My business</h1>
          ${providerFormMarkup({ provider: ownedProvider(user), values: bodyValues, errors, ctxPath: '/account' })}`,
      });
    }

    try {
      const existing = ownedProvider(user);
      let provider;
      if (existing) {
        provider = modelProvider.updateProvider(db, existing.id, {
          businessName, contactName, phone, altPhone, email, categoryId,
          locationId: localityId, pinCode: pin || null, addressLine, about, experienceYears,
        });
        modelProvider.setServiceAreas(db, existing.id, areaPins);
        logAudit(store, user.id, 'provider.update', 'provider', provider.id, {});
        return redirect('/account/provider', 'saved');
      }
      provider = modelProvider.createProvider(db, {
        userId: user.id, businessName, contactName, phone, altPhone, email, categoryId,
        locationId: localityId, pinCode: pin || null, addressLine, about, experienceYears,
        status: 'active',
      });
      modelProvider.setServiceAreas(db, provider.id, areaPins);
      logAudit(store, user.id, 'provider.create', 'provider', provider.id, {});
      return redirect('/account/provider', 'created');
    } catch (err) {
      const errors2 = { form: String(err && err.message ? err.message : 'Could not save the profile.') };
      return shell(ctx, {
        title: 'My business', active: 'provider',
        body: `<h1 class="acct-title">My business</h1>${providerFormMarkup({ provider: ownedProvider(user), values: body, errors: errors2, ctxPath: '/account' })}`,
      });
    }
  });

  /* --------------------------------------------------- services ----- */

  function serviceFormMarkup({ service = null, values = {}, errors = {}, ctxPath = '' }) {
    const data = service || {};
    const units = [
      { value: 'visit', label: 'per visit' },
      { value: 'hour', label: 'per hour' },
      { value: 'day', label: 'per day' },
      { value: 'job', label: 'per job' },
      { value: 'sqft', label: 'per sq.ft' },
      { value: 'month', label: 'per month' },
    ];
    const unitValue = values.price_unit || data.price_unit || 'visit';
    return `
    <form class="panel form-stack" action="${ctxPath}" method="post">
      <div class="acct-panel-head">
        <h2 class="panel__title">${service ? 'Edit service' : 'Add a new service'}</h2>
      </div>
      <p class="prose">${service
        ? 'Update the details below — changes go live immediately if the service is Live.'
        : 'One service = one thing you offer (e.g. “Bathroom leak repair”). Add several — each can have its own price.'}</p>
      ${errors.form ? alertMarkup(errors.form, { tone: 'err' }) : ''}
      ${field({ id: 'title', label: 'Service title', required: true, value: values.title ?? data.title ?? '', placeholder: 'e.g. Bathroom leak repair', error: errors.title, maxlength: 140 })}
      <div class="form-row">
        ${selectField({
          id: 'category_id', label: 'Category', required: true,
          value: values.category_id ?? data.category_id ?? '',
          error: errors.category_id, groups: leafCategoryGroups(),
        })}
        ${field({ id: 'price_min', type: 'number', label: 'Price from (₹)', value: values.price_min ?? (data.price_min === null || data.price_min === undefined ? '' : data.price_min), error: errors.price_min, min: 0, inputmode: 'numeric' })}
      </div>
      <div class="form-row">
        ${field({ id: 'price_max', type: 'number', label: 'Price up to (₹)', value: values.price_max ?? (data.price_max === null || data.price_max === undefined ? '' : data.price_max), error: errors.price_max, min: 0, inputmode: 'numeric', hint: 'Optional — leave the same as “from” for a fixed price.' })}
        ${selectField({ id: 'price_unit', label: 'Price unit', value: unitValue, options: units, error: errors.price_unit, emptyLabel: '' })}
      </div>
      ${textareaField({ id: 'description', label: 'Description', value: values.description ?? data.description ?? '', rows: 4, maxlength: 2000, placeholder: 'What exactly is included? How long does it take? Do you offer a guarantee?', error: errors.description })}
      ${service
        ? `<input type="hidden" name="service_id" value="${esc(data.id)}">`
        : `<fieldset class="status-pick">
            <legend>Visibility</legend>
            <label class="radio-line"><input type="radio" name="status" value="active" ${(values.status || 'active') === 'active' ? 'checked' : ''}> <span><strong>Publish now</strong> — visible in search immediately</span></label>
            <label class="radio-line"><input type="radio" name="status" value="draft" ${values.status === 'draft' ? 'checked' : ''}> <span><strong>Save as draft</strong> — only you can see it</span></label>
          </fieldset>`}
      <div class="form-actions">
        <button class="btn btn--orange btn--lg" type="submit">${service ? 'Save changes' : 'Add service'}</button>
        <a class="btn btn--ghost btn--lg" href="/account/services">Cancel</a>
      </div>
    </form>`;
  }

  router.get('/account/services', async (ctx) => {
    if (!ctx.auth) return { redirect: '/login?next=/account/services' };
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account/services' };
    const provider = user.role === 'provider' ? ownedProvider(user) : null;
    if (!provider) return { redirect: '/account/provider' };

    const services = modelService.byProviderAll(db, provider.id);
    const banner = alertFromOk(ctx.query, {
      created: 'Service added! 🎉',
      saved: 'Service updated.',
      published: 'Service is now Live.',
      paused: 'Service paused — customers can no longer see it.',
      removed: 'Service removed from the marketplace.',
    });
    const rows = services.map((service) => `
      <li class="svc-row">
        <span class="svc-row__icon tint-${tintIndex(service.category_slug)}" aria-hidden="true">${esc(service.category_icon || '🧰')}</span>
        <div class="svc-row__main">
          <strong>${service.status === 'active'
            ? `<a href="/services/${esc(service.slug)}">${esc(service.title)}</a>`
            : esc(service.title)}</strong>
          <span class="svc-row__meta">${esc(service.category_name)} · ${esc(priceLabel(service))}</span>
        </div>
        ${serviceStatusMarkup(service.status)}
        <div class="svc-row__actions">
          ${service.status === 'active'
            ? `<form method="post" action="/account/services/${service.id}/status"><input type="hidden" name="status" value="paused"><button class="btn btn--ghost btn--sm" type="submit">Pause</button></form>`
            : (service.status !== 'archived'
              ? `<form method="post" action="/account/services/${service.id}/status"><input type="hidden" name="status" value="active"><button class="btn btn--primary btn--sm" type="submit">Publish</button></form>`
              : '')}
          <a class="btn btn--ghost btn--sm" href="/account/services/${service.id}/edit">Edit</a>
          ${service.status !== 'archived'
            ? `<form method="post" action="/account/services/${service.id}/status" data-confirm="Remove this service from the marketplace?"><input type="hidden" name="status" value="archived"><button class="btn btn--danger-ghost btn--sm" type="submit">Remove</button></form>`
            : ''}
        </div>
      </li>`).join('');

    const body = `
      <h1 class="acct-title">My services</h1>
      <p class="acct-lede">Drafts, live and paused — only <strong>Live</strong> services appear in customer search.</p>
      ${banner}
      <div class="acct-panel-head"><div></div>
        <a class="btn btn--yellow" href="/account/services/new">+ Add a service</a>
      </div>
      ${services.length
        ? `<ul class="panel svc-list">${rows}</ul>
           <p class="acct-note">💡 Tip: services with a photo and a clear price get more enquiries — photos arrive in the next build.</p>`
        : `<div class="panel"><div class="empty">
            <span class="empty__icon" aria-hidden="true">🛠️</span>
            <h2>No services yet</h2>
            <p>Add your first service — it takes under a minute.</p>
            <a class="btn btn--orange" href="/account/services/new">+ Add your first service</a>
          </div></div>`}
    `;
    return shell(ctx, { title: 'My services', active: 'services', body });
  });

  router.get('/account/services/new', async (ctx) => {
    if (!ctx.auth) return { redirect: '/login?next=/account/services/new' };
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account/services/new' };
    if (user.role !== 'provider') return { redirect: '/account/provider' };
    const provider = ownedProvider(user);
    if (!provider) return { redirect: '/account/provider' };
    const body = `<h1 class="acct-title">Add a service</h1>
      <p class="acct-lede">Listing under <strong>${esc(provider.business_name)}</strong> — ${esc(provider.location_label || '')}</p>
      ${serviceFormMarkup({ ctxPath: '/account/services/new' })}`;
    return shell(ctx, { title: 'Add a service', active: 'services', body });
  });

  router.post('/account/services/new', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account/services/new' };
    const provider = user.role === 'provider' ? ownedProvider(user) : null;
    if (!provider) return { redirect: '/account/provider' };

    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const errors = {};
    const title = cleanValue(body.title, errors, 'title', { required: true, max: 140 });
    const categoryId = Number(body.category_id);
    const priceMin = body.price_min === '' ? null : Number(body.price_min);
    const priceMax = body.price_max === '' ? null : Number(body.price_max);
    const unit = ['visit', 'hour', 'day', 'sqft', 'job', 'month'].includes(body.price_unit) ? body.price_unit : 'visit';
    const description = cleanValue(body.description, errors, 'description', { max: 2000 });
    const status = body.status === 'draft' ? 'draft' : 'active';

    if (!title) errors.title = 'Service title is required.';
    if (!modelCategory.findById(db, categoryId)) errors.category_id = 'Choose a category.';
    if (body.price_min !== '' && (priceMin === null || Number.isNaN(priceMin) || priceMin < 0)) errors.price_min = 'Enter 0 or more.';
    if (body.price_max !== '' && (priceMax === null || Number.isNaN(priceMax) || priceMax < 0)) errors.price_max = 'Enter 0 or more.';
    if (priceMin !== null && priceMax !== null && priceMax < priceMin) errors.price_max = 'Cannot be below “price from”.';

    if (Object.keys(errors).length) {
      return shell(ctx, { title: 'Add a service', active: 'services', body: `<h1 class="acct-title">Add a service</h1>${serviceFormMarkup({ values: body, errors, ctxPath: '/account/services/new' })}` });
    }
    try {
      const service = modelService.createService(db, {
        providerId: provider.id,
        categoryId,
        locationId: provider.location_id,
        title,
        description,
        pinCode: provider.pin_code,
        priceMin,
        priceMax,
        priceUnit: unit,
        status,
      });
      logAudit(store, user.id, 'service.create', 'service', service.id, {});
      return redirect('/account/services', status === 'active' ? 'created' : 'created');
    } catch (err) {
      return shell(ctx, { title: 'Add a service', active: 'services', body: `<h1 class="acct-title">Add a service</h1>${serviceFormMarkup({ values: body, errors: { form: String(err.message) }, ctxPath: '/account/services/new' })}` });
    }
  });

  router.get('/account/services/:id/edit', async (ctx) => {
    if (!ctx.auth) return { redirect: '/login?next=/account/services' };
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account/services' };
    const provider = user.role === 'provider' ? ownedProvider(user) : null;
    const service = provider && modelService.findById(db, Number(ctx.params.id));
    if (!service || service.provider_id !== provider.id) return { redirect: '/account/services' };
    const body = `<h1 class="acct-title">Edit service</h1>${serviceFormMarkup({ service, ctxPath: `/account/services/${service.id}/edit` })}`;
    return shell(ctx, { title: 'Edit service', active: 'services', body });
  });

  router.post('/account/services/:id/edit', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account/services' };
    const provider = user.role === 'provider' ? ownedProvider(user) : null;
    const service = provider && modelService.findById(db, Number(ctx.params.id));
    if (!service || service.provider_id !== provider.id) return { redirect: '/account/services' };

    const body = await readBody(ctx.req, config.http.maxBodyBytes);
    const errors = {};
    const title = cleanValue(body.title, errors, 'title', { required: true, max: 140 });
    const categoryId = Number(body.category_id);
    const priceMin = body.price_min === '' ? null : Number(body.price_min);
    const priceMax = body.price_max === '' ? null : Number(body.price_max);
    const unit = ['visit', 'hour', 'day', 'sqft', 'job', 'month'].includes(body.price_unit) ? body.price_unit : service.price_unit;
    const description = cleanValue(body.description, errors, 'description', { max: 2000 });

    if (!title) errors.title = 'Service title is required.';
    if (!modelCategory.findById(db, categoryId)) errors.category_id = 'Choose a category.';
    if (body.price_min !== '' && (priceMin === null || Number.isNaN(priceMin) || priceMin < 0)) errors.price_min = 'Enter 0 or more.';
    if (body.price_max !== '' && (priceMax === null || Number.isNaN(priceMax) || priceMax < 0)) errors.price_max = 'Enter 0 or more.';
    if (priceMin !== null && priceMax !== null && priceMax < priceMin) errors.price_max = 'Cannot be below “price from”.';

    if (Object.keys(errors).length) {
      const filled = { ...service, title, category_id: categoryId, price_min: priceMin, price_max: priceMax, price_unit: unit, description };
      return shell(ctx, { title: 'Edit service', active: 'services', body: `<h1 class="acct-title">Edit service</h1>${serviceFormMarkup({ service: filled, values: { title, category_id: categoryId, price_min: priceMin ?? '', price_max: priceMax ?? '', price_unit: unit, description }, errors, ctxPath: `/account/services/${service.id}/edit` })}` });
    }
    try {
      modelService.updateService(db, service.id, {
        title, description, categoryId, priceMin, priceMax, priceUnit: unit,
      });
      logAudit(store, user.id, 'service.update', 'service', service.id, {});
      return redirect('/account/services', 'saved');
    } catch (err) {
      return shell(ctx, { title: 'Edit service', active: 'services', body: `<h1 class="acct-title">Edit service</h1>${serviceFormMarkup({ service, values: body, errors: { form: String(err.message) }, ctxPath: `/account/services/${service.id}/edit` })}` });
    }
  });

  router.post('/account/services/:id/status', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account/services' };
    const provider = user.role === 'provider' ? ownedProvider(user) : null;
    const service = provider && modelService.findById(db, Number(ctx.params.id));
    if (!service || service.provider_id !== provider.id) return { redirect: '/account/services' };

    const { readBody: read } = require('../http/request');
    const body = await read(ctx.req, config.http.maxBodyBytes);
    const wanted = ['active', 'paused', 'archived'].includes(body.status) ? body.status : 'active';
    try {
      modelService.setStatus(db, service.id, wanted);
      logAudit(store, user.id, `service.${wanted}`, 'service', service.id, {});
      return redirect('/account/services', wanted === 'active' ? 'published' : (wanted === 'paused' ? 'paused' : 'removed'));
    } catch (err) {
      return { redirect: '/account/services' };
    }
  });

  /* ------------------------------------------------------ leads ------ */

  router.get('/account/leads', async (ctx) => {
    if (!ctx.auth) return { redirect: '/login?next=/account/leads' };
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account/leads' };
    const provider = user.role === 'provider' ? ownedProvider(user) : null;
    if (!provider) return { redirect: '/account/provider' };

    const leads = await store.leads.byProvider(provider.id, { limit: 200 }).catch(() => []);
    const banner = alertFromOk(ctx.query, { contacted: 'Marked as contacted.', closed: 'Marked as closed.', spam: 'Marked as spam.' });
    const rows = leads.map((lead) => `
      <li class="lead-row ${lead.status === 'new' ? 'is-new' : ''}">
        <div class="lead-row__head">
          <span class="avatar avatar--sm" aria-hidden="true">${esc(initials(lead.name))}</span>
          <div>
            <strong>${esc(lead.name)}</strong>
            <span class="lead-row__phone"><a href="tel:+91${esc(lead.phone)}">📞 ${esc(lead.phone)}</a></span>
          </div>
          ${leadStatusMarkup(lead.status)}
          <time>${esc(friendlyDate(lead.created_at))}</time>
        </div>
        ${lead.email ? `<p class="lead-row__mail"><a href="mailto:${esc(lead.email)}">✉️ ${esc(lead.email)}</a></p>` : ''}
        ${lead.message ? `<p class="lead-row__msg">${esc(lead.message)}</p>` : ''}
        ${lead.pin_code ? `<p class="lead-row__pin">📍 PIN ${esc(lead.pin_code)}</p>` : ''}
        ${lead.status !== 'closed' && lead.status !== 'spam' ? `
        <div class="lead-row__actions">
          <form method="post" action="/account/leads/${lead.id}/status"><input type="hidden" name="status" value="contacted">
            <button class="btn btn--primary btn--sm" type="submit">Mark contacted</button></form>
          <form method="post" action="/account/leads/${lead.id}/status"><input type="hidden" name="status" value="closed">
            <button class="btn btn--ghost btn--sm" type="submit">Mark closed</button></form>
          <form method="post" action="/account/leads/${lead.id}/status"><input type="hidden" name="status" value="spam">
            <button class="btn btn--danger-ghost btn--sm" type="submit">Spam</button></form>
        </div>` : ''}
      </li>`).join('');
    const newCount = leads.filter((lead) => lead.status === 'new').length;

    const body = `
      <h1 class="acct-title">Enquiries ${newCount ? `<span class="count-pill">${newCount} new</span>` : ''}</h1>
      <p class="acct-lede">Customers who contacted you through your listing. Follow up fast — first come, first booked.</p>
      ${banner}
      ${leads.length ? `<ul class="panel lead-list lead-list--rows">${rows}</ul>`
        : `<div class="panel"><div class="empty">
            <span class="empty__icon" aria-hidden="true">📭</span>
            <h2>No enquiries yet</h2>
            <p>Share your <a href="/providers/${esc(provider.slug)}">public profile link</a> with neighbours, or add more services to get found.</p>
          </div></div>`}
    `;
    return shell(ctx, { title: 'Enquiries', active: 'leads', body });
  });

  router.post('/account/leads/:id/status', async (ctx) => {
    assertSameOrigin(ctx.req, { host: ctx.req.headers.host, siteUrl: config.site.url });
    const user = await currentUser(ctx);
    if (!user) return { redirect: '/login?next=/account/leads' };
    const provider = user.role === 'provider' ? ownedProvider(user) : null;
    if (!provider) return { redirect: '/account/leads' };

    const { readBody: read } = require('../http/request');
    const body = await read(ctx.req, config.http.maxBodyBytes);
    const wanted = ['contacted', 'closed', 'spam'].includes(body.status) ? body.status : null;
    if (!wanted) return { redirect: '/account/leads' };
    const id = Number(ctx.params.id);
    const leads = await store.leads.byProvider(provider.id, { limit: 500 }).catch(() => []);
    if (!leads.some((lead) => Number(lead.id) === id)) return { redirect: '/account/leads' };
    try {
      await store.leads.setStatus(id, wanted);
      logAudit(store, user.id, `lead.${wanted}`, 'lead', id, {});
      return redirect('/account/leads', wanted === 'contacted' ? 'contacted' : wanted);
    } catch (_) {
      return { redirect: '/account/leads' };
    }
  });
}

/* -------------------------------------------------- module helpers --- */

function cleanValue(raw, errors, key, { required = false, max = 500, phone = false, email = false } = {}) {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!text) {
    if (required) errors[key] = 'This field is required.';
    return null;
  }
  if (phone) {
    const digits = text.replace(/\D/g, '').slice(-10);
    if (!/^[6-9][0-9]{9}$/.test(digits)) {
      errors[key] = 'Enter a valid 10-digit Indian mobile number.';
      return null;
    }
    return digits;
  }
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) {
      errors[key] = 'Enter a valid email address.';
      return null;
    }
    return text.toLowerCase();
  }
  return text.slice(0, max);
}

function friendlyDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

module.exports = { register, friendlyDate };
