/**
 * Location domain — India → State → District → City → Locality → PIN.
 *
 * The hierarchy is modelled as six explicit tables rather than one generic
 * "places" tree because every level has a different meaning in India:
 *   • a PIN code (India Post) can serve several localities and, in border
 *     cases, more than one district — so it is its own entity, not a column;
 *   • districts are administrative, cities are what users search for, and
 *     localities are what makes a result feel "near me".
 *
 * Nothing here is hard-coded to one country: `countries` is the root so the
 * same model can serve other markets later.
 */
import { newId } from '../ids.js';
import { slugify, uniqueSlug } from '../slug.js';
import { cleanText, normalisePincode } from '../validate.js';

const STATE_TYPES = ['state', 'union_territory'];

function timestamps(now) {
  return { created_at: now, updated_at: now };
}

function toFlag(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  return value ? 1 : 0;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export const country = {
  table: 'countries',
  columns: ['id', 'name', 'code', 'iso3', 'phone_code', 'currency_code', 'is_active', 'created_at', 'updated_at'],
  unique: [['code']],
  rules: {
    name: { type: 'string', required: true, min: 2, max: 80 },
    code: { type: 'string', required: true, pattern: /^[A-Z]{2}$/, message: 'must be a 2-letter ISO country code' },
    iso3: { type: 'string', required: true, pattern: /^[A-Z]{3}$/, message: 'must be a 3-letter ISO country code' },
    phone_code: { type: 'string', max: 8 },
    currency_code: { type: 'string', max: 3 }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      name: cleanText(input.name),
      code: cleanText(input.code).toUpperCase(),
      iso3: cleanText(input.iso3 || input.code).toUpperCase(),
      phone_code: cleanText(input.phone_code || ''),
      currency_code: cleanText(input.currency_code || 'INR').toUpperCase(),
      is_active: toFlag(input.is_active),
      ...timestamps(now)
    };
  }
};

export const state = {
  table: 'states',
  columns: [
    'id',
    'country_id',
    'name',
    'slug',
    'code',
    'type',
    'is_active',
    'created_at',
    'updated_at'
  ],
  unique: [['slug'], ['country_id', 'name']],
  rules: {
    country_id: { type: 'uuid', required: true },
    name: { type: 'string', required: true, min: 2, max: 80 },
    slug: { type: 'slug' },
    code: { type: 'string', max: 8 },
    type: { type: 'enum', values: STATE_TYPES, default: 'state' }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      country_id: input.country_id,
      name: cleanText(input.name),
      slug: input.slug ? slugify(input.slug) : slugify(input.name, 'state'),
      code: cleanText(input.code || '').toUpperCase(),
      type: STATE_TYPES.includes(input.type) ? input.type : 'state',
      is_active: toFlag(input.is_active),
      ...timestamps(now)
    };
  },
  toPublic(row) {
    return { id: row.id, name: row.name, slug: row.slug, code: row.code, type: row.type };
  },
  async withUniqueSlug(input, isTaken) {
    const base = input.slug ? slugify(input.slug) : slugify(input.name, 'state');
    return { ...input, slug: await uniqueSlug(base, isTaken, { fallback: 'state' }) };
  }
};

export const district = {
  table: 'districts',
  columns: ['id', 'state_id', 'name', 'slug', 'is_active', 'created_at', 'updated_at'],
  unique: [['state_id', 'slug'], ['state_id', 'name']],
  rules: {
    state_id: { type: 'uuid', required: true },
    name: { type: 'string', required: true, min: 2, max: 80 }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      state_id: input.state_id,
      name: cleanText(input.name),
      slug: input.slug ? slugify(input.slug) : slugify(input.name, 'district'),
      is_active: toFlag(input.is_active),
      ...timestamps(now)
    };
  },
  toPublic(row) {
    return { id: row.id, name: row.name, slug: row.slug, state_id: row.state_id };
  },
  async withUniqueSlug(input, isTaken) {
    const base = input.slug ? slugify(input.slug) : slugify(input.name, 'district');
    return { ...input, slug: await uniqueSlug(base, isTaken, { fallback: 'district' }) };
  }
};

export const city = {
  table: 'cities',
  columns: [
    'id',
    'district_id',
    'state_id',
    'name',
    'slug',
    'is_metro',
    'latitude',
    'longitude',
    'is_active',
    'created_at',
    'updated_at'
  ],
  unique: [['state_id', 'slug'], ['district_id', 'name']],
  rules: {
    district_id: { type: 'uuid', required: true },
    state_id: { type: 'uuid', required: true },
    name: { type: 'string', required: true, min: 2, max: 80 },
    is_metro: { type: 'boolean' },
    latitude: { type: 'number', min: -90, max: 90 },
    longitude: { type: 'number', min: -180, max: 180 }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      district_id: input.district_id,
      state_id: input.state_id,
      name: cleanText(input.name),
      slug: input.slug ? slugify(input.slug) : slugify(input.name, 'city'),
      is_metro: toFlag(input.is_metro, 0),
      latitude: toNumberOrNull(input.latitude),
      longitude: toNumberOrNull(input.longitude),
      is_active: toFlag(input.is_active),
      ...timestamps(now)
    };
  },
  toPublic(row) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      district_id: row.district_id,
      state_id: row.state_id,
      is_metro: Boolean(row.is_metro)
    };
  },
  async withUniqueSlug(input, isTaken) {
    const base = input.slug ? slugify(input.slug) : slugify(input.name, 'city');
    return { ...input, slug: await uniqueSlug(base, isTaken, { fallback: 'city' }) };
  }
};

export const pincode = {
  table: 'pincodes',
  columns: [
    'id',
    'code',
    'office_name',
    'city_id',
    'district_id',
    'state_id',
    'latitude',
    'longitude',
    'is_active',
    'created_at',
    'updated_at'
  ],
  unique: [['code']],
  rules: {
    code: { type: 'pincode', required: true },
    office_name: { type: 'string', max: 120 },
    city_id: { type: 'uuid' },
    district_id: { type: 'uuid' },
    state_id: { type: 'uuid' },
    latitude: { type: 'number', min: -90, max: 90 },
    longitude: { type: 'number', min: -180, max: 180 }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      code: normalisePincode(input.code),
      office_name: cleanText(input.office_name || ''),
      city_id: input.city_id || null,
      district_id: input.district_id || null,
      state_id: input.state_id || null,
      latitude: toNumberOrNull(input.latitude),
      longitude: toNumberOrNull(input.longitude),
      is_active: toFlag(input.is_active),
      ...timestamps(now)
    };
  },
  toPublic(row) {
    return {
      id: row.id,
      code: row.code,
      office_name: row.office_name,
      city_id: row.city_id,
      district_id: row.district_id,
      state_id: row.state_id
    };
  }
};

export const locality = {
  table: 'localities',
  columns: [
    'id',
    'city_id',
    'pincode_id',
    'name',
    'slug',
    'latitude',
    'longitude',
    'is_active',
    'created_at',
    'updated_at'
  ],
  unique: [['city_id', 'slug'], ['city_id', 'name']],
  rules: {
    city_id: { type: 'uuid', required: true },
    pincode_id: { type: 'uuid' },
    name: { type: 'string', required: true, min: 2, max: 80 },
    latitude: { type: 'number', min: -90, max: 90 },
    longitude: { type: 'number', min: -180, max: 180 }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      city_id: input.city_id,
      pincode_id: input.pincode_id || null,
      name: cleanText(input.name),
      slug: input.slug ? slugify(input.slug) : slugify(input.name, 'locality'),
      latitude: toNumberOrNull(input.latitude),
      longitude: toNumberOrNull(input.longitude),
      is_active: toFlag(input.is_active),
      ...timestamps(now)
    };
  },
  toPublic(row) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      city_id: row.city_id,
      pincode_id: row.pincode_id
    };
  },
  async withUniqueSlug(input, isTaken) {
    const base = input.slug ? slugify(input.slug) : slugify(input.name, 'locality');
    return { ...input, slug: await uniqueSlug(base, isTaken, { fallback: 'locality' }) };
  }
};

export const LOCATION_MODELS = { country, state, district, city, pincode, locality };
