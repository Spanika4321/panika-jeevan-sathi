'use strict';
/**
 * SEVA MARKET INDIA — provider verification.
 *
 * The trust layer of a services marketplace. Two rules shape this module:
 *
 *   1. Documents are *referenced*, never uploaded. A `provider_documents`
 *      row holds a masked reference ("GST 22*****4567P"), not a scan, so the
 *      database is not the place a leak hurts most.
 *   2. Approval is a single, audited action. `review()` is the only place
 *      that turns a pending listing into a live one, so it can flip the
 *      provider status, the user status and the badge together — and record
 *      who did it.
 */

const { cleanText, slugify } = require('../db/values');

const DOC_KINDS = ['gst', 'udyam', 'pan', 'licence', 'photo', 'other'];

/**
 * Mask a document reference so it can be stored and displayed safely.
 * "22AAAAA0000A1Z5" -> "22*****0A1Z5": enough for a human to match against
 * the real document, useless on its own.
 */
function maskReference(value) {
  const text = cleanText(value, 40)?.replace(/\s+/g, '').toUpperCase();
  if (!text) return null;
  if (text.length <= 6) return `${text.slice(0, 1)}${'*'.repeat(Math.max(1, text.length - 2))}${text.slice(-1)}`;
  return `${text.slice(0, 2)}${'*'.repeat(text.length - 6)}${text.slice(-4)}`;
}

function submitDocument(db, providerId, { kind = 'other', reference, note = null }) {
  if (!DOC_KINDS.includes(kind)) throw new Error(`Unknown document kind: ${kind}`);
  const provider = db.get('SELECT id FROM providers WHERE id = ?', [providerId]);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const masked = maskReference(reference);
  if (!masked) throw new Error('A document reference is required.');

  const existing = db.get(
    'SELECT id FROM provider_documents WHERE provider_id = ? AND kind = ? AND status = ?',
    [providerId, kind, 'pending'],
  );
  if (existing) {
    db.run(
      'UPDATE provider_documents SET reference = ?, note = ? WHERE id = ?',
      [masked, cleanText(note, 300), existing.id],
    );
    return db.get('SELECT * FROM provider_documents WHERE id = ?', [existing.id]);
  }

  const result = db.run(
    'INSERT INTO provider_documents (provider_id, kind, reference, note) VALUES (?, ?, ?, ?)',
    [providerId, kind, masked, cleanText(note, 300)],
  );
  return db.get('SELECT * FROM provider_documents WHERE id = ?', [Number(result.lastInsertRowid)]);
}

function documents(db, providerId) {
  return db.all(
    'SELECT id, kind, reference, status, note, created_at, reviewed_at FROM provider_documents WHERE provider_id = ? ORDER BY id DESC',
    [providerId],
  );
}

/** Every provider still waiting to be published — the admin queue. */
function pendingQueue(db, { limit = 50, offset = 0 } = {}) {
  const rows = db.all(
    `SELECT p.id, p.business_name, p.slug, p.phone, p.email, p.category_id, p.location_id,
            p.pin_code, p.experience_years, p.created_at, p.status,
            c.name AS category_name, l.search_text AS location_label,
            u.email AS owner_email, u.status AS owner_status,
            (SELECT COUNT(*) FROM services s WHERE s.provider_id = p.id) AS service_count,
            (SELECT COUNT(*) FROM provider_documents d WHERE d.provider_id = p.id AND d.status = 'pending') AS doc_count
     FROM providers p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN locations  l ON l.id = p.location_id
     LEFT JOIN users      u ON u.id = p.user_id
     WHERE p.status = 'pending'
     ORDER BY p.created_at, p.id
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  const total = Number(db.scalar("SELECT COUNT(*) FROM providers WHERE status = 'pending'") ?? 0);
  return { items: rows, total };
}

/**
 * Publish or reject a listing.
 * @param {object} options
 * @param {'approve'|'reject'} options.decision
 * @param {boolean} [options.verified] grant the verified badge (approve only)
 * @param {string}  [options.note] shown to the provider on rejection
 * @param {string|number} [options.actor] user id or "admin:4" for the audit row
 */
function review(db, providerId, { decision, verified = false, note = null, actor = 'admin', documentIds = null, document_ids = null } = {}) {
  const ids = documentIds ?? document_ids ?? [];
  if (!['approve', 'reject'].includes(decision)) throw new Error(`Unknown review decision: ${decision}`);
  const provider = db.get('SELECT id, user_id, status, business_name FROM providers WHERE id = ?', [providerId]);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const status = decision === 'approve' ? 'active' : 'suspended';
  const isVerified = decision === 'approve' ? (verified ? 1 : 0) : 0;

  db.transaction(() => {
    db.run(
      `UPDATE providers
       SET status = ?, is_verified = ?, verified_at = ?, review_note = ?, reviewed_at = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
      [
        status,
        isVerified,
        isVerified ? new Date().toISOString() : null,
        cleanText(note, 500),
        new Date().toISOString(),
        providerId,
      ],
    );

    for (const documentId of ids) {
      const id = Number(documentId);
      if (!Number.isInteger(id)) continue;
      db.run(
        `UPDATE provider_documents SET status = ?, reviewed_at = ?, note = ?
         WHERE id = ? AND provider_id = ?`,
        [decision === 'approve' ? 'approved' : 'rejected', new Date().toISOString(), cleanText(note, 300), id, providerId],
      );
    }

    if (provider.user_id) {
      if (decision === 'approve') {
        // A provider whose listing is live is a real account: activate it.
        db.run(
          `UPDATE users SET status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ? AND role != 'admin'`,
          [provider.user_id],
        );
      }
    }

    const audit = require('./auth');
    audit.audit(db, {
      actor: String(actor),
      action: `provider.${decision}`,
      entity: 'provider',
      entityId: providerId,
      detail: `${provider.business_name} -> ${status}${isVerified ? ' (verified)' : ''}${note ? `: ${note}` : ''}`,
    });
  });

  return db.get('SELECT id, business_name, slug, status, is_verified, review_note FROM providers WHERE id = ?', [providerId]);
}

/**
 * Toggle the verified badge without changing status — used for providers who
 * joined before the queue existed.
 */
function setVerified(db, providerId, verified, { actor = 'admin', note = null } = {}) {
  db.run(
    `UPDATE providers SET is_verified = ?, verified_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    [verified ? 1 : 0, verified ? new Date().toISOString() : null, providerId],
  );
  require('./auth').audit(db, {
    actor: String(actor),
    action: verified ? 'provider.verified' : 'provider.unverified',
    entity: 'provider',
    entityId: providerId,
    detail: cleanText(note, 300),
  });
  return db.get('SELECT id, business_name, slug, status, is_verified FROM providers WHERE id = ?', [providerId]);
}

/** Suggested slug for a business, kept for the onboarding preview. */
function suggestSlug(name) {
  return slugify(name) || 'listing';
}

module.exports = {
  DOC_KINDS,
  maskReference,
  submitDocument,
  documents,
  pendingQueue,
  review,
  setVerified,
  suggestSlug,
};
