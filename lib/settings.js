'use strict';
/** Editable website content. Everything here is editable from the admin panel. */

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
  'communities',
  'about_text',
  'safety_text',
  'footer_note',
  'maintenance'
];

async function all(db) {
  const rows = await db.all('settings');
  const out = Object.assign({}, DEFAULTS);
  for (const row of rows) {
    if (row.value !== null && row.value !== undefined) out[row.key] = String(row.value);
  }
  return out;
}

async function get(db, key) {
  return (await all(db))[key];
}

async function setMany(db, values) {
  const allowed = Object.keys(DEFAULTS);
  for (const [key, value] of Object.entries(values || {})) {
    if (!allowed.includes(key)) continue;
    const existing = await db.one('settings', { key });
    const text = value === null || value === undefined ? '' : String(value);
    if (existing) await db.update('settings', { key }, { value: text });
    else await db.insert('settings', { key, value: text });
  }
  return all(db);
}

async function publicSite(db) {
  const settings = await all(db);
  const out = {};
  for (const key of PUBLIC_KEYS) out[key] = settings[key];
  out.require_email_verification = settings.require_email_verification === '1';
  out.communities_list = String(settings.communities || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  out.counts = {
    members: await db.count('profiles'),
    stories: await db.count('stories', { approved: 1 })
  };
  return out;
}

module.exports = { DEFAULTS, all, get, setMany, publicSite };
