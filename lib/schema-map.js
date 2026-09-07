'use strict';
/**
 * PANIKA JEEVAN SATHI — single source of truth for the data model.
 *
 * Every table, column, index and key rule lives here once:
 *
 *   • lib/db.js         keeps the battle-tested SQLite DDL (SCHEMA/INDEXES)
 *                       used by the sqlite and D1 drivers.
 *   • lib/appwrite.js   provisions Appwrite Cloud collections/attributes
 *                       from this map, so the remote schema always mirrors
 *                       the SQLite schema.
 *   • scripts/verify-schema-parity.mjs proves both agree (dev-time check).
 *
 * Column rules used by the Appwrite bridge:
 *   type   'int' | 'str'        → Appwrite integer / string attribute
 *   size   string attribute max (Appwrite legacy string max = 16384)
 *   nullMarker
 *          SQLite keeps these columns NULL; Appwrite cannot store null, so
 *          the bridge writes 0 (int) / '' (str) and converts them back to
 *          null on read. 0 / '' are never legitimate values for these
 *          columns, so the round-trip is lossless:
 *            profiles.age, height_cm, pref_age_min, pref_age_max  → 0
 *            users.photo, verification_token, reset_token         → ''
 */

const TABLES = {
  users: {
    pk: 'id',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'email', type: 'str', size: 320, notNull: true, unique: true },
      { name: 'password_hash', type: 'str', size: 255, notNull: true },
      { name: 'name', type: 'str', size: 255, notNull: true },
      { name: 'role', type: 'str', size: 64, notNull: true },
      { name: 'status', type: 'str', size: 64, notNull: true },
      { name: 'email_verified', type: 'int', notNull: true },
      { name: 'verification_token', type: 'str', size: 128, nullMarker: '' },
      { name: 'reset_token', type: 'str', size: 128, nullMarker: '' },
      { name: 'reset_expires', type: 'int', notNull: true },
      { name: 'token_version', type: 'int', notNull: true },
      { name: 'photo', type: 'str', size: 2048, nullMarker: '' },
      { name: 'last_login', type: 'int', notNull: true },
      { name: 'created_at', type: 'int', notNull: true }
    ]
  },
  profiles: {
    pk: 'user_id',
    columns: [
      { name: 'user_id', type: 'int', notNull: true, unique: true },
      { name: 'headline', type: 'str', size: 255 },
      { name: 'phone', type: 'str', size: 64 },
      { name: 'age', type: 'int', nullMarker: 0 },
      { name: 'gender', type: 'str', size: 64 },
      { name: 'height_cm', type: 'int', nullMarker: 0 },
      { name: 'marital_status', type: 'str', size: 64 },
      { name: 'religion', type: 'str', size: 64 },
      { name: 'community', type: 'str', size: 64 },
      { name: 'sub_community', type: 'str', size: 64 },
      { name: 'mother_tongue', type: 'str', size: 64 },
      { name: 'city', type: 'str', size: 128 },
      { name: 'state', type: 'str', size: 128 },
      { name: 'country', type: 'str', size: 128 },
      { name: 'education', type: 'str', size: 128 },
      { name: 'education_detail', type: 'str', size: 255 },
      { name: 'occupation', type: 'str', size: 128 },
      { name: 'company', type: 'str', size: 255 },
      { name: 'annual_income', type: 'str', size: 64 },
      { name: 'diet', type: 'str', size: 64 },
      { name: 'smoking', type: 'str', size: 64 },
      { name: 'drinking', type: 'str', size: 64 },
      { name: 'about_me', type: 'str', size: 4096 },
      { name: 'family_type', type: 'str', size: 64 },
      { name: 'family_status', type: 'str', size: 64 },
      { name: 'father_occupation', type: 'str', size: 255 },
      { name: 'mother_occupation', type: 'str', size: 255 },
      { name: 'siblings', type: 'str', size: 255 },
      { name: 'gotra', type: 'str', size: 255 },
      { name: 'manglik', type: 'str', size: 64 },
      { name: 'pref_age_min', type: 'int', nullMarker: 0 },
      { name: 'pref_age_max', type: 'int', nullMarker: 0 },
      { name: 'pref_gender', type: 'str', size: 64 },
      { name: 'pref_location', type: 'str', size: 255 },
      { name: 'pref_education', type: 'str', size: 255 },
      { name: 'pref_occupation', type: 'str', size: 255 },
      { name: 'pref_marital_status', type: 'str', size: 64 },
      { name: 'pref_religion', type: 'str', size: 64 },
      { name: 'pref_community', type: 'str', size: 64 },
      { name: 'pref_message', type: 'str', size: 1024 },
      { name: 'visibility', type: 'str', size: 64, notNull: true },
      { name: 'hide_photo', type: 'int', notNull: true },
      { name: 'hide_contact', type: 'int', notNull: true },
      { name: 'searchable', type: 'int', notNull: true },
      { name: 'profile_complete', type: 'int', notNull: true },
      { name: 'updated_at', type: 'int', notNull: true }
    ]
  },
  interests: {
    pk: 'id',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'from_user_id', type: 'int', notNull: true },
      { name: 'to_user_id', type: 'int', notNull: true },
      { name: 'message', type: 'str', size: 1024 },
      { name: 'status', type: 'str', size: 64, notNull: true },
      { name: 'created_at', type: 'int', notNull: true },
      { name: 'responded_at', type: 'int', notNull: true }
    ]
  },
  shortlist: {
    pk: 'id',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'user_id', type: 'int', notNull: true },
      { name: 'target_user_id', type: 'int', notNull: true },
      { name: 'created_at', type: 'int', notNull: true }
    ]
  },
  messages: {
    pk: 'id',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'sender_id', type: 'int', notNull: true },
      { name: 'receiver_id', type: 'int', notNull: true },
      { name: 'body', type: 'str', size: 4096, notNull: true },
      { name: 'created_at', type: 'int', notNull: true },
      { name: 'read_at', type: 'int', notNull: true }
    ]
  },
  notifications: {
    pk: 'id',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'user_id', type: 'int', notNull: true },
      { name: 'type', type: 'str', size: 64, notNull: true },
      { name: 'title', type: 'str', size: 512, notNull: true },
      { name: 'body', type: 'str', size: 4096, notNull: true },
      { name: 'link', type: 'str', size: 2048 },
      { name: 'is_read', type: 'int', notNull: true },
      { name: 'created_at', type: 'int', notNull: true }
    ]
  },
  reports: {
    pk: 'id',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'reporter_id', type: 'int', notNull: true },
      { name: 'target_user_id', type: 'int', notNull: true },
      { name: 'reason', type: 'str', size: 512, notNull: true },
      { name: 'details', type: 'str', size: 2048 },
      { name: 'status', type: 'str', size: 64, notNull: true },
      { name: 'created_at', type: 'int', notNull: true }
    ]
  },
  stories: {
    pk: 'id',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'title', type: 'str', size: 512, notNull: true },
      { name: 'couple', type: 'str', size: 512, notNull: true },
      { name: 'location', type: 'str', size: 512 },
      { name: 'body', type: 'str', size: 8192 },
      { name: 'photo', type: 'str', size: 2048 },
      { name: 'approved', type: 'int', notNull: true },
      { name: 'created_at', type: 'int', notNull: true }
    ]
  },
  contact_messages: {
    pk: 'id',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'str', size: 255, notNull: true },
      { name: 'email', type: 'str', size: 320 },
      { name: 'phone', type: 'str', size: 64 },
      { name: 'subject', type: 'str', size: 512 },
      { name: 'message', type: 'str', size: 8192, notNull: true },
      { name: 'handled', type: 'int', notNull: true },
      { name: 'created_at', type: 'int', notNull: true }
    ]
  },
  settings: {
    pk: 'key',
    columns: [
      { name: 'key', type: 'str', size: 128, notNull: true, unique: true },
      { name: 'value', type: 'str', size: 16384 }
    ]
  },
  audit_logs: {
    pk: 'id',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'actor_id', type: 'int', notNull: true },
      { name: 'actor_email', type: 'str', size: 320, notNull: true },
      { name: 'action', type: 'str', size: 255, notNull: true },
      { name: 'target_type', type: 'str', size: 64, notNull: true },
      { name: 'target_id', type: 'int', notNull: true },
      { name: 'detail', type: 'str', size: 4096, notNull: true },
      { name: 'created_at', type: 'int', notNull: true }
    ]
  },
  site_stats: {
    pk: 'id',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'day', type: 'str', size: 32, notNull: true, unique: true },
      { name: 'visits', type: 'int', notNull: true },
      { name: 'visitors', type: 'int', notNull: true },
      { name: 'updated_at', type: 'int', notNull: true }
    ]
  },
  site_visitors: {
    pk: 'id',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'day', type: 'str', size: 32, notNull: true },
      { name: 'hid', type: 'str', size: 64, notNull: true },
      { name: 'created_at', type: 'int', notNull: true }
    ]
  }
};

/** Order in which tables are provisioned / migrated (FK-ish sanity). */
const TABLE_ORDER = Object.keys(TABLES);

/** pk name for each table, matching lib/db.js TABLES. */
function pkOf(table) {
  return TABLES[table] ? TABLES[table].pk : 'id';
}

/** Column lookup map per table. */
function columnsOf(table) {
  const out = {};
  for (const col of TABLES[table] ? TABLES[table].columns : []) out[col.name] = col;
  return out;
}

/** Column names that are integers (for value coercion both ways). */
function intColumns(table) {
  const out = new Set();
  for (const col of TABLES[table] ? TABLES[table].columns : []) {
    if (col.type === 'int') out.add(col.name);
  }
  return out;
}

/**
 * Columns SQLite keeps NULL but Appwrite cannot store as null.
 * int → 0, str → '' are the lossless stand-ins (never legal values).
 */
function nullMarkerOf(table) {
  const out = {};
  for (const col of TABLES[table] ? TABLES[table].columns : []) {
    if (Object.prototype.hasOwnProperty.call(col, 'nullMarker')) {
      out[col.name] = col.nullMarker;
    }
  }
  return out;
}

/** Columns that Appwrite should guard with a UNIQUE index. */
function uniqueColumns(table) {
  const out = [];
  for (const col of TABLES[table] ? TABLES[table].columns : []) {
    if (col.unique) out.push(col.name);
  }
  return out;
}

/** A document ID that is stable for every row of a table (see lib/appwrite.js). */
function docIdFor(table, row) {
  const pk = pkOf(table);
  if (pk === 'id') return String(row.id);
  if (pk === 'user_id') return `p${row.user_id}`;
  if (pk === 'key') return `k${row.key}`;
  throw new Error(`schema-map: unknown primary key '${pk}' for table '${table}'`);
}

module.exports = {
  TABLES,
  TABLE_ORDER,
  pkOf,
  columnsOf,
  intColumns,
  nullMarkerOf,
  uniqueColumns,
  docIdFor
};
