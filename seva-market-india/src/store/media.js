'use strict';
/**
 * SEVA MARKET INDIA — business-photo storage.
 *
 * Browser uploads never receive Supabase credentials. In production photos go
 * server-to-server to a dedicated public Storage bucket; in local development
 * they are written below public/uploads/ so the same form remains useful
 * without cloud credentials.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const IMAGE_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

class MediaError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'MediaError';
    Object.assign(this, extra);
  }
}

function imageTypeFromBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** Validate file bytes, rather than trusting the browser-provided MIME type. */
function validatePhoto(file, { maxFileBytes = 2 * 1024 * 1024 } = {}) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw new MediaError('Choose a JPG, PNG, or WebP image.');
  if (!file.buffer.length) throw new MediaError('The selected photo is empty. Choose another image.');
  if (file.buffer.length > maxFileBytes) {
    throw new MediaError(`Each business photo must be ${Math.floor(maxFileBytes / 1024 / 1024)} MB or smaller.`);
  }
  const contentType = imageTypeFromBytes(file.buffer);
  if (!contentType) throw new MediaError('Only real JPG, PNG, or WebP images can be uploaded.');
  return {
    buffer: file.buffer,
    contentType,
    extension: IMAGE_TYPES[contentType],
    size: file.buffer.length,
  };
}

function bucketName(value) {
  const clean = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(clean)) {
    throw new MediaError('Business photo storage is not configured correctly.');
  }
  return clean;
}

function objectPath(bucket, object) {
  return `${encodeURIComponent(bucket)}/${String(object).split('/').map(encodeURIComponent).join('/')}`;
}

function createLocalMediaStore({ config }) {
  const root = path.join(config.root, 'public', 'uploads', 'businesses');
  const limits = config.media;
  return {
    backend: 'local-development',
    async uploadProviderPhoto({ providerId, file }) {
      const image = validatePhoto(file, limits);
      const id = Number(providerId);
      if (!Number.isSafeInteger(id) || id <= 0) throw new MediaError('Save the business profile before adding photos.');
      fs.mkdirSync(root, { recursive: true });
      const filename = `${id}-${crypto.randomUUID()}.${image.extension}`;
      const finalPath = path.join(root, filename);
      const temporaryPath = `${finalPath}.uploading`;
      fs.writeFileSync(temporaryPath, image.buffer, { mode: 0o600 });
      fs.renameSync(temporaryPath, finalPath);
      return `/uploads/businesses/${filename}`;
    },
  };
}

function createSupabaseMediaStore({ config, fetchImpl = globalThis.fetch }) {
  const baseUrl = String(config.storage?.supabase?.url || '').replace(/\/+$/, '');
  const apiKey = String(config.storage?.supabase?.key || '').trim();
  const bucket = bucketName(config.media?.bucket);
  const limits = config.media;
  let ready = null;

  if (!baseUrl || !apiKey || typeof fetchImpl !== 'function') {
    throw new MediaError('Business photo storage is unavailable because Supabase is not configured.');
  }

  const headers = (extra = {}) => ({
    apikey: apiKey,
    authorization: `Bearer ${apiKey}`,
    ...extra,
  });

  async function readError(response) {
    const text = await response.text().catch(() => '');
    return String(text).replace(/\s+/g, ' ').slice(0, 220);
  }

  async function request(url, init) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...init,
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined,
      });
    } catch (_) {
      throw new MediaError('Photo upload could not reach storage. Check your connection and try again.');
    }
    return response;
  }

  async function ensureBucket() {
    const existing = await request(`${baseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      method: 'GET', headers: headers(),
    });
    if (existing.ok) return true;
    if (existing.status !== 404) {
      await readError(existing);
      throw new MediaError('Business photo storage could not be opened. Please try again later.');
    }

    const created = await request(`${baseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        id: bucket,
        name: bucket,
        public: true,
        file_size_limit: limits.maxFileBytes,
        allowed_mime_types: Object.keys(IMAGE_TYPES),
      }),
    });
    // A simultaneous first upload can create the bucket between our GET and
    // POST. 409 means it now exists and is safe to use.
    if (created.ok || created.status === 409) return true;
    await readError(created);
    throw new MediaError('Business photo storage could not be prepared. Please try again later.');
  }

  return {
    backend: 'supabase-storage',
    async uploadProviderPhoto({ providerId, file }) {
      const image = validatePhoto(file, limits);
      const id = Number(providerId);
      if (!Number.isSafeInteger(id) || id <= 0) throw new MediaError('Save the business profile before adding photos.');
      ready ||= ensureBucket();
      await ready;

      // The server assigns a random name; original filenames are neither a
      // security boundary nor something we need to expose publicly.
      const key = `providers/${id}/${crypto.randomUUID()}.${image.extension}`;
      const response = await request(`${baseUrl}/storage/v1/object/${objectPath(bucket, key)}`, {
        method: 'POST',
        headers: headers({
          'content-type': image.contentType,
          'x-upsert': 'false',
        }),
        body: image.buffer,
      });
      if (!response.ok) {
        await readError(response);
        throw new MediaError('Photo upload failed. Please choose a smaller JPG, PNG, or WebP image and try again.');
      }
      return `${baseUrl}/storage/v1/object/public/${objectPath(bucket, key)}`;
    },
  };
}

function createMediaStore({ config, driver, fetchImpl }) {
  return driver === 'supabase'
    ? createSupabaseMediaStore({ config, fetchImpl })
    : createLocalMediaStore({ config });
}

module.exports = {
  IMAGE_TYPES,
  MediaError,
  imageTypeFromBytes,
  validatePhoto,
  createLocalMediaStore,
  createSupabaseMediaStore,
  createMediaStore,
};
