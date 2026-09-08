/** SEVA MARKET INDIA — business-photo safety and storage tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  validatePhoto, createSupabaseMediaStore, MediaError,
} = require('../src/store/media');
const config = require('../src/config');

const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
]);

const response = (status, body = '') => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

test('photo validation checks magic bytes, size, and allows only JPG/PNG/WebP', () => {
  const jpeg = validatePhoto({ filename: 'shop.jpeg', contentType: 'image/jpeg', buffer: TINY_JPEG });
  assert.equal(jpeg.contentType, 'image/jpeg');
  assert.equal(jpeg.extension, 'jpg');

  assert.throws(
    () => validatePhoto({ filename: 'not-really.jpg', contentType: 'image/jpeg', buffer: Buffer.from('<svg/>') }),
    (err) => err instanceof MediaError && /Only real JPG/i.test(err.message),
  );
  assert.throws(
    () => validatePhoto({ filename: 'large.jpg', buffer: Buffer.alloc(17), contentType: 'image/jpeg' }, { maxFileBytes: 16 }),
    /smaller/i,
  );
});

test('the first production upload creates a restricted public bucket server-side and returns its public object URL', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url.endsWith('/storage/v1/bucket/seva-business-photos')) return response(404);
    if (url.endsWith('/storage/v1/bucket')) return response(200, '{}');
    if (url.includes('/storage/v1/object/seva-business-photos/providers/42/')) return response(200, '{}');
    return response(500);
  };
  const media = createSupabaseMediaStore({
    config: {
      ...config,
      media: { ...config.media, bucket: 'seva-business-photos', maxFileBytes: 2 * 1024 * 1024 },
      storage: { ...config.storage, supabase: { url: 'https://project.supabase.co', key: 'sb_secret_test_123456789' } },
    },
    fetchImpl,
  });

  const url = await media.uploadProviderPhoto({
    providerId: 42,
    file: { filename: 'front.jpg', contentType: 'image/jpeg', buffer: TINY_JPEG },
  });
  assert.match(url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/seva-business-photos\/providers\/42\//);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].body).allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(calls[2].headers['content-type'], 'image/jpeg');
  assert.equal(calls[2].headers['x-upsert'], 'false');
  assert.ok(Buffer.isBuffer(calls[2].body));
  assert.ok(!url.includes('sb_secret_test_123456789'), 'secrets must not be part of a returned upload value');
});
