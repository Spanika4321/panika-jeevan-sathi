'use strict';
/**
 * TEERNOVA — Editable website content.
 * Live Teer Results • Smart Statistics • Trusted Information
 */

const DEFAULTS = {
  site_name: 'TEERNOVA',
  site_short_name: 'Teernova',
  tagline: 'Live Teer Results • Smart Statistics • Trusted Information',
  hero_title: 'Your trusted source for Teer results',
  hero_subtitle:
    'TEERNOVA provides verified Teer results, historical records, smart statistics and session information in a simple mobile-friendly platform. All data is verified before publishing.',
  announcement: '',
  whatsapp_number: '918099834725',
  whatsapp_display: '+91 80998 34725',
  support_email: 'support@teernova.com',
  state: 'Assam',
  copyright_text: '© ' + new Date().getFullYear() + ' TEERNOVA. All rights reserved.',
  require_email_verification: '0',
  maintenance: '0'
};

const PUBLIC_KEYS = [
  'site_name',
  'site_short_name',
  'tagline',
  'hero_title',
  'hero_subtitle',
  'announcement',
  'whatsapp_number',
  'whatsapp_display',
  'support_email',
  'state',
  'copyright_text',
  'require_email_verification',
  'maintenance'
];

function all(db) {
  const rows = db.all('settings');
  const out = Object.assign({}, DEFAULTS);
  for (const row of rows) {
    if (row.value !== null && row.value !== undefined) out[row.key] = String(row.value);
  }
  return out;
}

function get(db, key) {
  return all(db)[key];
}

function setMany(db, values) {
  const allowed = Object.keys(DEFAULTS);
  for (const [key, value] of Object.entries(values || {})) {
    if (!allowed.includes(key)) continue;
    const existing = db.one('settings', { key });
    const text = value === null || value === undefined ? '' : String(value);
    if (existing) {
      db.update('settings', { key }, { value: text });
    } else {
      db.insert('settings', { key, value: text });
    }
  }
  return all(db);
}

module.exports = { all, get, setMany, DEFAULTS, PUBLIC_KEYS, publicSite };

function publicSite(db) {
  const s = all(db);
  return {
    name: s.site_name || 'TEERNOVA',
    short_name: s.site_short_name || 'Teernova',
    tagline: s.tagline || 'Live Teer Results • Smart Statistics • Trusted Information',
    hero_title: s.hero_title || 'Your trusted source for Teer results',
    hero_subtitle: s.hero_subtitle || '',
    announcement: s.announcement || '',
    whatsapp_number: s.whatsapp_number || '',
    whatsapp_display: s.whatsapp_display || '',
    support_email: s.support_email || 'support@teernova.com',
    state: s.state || 'Assam',
    copyright_text: s.copyright_text || '',
    maintenance: s.maintenance === '1',
    payment: {
      upi_id: process.env.TEERNOVA_PAY_UPI_ID || 'payments@teernova',
      business_name: process.env.TEERNOVA_PAY_BUSINESS || 'TEERNOVA',
      plans: require('./payments').PLANS,
    }
  };
}
