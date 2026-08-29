'use strict';
/**
 * Free monetisation helpers.
 * No payment gateway, no third-party SDK — UPI intent links + admin confirmation.
 */

function isFeatured(profile, now) {
  return Number((profile && profile.featured_until) || 0) > (now || Date.now());
}

function sanitizeAdsense(value) {
  const v = String(value || '').trim();
  return /^ca-pub-\d{8,22}$/.test(v) ? v : '';
}

function sanitizeHttpUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch (_) {
    /* ignore */
  }
  return '';
}

function sanitizeUpiId(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  // UPI VPA: name@bank  (letters, digits, '.', '-', '_')
  if (!/^[a-z0-9._-]{2,64}@[a-z0-9.-]{2,64}$/i.test(v)) return '';
  return v;
}

function parseAmount(value) {
  const v = String(value || '').trim().replace(/,/g, '');
  if (!v) return '';
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 100000) return null;
  return v;
}

function upiIntent(settings, amount, note) {
  const pa = sanitizeUpiId(settings && settings.upi_id);
  if (!pa) return '';
  const params = new URLSearchParams();
  params.set('pa', pa);
  params.set('pn', String((settings && settings.upi_name) || 'PANIKA JEEVAN SATHI').slice(0, 80));
  params.set('cu', 'INR');
  params.set('tn', String(note || 'PANIKA JEEVAN SATHI').slice(0, 80));
  if (amount) params.set('am', String(amount));
  return 'upi://pay?' + params.toString();
}

module.exports = {
  isFeatured,
  sanitizeAdsense,
  sanitizeHttpUrl,
  sanitizeUpiId,
  parseAmount,
  upiIntent
};
