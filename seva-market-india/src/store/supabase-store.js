'use strict';
/**
 * SEVA MARKET INDIA — Supabase (Postgres) storage backend.
 *
 * Only the rows that cannot be regenerated live here:
 *
 *   seva_users        accounts
 *   seva_leads        customer enquiries — the marketplace's whole point
 *   seva_audit_logs   who did what
 *
 * The catalog (locations, categories, providers, services) deliberately
 * stays in local SQLite: it is deterministic seed data, rebuilt at boot in
 * a second, and it is already mirrored to public.seva_mirror. Keeping the
 * hot read path local means search stays fast and a Supabase hiccup cannot
 * take the browse experience down — only writes need the network.
 *
 * Validation is shared with the SQLite backend (models/*.prepare*), so both
 * backends enforce identical rules; only the destination differs.
 */

const userModel = require('../models/user');
const leadModel = require('../models/lead');

/** Postgres returns timestamptz; the API contract is a plain ISO string. */
function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** Strip the password hash: it must never leave this module. */
function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    phone: row.phone ?? null,
    full_name: row.full_name,
    role: row.role,
    status: row.status,
    email_verified_at: isoOrNull(row.email_verified_at),
    created_at: isoOrNull(row.created_at),
    updated_at: isoOrNull(row.updated_at),
  };
}

function publicLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    service_id: row.service_id ?? null,
    provider_id: row.provider_id,
    name: row.name,
    phone: row.phone,
    email: row.email ?? null,
    pin_code: row.pin_code ?? null,
    message: row.message ?? null,
    status: row.status,
    created_at: isoOrNull(row.created_at),
  };
}

/**
 * @param {object} options
 * @param {object} options.db      local SQLite catalog (read-only here)
 * @param {object} options.remote  client from db/remote.js
 * @param {object} options.config
 */
function createSupabaseStore({ db, remote, config }) {
  const secret = config?.security?.sessionSecret || '';
  const tables = config.storage.tables;

  return {
    backend: 'supabase',
    durable: true,
    location: remote.baseUrl,

    users: {
      /**
       * Write-through signup. The uniqueness check is a SELECT first (for a
       * friendly message) and a UNIQUE index second (for correctness under
       * a race) — the index is the one that actually guarantees it.
       */
      async create(input) {
        const row = userModel.prepareUser(input);

        const duplicate = await remote.first(tables.users, {
          columns: 'id',
          where: { email: row.email },
        });
        if (duplicate) throw new Error('An account with that email already exists.');

        let inserted;
        try {
          [inserted] = await remote.insert(tables.users, row);
        } catch (err) {
          // 23505 = unique_violation: someone won the race between the
          // SELECT above and this INSERT.
          if (/23505|duplicate key/i.test(err.message || '')) {
            throw new Error('An account with that email already exists.');
          }
          throw err;
        }
        return { user: publicUser(inserted), passwordHash: row.password_hash };
      },

      /** Includes password_hash — for the auth path only, never a response. */
      async findByEmail(email) {
        const clean = String(email || '').trim().toLowerCase();
        if (!clean) return null;
        const row = await remote.first(tables.users, {
          columns: 'id,email,full_name,role,status,password_hash',
          where: { email: clean },
        });
        return row || null;
      },

      async findById(id) {
        const row = await remote.first(tables.users, { where: { id } });
        return publicUser(row);
      },

      async setStatus(id, status) {
        if (!['pending', 'active', 'suspended'].includes(status)) {
          throw new Error(`Unknown status: ${status}`);
        }
        const [row] = await remote.update(
          tables.users,
          { status, updated_at: new Date().toISOString() },
          { id },
        );
        return publicUser(row);
      },

      async count() {
        return remote.count(tables.users, { status: { ne: 'suspended' } });
      },
    },

    leads: {
      /**
       * The enquiry is validated against the local catalog and then written
       * to Postgres. `await` is the whole point: if Supabase does not ACK,
       * this throws and the customer sees an error instead of a fake
       * "enquiry received" for a row that never existed.
       */
      async create(input) {
        leadModel.assertTarget(db, input.providerId, input.serviceId ?? null);
        const row = leadModel.prepareLead({ ...input, secret });
        const [inserted] = await remote.insert(tables.leads, row);
        return publicLead(inserted);
      },

      async byProvider(providerId, { limit = 50 } = {}) {
        const rows = await remote.select(tables.leads, {
          columns: 'id,service_id,provider_id,name,phone,email,pin_code,message,status,created_at',
          where: { provider_id: providerId },
          order: 'created_at.desc',
          limit,
        });
        return rows.map(publicLead);
      },

      async recentCountFromIp(ip, { minutes = 60 } = {}) {
        const ipHash = leadModel.hashIp(ip, secret);
        if (!ipHash) return 0;
        const since = new Date(Date.now() - Math.trunc(minutes) * 60_000).toISOString();
        return remote.count(tables.leads, { ip_hash: ipHash, created_at: { gte: since } });
      },

      async count() {
        return remote.count(tables.leads, {});
      },
    },

    audit: {
      async log({ actor = 'system', action, entity = null, entityId = null, detail = null }) {
        await remote.insert(
          tables.audit,
          { actor, action, entity, entity_id: entityId, detail },
          { returning: 'minimal' },
        );
        return true;
      },
    },

    async health() {
      try {
        const probe = await remote.ping(tables.leads);
        return {
          backend: 'supabase',
          durable: true,
          ok: true,
          location: remote.baseUrl,
          latency_ms: probe.ms,
        };
      } catch (err) {
        return {
          backend: 'supabase',
          durable: true,
          ok: false,
          location: remote.baseUrl,
          error: err.message,
        };
      }
    },

    async close() {},
  };
}

module.exports = { createSupabaseStore, publicUser, publicLead, isoOrNull };
