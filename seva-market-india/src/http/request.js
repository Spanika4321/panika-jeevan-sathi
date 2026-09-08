'use strict';
/**
 * SEVA MARKET INDIA — request body parsing + input validation.
 *
 * Bodies are size-capped before parsing and every field that reaches the
 * database passes through a validator. Validation returns a flat
 * `{ field: message }` map so forms can render errors next to inputs.
 */

const { HttpError } = require('./respond');
const { cleanText, isValidPin, normalizePhone } = require('../db/values');

/**
 * Read and parse a request body.
 * @returns {Promise<object>}
 */
function readBody(req, maxBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        finish(HttpError.badRequest(`Request body exceeds ${maxBytes} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return finish(null, {});
      const type = String(req.headers['content-type'] || '').split(';')[0].trim();
      try {
        if (type === 'application/json') return finish(null, JSON.parse(raw));
        if (type === 'application/x-www-form-urlencoded') {
          return finish(null, Object.fromEntries(new URLSearchParams(raw).entries()));
        }
        return finish(HttpError.badRequest('Unsupported Content-Type; send JSON or a form.'));
      } catch (_) {
        return finish(HttpError.badRequest('Malformed request body.'));
      }
    });
    req.on('error', (error) => finish(error));
  });
}

/**
 * Parse a small multipart/form-data submission for the business-photo form.
 * No third-party parser is needed here: the route accepts ordinary text fields
 * plus a bounded number of image buffers, and validates image magic bytes
 * before anything is stored. Other forms remain urlencoded/JSON via readBody.
 *
 * @returns {Promise<{fields: object, files: Record<string, object[]>}>}
 */
function readMultipart(req, maxBytes = 11 * 1024 * 1024) {
  const contentType = String(req.headers['content-type'] || '');
  const match = /multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match && (match[1] || match[2]);
  if (!boundary || boundary.length > 200) {
    return Promise.reject(HttpError.badRequest('Malformed photo upload. Please choose the images again.'));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        finish(HttpError.badRequest(`Photo upload exceeds ${Math.floor(maxBytes / 1024 / 1024)} MB.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const source = Buffer.concat(chunks);
        const delimiter = Buffer.from(`--${boundary}`);
        const beforeDelimiter = Buffer.concat([Buffer.from('\r\n'), delimiter]);
        const fields = {};
        const files = {};
        let cursor = 0;
        let complete = false;

        while (cursor < source.length) {
          if (!source.subarray(cursor, cursor + delimiter.length).equals(delimiter)) {
            throw HttpError.badRequest('Malformed photo upload. Please choose the images again.');
          }
          cursor += delimiter.length;
          // The final delimiter is followed by "--" (and optionally CRLF).
          if (source.subarray(cursor, cursor + 2).toString('ascii') === '--') {
            complete = true;
            break;
          }
          if (source.subarray(cursor, cursor + 2).toString('ascii') !== '\r\n') {
            throw HttpError.badRequest('Malformed photo upload. Please choose the images again.');
          }
          cursor += 2;

          const headerEnd = source.indexOf(Buffer.from('\r\n\r\n'), cursor);
          if (headerEnd < 0) throw HttpError.badRequest('Malformed photo upload. Please choose the images again.');
          const headers = {};
          for (const line of source.subarray(cursor, headerEnd).toString('utf8').split('\r\n')) {
            const split = line.indexOf(':');
            if (split > 0) headers[line.slice(0, split).trim().toLowerCase()] = line.slice(split + 1).trim();
          }
          cursor = headerEnd + 4;

          const next = source.indexOf(beforeDelimiter, cursor);
          if (next < 0) throw HttpError.badRequest('Malformed photo upload. Please choose the images again.');
          const bytes = source.subarray(cursor, next);
          cursor = next + 2; // leave cursor at the next --boundary marker

          const disposition = headers['content-disposition'] || '';
          const nameMatch = /(?:^|;)\s*name="([^"]*)"/i.exec(disposition);
          if (!/^form-data/i.test(disposition) || !nameMatch || !nameMatch[1]) continue;
          const name = nameMatch[1];
          const filenameMatch = /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition);
          if (filenameMatch && filenameMatch[1]) {
            const filename = filenameMatch[1].replace(/[\\/\0]/g, '_').slice(-180);
            const file = { filename, contentType: headers['content-type'] || '', buffer: bytes };
            (files[name] || (files[name] = [])).push(file);
          } else if (!filenameMatch) {
            fields[name] = bytes.toString('utf8');
          }
        }
        if (!complete) throw HttpError.badRequest('Malformed photo upload. Please choose the images again.');
        finish(null, { fields, files });
      } catch (err) {
        finish(err instanceof HttpError ? err : HttpError.badRequest('Malformed photo upload. Please choose the images again.'));
      }
    });
    req.on('error', (error) => finish(error));
  });
}

/** Field-level validators. Each returns a normalised value or throws. */
const validators = {
  text(value, { field, required = true, min = 1, max = 500 } = {}) {
    const text = cleanText(value, max);
    if (!text) {
      if (required) throw fieldError(field, `${label(field)} is required.`);
      return null;
    }
    if (text.length < min) throw fieldError(field, `${label(field)} must be at least ${min} characters.`);
    return text;
  },

  email(value, { field = 'email', required = false } = {}) {
    const text = cleanText(value, 254)?.toLowerCase() ?? null;
    if (!text) {
      if (required) throw fieldError(field, 'Email is required.');
      return null;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) throw fieldError(field, 'Enter a valid email address.');
    return text;
  },

  phone(value, { field = 'phone', required = true } = {}) {
    const digits = normalizePhone(value);
    if (!digits) {
      if (required) throw fieldError(field, 'Enter a valid 10-digit Indian mobile number.');
      return null;
    }
    return digits;
  },

  pin(value, { field = 'pin', required = false } = {}) {
    const text = cleanText(value, 6);
    if (!text) {
      if (required) throw fieldError(field, 'PIN code is required.');
      return null;
    }
    if (!isValidPin(text)) throw fieldError(field, 'PIN code must be 6 digits and cannot start with 0.');
    return text;
  },

  int(value, { field, required = false, min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
    if (value === null || value === undefined || value === '') {
      if (required) throw fieldError(field, `${label(field)} is required.`);
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw fieldError(field, `${label(field)} must be a whole number.`);
    }
    if (parsed < min || parsed > max) {
      throw fieldError(field, `${label(field)} must be between ${min} and ${max}.`);
    }
    return parsed;
  },

  enum(value, allowed, { field, required = true, fallback = null } = {}) {
    if (value === null || value === undefined || value === '') {
      if (required) throw fieldError(field, `${label(field)} is required.`);
      return fallback;
    }
    if (!allowed.includes(value)) {
      throw fieldError(field, `${label(field)} must be one of: ${allowed.join(', ')}.`);
    }
    return value;
  },

  boolean(value, { fallback = false } = {}) {
    if (value === true || value === 'true' || value === '1' || value === 1) return true;
    if (value === false || value === 'false' || value === '0' || value === 0) return false;
    return fallback;
  },
};

/**
 * Collect every validation error instead of failing on the first one.
 *
 * Errors are keyed by the *shape key* — the name the calling route uses in its
 * template (`errors.password`), not the human label the validator was given
 * (`'New password'`). Keying by the label silently produced an errors object
 * no template could read, so every field error fell back to one generic
 * "please correct the highlighted fields" banner. The label still appears in
 * the message, which is where a human reads it.
 */
function validate(shape) {
  const errors = {};
  const value = {};
  for (const [key, run] of Object.entries(shape)) {
    try {
      value[key] = run();
    } catch (err) {
      if (err && err.name === 'ValidationError') errors[key] = err.message;
      else throw err;
    }
  }
  return { value, errors, valid: Object.keys(errors).length === 0 };
}

function fieldError(field, message) {
  const error = new Error(message);
  error.name = 'ValidationError';
  error.field = field;
  return error;
}

function label(field) {
  return String(field || 'This field').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Pagination clamping shared by list endpoints. */
function pagination(searchParams, { defaultSize = 20, maxSize = 100 } = {}) {
  const limit = clampInt(searchParams.get('limit'), defaultSize, 1, maxSize);
  const page = clampInt(searchParams.get('page'), 1, 1, 100000);
  return { limit, page, offset: (page - 1) * limit };
}

function clampInt(raw, fallback, min, max) {
  // An absent query param arrives as null, and Number(null) === 0 — which is
  // finite, so it must be rejected here or the fallback never applies.
  if (raw === null || raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

module.exports = { readBody, readMultipart, validators, validate, pagination, fieldError };
