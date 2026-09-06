'use strict';
/** HTML escaping — the only gate between data and markup. */

const ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/** Escape a value for safe interpolation into HTML text or attributes. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, (char) => ENTITIES[char]);
}

/** Escape a list into a comma-free attribute-safe string. */
function escList(values) {
  return (values || []).map(esc).join(', ');
}

module.exports = { esc, escList };
