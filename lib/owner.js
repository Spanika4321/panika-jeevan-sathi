'use strict';
/**
 * Site owner / administrator identity.
 *
 * Owner emails come from ADMIN_EMAIL / OWNER_EMAILS (env) with a single
 * first-run default for this project. Passwords are NEVER hardcoded —
 * they come from ADMIN_PASSWORD or are generated on first boot.
 */

const DEFAULT_OWNER_EMAIL = 'sukulpanika939@gmail.com';
const DEFAULT_OWNER_NAME = 'Sukul Panika';

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

module.exports = {
  DEFAULT_OWNER_EMAIL,
  DEFAULT_OWNER_NAME,
  ownerEmails,
  isOwnerEmail,
  defaultOwnerName
};
