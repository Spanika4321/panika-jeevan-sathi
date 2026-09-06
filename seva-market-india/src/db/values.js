'use strict';
/**
 * SEVA MARKET INDIA — shared value helpers (slugs, PIN codes, addresses).
 *
 * Kept framework-free and pure so the same functions serve the HTTP layer,
 * the models, the seed script and the tests.
 */

const LOCATION_KINDS = ['country', 'state', 'district', 'city', 'locality', 'pincode'];

/** India -> State -> District -> City -> Locality -> PIN, in order. */
const LOCATION_ORDER = Object.fromEntries(LOCATION_KINDS.map((kind, index) => [kind, index]));

/**
 * "Kamrup Metropolitan" -> "kamrup-metropolitan".
 * Strips diacritics so Hindi/Assamese/Bengali transliterations still slugify.
 */
function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Validate an Indian PIN code: 6 digits, never starting with 0. */
function isValidPin(pin) {
  return typeof pin === 'string' && /^[1-9][0-9]{5}$/.test(pin);
}

/** Validate a 10-digit Indian mobile number. */
function isValidPhone(phone) {
  return typeof phone === 'string' && /^[6-9][0-9]{9}$/.test(phone);
}

/** Normalise free-form phone input to 10 digits, or null when unusable. */
function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  return isValidPhone(digits) ? digits : null;
}

/**
 * Build a LIKE pattern for user input.
 *
 * `%`, `_` and `\` are escaped and every LIKE clause that uses this must be
 * written as `LIKE ? ESCAPE '\'`. Without that, a user typing "%" would
 * match every row in the table.
 */
function likePattern(text) {
  const escaped = String(text).replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

/** Trim + collapse internal whitespace; null when empty. */
function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

/**
 * Build a display breadcrumb from an ordered location chain.
 * @param {Array<{name: string}>} chain root-first
 */
function breadcrumb(chain) {
  return (chain || []).map((node) => node && node.name).filter(Boolean).join(', ');
}

module.exports = {
  LOCATION_KINDS,
  LOCATION_ORDER,
  slugify,
  isValidPin,
  isValidPhone,
  normalizePhone,
  cleanText,
  likePattern,
  breadcrumb,
};
