'use strict';
/**
 * SEVA MARKET INDIA — provider onboarding pages.
 *
 * `/providers/new` is the money page: the form that turns a business into
 * inventory. It works signed-out (it creates the account and the listing in
 * one submit) and signed-in (it just adds the listing).
 */

const dashboard = require('../actions/dashboard');
const onboarding = require('../actions/onboarding');
const authHttp = require('../http/auth');
const { renderPage } = require('../views/render');
const { onboardingBody, submittedBody } = require('../views/onboarding');
const { cleanText, isValidPin } = require('../db/values');
const providers = require('../models/provider');

function register(router, { db, config }) {
  const categories = () => dashboard.categoryOptions(db).map((row) => ({ value: row.id, label: row.label }));

  router.get('/providers/new', (ctx) => {
    if (ctx.user && ctx.user.role !== 'customer' && ctx.user.role !== 'admin') {
      const existing = providers.findForUser(db, ctx.user.id);
      if (existing) return { redirect: `/dashboard?ok=${existing.status === 'active' ? 'provider-live' : 'provider-submitted'}` };
    }
    const pin = cleanText(ctx.query.get('pin'), 6);
    let availability = null;
    if (pin && isValidPin(pin)) {
      const rows = providers.searchProviders(db, { pin, limit: 4 });
      availability = {
        note: rows.total === 0
          ? `No active provider is listed in PIN ${pin} yet — customers searching here see an empty page.`
          : `${rows.total} provider${rows.total === 1 ? '' : 's'} already serve PIN ${pin}. A complete profile with prices is how you win the click.`,
        sample: rows.items.map((row) => ({ business_name: row.business_name })),
      };
    }

    // `?intent=provider` is where the guards send a signed-in customer who
    // wandered into the provider area: the form fixes exactly that.
    const notice = ctx.query.get('intent') === 'provider'
      ? 'This is the provider side of SEVA MARKET INDIA. Listing your business takes a minute and turns this account into a provider account — your sign-in stays the same.'
      : null;

    return renderPage(ctx, {
      title: 'List your service',
      description: 'Add your business to SEVA MARKET INDIA: category, PIN code, one priced service. Free, and customers call you directly.',
      body: onboardingBody({
        values: { ...(ctx.user ? { email: ctx.user.email, full_name: ctx.user.full_name } : {}), pin_code: pin || '' },
        errors: {},
        categories: categories(),
        maxAreas: config.onboarding.maxServiceAreas,
        isNewAccount: !ctx.user,
        csrf: ctx.csrfToken || '',
        user: ctx.user,
        autoApprove: config.onboarding.autoApprove,
        availability,
        notice,
      }),
    });
  });

  router.post('/providers/new', async (ctx) => {
    const body = await ctx.readBody();
    const result = onboarding.onboard(db, config, {
      user: ctx.user,
      body,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      linkBase: require('../mail/mailer').baseUrl(config, ctx),
    });

    if (!result.ok) {
      // Sign-in collision (email already used) or an ownership conflict:
      // re-render the form with the errors, keeping everything they typed.
      const message = result.message || (result.errors && Object.values(result.errors)[0]);
      return renderPage(ctx, {
        title: 'List your service',
        status: result.status || 400,
        body: onboardingBody({
          values: { ...body, password: undefined },
          errors: { ...(result.errors || {}), ...(message && !result.errors ? { form: message } : {}) },
          categories: categories(),
          maxAreas: config.onboarding.maxServiceAreas,
          isNewAccount: !ctx.user,
          csrf: ctx.csrfToken || '',
          user: ctx.user,
          autoApprove: config.onboarding.autoApprove,
        }),
        flash: null,
      });
    }

    // A brand-new account has no cookie yet; give it one so the dashboard
    // works immediately instead of asking them to sign in again.
    if (result.account && !ctx.user) {
      const account = db.get('SELECT id, status FROM users WHERE email = ?', [String(body.email || '').toLowerCase()]);
      if (account && account.status === 'active') {
        const authModel = require('../models/auth');
        const session = authModel.createSession(db, account.id, {
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          secret: config.security.sessionSecret,
          days: config.auth.sessionDays,
        });
        authHttp.startSession(ctx, session.token);
      }
    }

    return renderPage(ctx, {
      title: result.needsReview ? 'Listing submitted' : 'Your listing is live',
      noIndex: true,
      body: submittedBody({
        provider: result.provider,
        service: result.service,
        needsReview: result.needsReview,
        serviceAreas: result.serviceAreas,
        site: config.site,
        email: body.email,
      }),
      flash: null,
    });
  });
}

module.exports = { register };
