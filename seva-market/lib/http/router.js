/**
 * Minimal HTTP router for the JSON API.
 *
 * Handlers return plain data (serialised as `{ok: true, ...}`) or throw an
 * `AppError`; they never touch `res` directly, which keeps error handling,
 * status codes and logging in exactly one place.
 */
import { toAppError } from '../errors.js';

const MAX_BODY_BYTES = 256 * 1024;

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler, options = {}) {
    routes.push({
      method,
      pattern,
      parts: pattern.split('/').filter(Boolean),
      handler,
      options
    });
  }

  const api = {
    routes,
    get: (pattern, handler, options) => add('GET', pattern, handler, options),
    post: (pattern, handler, options) => add('POST', pattern, handler, options),
    put: (pattern, handler, options) => add('PUT', pattern, handler, options),
    patch: (pattern, handler, options) => add('PATCH', pattern, handler, options),
    delete: (pattern, handler, options) => add('DELETE', pattern, handler, options)
  };

  function match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of routes) {
      if (route.method !== method) continue;
      if (route.parts.length !== parts.length) continue;
      const params = {};
      let matched = true;
      for (let i = 0; i < parts.length; i += 1) {
        const expected = route.parts[i];
        if (expected.startsWith(':')) {
          params[expected.slice(1)] = safeDecode(parts[i]);
        } else if (expected !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }

  api.match = match;
  api.MAX_BODY_BYTES = MAX_BODY_BYTES;
  return api;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Read and parse a JSON body, refusing anything oversized or malformed. */
export function readJsonBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks = [];

    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        const error = new Error('Request body too large');
        error.status = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (done) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const error = new Error('JSON body must be an object');
          error.status = 400;
          return reject(error);
        }
        resolve(parsed);
      } catch {
        const error = new Error('Invalid JSON body');
        error.status = 400;
        reject(error);
      }
    });

    req.on('aborted', () => reject(Object.assign(new Error('Request aborted'), { status: 400 })));
    req.on('error', reject);
  });
}

export function statusForError(error) {
  if (error && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) {
    return error.status;
  }
  return toAppError(error).status;
}
