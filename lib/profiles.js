'use strict';
/** Profile schema helpers: validation, privacy-aware serialisation, search & match scoring. */

const TEXT_FIELDS = [
  'headline',
  'phone',
  'gender',
  'marital_status',
  'religion',
  'community',
  'sub_community',
  'mother_tongue',
  'city',
  'state',
  'country',
  'education',
  'education_detail',
  'occupation',
  'company',
  'annual_income',
  'diet',
  'smoking',
  'drinking',
  'about_me',
  'family_type',
  'family_status',
  'father_occupation',
  'mother_occupation',
  'siblings',
  'gotra',
  'manglik'
];

const PREF_TEXT_FIELDS = [
  'pref_gender',
  'pref_location',
  'pref_education',
  'pref_occupation',
  'pref_marital_status',
  'pref_religion',
  'pref_community',
  'pref_message'
];

const NUMBER_FIELDS = {
  age: { min: 18, max: 100 },
  height_cm: { min: 120, max: 240 },
  pref_age_min: { min: 18, max: 100 },
  pref_age_max: { min: 18, max: 100 }
};

const PRIVACY_FIELDS = ['visibility', 'hide_photo', 'hide_contact', 'searchable'];
const VISIBILITY = ['everyone', 'members', 'hidden'];

const MAX_LENGTH = {
  headline: 120,
  about_me: 2000,
  pref_message: 500,
  phone: 20
};

const GENDERS = ['Male', 'Female'];

/**
 * Validate + normalise an incoming profile patch.
 * Returns { data, errors }
 */
function validatePatch(input, existing = {}) {
  const data = {};
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};

  for (const field of [...TEXT_FIELDS, ...PREF_TEXT_FIELDS]) {
    if (!Object.prototype.hasOwnProperty.call(src, field)) continue;
    let value = src[field];
    if (value === null || value === undefined) value = '';
    value = String(value).trim();
    const max = MAX_LENGTH[field] || 200;
    if (value.length > max) {
      errors.push(`${labelFor(field)} is too long (max ${max} characters).`);
      continue;
    }
    data[field] = value;
  }

  for (const [field, rule] of Object.entries(NUMBER_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(src, field)) continue;
    const raw = src[field];
    if (raw === '' || raw === null || raw === undefined) {
      data[field] = null;
      continue;
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      errors.push(`${labelFor(field)} must be a number.`);
      continue;
    }
    if (num < rule.min || num > rule.max) {
      errors.push(`${labelFor(field)} must be between ${rule.min} and ${rule.max}.`);
      continue;
    }
    data[field] = Math.round(num);
  }

  if (Object.prototype.hasOwnProperty.call(src, 'visibility')) {
    const value = String(src.visibility || 'members');
    if (!VISIBILITY.includes(value)) errors.push('Invalid profile visibility.');
    else data.visibility = value;
  }

  for (const field of ['hide_photo', 'hide_contact', 'searchable']) {
    if (!Object.prototype.hasOwnProperty.call(src, field)) continue;
    data[field] = truthy(src[field]) ? 1 : 0;
  }

  if (data.gender && !GENDERS.includes(data.gender)) {
    errors.push('Gender must be Male or Female.');
    delete data.gender;
  }

  const combined = Object.assign({}, existing, data);
  if (
    combined.pref_age_min &&
    combined.pref_age_max &&
    combined.pref_age_min > combined.pref_age_max
  ) {
    errors.push('Preferred age range is invalid (minimum is greater than maximum).');
  }

  if (data.phone && !/^[0-9+\-() ]{6,20}$/.test(data.phone)) {
    errors.push('Please enter a valid phone number.');
    delete data.phone;
  }

  return { data, errors };
}

function truthy(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (typeof v === 'string') return ['true', 'yes', 'on'].includes(v.toLowerCase());
  return false;
}

function labelFor(field) {
  return field
    .replace(/^pref_/, 'Preferred ')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Percentage shown on the dashboard to encourage a complete profile. */
function completeness(profile) {
  if (!profile) return 0;
  const required = [
    'age',
    'gender',
    'height_cm',
    'marital_status',
    'religion',
    'community',
    'mother_tongue',
    'city',
    'state',
    'education',
    'occupation',
    'about_me',
    'family_type',
    'father_occupation',
    'pref_age_min',
    'pref_age_max'
  ];
  let filled = 0;
  for (const key of required) {
    const value = profile[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    filled++;
  }
  return Math.round((filled / required.length) * 100);
}

/** Strip / mask fields the viewer is not allowed to see. */
function publicProfile(profile, viewerId, options = {}) {
  if (!profile) return null;
  const isOwner = viewerId && profile.user_id === viewerId;
  const isAdmin = Boolean(options.isAdmin);
  const out = Object.assign({}, profile);

  out.profile_complete = completeness(profile);
  out.is_owner = Boolean(isOwner);

  if (isOwner || isAdmin) return out;

  delete out.pref_message;
  if (Number(profile.hide_contact) === 1) out.phone = '';
  if (Number(profile.hide_photo) === 1) out.photo = null;
  return out;
}

/**
 * Score how well `candidate` fits `viewer`'s partner preferences (0-100).
 * Returns { score, reasons: [] }
 */
function matchScore(viewerProfile, candidateProfile, extras = {}) {
  const reasons = [];
  let score = 40; // base score: an active, complete profile is already relevant
  const pref = viewerProfile || {};
  const cand = candidateProfile || {};

  const norm = (v) => String(v || '').trim().toLowerCase();

  if (pref.pref_gender && norm(cand.gender) === norm(pref.pref_gender)) {
    score += 10;
  }

  if (cand.age && pref.pref_age_min && cand.age >= pref.pref_age_min) score += 4;
  if (cand.age && pref.pref_age_max && cand.age <= pref.pref_age_max) score += 4;
  if (
    cand.age &&
    pref.pref_age_min &&
    pref.pref_age_max &&
    cand.age >= pref.pref_age_min &&
    cand.age <= pref.pref_age_max
  ) {
    score += 6;
    reasons.push('Age matches your preference');
  }

  if (pref.pref_community && norm(cand.community) === norm(pref.pref_community)) {
    score += 10;
    reasons.push(`Same community (${cand.community})`);
  }
  if (pref.pref_religion && norm(cand.religion) === norm(pref.pref_religion)) {
    score += 5;
    reasons.push('Same religion');
  }
  if (pref.pref_location) {
    const loc = norm(pref.pref_location);
    if (loc && (norm(cand.city).includes(loc) || norm(cand.state).includes(loc))) {
      score += 8;
      reasons.push('Near your preferred location');
    }
  }
  if (pref.pref_education && norm(cand.education).includes(norm(pref.pref_education))) {
    score += 5;
    reasons.push('Education matches your preference');
  }
  if (pref.pref_occupation && norm(cand.occupation).includes(norm(pref.pref_occupation))) {
    score += 4;
  }
  if (
    pref.pref_marital_status &&
    norm(cand.marital_status) === norm(pref.pref_marital_status)
  ) {
    score += 3;
  }

  if (norm(cand.state) && norm(pref.state) && norm(cand.state) === norm(pref.state)) {
    score += 4;
    reasons.push('Same state');
  }
  if (norm(cand.mother_tongue) && norm(pref.mother_tongue) === norm(cand.mother_tongue)) {
    score += 3;
    reasons.push('Same mother tongue');
  }

  if (Number(cand.profile_complete || completeness(cand)) >= 70) score += 5;
  if (extras.receivedInterest) {
    score += 8;
    reasons.push('Already interested in you');
  }
  if (extras.photo) score += 3;

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons: reasons.slice(0, 3) };
}

/** Turn search query parameters into a candidate filter function. */
function buildFilter(query, viewerId) {
  const q = query || {};
  const keyword = String(q.keyword || '').trim().toLowerCase();
  const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v));
  const ageMin = num(q.age_min);
  const ageMax = num(q.age_max);
  const eq = (v) => (v ? String(v).trim().toLowerCase() : '');

  const gender = eq(q.gender);
  const state = eq(q.state);
  const city = eq(q.city);
  const religion = eq(q.religion);
  const community = eq(q.community);
  const education = eq(q.education);
  const occupation = eq(q.occupation);
  const marital = eq(q.marital_status);
  const tongue = eq(q.mother_tongue);
  const withPhoto = String(q.with_photo || '') === '1';

  return function filter(profile, user) {
    if (profile.user_id === viewerId) return false;
    if (gender && String(profile.gender || '').toLowerCase() !== gender) return false;
    if (ageMin !== null && (!profile.age || profile.age < ageMin)) return false;
    if (ageMax !== null && (!profile.age || profile.age > ageMax)) return false;
    if (state && !String(profile.state || '').toLowerCase().includes(state)) return false;
    if (city && !String(profile.city || '').toLowerCase().includes(city)) return false;
    if (religion && String(profile.religion || '').toLowerCase() !== religion) return false;
    if (community && String(profile.community || '').toLowerCase() !== community) return false;
    if (education && !String(profile.education || '').toLowerCase().includes(education))
      return false;
    if (occupation && !String(profile.occupation || '').toLowerCase().includes(occupation))
      return false;
    if (marital && String(profile.marital_status || '').toLowerCase() !== marital) return false;
    if (tongue && String(profile.mother_tongue || '').toLowerCase() !== tongue) return false;
    if (withPhoto && !user.photo) return false;
    if (keyword) {
      const haystack = [
        user.name,
        profile.headline,
        profile.city,
        profile.state,
        profile.education,
        profile.occupation,
        profile.community,
        profile.about_me
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  };
}

const OPTION_SETS = {
  genders: GENDERS,
  marital: ['Never Married', 'Divorced', 'Widowed', 'Separated', 'Awaiting Divorce'],
  religions: ['Hindu', 'Kabirpanth', 'Christian', 'Muslim', 'Sikh', 'Buddhist', 'Jain', 'Other'],
  education: [
    'Below 10th',
    '10th Pass',
    '12th Pass',
    'Diploma',
    'ITI',
    'Graduate',
    'Post Graduate',
    'B.Ed / D.El.Ed',
    'Professional Degree',
    'Doctorate'
  ],
  occupations: [
    'Agriculture / Farming',
    'Government Job',
    'Teacher',
    'Business / Self Employed',
    'Private Job',
    'Healthcare',
    'Defence / Police',
    'Weaving / Textile',
    'Skilled Trade',
    'Student',
    'Not Working',
    'Other'
  ],
  diet: ['Vegetarian', 'Non-Vegetarian', 'Eggetarian'],
  habits: ['No', 'Yes', 'Occasionally'],
  familyType: ['Nuclear', 'Joint'],
  familyStatus: ['Middle Class', 'Upper Middle Class', 'Affluent'],
  incomes: [
    'Not Disclosed',
    'Below 2 Lakh',
    '2 - 5 Lakh',
    '5 - 10 Lakh',
    '10 - 20 Lakh',
    'Above 20 Lakh'
  ],
  heights: [
    { label: "4'10\" (147 cm)", value: 147 },
    { label: "5'0\" (152 cm)", value: 152 },
    { label: "5'2\" (157 cm)", value: 157 },
    { label: "5'4\" (163 cm)", value: 163 },
    { label: "5'6\" (168 cm)", value: 168 },
    { label: "5'8\" (173 cm)", value: 173 },
    { label: "5'10\" (178 cm)", value: 178 },
    { label: "6'0\" (183 cm)", value: 183 },
    { label: "6'2\" (188 cm)", value: 188 }
  ]
};

module.exports = {
  TEXT_FIELDS,
  PREF_TEXT_FIELDS,
  NUMBER_FIELDS,
  PRIVACY_FIELDS,
  VISIBILITY,
  OPTION_SETS,
  validatePatch,
  completeness,
  publicProfile,
  matchScore,
  buildFilter
};
