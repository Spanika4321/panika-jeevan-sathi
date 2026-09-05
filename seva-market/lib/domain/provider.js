/**
 * Provider domain — the business that a customer contacts.
 *
 * Design notes:
 *   • `pincode` is stored as a denormalised six-digit column *in addition to*
 *     `pincode_id` so PIN search is a single index lookup even while the
 *     reference data is still being imported;
 *   • money is stored in **paise** (integer) to avoid float rounding, and price
 *     ranges are display-only for now — no payment gateway is wired in;
 *   • `search_text` is a lower-cased concatenation maintained by the service
 *     layer so keyword search works identically on SQLite and Postgres today,
 *     and can be replaced by a full-text index later without changing callers.
 */
import { newId } from '../ids.js';
import { slugify, uniqueSlug } from '../slug.js';
import { cleanText, normalisePhone, normalisePincode } from '../validate.js';

export const PROVIDER_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'suspended'];
export const VERIFICATION_LEVELS = ['unverified', 'phone', 'document', 'trusted'];
export const PRICE_UNITS = ['visit', 'hour', 'day', 'month', 'sqft', 'unit', 'quote'];

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export const provider = {
  table: 'providers',
  columns: [
    'id',
    'user_id',
    'business_name',
    'slug',
    'tagline',
    'description',
    'primary_category_id',
    'address_line',
    'locality_id',
    'city_id',
    'district_id',
    'state_id',
    'pincode_id',
    'pincode',
    'latitude',
    'longitude',
    'service_radius_km',
    'phone',
    'whatsapp',
    'email',
    'website',
    'experience_years',
    'team_size',
    'status',
    'verification_level',
    'is_active',
    'rating_sum',
    'rating_count',
    'view_count',
    'search_text',
    'created_at',
    'updated_at'
  ],
  unique: [['slug']],
  rules: {
    user_id: { type: 'uuid' },
    business_name: { type: 'string', required: true, min: 2, max: 120 },
    tagline: { type: 'string', max: 140 },
    description: { type: 'text', max: 2000 },
    primary_category_id: { type: 'uuid' },
    address_line: { type: 'text', max: 240 },
    locality_id: { type: 'uuid' },
    city_id: { type: 'uuid' },
    district_id: { type: 'uuid' },
    state_id: { type: 'uuid' },
    pincode_id: { type: 'uuid' },
    pincode: { type: 'pincode' },
    latitude: { type: 'number', min: -90, max: 90 },
    longitude: { type: 'number', min: -180, max: 180 },
    service_radius_km: { type: 'integer', min: 0, max: 200, default: 10 },
    phone: { type: 'phone' },
    whatsapp: { type: 'phone' },
    email: { type: 'email' },
    website: { type: 'string', max: 200 },
    experience_years: { type: 'integer', min: 0, max: 80, default: 0 },
    team_size: { type: 'integer', min: 1, max: 100000, default: 1 },
    status: { type: 'enum', values: PROVIDER_STATUSES, default: 'pending' },
    verification_level: { type: 'enum', values: VERIFICATION_LEVELS, default: 'unverified' }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      user_id: input.user_id || null,
      business_name: cleanText(input.business_name),
      slug: input.slug ? slugify(input.slug) : slugify(input.business_name, 'provider'),
      tagline: cleanText(input.tagline || ''),
      description: cleanText(input.description || ''),
      primary_category_id: input.primary_category_id || null,
      address_line: cleanText(input.address_line || ''),
      locality_id: input.locality_id || null,
      city_id: input.city_id || null,
      district_id: input.district_id || null,
      state_id: input.state_id || null,
      pincode_id: input.pincode_id || null,
      pincode: input.pincode ? normalisePincode(input.pincode) : '',
      latitude: toNumberOrNull(input.latitude),
      longitude: toNumberOrNull(input.longitude),
      service_radius_km: Number.isFinite(Number(input.service_radius_km)) ? Number(input.service_radius_km) : 10,
      phone: input.phone ? normalisePhone(input.phone) : '',
      whatsapp: input.whatsapp ? normalisePhone(input.whatsapp) : '',
      email: input.email ? cleanText(input.email).toLowerCase() : '',
      website: cleanText(input.website || ''),
      experience_years: Number(input.experience_years || 0),
      team_size: Number(input.team_size || 1),
      status: PROVIDER_STATUSES.includes(input.status) ? input.status : 'pending',
      verification_level: VERIFICATION_LEVELS.includes(input.verification_level) ? input.verification_level : 'unverified',
      is_active: input.is_active === true || input.status === 'approved' ? 1 : 0,
      rating_sum: Number(input.rating_sum || 0),
      rating_count: Number(input.rating_count || 0),
      view_count: Number(input.view_count || 0),
      search_text: cleanText(input.search_text || '').toLowerCase(),
      created_at: input.created_at || now,
      updated_at: now
    };
  },
  toPublic(row, { contact = true } = {}) {
    if (!row) return null;
    const base = {
      id: row.id,
      business_name: row.business_name,
      slug: row.slug,
      tagline: row.tagline,
      description: row.description,
      primary_category_id: row.primary_category_id,
      address_line: row.address_line,
      city_id: row.city_id,
      locality_id: row.locality_id,
      state_id: row.state_id,
      pincode: row.pincode,
      service_radius_km: row.service_radius_km,
      experience_years: row.experience_years,
      status: row.status,
      verification_level: row.verification_level,
      rating: row.rating_count ? Number((row.rating_sum / row.rating_count).toFixed(2)) : null,
      rating_count: row.rating_count,
      created_at: row.created_at
    };
    if (contact) {
      base.phone = row.phone;
      base.whatsapp = row.whatsapp;
    }
    return base;
  },
  async withUniqueSlug(input, isTaken) {
    const base = input.slug ? slugify(input.slug) : slugify(input.business_name, 'provider');
    return { ...input, slug: await uniqueSlug(base, isTaken, { fallback: 'provider' }) };
  }
};

export const providerService = {
  table: 'provider_services',
  columns: [
    'id',
    'provider_id',
    'service_id',
    'category_id',
    'price_from',
    'price_to',
    'price_unit',
    'is_primary',
    'created_at',
    'updated_at'
  ],
  unique: [['provider_id', 'service_id']],
  rules: {
    provider_id: { type: 'uuid', required: true },
    service_id: { type: 'uuid', required: true },
    category_id: { type: 'uuid', required: true },
    price_from: { type: 'integer', min: 0, max: 100000000 },
    price_to: { type: 'integer', min: 0, max: 100000000 },
    price_unit: { type: 'enum', values: PRICE_UNITS, default: 'visit' },
    is_primary: { type: 'boolean', default: false }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      provider_id: input.provider_id,
      service_id: input.service_id,
      category_id: input.category_id,
      price_from: toNumberOrNull(input.price_from),
      price_to: toNumberOrNull(input.price_to),
      price_unit: PRICE_UNITS.includes(input.price_unit) ? input.price_unit : 'visit',
      is_primary: input.is_primary ? 1 : 0,
      created_at: input.created_at || now,
      updated_at: now
    };
  },
  toPublic(row) {
    return {
      service_id: row.service_id,
      category_id: row.category_id,
      price_from: row.price_from,
      price_to: row.price_to,
      price_unit: row.price_unit
    };
  }
};

/** PIN codes a provider is willing to travel to. */
export const providerArea = {
  table: 'provider_areas',
  columns: ['id', 'provider_id', 'pincode_id', 'pincode', 'created_at'],
  unique: [['provider_id', 'pincode']],
  rules: {
    provider_id: { type: 'uuid', required: true },
    pincode_id: { type: 'uuid' },
    pincode: { type: 'pincode', required: true }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      provider_id: input.provider_id,
      pincode_id: input.pincode_id || null,
      pincode: normalisePincode(input.pincode),
      created_at: input.created_at || now
    };
  },
  toPublic(row) {
    return { pincode: row.pincode, pincode_id: row.pincode_id };
  }
};

export const PROVIDER_MODELS = { provider, providerService, providerArea };
