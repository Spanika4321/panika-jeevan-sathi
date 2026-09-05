/**
 * Declarative payload validation.
 *
 * Untrusted input is normalised into a clean object; anything that fails is
 * reported per-field so the UI can render inline errors. Validation lives in
 * one place so the HTTP layer, the domain services and the seeders all agree
 * on what a valid Indian PIN code, phone number or slug looks like.
 */
import { ValidationError } from './errors.js';

export const PATTERNS = {
  // Indian mobile numbers: 10 digits, starting 6-9, optional +91 / 0 prefix.
  phone: /^[6-9]\d{9}$/,
  // India Post PIN code: 6 digits, first digit 1-9.
  pincode: /^[1-9][0-9]{5}$/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  time24: /^([01]\d|2[0-3]):[0-5]\d$/
};

/** Strip control characters and zero-width junk from free text. */
export function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\ufeff]/g, '')
    .trim();
}

export function normalisePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

export function normalisePincode(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 6);
}

export function normaliseEmail(value) {
  return cleanText(value).toLowerCase();
}

const TYPES = {
  string(value, rule, field) {
    if (typeof value !== 'string') return 'must be text';
    const text = rule.trim === false ? value : value.trim();
    if (rule.min && text.length < rule.min) return `must be at least ${rule.min} characters`;
    if (rule.max && text.length > rule.max) return `must be at most ${rule.max} characters`;
    if (rule.pattern && !rule.pattern.test(text)) return rule.message || 'has an invalid format';
    return null;
  },

  text(value, rule, field) {
    const error = TYPES.string(value, rule, field);
    if (error) return error;
    return null;
  },

  email(value) {
    if (typeof value !== 'string') return 'must be text';
    const email = normaliseEmail(value);
    if (email.length > 254) return 'is too long';
    if (!PATTERNS.email.test(email)) return 'must be a valid email address';
    return null;
  },

  phone(value) {
    const digits = normalisePhone(value);
    if (!PATTERNS.phone.test(digits)) return 'must be a valid 10-digit Indian mobile number';
    return null;
  },

  pincode(value) {
    // Check the raw digits first: silently truncating "5600341" to "560034"
    // would accept a PIN that India Post would reject.
    const digits = String(value ?? '').replace(/\D/g, '');
    if (digits.length !== 6) return 'must be a valid 6-digit Indian PIN code';
    if (!PATTERNS.pincode.test(digits)) return 'must be a valid 6-digit Indian PIN code';
    return null;
  },

  slug(value) {
    if (!PATTERNS.slug.test(String(value ?? ''))) return 'must be a lowercase URL slug';
    return null;
  },

  uuid(value) {
    if (!PATTERNS.uuid.test(String(value ?? ''))) return 'must be a valid id';
    return null;
  },

  integer(value, rule) {
    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isInteger(number)) return 'must be a whole number';
    if (rule.min !== undefined && number < rule.min) return `must be ${rule.min} or more`;
    if (rule.max !== undefined && number > rule.max) return `must be ${rule.max} or less`;
    return null;
  },

  number(value, rule) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'must be a number';
    if (rule.min !== undefined && number < rule.min) return `must be ${rule.min} or more`;
    if (rule.max !== undefined && number > rule.max) return `must be ${rule.max} or less`;
    return null;
  },

  boolean(value) {
    if (typeof value !== 'boolean' && !['true', 'false', '0', '1'].includes(String(value))) {
      return 'must be true or false';
    }
    return null;
  },

  enum(value, rule) {
    if (!rule.values.includes(value)) return `must be one of: ${rule.values.join(', ')}`;
    return null;
  },

  array(value, rule) {
    if (!Array.isArray(value)) return 'must be a list';
    if (rule.min !== undefined && value.length < rule.min) return `needs at least ${rule.min} item(s)`;
    if (rule.max !== undefined && value.length > rule.max) return `allows at most ${rule.max} item(s)`;
    return null;
  }
};

const NORMALISERS = {
  string: (value) => cleanText(value),
  text: (value) => cleanText(value),
  email: (value) => normaliseEmail(value),
  phone: (value) => normalisePhone(value),
  pincode: (value) => normalisePincode(value),
  slug: (value) => String(value ?? '').trim().toLowerCase(),
  uuid: (value) => String(value ?? '').trim().toLowerCase(),
  integer: (value) => Math.trunc(Number(value)),
  number: (value) => Number(value),
  boolean: (value) => value === true || value === 'true' || value === '1' || value === 1,
  enum: (value) => value,
  array: (value) => value
};

/**
 * Validate and normalise `payload` against `rules`.
 *
 * rules = { field: { type, required, default, min, max, pattern, values } }
 * Unknown fields are dropped, so callers can pass a raw request body safely.
 *
 * @throws {ValidationError} with one message per offending field.
 */
export function validate(payload, rules, { partial = false } = {}) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const fields = {};
  const output = {};

  for (const [field, rule] of Object.entries(rules)) {
    const type = rule.type || 'string';
    const checker = TYPES[type];
    if (!checker) throw new Error(`Unknown validator type "${type}" for field "${field}"`);

    let value = source[field];
    const missing = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

    if (missing) {
      if (rule.default !== undefined) {
        output[field] = typeof rule.default === 'function' ? rule.default() : rule.default;
      } else if (rule.required && !partial) {
        fields[field] = 'is required';
      } else if (!partial) {
        output[field] = null;
      }
      continue;
    }

    if (type === 'array' && !Array.isArray(value)) value = [value];

    const error = checker(value, rule, field);
    if (error) {
      fields[field] = error;
      continue;
    }

    output[field] = NORMALISERS[type] ? NORMALISERS[type](value) : value;
  }

  if (Object.keys(fields).length) throw new ValidationError(fields);
  return output;
}

/** Validate an already-parsed query string object (all fields optional). */
export function validateQuery(query, rules) {
  return validate(query, rules, { partial: true });
}
