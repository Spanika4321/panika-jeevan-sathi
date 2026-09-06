'use strict';
/**
 * SEVA MARKET INDIA — administrator pages.
 *
 * The review queue is the only admin surface in this milestone, and it is
 * admin-only by role, not by a secret URL. Every decision writes to
 * `audit_logs` and emails the provider, so the queue cannot silently eat a
 * submission.
 */

const authHttp = require('../http/auth');
const verification = require('../models/verification');
const providerModel = require('../models/provider');
const serviceModel = require('../models/service');
const categoryModel = require('../models/category');
const locationModel = require('../models/location');
const leadModel = require('../models/lead');
const userModel = require('../models/user');
const authModel = require('../models/auth');
const mailer = require('../mail/mailer');
const { renderPage } = require('../views/render');
const { queueBody, adminHomeBody } = require('../views/admin');
const { HttpError } = require('../http/respond');
const { cleanText } = require('../db/values');

function summary(db) {
  const locationTotals = locationModel.stats(db);
  return {
    providers: {
      pending: Number(db.scalar("SELECT COUNT(*) FROM providers WHERE status = 'pending'") ?? 0),
      active: providerModel.count(db),
      suspended: Number(db.scalar("SELECT COUNT(*) FROM providers WHERE status = 'suspended'") ?? 0),
      verified: Number(db.scalar('SELECT COUNT(*) FROM providers WHERE is_verified = 1') ?? 0),
    },
    services: {
      active: serviceModel.count(db),
      draft: serviceModel.count(db, { status: 'draft' }),
      paused: serviceModel.count(db, { status: 'paused' }),
    },
    users: { total: userModel.count(db) },
    leads: { total: leadModel.count(db) },
    categories: categoryModel.count(db),
    locations: locationTotals,
    sessions: Number(db.scalar('SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL') ?? 0),
  };
}

function register(router, { db, config }) {
  const ADMIN_TABS = [
    { href: '/admin', label: 'Review queue' },
    { href: '/admin/overview', label: 'Overview' },
    { href: '/account', label: 'My account' },
    { href: '/', label: 'Site' },
  ];

  const guard = (ctx) => {
    const result = authHttp.requireAdmin(ctx);
    return result.redirect ? { redirect: result.redirect } : { user: ctx.user };
  };

  router.get('/admin', (ctx) => {
    const blocked = guard(ctx);
    if (blocked.redirect) return blocked;
    const queue = verification.pendingQueue(db, { limit: 50 });
    return renderPage(ctx, {
      title: 'Review queue',
      noIndex: true,
      tabs: ADMIN_TABS,
      body: queueBody({
        items: queue.items,
        total: queue.total,
        csrf: ctx.csrfToken,
        summary: summary(db),
        documentsFor: Object.fromEntries(queue.items.map((row) => [row.id, verification.documents(db, row.id)])),
      }),
    });
  });

  router.post('/admin/providers/:id/review', async (ctx) => {
    const blocked = guard(ctx);
    if (blocked.redirect) return blocked;
    const body = await ctx.readBody();
    const decision = cleanText(body.decision, 10);
    if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'Choose approve or reject.');
    const id = Number(ctx.params.id);
    const provider = db.get('SELECT id, user_id, business_name FROM providers WHERE id = ?', [id]);
    if (!provider) throw new HttpError(404, 'That listing no longer exists.');

    const verified = decision === 'approve' && (body.verified === '1' || body.verified === true);
    verification.review(db, id, {
      decision,
      verified,
      note: body.note,
      actor: `admin:${ctx.user.id}`,
      document_ids: Array.isArray(body.document_ids) ? body.document_ids.map(Number) : [],
    });
    if (decision === 'approve') {
      // Drafts become live only with the business, never before it.
      db.run("UPDATE services SET status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE provider_id = ? AND status = 'draft'", [id]);
    }
    if (provider.user_id) {
      const owner = db.get('SELECT email, full_name FROM users WHERE id = ?', [provider.user_id]);
      if (owner) {
        mailer.providerDecisionMessage({
          to: owner.email,
          name: owner.full_name || 'there',
          business: provider.business_name,
          approved: decision === 'approve',
          note: body.note || null,
          config,
        });
      }
    }
    return { redirect: `/admin?ok=${decision === 'approve' ? 'review-approved' : 'review-rejected'}` };
  });

  router.get('/admin/overview', (ctx) => {
    const blocked = guard(ctx);
    if (blocked.redirect) return blocked;
    return renderPage(ctx, {
      title: 'Administration',
      noIndex: true,
      tabs: ADMIN_TABS,
      body: adminHomeBody({
        summary: summary(db),
        queue: verification.pendingQueue(db, { limit: 5 }).items,
        recent: authModel.recentAudit(db, { limit: 20 }),
        csrf: ctx.csrfToken,
      }),
    });
  });

  router.post('/admin/providers/:id/verify', async (ctx) => {
    const blocked = guard(ctx);
    if (blocked.redirect) return blocked;
    const body = await ctx.readBody();
    const verified = !(body.verified === '0' || body.verified === 'false' || body.verified === false);
    const result = verification.setVerified(db, Number(ctx.params.id), verified, { actor: `admin:${ctx.user.id}`, note: body.note });
    if (!result) throw new HttpError(404, 'That listing no longer exists.');
    return { redirect: `/admin?ok=${verified ? 'badge-granted' : 'badge-removed'}` };
  });

  router.post('/admin/housekeeping', (ctx) => {
    const blocked = guard(ctx);
    if (blocked.redirect) return blocked;
    authModel.purgeExpired(db);
    return { redirect: '/admin?ok=housekeeping' };
  });
}

module.exports = { register, summary };
