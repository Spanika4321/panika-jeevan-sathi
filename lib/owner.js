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

/** Where security reports should be sent (/.well-known/security.txt). */
function securityContact() {
  const raw = String(process.env.SECURITY_EMAIL || ownerEmails()[0] || DEFAULT_OWNER_EMAIL).trim();
  return /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(raw) ? raw : DEFAULT_OWNER_EMAIL;
}

module.exports = {
  DEFAULT_OWNER_EMAIL,
  DEFAULT_OWNER_NAME,
  ownerEmails,
  isOwnerEmail,
  defaultOwnerName,
  securityContact
};
