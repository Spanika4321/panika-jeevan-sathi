'use strict';
/**
 * PANIKA JEEVAN SATHI — HTTP hardening + delivery layer.
 *
 * One place for the things a professional site is expected to have but that
 * must never touch the approved design:
 *
 *   - gzip compression of text responses (small HTML/CSS/JS, in-memory cache)
 *   - ETag / Last-Modified validators so repeat visits cost 304 Not Modified
 *   - Content-Security-Policy built per response with a nonce, so the inline
 *     <script> blocks that the pages already use stay legal without
 *     'unsafe-inline' being honoured by modern browsers
 *   - HSTS, only when the request actually arrived over HTTPS
 *   - X-Robots-Tag on every member-only page (defence in depth behind noindex)
 *   - Search-engine head tags injected at render time (canonical, Open Graph,
 *     Twitter card, JSON-LD, Google site verification) — the HTML files on disk
 *     and the <body> (the design lock) are never modified
 *
 * Zero npm dependencies, like the rest of the project.
 *
 *   const hard = require('./lib/http-hardening').create({ publicDir });
 *   hard.respondHtml(req, res, '/index.html', { file });
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const COMPRESSIBLE = new Set([
  '.html',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.svg',
  '.xml',
  '.txt',
  '.webmanifest'
]);

const MIN_COMPRESS_BYTES = 860;

/* Pages a crawler must never index (mirrors PRIVATE_PAGES in server.js). */
const NO_ROBOTS_PAGES = new Set([
  'admin.html',
  'seo-center.html',
  'settings.html',
  'dashboard.html',
  'matches.html',
  'messages.html',
  'notifications.html',
  'interests.html',
  'shortlist.html',
  'edit-profile.html',
  'profile.html',
  'search.html',
  'reset-password.html',
  'verify-email.html'
]);

/* Marketing/legal pages that search engines SHOULD index. */
const PUBLIC_META_PAGES = new Set([
  'index.html',
  'about.html',
  'contact.html',
  'login.html',
  'privacy.html',
  'terms.html',
  '404.html'
]);

const SITE_NAME = 'PANIKA JEEVAN SATHI';

/* Per-page search snippet. Falls back to the <meta description> in the file. */
const PAGE_META = {
  'index.html': {
    title: `${SITE_NAME} — 100% Free Matrimonial Service`,
    description:
      'Free matrimonial service for the Panika, Manikpuri, Kabirpanthi and Adivasi communities. Free registration, verified profiles, search, interests and messaging — no fees, ever.',
    type: 'website',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE_NAME,
        description: 'Community matrimonial service — free forever, no locked profiles.',
        areaServed: 'IN',
        knowingLanguage: ['hi', 'en'],
        nonProprietaryName: true
      },
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        inLanguage: 'en',
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: 'https://example.invalid/search.html?q={search_term_string}' },
          'query-input': 'required name=search_term_string'
        }
      }
    ]
  },
  'about.html': {
    title: `About us — ${SITE_NAME}`,
    description:
      'Why PANIKA JEEVAN SATHI exists: a free, community-run matrimonial service for Panika, Manikpuri, Kabirpanthi and Adivasi families, with no charges and no locked profiles.',
    type: 'article',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'AboutPage',
        name: `About ${SITE_NAME}`,
        description: 'Community matrimonial service run on trust: free registration, manual verification, no payments.'
      }
    ]
  },
  'contact.html': {
    title: `Contact — ${SITE_NAME}`,
    description: `Reach the ${SITE_NAME} team for help with registration, profile verification or a reported profile.`,
    type: 'article',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'ContactPage',
        name: `Contact ${SITE_NAME}`
      }
    ]
  },
  'login.html': {
    title: `Login or Register — ${SITE_NAME}`,
    description: `Create your free ${SITE_NAME} profile or log in. Registration costs nothing and never asks for payment details.`,
    type: 'website'
  },
  'privacy.html': {
    title: `Privacy policy — ${SITE_NAME}`,
    description: `What ${SITE_NAME} stores about you, who can see it, and how to have it removed.`,
    type: 'article'
  },
  'terms.html': {
    title: `Terms of use — ${SITE_NAME}`,
    description: `The rules that keep ${SITE_NAME} safe: honest profiles, no harassment, no payment ever.`,
    type: 'article'
  }
};

function firstMatch(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] && m[1].trim()) return decodeEntities(m[1].trim());
  }
  return '';
}

function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeJsonLd(value) {
  // </script> inside JSON would break out of the tag; "<" is enough to neutralise.
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

module.exports = {
  name: 'http-hardening',
  create(options = {}) {
    const publicDir = options.publicDir;
    const log = options.log || (() => {});
    /* path → { mtimeMs, size, etag, raw } */
    const metaCache = new Map();
    /* `${path}:${mtimeMs}` → gzipped buffer */
    const gzipCache = new Map();
    let injectedCount = 0;

    /** mtime/size keyed file metadata, with an ETag that only changes on edit. */
    function stat(filePath) {
      let fresh;
      try {
        const s = fs.statSync(filePath);
        if (!s.isFile()) return null;
        fresh = { mtimeMs: Math.round(s.mtimeMs), size: s.size };
      } catch (_) {
        return null;
      }
      const cached = metaCache.get(filePath);
      if (cached && cached.mtimeMs === fresh.mtimeMs && cached.size === fresh.size) return cached;
      const etag = `W/"${crypto
        .createHash('sha1')
        .update(`${fresh.mtimeMs}:${fresh.size}:${path.basename(filePath)}`)
        .digest('hex')
        .slice(0, 24)}"`;
      const entry = Object.assign({ etag }, fresh);
      metaCache.set(filePath, entry);
      return entry;
    }

    function wantsGzip(req) {
      const ae = String(req.headers['accept-encoding'] || '').toLowerCase();
      return ae.includes('gzip');
    }

    function compressible(ext, size) {
      return COMPRESSIBLE.has(ext) && size >= MIN_COMPRESS_BYTES;
    }

    function gzipFor(filePath, meta) {
      const key = `${filePath}:${meta.mtimeMs}`;
      const hit = gzipCache.get(key);
      if (hit) return hit;
      // Bound the cache: a host restart must not be paid for by memory growth.
      if (gzipCache.size > 200) gzipCache.clear();
      const buf = zlib.gzipSync(fs.readFileSync(filePath), { level: 6 });
      gzipCache.set(key, buf);
      return buf;
    }

    /**
     * Origin the site is officially served from. SITE_URL pins production so
     * canonical/OG never leak a preview or internal hostname to Google.
     */
    function publicOrigin(req) {
      const pinned = process.env.SITE_URL;
      if (pinned && /^https?:\/\//i.test(pinned)) return pinned.replace(/\/+$/, '');
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
      return `${proto}://${String(host).split(',')[0].trim()}`;
    }

    /**
     * HSTS must only be sent when *this connection* is HTTPS. SITE_URL is a
     * canonical-URL setting, not a statement about the transport, and storing
     * HSTS for http://localhost would lock a developer out of their own machine.
     */
    function isHttps(req) {
      const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
      if (forwarded) return forwarded === 'https';
      const forwardedPort = String(req.headers['x-forwarded-port'] || '').trim();
      if (forwardedPort) return forwardedPort === '443';
      return !!(req.socket && req.socket.encrypted);
    }

    /**
     * Security headers. `nonce` is set for HTML documents so the pages' own
     * inline scripts keep working while browsers that understand nonces ignore
     * 'unsafe-inline' entirely (per CSP3).
     */
    function headers(req, { html = false } = {}) {
      const out = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
        'X-Permitted-Cross-Domain-Policies': 'none',
        'Cross-Origin-Opener-Policy': 'same-origin'
      };
      const csp = [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "form-action 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        // wa.me / producthunt are plain links, not subresources.
        "connect-src 'self'",
        "font-src 'self' data:"
      ];
      if (html) {
        const nonce = crypto.randomBytes(16).toString('base64');
        csp.unshift(`script-src 'self' 'nonce-${nonce}' 'unsafe-inline'`);
        out.__nonce = nonce;
      } else {
        csp.unshift("script-src 'self' 'unsafe-inline'");
      }
      out['Content-Security-Policy'] = csp.join('; ');
      if (isHttps(req)) {
        out['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
      }
      return out;
    }

    /**
     * Head tags a professional page is expected to carry. Written into the
     * served HTML only — the file on disk (and therefore the design lock) is
     * untouched, so the same page can be reviewed visually at any time.
     */
    function headInjection(page, origin, nonce) {
      const meta = PAGE_META[page];
      if (!meta) return '';
      const canonical = `${origin}/${page === 'index.html' ? '' : page}`;
      const bits = [];
      bits.push(`<link rel="canonical" href="${escapeAttr(canonical)}">`);
      bits.push(`<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">`);
      bits.push(`<meta property="og:type" content="${escapeAttr(meta.type || 'website')}">`);
      bits.push(`<meta property="og:title" content="${escapeAttr(meta.title)}">`);
      bits.push(`<meta property="og:description" content="${escapeAttr(meta.description)}">`);
      bits.push(`<meta property="og:url" content="${escapeAttr(canonical)}">`);
      bits.push(`<meta property="og:image" content="${escapeAttr(`${origin}/assets/img/logo.svg`)}">`);
      bits.push(`<meta property="og:locale" content="en_IN">`);
      bits.push('<meta name="twitter:card" content="summary">');
      bits.push(`<meta name="twitter:title" content="${escapeAttr(meta.title)}">`);
      bits.push(`<meta name="twitter:description" content="${escapeAttr(meta.description)}">`);
      const verify = process.env.GOOGLE_SITE_VERIFICATION;
      if (verify && /^[A-Za-z0-9_-]{20,200}$/.test(String(verify).trim())) {
        bits.push(`<meta name="google-site-verification" content="${escapeAttr(String(verify).trim())}">`);
      }
      if (meta.jsonLd && meta.jsonLd.length) {
        for (const block of meta.jsonLd) {
          const doc = rewriteJsonLdOrigin(block, origin);
          bits.push(
            `<script type="application/ld+json"${nonce ? ` nonce="${nonce}"` : ''}>${safeJsonLd(doc)}</script>`
          );
        }
      }
      return bits.join('\n');
    }

    /** The WebSite SearchAction template must point at the real origin. */
    function rewriteJsonLdOrigin(block, origin) {
      try {
        const copy = JSON.parse(JSON.stringify(block));
        const tpl = copy && copy.potentialAction && copy.potentialAction.target;
        if (tpl && typeof tpl.urlTemplate === 'string') {
          tpl.urlTemplate = `${origin}/search.html?q={search_term_string}`;
        }
        if (copy['@type'] === 'Organization') copy.url = origin + '/';
        if (copy['@type'] === 'WebSite') copy.url = origin + '/';
        return copy;
      } catch (_) {
        return block;
      }
    }

    /** Nonce every inline <script> so a strict CSP does not kill the page. */
    function applyNonces(html, nonce) {
      return html.replace(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)(?![^>]*\bnonce=)([^>]*)>/gi, (full, attrs) =>
        `<script nonce="${nonce}"${attrs}>`
      );
    }

    /**
     * Serve a static file with compression + validators + (for HTML) the
     * injected head tags. Returns true when the response was written.
     */
    function respond(req, res, filePath, { cache = false, htmlPage = null, status = 200 } = {}) {
      const meta = stat(filePath);
      if (!meta) return false;
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      const isHtml = ext === '.html';

      const base = headers(req, { html: isHtml });
      const nonce = base.__nonce;
      delete base.__nonce;

      const etag = meta.etag;
      if (status === 200 && String(req.headers['if-none-match'] || '').includes(etag)) {
        res.writeHead(304, Object.assign({ ETag: etag }, base));
        res.end();
        return true;
      }

      const headersOut = Object.assign({}, base, {
        ETag: etag,
        'Last-Modified': new Date(meta.mtimeMs).toUTCString(),
        'Cache-Control': cache ? 'public, max-age=86400, stale-while-revalidate=604800' : 'no-cache',
        Vary: 'Accept-Encoding'
      });
      const pageName = path.basename(filePath);
      if (NO_ROBOTS_PAGES.has(pageName)) headersOut['X-Robots-Tag'] = 'noindex, nofollow, noarchive';

      let body = null;
      if (isHtml && htmlPage !== false) {
        let text = fs.readFileSync(filePath, 'utf8');
        const inject = headInjection(pageName, publicOrigin(req), nonce);
        if (inject && text.includes('</head>')) {
          text = text.replace('</head>', `${inject}\n</head>`);
          injectedCount += 1;
        }
        if (nonce) text = applyNonces(text, nonce);
        body = Buffer.from(text, 'utf8');
        if (body.length >= MIN_COMPRESS_BYTES && wantsGzip(req)) {
          headersOut['Content-Encoding'] = 'gzip';
          body = zlib.gzipSync(body, { level: 6 });
          headersOut['Content-Length'] = body.length;
        } else {
          headersOut['Content-Length'] = body.length;
        }
        res.writeHead(status, headersOut);
        res.end(req.method === 'HEAD' ? undefined : body);
        return true;
      }

      // Static assets: gzip from the in-memory cache, otherwise stream.
      if (compressible(ext, meta.size) && wantsGzip(req)) {
        const gz = gzipFor(filePath, meta);
        headersOut['Content-Encoding'] = 'gzip';
        headersOut['Content-Length'] = gz.length;
        res.writeHead(status, headersOut);
        res.end(req.method === 'HEAD' ? undefined : gz);
        return true;
      }

      headersOut['Content-Length'] = meta.size;
      res.writeHead(status, headersOut);
      if (req.method === 'HEAD') {
        res.end();
        return true;
      }
      fs.createReadStream(filePath).pipe(res);
      return true;
    }

    /**
     * Patches a response so that anything written through writeHead/end gets
     * the security headers and, when it is JSON/text and big enough, gzip.
     * Used for the API, which builds its own bodies and never streams files.
     */
    function wrap(req, res) {
      const policy = headers(req);
      const originalWriteHead = res.writeHead.bind(res);
      const originalEnd = res.end.bind(res);
      let status = 200;
      let head = null;

      res.writeHead = function writeHead(statusCode, headersArg) {
        status = statusCode;
        const given = headersArg && typeof headersArg === 'object' ? headersArg : {};
        head = Object.assign({}, policy, given);
        return res;
      };

      res.end = function end(chunk) {
        const body =
          chunk === undefined || chunk === null
            ? null
            : Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(String(chunk), 'utf8');
        const out = head || Object.assign({}, policy, safeGetHeaders(res));
        const type = String(out['Content-Type'] || 'application/octet-stream');
        const textish = /json|text\/|javascript|xml/i.test(type);
        if (body && textish && body.length >= MIN_COMPRESS_BYTES && wantsGzip(req) && !out['Content-Encoding']) {
          try {
            const gz = zlib.gzipSync(body, { level: 5 });
            if (gz.length < body.length) {
              out['Content-Encoding'] = 'gzip';
              out['Content-Length'] = gz.length;
              out.Vary = 'Accept-Encoding';
              return originalWriteHead(status, out), originalEnd(gz);
            }
          } catch (_) {
            /* compression is optional; the plain body always works */
          }
        }
        if (body) out['Content-Length'] = body.length;
        out.Vary = out.Vary || 'Accept-Encoding';
        return originalWriteHead(status, out), originalEnd(body);
      };

      return res;
    }

    function safeGetHeaders(res) {
      try {
        return typeof res.getHeaders === 'function' ? res.getHeaders() : {};
      } catch (_) {
        return {};
      }
    }

    /**
     * The 404 document, served with the same headers as everything else so a
     * missing page still gets its security policy and its branded look.
     */
    function respondNotFound(req, res) {
      const notFound = path.join(publicDir, '404.html');
      if (fs.existsSync(notFound)) {
        respond(req, res, notFound, { status: 404 });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    }

    /** Compressed JSON for API-shaped responses that go through this layer. */
    function respondJson(req, res, status, payload, extra = {}) {
      const text = JSON.stringify(payload);
      const buf = Buffer.from(text, 'utf8');
      const h = Object.assign({}, headers(req), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        Vary: 'Accept-Encoding'
      }, extra);
      if (buf.length >= MIN_COMPRESS_BYTES && wantsGzip(req)) {
        const gz = zlib.gzipSync(buf, { level: 5 });
        h['Content-Encoding'] = 'gzip';
        h['Content-Length'] = gz.length;
        res.writeHead(status, h);
        res.end(gz);
        return;
      }
      h['Content-Length'] = buf.length;
      res.writeHead(status, h);
      res.end(buf);
    }

    const MIME = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
      '.webmanifest': 'application/manifest+json',
      '.txt': 'text/plain; charset=utf-8',
      '.xml': 'application/xml; charset=utf-8',
      '.woff2': 'font/woff2'
    };

    return {
      respond,
      respondNotFound,
      wrap,
      respondJson,
      headers,
      publicOrigin,
      isHttps,
      pageMeta: PAGE_META,
      cacheStats() {
        return { files: metaCache.size, gzipped: gzipCache.size, htmlInjections: injectedCount, publicDir };
      },
      warm() {
        if (!publicDir || !fs.existsSync(publicDir)) return 0;
        let n = 0;
        for (const f of fs.readdirSync(publicDir)) {
          if (!f.endsWith('.html')) continue;
          const p = path.join(publicDir, f);
          if (COMPRESSIBLE.has(path.extname(p))) {
            gzipFor(p, stat(p));
            n += 1;
          }
        }
        log(`[delivery] pre-compressed ${n} pages (gzip)`);
        return n;
      }
    };
  }
};
