'use strict';
/**
 * PANIKA JEEVAN SATHI — Cloudflare R2 client (S3-compatible, AWS SigV4).
 *
 * Render's Free plan has no persistent disk, so uploaded photos cannot live on
 * the instance filesystem. R2's free tier (10 GB/month, no egress fees) holds
 * them instead.
 *
 * Zero dependencies: signatures are computed with node:crypto and requests go
 * out through Node 22's global fetch.
 *
 * Endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com   (region: "auto")
 * Docs: https://developers.cloudflare.com/r2/api/s3/api/
 */

const crypto = require('node:crypto');

const DEFAULTS = {
  region: 'auto',
  service: 's3',
  timeoutMs: 30000,
  maxRetries: 3,
  retryBaseMs: 250,
  maxRetryDelayMs: 6000
};

class R2Error extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'R2Error';
    Object.assign(this, extra);
  }
}

function configFromEnv(env = process.env) {
  const accountId = String(env.R2_ACCOUNT_ID || env.CF_ACCOUNT_ID || '').trim();
  const bucket = String(env.R2_BUCKET || '').trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '').trim();
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  const endpoint = String(
    env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`
  ).replace(/\/+$/, '');
  return {
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    region: String(env.R2_REGION || DEFAULTS.region),
    prefix: String(env.R2_PREFIX || 'uploads').replace(/^\/+|\/+$/g, '')
  };
}

/* -------------------------------------------------------------- signing */

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/** RFC 3986 URI encoding, which is what AWS SigV4 expects. */
function uriEncode(value, encodeSlash = true) {
  const encoded = encodeURIComponent(String(value));
  return encoded.replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  ).replace(/%2F/g, encodeSlash ? '%2F' : '/');
}

function canonicalUri(pathname) {
  return String(pathname)
    .split('/')
    .map((segment) => {
      // `new URL()` already percent-encodes the path, so decode first to avoid
      // double-encoding ("/ሴ" must stay "/%E1%88%B4", not become "/%25E1%2588%25B4").
      let raw = segment;
      try {
        raw = decodeURIComponent(segment);
      } catch (_) {
        raw = segment; // a stray "%" is not a valid escape — keep it literal
      }
      return uriEncode(raw, false);
    })
    .join('/');
}

function amzDates(now = new Date()) {
  const iso = now.toISOString().replace(/[-:]/g, '');
  return {
    amzDate: iso.slice(0, 15) + 'Z', // YYYYMMDDTHHMMSSZ
    dateStamp: iso.slice(0, 8) // YYYYMMDD
  };
}

/**
 * Build the AWS Signature Version 4 `Authorization` header.
 *
 * Verified against the canonical AWS "GET Object" test vector:
 *   signature f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41
 * (see scripts/test-sigv4.mjs)
 */
function signRequest({
  method,
  url,
  headers = {},
  payloadHash,
  accessKeyId,
  secretAccessKey,
  region,
  service,
  now = new Date(),
  // S3 and R2 always require x-amz-content-sha256; the AWS conformance suite
  // has cases without it, so the header can be switched off for testing.
  contentShaHeader = true
}) {
  const target = new URL(url);

  const allHeaders = Object.assign({}, headers, { host: target.host });
  if (contentShaHeader) allHeaders['x-amz-content-sha256'] = payloadHash;
  if (!Object.keys(allHeaders).some((k) => k.toLowerCase() === 'x-amz-date')) {
    allHeaders['x-amz-date'] = amzDates(now).amzDate;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(allHeaders)) {
    if (value === undefined || value === null) continue;
    const name = String(key).toLowerCase();
    const text = String(value).trim().replace(/\s+/g, ' ');
    // Duplicate header names are combined with a comma (AWS requirement).
    normalized[name] = normalized[name] ? `${normalized[name]},${text}` : text;
  }

  // The date in the credential scope must be the same one sent in x-amz-date.
  const headerDate = normalized['x-amz-date'] || amzDates(now).amzDate;
  const dateStamp = headerDate.slice(0, 8);

  const signedHeaderNames = Object.keys(normalized).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${normalized[name]}\n`)
    .join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalQuery = [...target.searchParams.entries()]
    .map(([key, value]) => [uriEncode(key), uriEncode(value)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(target.pathname),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    headerDate,
    scope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf8'))
  ].join('\n');

  let key = hmac(Buffer.from(`AWS4${secretAccessKey}`, 'utf8'), dateStamp);
  key = hmac(key, region);
  key = hmac(key, service);
  key = hmac(key, 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(stringToSign).digest('hex');

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    headers: Object.assign({}, normalized, {
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    }),
    amzDate: headerDate,
    signedHeaders,
    signature,
    canonicalRequest,
    stringToSign,
    scope
  };
}

/* -------------------------------------------------------------- helpers */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseXmlError(text) {
  const code = /<Code>([^<]*)<\/Code>/.exec(text);
  const message = /<Message>([^<]*)<\/Message>/.exec(text);
  if (!code && !message) return text.slice(0, 300);
  return `${code ? code[1] : ''}${message ? `: ${message[1]}` : ''}`.trim();
}

function createClient(config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = options.log || (() => {});
  const limits = Object.assign({}, DEFAULTS, options.limits || {});
  const base = `${config.endpoint}/${config.bucket}`;
  let lastError = null;
  let requestCount = 0;

  function objectUrl(key, query) {
    const path = [config.prefix, key].filter(Boolean).map((part) => String(part).split('/').map((s) => uriEncode(s, false)).join('/')).join('/');
    const search = query
      ? '?' +
        Object.entries(query)
          .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
          .join('&')
      : '';
    return `${base}/${path}${search}`;
  }

  async function request(method, url, { body = null, contentType = '', query = {} } = {}) {
    const payload = body === null ? Buffer.alloc(0) : body;
    const payloadHash = sha256Hex(payload);
    const headers = {};
    if (contentType) headers['content-type'] = contentType;

    const signed = signRequest({
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
            new R2Error(`R2 ${method} HTTP ${res.status}: ${parseXmlError(text)}`, {
              status: res.status
            }),
            { retryable: true }
          );
        }

        const buffer = Buffer.from(await res.arrayBuffer());

        if (!res.ok) {
          throw Object.assign(
            new R2Error(`R2 ${method} HTTP ${res.status}: ${parseXmlError(buffer.toString('utf8'))}`, {
              status: res.status
            }),
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
        log(`[r2] ${err.message} — retrying in ${delay} ms`);
        await sleep(delay);
        attempt += 1;
      }
    }
  }

  return {
    kind: 'r2',

    /** Upload (or replace) an object. */
    async put(key, data, contentType = 'application/octet-stream') {
      const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const { res } = await request('PUT', objectUrl(key), { body, contentType });
      return { key, size: body.length, etag: res.headers.get('etag') };
    },

    /** Download an object; returns null when it does not exist. */
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
        const { buffer } = await request('GET', objectUrl('', query).replace(/\/$/, ''));
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

    /** Connectivity probe (also proves the bucket is reachable & writable). */
    async ping() {
      const key = `.ping-${Date.now()}`;
      await this.put(key, Buffer.from('pjs'), 'text/plain');
      const value = await this.get(key);
      await this.remove(key);
      return Boolean(value && value.toString('utf8') === 'pjs');
    },

    stats() {
      return { requests: requestCount, lastError: lastError ? lastError.message : null };
    }
  };
}

module.exports = {
  DEFAULTS,
  R2Error,
  configFromEnv,
  createClient,
  signRequest,
  sha256Hex,
  uriEncode,
  amzDates
};
