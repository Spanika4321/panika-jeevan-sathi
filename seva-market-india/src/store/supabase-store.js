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
const tokenModel = require('../models/account-token');

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

/** A token row as the routes see it: hashes and ISO dates, never the secret. */
function publicToken(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: Number(row.user_id),
    purpose: row.purpose,
    token_hash: row.token_hash,
    ip_hash: row.ip_hash ?? null,
    expires_at: isoOrNull(row.expires_at),
    consumed_at: isoOrNull(row.consumed_at),
    created_at: isoOrNull(row.created_at),
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
  // Test doubles and older configs predate the token table; the name is a
  // constant here so a missing key cannot turn into a query against "undefined".
  const tokensTable = tables.tokens || 'seva_account_tokens';

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

      async setEmailVerified(id, at = new Date().toISOString()) {
        const [row] = await remote.update(
          tables.users,
          { email_verified_at: at, updated_at: new Date().toISOString() },
          { id },
        );
        return publicUser(row);
      },

      /**
       * The new hash is computed by the shared model, so a password set
       * through Postgres is byte-identical to one set through SQLite.
       */
      async setPassword(id, password) {
        const passwordHash = userModel.hashPassword(password);
        const [row] = await remote.update(
          tables.users,
          { password_hash: passwordHash, updated_at: new Date().toISOString() },
          { id },
        );
        if (!row) throw new Error('That account no longer exists.');
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

      async setRole(id, role) {
        if (!['customer', 'provider', 'admin'].includes(role)) {
          throw new Error(`Unknown role: ${role}`);
        }
        const [row] = await remote.update(
          tables.users,
          { role, updated_at: new Date().toISOString() },
          { id },
        );
        return publicUser(row);
      },

      async updateProfile(id, patch) {
        const clean = {};
        if (patch.fullName !== undefined && patch.fullName !== null) clean.full_name = String(patch.fullName).trim();
        if (patch.phone !== undefined && patch.phone !== null) clean.phone = String(patch.phone).trim();
        const [row] = await remote.update(
          tables.users,
          { ...clean, updated_at: new Date().toISOString() },
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

      async setStatus(id, status) {
        if (!['new', 'contacted', 'closed', 'spam'].includes(status)) {
          throw new Error(`Unknown lead status: ${status}`);
        }
        const [row] = await remote.update(tables.leads, { status }, { id });
        return publicLead(row);
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

    /**
     * One-time links, written through to Postgres for the same reason
     * accounts are: a reset link that dies with an ephemeral disk is a
     * customer locked out of their own business profile.
     */
    tokens: {
      async create(input) {
        const row = tokenModel.prepareToken(input);
        const [inserted] = await remote.insert(tokensTable, row);
        return publicToken(inserted);
      },

      /**
       * Expiry and single-use are enforced by the filter, not by the caller:
       * `consumed_at is null AND expires_at >= now`. A spent or stale link
       * simply does not match, which is the answer the route needs.
       */
      async findValid({ purpose, token }, at = Date.now()) {
        if (!tokenModel.PURPOSES.includes(purpose) || !tokenModel.isTokenShape(token)) return null;
        const row = await remote.first(tokensTable, {
          columns: 'id,user_id,purpose,token_hash,ip_hash,expires_at,consumed_at,created_at',
          where: {
            purpose,
            token_hash: tokenModel.hashToken(token),
            consumed_at: null,
            expires_at: { gte: tokenModel.nowIso(at) },
          },
        });
        return publicToken(row);
      },

      async consume(id, at = Date.now()) {
        const rows = await remote.update(
          tokensTable,
          { consumed_at: tokenModel.nowIso(at) },
          { id, consumed_at: null },
        );
        return rows.length;
      },

      async revokeForUser(userId, purpose, at = Date.now()) {
        if (!tokenModel.PURPOSES.includes(purpose)) throw new Error(`Unknown token purpose: ${purpose}`);
        const rows = await remote.update(
          tokensTable,
          { consumed_at: tokenModel.nowIso(at) },
          { user_id: Number(userId), purpose, consumed_at: null },
        );
        return rows.length;
      },

      async recentCount({ purpose, userId = null, ipHash = null, minutes = 60 }, at = Date.now()) {
        if (!tokenModel.PURPOSES.includes(purpose)) throw new Error(`Unknown token purpose: ${purpose}`);
        const since = tokenModel.nowIso(at - Math.trunc(minutes) * 60_000);
        const where = { purpose, created_at: { gte: since } };
        if (userId) where.user_id = Number(userId);
        else if (ipHash) where.ip_hash = String(ipHash);
        else return 0;
        return remote.count(tokensTable, where);
      },

      async purgeExpired(at = Date.now()) {
        const rows = await remote.remove(tokensTable, { expires_at: { lt: tokenModel.nowIso(at) } });
        return Array.isArray(rows) ? rows.length : 0;
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

module.exports = { createSupabaseStore, publicUser, publicLead, publicToken, isoOrNull };
