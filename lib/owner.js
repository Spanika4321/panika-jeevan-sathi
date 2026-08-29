'use strict';
/**
 * Site owner / administrator identity.
 *
 * Registration always used to create role=user, so the owner's own Gmail
 * kept landing as a normal member. Owner emails are promoted to admin on
 * every boot and on every authenticated request.
 */

const DEFAULT_OWNER_EMAIL = 'sukulpanika939@gmail.com';
const DEFAULT_OWNER_NAME = 'Sukul Panika';
const DEFAULT_OWNER_PASSWORD = 'Panika@123';

function ownerEmails() {
  const collected = [];
  if (process.env.ADMIN_EMAIL) collected.push(process.env.ADMIN_EMAIL);
  if (process.env.OWNER_EMAILS) {
    for (const part of String(process.env.OWNER_EMAILS).split(',')) collected.push(part);
  }
  const unique = [...new Set(collected.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))];
  if (unique.length) return unique;
  return [DEFAULT_OWNER_EMAIL];
}

function isOwnerEmail(email) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle) return false;
  return ownerEmails().includes(needle);
}

function defaultOwnerName() {
  return process.env.ADMIN_NAME || DEFAULT_OWNER_NAME;
}

function defaultOwnerPassword() {
  return process.env.ADMIN_PASSWORD || DEFAULT_OWNER_PASSWORD;
}

module.exports = {
  DEFAULT_OWNER_EMAIL,
  DEFAULT_OWNER_NAME,
  DEFAULT_OWNER_PASSWORD,
  ownerEmails,
  isOwnerEmail,
  defaultOwnerName,
  defaultOwnerPassword
};
