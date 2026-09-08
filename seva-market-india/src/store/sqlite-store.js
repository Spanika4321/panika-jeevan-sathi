'use strict';
/**
 * SEVA MARKET INDIA — SQLite storage backend.
 *
 * The original behaviour, wrapped in the async store interface so that
 * call sites do not care which backend they are talking to. Suitable for
 * local development, tests, and any host with a genuinely persistent disk.
 */

const userModel = require('../models/user');
const leadModel = require('../models/lead');
const tokenModel = require('../models/account-token');

function createSqliteStore({ db, config }) {
  const secret = config?.security?.sessionSecret || '';

  return {
    backend: 'sqlite',
    durable: false, // "durable" here means "survives this container" — a file does not
    location: db.file,

    users: {
      async create(input) {
        return userModel.createUser(db, input);
      },
      async findByEmail(email) {
        return userModel.findByEmail(db, email);
      },
      async findById(id) {
        return userModel.findById(db, id);
      },
      async setEmailVerified(id, at = new Date().toISOString()) {
        userModel.setEmailVerified(db, id, at);
        return userModel.findById(db, id);
      },
      async setPassword(id, password) {
        return userModel.setPassword(db, id, password);
      },
      async setStatus(id, status) {
        userModel.setStatus(db, id, status);
        return userModel.findById(db, id);
      },
      async setRole(id, role) {
        userModel.setRole(db, id, role);
        return userModel.findById(db, id);
      },
      async updateProfile(id, patch) {
        return userModel.updateProfile(db, id, patch);
      },
      async count() {
        return userModel.count(db);
      },
    },

    leads: {
      async create(input) {
        return leadModel.createLead(db, { ...input, secret });
      },
      async byProvider(providerId, options) {
        return leadModel.byProvider(db, providerId, options);
      },
      async setStatus(id, status) {
        return leadModel.setStatus(db, id, status);
      },
      async recentCountFromIp(ip, options = {}) {
        return leadModel.recentCountFromIp(db, ip, { secret, ...options });
      },
      async count() {
        return leadModel.count(db);
      },
    },

    /**
     * One-time links (verify_email / reset_password). Only the hash is ever
     * written; the raw token goes into the email and nowhere else.
     */
    tokens: {
      async create(input) {
        return tokenModel.create(db, input);
      },
      async findValid({ purpose, token }, at = Date.now()) {
        return tokenModel.findValid(db, { purpose, token }, at);
      },
      async consume(id, at = Date.now()) {
        return tokenModel.consume(db, id, at);
      },
      async revokeForUser(userId, purpose, at = Date.now()) {
        return tokenModel.revokeForUser(db, userId, purpose, at);
      },
      async recentCount(query, at = Date.now()) {
        return tokenModel.recentCount(db, query, at);
      },
      async purgeExpired(at = Date.now()) {
        return tokenModel.purgeExpired(db, at);
      },
    },

    audit: {
      async log({ actor = 'system', action, entity = null, entityId = null, detail = null }) {
        db.run(
          'INSERT INTO audit_logs (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
          [actor, action, entity, entityId, detail],
        );
        return true;
      },
    },

    /** Shape matches the Supabase backend so /health/deep is backend-agnostic. */
    async health() {
      const probe = db.scalar('SELECT 1');
      return {
        backend: 'sqlite',
        durable: false,
        ok: probe === 1,
        location: db.file === ':memory:' ? 'memory' : db.file,
      };
    },

    async close() {},
  };
}

module.exports = { createSqliteStore };
