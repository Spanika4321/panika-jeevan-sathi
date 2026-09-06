'use strict';
/** API: approved reviews for a provider, and the review write path. */

const { HttpError, created } = require('../../http/respond');
const providerModel = require('../../models/provider');
const reviewModel = require('../../models/review');
const { validate, validators, readBody } = require('../../http/request');

function activeProvider(db, slug) {
  const provider = providerModel.findBySlug(db, slug);
  if (!provider || provider.status !== 'active') {
    throw HttpError.notFound(`Provider "${slug}" not found.`);
  }
  return provider;
}

function register(router, { db, config }) {
  /** GET /api/v1/providers/:slug/reviews — approved reviews only. */
  router.get('/api/v1/providers/:slug/reviews', ({ params }) => {
    const provider = activeProvider(db, params.slug);
    return {
      provider_id: provider.id,
      rating_avg: provider.rating_avg,
      rating_count: provider.rating_count,
      items: reviewModel.approvedByProvider(db, provider.id),
    };
  });

  /**
   * POST /api/v1/providers/:slug/reviews — leave a rating.
   * Auto-approved unless REVIEWS_MODERATED=1. Rate-limited per IP.
   */
  router.post('/api/v1/providers/:slug/reviews', async ({ req, params, ip, config: cfg }) => {
    const provider = activeProvider(db, params.slug);
    const body = await readBody(req, cfg.http.maxBodyBytes);
    const { value, errors, valid } = validate({
      customerName: () => validators.text(body.customer_name ?? body.name, { field: 'customer_name', max: 120 }),
      rating: () => validators.int(body.rating, { field: 'rating', required: true, min: 1, max: 5 }),
      comment: () => validators.text(body.comment, { field: 'comment', required: false, max: 2000 }),
    });
    if (!valid) throw HttpError.badRequest('Please correct the highlighted fields.', errors);

    const tooMany = reviewModel.recentCountFromIp(db, ip, {
      minutes: 60,
      secret: cfg.security.sessionSecret,
    });
    if (tooMany >= cfg.reviews.perHourPerIp) {
      throw HttpError.tooManyRequests('Too many reviews from your connection. Try again later.');
    }

    const review = reviewModel.create(db, {
      providerId: provider.id,
      customerName: value.customerName,
      rating: value.rating,
      comment: value.comment,
      ip,
      secret: cfg.security.sessionSecret,
      approve: !cfg.reviews.moderated,
    });
    return { __status: 201, data: { id: review.id, status: review.status } };
  });
}

module.exports = { register };
