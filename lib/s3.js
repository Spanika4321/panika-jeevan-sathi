'use strict';
/**
 * PANIKA JEEVAN SATHI — generic S3-compatible object storage client.
 *
 * This is the SEO Center's permanent archive layer. The intended provider is
 * **Fil One** (https://fil.one — S3-compatible object storage on Filecoin,
 * endpoint shape `https://<region>.s3.filonecontent.com`), but because the
 * code speaks plain S3 + AWS Signature V4 it also works with AWS S3, MinIO,
 * Wasabi, Backblaze B2 and any other S3-compatible endpoint.
 *
 * Signature generation is shared with lib/r2.js (the AWS SigV4 implementation
 * that scripts/test-sigv4.mjs verifies against the canonical AWS test vector),
 * so there is exactly one signing implementation in this codebase.
 *
 * Credentials live ONLY in server-side environment variables. Nothing in here
 * is ever sent to the browser.
 */

const crypto = require('node:crypto');

const r2 = require('./r2');

const DEFAULTS = {
  region: 'eu-west-1',
  service: 's3',
  timeoutMs: 30000,
  maxRetries: 3,
  retryBaseMs: 250,
  maxRetryDelayMs: 6000
};

class S3Error extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'S3Error';
    Object.assign(this, extra);
  }
}

function first(...values) {
  for (const value of values) {
    const text = String(value === null || value === undefined ? '' : value).trim();
    if (text) return text;
  }
  return '';
}

/**
 * Read Fil One (or any S3-compatible) settings from the environment.
 * Returns null when the provider is not fully configured — callers must then
 * report NOT_CONFIGURED instead of pretending the archive exists.
 */
function configFromEnv(env = process.env) {
  const endpoint = first(
    env.FILONE_ENDPOINT,
    env.FIL_ONE_ENDPOINT,
    env.FIL_ENDPOINT,
    env.SEO_S3_ENDPOINT
  );
  const bucket = first(env.FILONE_BUCKET, env.FIL_ONE_BUCKET, env.FIL_BUCKET, env.SEO_S3_BUCKET);
  const accessKeyId = first(
    env.FILONE_ACCESS_KEY_ID,
    env.FILONE_ACCESS_KEY,
    env.FIL_ACCESS_KEY,
    env.SEO_S3_ACCESS_KEY_ID
  );
  const secretAccessKey = first(
    env.FILONE_SECRET_ACCESS_KEY,
    env.FILONE_SECRET_KEY,
    env.FIL_SECRET_KEY,
    env.SEO_S3_SECRET_ACCESS_KEY
  );

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  const provider = first(env.FILONE_PROVIDER, env.SEO_S3_PROVIDER, 'fil_one');

  return {
    provider,
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    accessKeyId,
    secretAccessKey,
    region: first(env.FILONE_REGION, env.FIL_REGION, env.SEO_S3_REGION, DEFAULTS.region),
    prefix: first(env.FILONE_PREFIX, env.SEO_S3_PREFIX, 'panika-jeevan-sathi/seo').replace(
      /^\/+|\/+$/g,
      ''
    )
  };
}

/** Which settings are present — reported to the admin UI (never the values). */
function envStatus(env = process.env) {
  return {
    endpoint: Boolean(first(env.FILONE_ENDPOINT, env.FIL_ONE_ENDPOINT, env.FIL_ENDPOINT, env.SEO_S3_ENDPOINT)),
    bucket: Boolean(first(env.FILONE_BUCKET, env.FIL_ONE_BUCKET, env.FIL_BUCKET, env.SEO_S3_BUCKET)),
    access_key: Boolean(
      first(
        env.FILONE_ACCESS_KEY_ID,
        env.FILONE_ACCESS_KEY,
        env.FIL_ACCESS_KEY,
        env.SEO_S3_ACCESS_KEY_ID
      )
    ),
    secret_key: Boolean(
      first(
        env.FILONE_SECRET_ACCESS_KEY,
        env.FILONE_SECRET_KEY,
        env.FIL_SECRET_KEY,
        env.SEO_S3_SECRET_ACCESS_KEY
      )
    )
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseXmlError(text) {
  const code = /<Code>([^<]*)<\/Code>/.exec(text);
  const message = /<Message>([^<]*)<\/Message>/.exec(text);
  if (!code && !message) return String(text || '').slice(0, 300);
  return `${code ? code[1] : ''}${message ? `: ${message[1]}` : ''}`.trim();
}

function createClient(config, options = {}) {
  if (!config) throw new S3Error('Object storage is not configured.');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = options.log || (() => {});
  const limits = Object.assign({}, DEFAULTS, options.limits || {});

  let lastError = null;
  let requestCount = 0;

  /** path-style object URL: <endpoint>/<bucket>/<prefix>/<key> */
  function objectUrl(key, query) {
    const parts = [config.prefix, key]
      .filter(Boolean)
      .map((part) =>
        String(part)
          .split('/')
          .map((segment) => r2.uriEncode(segment, false))
          .join('/')
      );
    const search = query
      ? '?' +
        Object.entries(query)
          .map(([k, v]) => `${r2.uriEncode(k)}=${r2.uriEncode(v)}`)
          .join('&')
      : '';
    return `${config.endpoint}/${r2.uriEncode(config.bucket, false)}/${parts.join('/')}${search}`;
  }

  async function request(method, url, { body = null, contentType = '' } = {}) {
    const payload = body === null ? Buffer.alloc(0) : body;
    const payloadHash = r2.sha256Hex(payload);
    const headers = {};
    if (contentType) headers['content-type'] = contentType;

    const signed = r2.signRequest({
      method,
      url,
      headers,
      payloadHash,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      service: limits.service
    });

    let attempt = 0;
    for (;;) {
      try {
        const res = await fetchImpl(url, {
          method,
          headers: signed.headers,
          body: body === null ? undefined : payload,
          signal: AbortSignal.timeout(limits.timeoutMs)
        });
        requestCount += 1;

        if (res.status === 429 || res.status >= 500) {
          const text = await res.text();
          throw Object.assign(
            new S3Error(`object storage ${method} HTTP ${res.status}: ${parseXmlError(text)}`, {
              status: res.status
            }),
            { retryable: true }
          );
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (!res.ok) {
          throw Object.assign(
            new S3Error(
              `object storage ${method} HTTP ${res.status}: ${parseXmlError(buffer.toString('utf8'))}`,
              { status: res.status }
            ),
            { retryable: false }
          );
        }
        lastError = null;
        return { res, buffer };
      } catch (err) {
        const retryable =
          err.retryable === true ||
          err.name === 'TimeoutError' ||
          err.name === 'AbortError' ||
          err.code === 'ECONNRESET';
        lastError = err;
        if (!retryable || attempt >= limits.maxRetries) throw err;
        const delay = Math.min(limits.maxRetryDelayMs, limits.retryBaseMs * 2 ** attempt);
        log(`[s3] ${err.message} — retrying in ${delay} ms`);
        await sleep(delay);
        attempt += 1;
      }
    }
  }

  return {
    kind: 's3',
    provider: config.provider,
    bucket: config.bucket,
    endpoint: config.endpoint,
    prefix: config.prefix,

    /** Upload (or replace) an object. */
    async put(key, data, contentType = 'application/octet-stream') {
      const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const { res } = await request('PUT', objectUrl(key), { body, contentType });
      return {
        key,
        size: body.length,
        etag: res.headers.get('etag'),
        sha256: crypto.createHash('sha256').update(body).digest('hex')
      };
    },

    /** Download an object; null when it does not exist. */
    async get(key) {
      try {
        const { buffer } = await request('GET', objectUrl(key));
        return buffer;
      } catch (err) {
        if (err.status === 404 || /NoSuchKey/i.test(err.message)) return null;
        throw err;
      }
    },

    async head(key) {
      try {
        const { res } = await request('HEAD', objectUrl(key));
        return {
          size: Number(res.headers.get('content-length') || 0),
          contentType: res.headers.get('content-type') || '',
          etag: res.headers.get('etag')
        };
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },

    async remove(key) {
      try {
        await request('DELETE', objectUrl(key));
        return true;
      } catch (err) {
        if (err.status === 404) return false;
        throw err;
      }
    },

    /** List object keys under the configured prefix (ListObjectsV2). */
    async list(prefix = '') {
      const keys = [];
      let continuation = null;
      for (;;) {
        const query = {
          'list-type': '2',
          prefix: [config.prefix, prefix].filter(Boolean).join('/'),
          'max-keys': '1000'
        };
        if (continuation) query['continuation-token'] = continuation;
        const { buffer } = await request('GET', objectUrl('', query).replace(/\/\?/, '?'));
        const xml = buffer.toString('utf8');
        for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
          const key = match[1];
          keys.push(config.prefix ? key.slice(config.prefix.length + 1) : key);
        }
        const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
        const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
        if (!truncated || !next) break;
        continuation = next[1];
      }
      return keys;
    },

    /**
     * Real connectivity proof: write, read back, compare, delete.
     * The SEO Center only reports CONNECTED when this succeeds — a
     * configured-but-broken bucket must show BLOCKED, never a green tick.
     */
    async ping() {
      const key = `.seo-ping-${Date.now()}`;
      const body = Buffer.from(`panika-jeevan-sathi seo archive probe ${new Date().toISOString()}`);
      await this.put(key, body, 'text/plain');
      const readBack = await this.get(key);
      await this.remove(key);
      return Boolean(readBack && readBack.equals(body));
    },

    stats() {
      return { requests: requestCount, lastError: lastError ? lastError.message : null };
    }
  };
}

module.exports = {
  DEFAULTS,
  S3Error,
  configFromEnv,
  envStatus,
  createClient
};
