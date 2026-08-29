'use strict';
/** Editable website content. Everything here is editable from the admin panel. */

const earn = require('./earn');

const DEFAULTS = {
  site_name: 'PANIKA JEEVAN SATHI',
  site_short_name: 'Panika Jeevan Sathi',
  tagline: '100% Free Matrimonial Service for Our Community',
  hero_title: 'Find a life partner with trust, respect and family values',
  hero_subtitle:
    'A completely free matrimonial service built for the Panika, Manikpuri, Kabirpanthi and Adivasi communities. Every feature — profiles, search, interests, shortlist and messaging — is free forever. No plans, no payments, no locked profiles.',
  announcement: '',
  whatsapp_number: '918099834725',
  whatsapp_display: '+91 80998 34725',
  support_email: 'support@panikajeevansathi.com',
  communities: 'Panika,Manikpuri,Kabirpanthi,Adivasi',
  about_text:
    'PANIKA JEEVAN SATHI is a community matrimonial service started to help families find suitable matches with dignity and transparency. Registration, profile creation, search, interests, shortlisting and messaging are all free of cost.',
  safety_text:
    'Never send money to anyone you meet online. Meet in public places with family present. Report any suspicious profile immediately — our moderators act on every report.',
  footer_note: 'Made with care for our community. Always free, always respectful.',
  require_email_verification: '0',
  maintenance: '0',
  upi_id: '',
  upi_name: 'PANIKA JEEVAN SATHI',
  featured_amount: '51',
  featured_days: '30',
  adsense_client: '',
  ad_text: '',
  ad_url: '',
  ad_label: ''
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
  'communities',
  'about_text',
  'safety_text',
  'footer_note',
  'maintenance',
  'upi_id',
  'upi_name',
  'featured_amount',
  'featured_days',
  'adsense_client',
  'ad_text',
  'ad_url',
  'ad_label'
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
  const src = values || {};
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    let text = src[key] === null || src[key] === undefined ? '' : String(src[key]);
    if (key === 'upi_id') text = earn.sanitizeUpiId(text);
    if (key === 'adsense_client') text = earn.sanitizeAdsense(text);
    if (key === 'ad_url') text = earn.sanitizeHttpUrl(text);
    if (key === 'featured_amount') {
      const parsed = earn.parseAmount(text);
      text = parsed === null ? DEFAULTS.featured_amount : parsed || DEFAULTS.featured_amount;
    }
    if (key === 'featured_days') {
      const n = Number(text);
      text = Number.isFinite(n) && n >= 1 && n <= 365 ? String(Math.round(n)) : DEFAULTS.featured_days;
    }
    if (key === 'ad_text') text = text.slice(0, 200);
    if (key === 'ad_label') text = text.slice(0, 40);
    if (key === 'upi_name') text = text.slice(0, 80);
    const existing = db.one('settings', { key });
    if (existing) db.update('settings', { key }, { value: text });
    else db.insert('settings', { key, value: text });
  }
  return all(db);
}

function publicSite(db) {
  const settings = all(db);
  const out = {};
  for (const key of PUBLIC_KEYS) out[key] = settings[key];
  out.require_email_verification = settings.require_email_verification === '1';
  out.communities_list = String(settings.communities || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  out.upi_id = earn.sanitizeUpiId(settings.upi_id);
  out.adsense_client = earn.sanitizeAdsense(settings.adsense_client);
  out.ad_url = earn.sanitizeHttpUrl(settings.ad_url);
  out.counts = {
    members: db.count('profiles'),
    stories: db.count('stories', { approved: 1 })
  };
  return out;
}

module.exports = { DEFAULTS, all, get, setMany, publicSite };
