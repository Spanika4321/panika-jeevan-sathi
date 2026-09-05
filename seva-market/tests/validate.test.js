import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validate,
  validateQuery,
  cleanText,
  normalisePhone,
  normalisePincode,
  normaliseEmail,
  PATTERNS
} from '../lib/validate.js';
import { ValidationError } from '../lib/errors.js';
import { slugify, uniqueSlug, isSlug } from '../lib/slug.js';

describe('validation', () => {
  test('normalises Indian phone numbers to 10 digits', () => {
    assert.equal(normalisePhone('+91 98765 43210'), '9876543210');
    assert.equal(normalisePhone('09876543210'), '9876543210');
    assert.equal(normalisePhone('98765-43210'), '9876543210');
  });

  test('accepts valid and rejects invalid phone numbers', () => {
    assert.equal(validate({ phone: '9876543210' }, { phone: { type: 'phone' } }).phone, '9876543210');
    assert.throws(() => validate({ phone: '1234567890' }, { phone: { type: 'phone' } }), ValidationError);
    assert.throws(() => validate({ phone: '98765' }, { phone: { type: 'phone' } }), ValidationError);
  });

  test('PIN codes must be six digits and cannot start with zero', () => {
    assert.equal(normalisePincode('110 001'), '110001');
    assert.equal(validate({ pincode: '560034' }, { pincode: { type: 'pincode' } }).pincode, '560034');
    assert.throws(() => validate({ pincode: '012345' }, { pincode: { type: 'pincode' } }), ValidationError);
    assert.throws(() => validate({ pincode: '56003' }, { pincode: { type: 'pincode' } }), ValidationError);
    assert.throws(() => validate({ pincode: '5600341' }, { pincode: { type: 'pincode' } }), ValidationError);
  });

  test('emails are lower-cased and trimmed', () => {
    assert.equal(normaliseEmail('  Ravi@Example.COM '), 'ravi@example.com');
    assert.throws(() => validate({ email: 'not-an-email' }, { email: { type: 'email' } }), ValidationError);
  });

  test('control characters are stripped from free text', () => {
    assert.equal(cleanText('Ravi​ Kumar'), 'Ravi Kumar');
  });

  test('missing required fields are reported per field', () => {
    try {
      validate({}, { name: { type: 'string', required: true }, email: { type: 'email', required: true } });
      assert.fail('expected a ValidationError');
    } catch (error) {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'validation_failed');
      assert.deepEqual(Object.keys(error.fields).sort(), ['email', 'name']);
    }
  });

  test('defaults are applied and unknown fields are dropped', () => {
    const clean = validate(
      { name: '  Sharma Plumbing  ', role: 'provider', injected: 'DROP TABLE users' },
      { name: { type: 'string', required: true }, role: { type: 'enum', values: ['customer', 'provider'], default: 'customer' } }
    );
    assert.equal(clean.name, 'Sharma Plumbing');
    assert.equal(clean.role, 'provider');
    assert.equal('injected' in clean, false, 'unknown keys never reach the database');
  });

  test('an invalid enum value is rejected', () => {
    assert.throws(
      () => validate({ role: 'superadmin' }, { role: { type: 'enum', values: ['customer', 'provider'] } }),
      ValidationError
    );
  });

  test('numbers are coerced and range-checked', () => {
    assert.equal(validate({ years: '12' }, { years: { type: 'integer', min: 0, max: 60 } }).years, 12);
    assert.throws(() => validate({ years: '99' }, { years: { type: 'integer', max: 60 } }), ValidationError);
    assert.throws(() => validate({ years: 'many' }, { years: { type: 'integer' } }), ValidationError);
  });

  test('query validation is partial: absent fields are simply omitted', () => {
    const query = validateQuery({ page: '2' }, { page: { type: 'integer' }, limit: { type: 'integer' } });
    assert.deepEqual(query, { page: 2 });
  });

  test('the PIN and slug patterns match the documented formats', () => {
    assert.match('110001', PATTERNS.pincode);
    assert.doesNotMatch('11000a', PATTERNS.pincode);
    assert.match('home-cleaning', PATTERNS.slug);
    assert.doesNotMatch('Home Cleaning', PATTERNS.slug);
  });
});

describe('slugs', () => {
  test('slugify produces clean URL slugs', () => {
    assert.equal(slugify('Home Cleaning'), 'home-cleaning');
    assert.equal(slugify('  AC Service & Repair  '), 'ac-service-and-repair');
    assert.equal(slugify('Plumbing — Delhi'), 'plumbing-delhi');
    assert.equal(slugify('!!!'), 'item', 'falls back when there is nothing usable');
  });

  test('slugs are truncated but never left with a trailing dash', () => {
    const slug = slugify('a'.repeat(200));
    assert.ok(slug.length <= 80);
    assert.doesNotMatch(slug, /-$/);
  });

  test('uniqueSlug avoids collisions', async () => {
    const taken = new Set(['sharma-plumbing']);
    const slug = await uniqueSlug('Sharma Plumbing', async (candidate) => taken.has(candidate));
    assert.equal(slug, 'sharma-plumbing-2');
  });

  test('isSlug validates existing slugs', () => {
    assert.equal(isSlug('plumbing'), true);
    assert.equal(isSlug('Plumbing'), false);
    assert.equal(isSlug('home-cleaning'), true);
  });
});
