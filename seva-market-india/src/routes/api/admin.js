'use strict';
/**
 * API: administrator operations — the review queue, badges, housekeeping.
 *
 * These mutate trust, so they are admin-only, audited, and (like every other
 * write route) protected by the session-bound CSRF proof enforced in app.js.
 */

const { HttpError, unwrapAction } = require('../../http/respond');
const authHttp = require('../../http/auth');
const verification = require('../../models/verification');
const providerModel = require('../../models/provider');
const serviceModel = require('../../models/service');
const categoryModel = require('../../models/category');
const locationModel = require('../../models/location');
const leadModel = require('../../models/lead');
const userModel = require('../../models/user');
const authModel = require('../../models/auth');
const mail = require('../../mail/mailer');
const { cleanText } = require('../../db/values');

function register(router, { db, config }) {
  const guard = (ctx) => {
    const result = authHttp.requireAdmin(ctx);
    if (result.redirect) throw new HttpError(401, 'Sign in as an administrator.');
    return ctx.user;
  };

  /** GET /api/v1/admin/summary — the numbers worth watching. */
  router.get('/api/v1/admin/summary', (ctx) => {
    guard(ctx);
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
        archived: serviceModel.count(db, { status: 'archived' }),
      },
      users: { total: userModel.count(db), providers: userModel.countByRole(db, 'provider'), admins: userModel.countByRole(db, 'admin') },
      leads: { total: leadModel.count(db) },
      categories: categoryModel.count(db),
      locations: locationTotals,
      sessions: Number(db.scalar('SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL') ?? 0),
      documents_pending: Number(db.scalar("SELECT COUNT(*) FROM provider_documents WHERE status = 'pending'") ?? 0),
    };
  });

  /** GET /api/v1/admin/providers?status=pending — the review queue. */
  router.get('/api/v1/admin/providers', (ctx) => {
    guard(ctx);
    const status = cleanText(ctx.query.get('status'), 20) || 'pending';
    if (!['pending', 'active', 'suspended', 'all'].includes(status)) {
      throw new HttpError(400, 'status must be pending, active, suspended or all.');
    }
    if (status === 'all') {
      const items = db.all(
        `SELECT id, business_name, slug, status, is_verified, pin_code, created_at, reviewed_at, review_note
         FROM providers ORDER BY id DESC LIMIT 100`,
      );
      return { items, total: items.length, status };
    }
    const page = Math.max(1, Number(ctx.query.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit')) || 25));
    const queue = status === 'pending'
      ? verification.pendingQueue(db, { limit, offset: (page - 1) * limit })
      : {
        items: db.all(
          `SELECT p.id, p.business_name, p.slug, p.status, p.is_verified, p.pin_code, p.created_at,
                  c.name AS category_name, l.search_text AS location_label,
                  (SELECT COUNT(*) FROM services s WHERE s.provider_id = p.id) AS service_count
           FROM providers p
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN locations l ON l.id = p.location_id
           WHERE p.status = ? ORDER BY p.id DESC LIMIT ? OFFSET ?`,
          [status, limit, (page - 1) * limit],
        ),
        total: Number(db.scalar('SELECT COUNT(*) FROM providers WHERE status = ?', [status]) ?? 0),
      };
    return { ...queue, page, pageSize: limit };
  });

  /** GET /api/v1/admin/providers/:id — one listing with its documents. */
  router.get('/api/v1/admin/providers/:id', (ctx) => {
    guard(ctx);
    const id = Number(ctx.params.id);
    const provider = db.get(`SELECT ${providerModel.OWNER_COLUMNS} FROM providers WHERE id = ?`, [id]);
    if (!provider) throw new HttpError(404, `Provider ${id} not found.`);
    return {
      provider,
      documents: verification.documents(db, id),
      services: serviceModel.listForProvider(db, id),
      leads: leadModel.listForProvider(db, id, { limit: 10 }).items,
      service_areas: providerModel.serviceAreas(db, id),
      owner: db.get('SELECT id, email, full_name, role, status, email_verified_at FROM users WHERE id = ?', [provider.user_id ?? 0]),
    };
  });

  /** POST /api/v1/admin/providers/:id/review — approve or reject. */
  router.post('/api/v1/admin/providers/:id/review', async (ctx) => {
    const admin = guard(ctx);
    const body = await ctx.readBody();
    const decision = cleanText(body.decision, 10);
    if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'decision must be approve or reject.');
    const id = Number(ctx.params.id);
    const provider = db.get('SELECT id, user_id, business_name FROM providers WHERE id = ?', [id]);
    if (!provider) throw new HttpError(404, `Provider ${id} not found.`);

    const result = verification.review(db, id, {
      decision,
      // Approval never implies the verified badge: a human has to tick it.
      verified: decision === 'approve'
        ? !(body.verified === false || body.verified === 'false' || body.verified === '0') && body.verified !== undefined && body.verified !== null
        : false,
      note: body.note,
      actor: `admin:${admin.id}`,
      document_ids: Array.isArray(body.document_ids) ? body.document_ids.map(Number) : [],
    });

    // Approving an owner's drafts is what makes the listing useful the moment
    // it goes live; nothing else about their data is touched.
    if (decision === 'approve') {
      db.run("UPDATE services SET status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE provider_id = ? AND status = 'draft'", [id]);
    }
    if (provider.user_id) {
      const owner = db.get('SELECT email, full_name FROM users WHERE id = ?', [provider.user_id]);
      if (owner) {
        mail.providerDecisionMessage({
          to: owner.email,
          name: owner.full_name || 'there',
          business: provider.business_name,
          approved: decision === 'approve',
          note: body.note ?? null,
          config,
        });
      }
    }
    return { provider: result, services_activated: decision === 'approve' ? 1 : 0 };
  });

  /** POST /api/v1/admin/providers/:id/verify — toggle the trust badge. */
  router.post('/api/v1/admin/providers/:id/verify', async (ctx) => {
    const admin = guard(ctx);
    const body = await ctx.readBody();
    const verified = !(body.verified === false || body.verified === 'false' || body.verified === '0');
    const result = verification.setVerified(db, Number(ctx.params.id), verified, { actor: `admin:${admin.id}`, note: body.note });
    if (!result) throw new HttpError(404, 'Provider not found.');
    return { provider: result };
  });

  /** GET /api/v1/admin/audit?entity=provider — the trail, newest first. */
  router.get('/api/v1/admin/audit', (ctx) => {
    guard(ctx);
    const entity = cleanText(ctx.query.get('entity'), 30);
    return { items: authModel.recentAudit(db, { limit: 100, entity: entity || null }) };
  });

  /** POST /api/v1/admin/housekeeping — purge dead sessions and tokens. */
  router.post('/api/v1/admin/housekeeping', (ctx) => {
    guard(ctx);
    return authModel.purgeExpired(db);
  });

  /** POST /api/v1/admin/users/:id/suspend — cut access immediately. */
  router.post('/api/v1/admin/users/:id/suspend', (ctx) => {
    const admin = guard(ctx);
    const id = Number(ctx.params.id);
    const target = db.get('SELECT id, role, status FROM users WHERE id = ?', [id]);
    if (!target) throw new HttpError(404, `User ${id} not found.`);
    if (target.role === 'admin' && id !== admin.id) throw new HttpError(403, 'Another administrator cannot be suspended here.');
    userModel.setStatus(db, id, target.status === 'suspended' ? 'active' : 'suspended');
    // Sessions are the authority: revoking them logs the person out now.
    const revoked = authModel.revokeAllSessions(db, id);
    authModel.audit(db, {
      actor: `admin:${admin.id}`,
      action: 'user.suspended',
      entity: 'user',
      entityId: id,
      detail: `revoked_sessions=${revoked}`,
    });
    return { user_id: id, status: target.status === 'suspended' ? 'active' : 'suspended', sessions_revoked: revoked };
  });
}

module.exports = { register };
