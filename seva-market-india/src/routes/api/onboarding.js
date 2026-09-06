'use strict';
/**
 * API: provider onboarding.
 *
 * `POST /api/v1/providers` is the one write endpoint a new business can hit
 * without an account: when no session is present it creates one, then the
 * listing. That is the shape Indian service providers actually accept — one
 * form, one submit, a phone call later.
 */

const { HttpError, unwrapAction } = require('../../http/respond');
const onboarding = require('../../actions/onboarding');
const mailer = require('../../mail/mailer');
const providers = require('../../models/provider');
const { cleanText, isValidPin } = require('../../db/values');

function register(router, { db, config }) {
  /**
   * POST /api/v1/providers
   * Body: business_name, phone, category_id, pin_code (or location_id/place),
   * service_title, optional: full_name+email+password for a new account,
   * about, experience_years, price_min/max/unit, service_areas[], gst_number.
   */
  router.post('/api/v1/providers', async (ctx) => {
    const body = await ctx.readBody();
    const result = onboarding.onboard(db, config, {
      user: ctx.user,
      body,
      ip: ctx.ip,
      userAgent: ctx.req.headers['user-agent'] || null,
      linkBase: mailer.baseUrl(config, ctx),
    });
    unwrapAction(result, 'Your listing could not be created.');
    return {
      __status: 201,
      data: {
        provider: {
          id: result.provider.id,
          business_name: result.provider.business_name,
          slug: result.provider.slug,
          status: result.provider.status,
          pin_code: result.provider.pin_code,
          profile_url: `/providers/${result.provider.slug}`,
        },
        service: { id: result.service.id, slug: result.service.slug, status: result.service.status },
        service_areas: result.serviceAreas,
        needs_review: result.needsReview,
        account_created: Boolean(result.account),
        dashboard_url: '/dashboard',
      },
    };
  });

  /**
   * GET /api/v1/providers/availability?pin=781001
   * What a provider is walking into: does their area already have someone in
   * their category? Shown on the onboarding form, and honest about demand.
   */
  router.get('/api/v1/providers/availability', ({ query }) => {
    const pin = cleanText(query.get('pin'), 6);
    if (!pin || !isValidPin(pin)) throw new HttpError(400, 'PIN code must be 6 digits and cannot start with 0.');
    const categoryId = query.get('category_id') ? Number(query.get('category_id')) : null;
    const rows = providers.searchProviders(db, { pin, categoryIds: categoryId ? [categoryId] : null, limit: 5 });
    return {
      pin,
      category_id: categoryId,
      existing_providers: rows.total,
      sample: rows.items.map((row) => ({ business_name: row.business_name, slug: row.slug, is_verified: row.is_verified })),
      demand_note: rows.total === 0
        ? 'No active listing in this PIN yet — customers searching here see an empty page today.'
        : `${rows.total} ${rows.total === 1 ? 'provider is' : 'providers are'} already listed here. A complete profile with clear prices wins the click.`,
    };
  });
}

module.exports = { register };
