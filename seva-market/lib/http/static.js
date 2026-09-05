/**
 * Static file serving for the mobile-first web app.
 *
 * Rules:
 *   • only GET/HEAD; anything else is 405,
 *   • the resolved path must stay inside public/ (traversal proof),
 *   • hashed-named assets under /assets/ may be cached; HTML must not be, so a
 *     deploy is visible immediately on a phone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { securityHeaders, isSecure } from './security.js';

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
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

export function createStaticHandler({ publicDir, config, log }) {
  const headers = securityHeaders();

  function resolve(pathname) {
    let clean;
    try {
      clean = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (clean.includes('\0')) return null;
    if (clean.endsWith('/')) clean += 'index.html';
    const target = path.normalize(path.join(publicDir, clean));
    if (target !== publicDir && !target.startsWith(publicDir + path.sep)) return null;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) return path.join(target, 'index.html');
    return target;
  }

  function stream(res, filePath, { cache, status = 200, head = false }) {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(status, {
      ...headers,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cache ? 'public, max-age=86400' : 'no-cache'
    });
    if (head || res.req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    return stream.pipe(res);
  }

  function notFound(res, head) {
    const notFoundPath = path.join(publicDir, '404.html');
    if (fs.existsSync(notFoundPath)) return stream(res, notFoundPath, { status: 404, head });
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(head ? undefined : '404 Not Found');
  }

  return async function handleStatic(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD, OPTIONS', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'Method not allowed');
      return;
    }
    const head = req.method === 'HEAD';

    if (url.pathname === '/robots.txt') {
      const origin = config.siteUrl || `${isSecure(req) ? 'https' : 'http'}://${req.headers.host || 'localhost'}`;
      const body = [
        '# SEVA MARKET INDIA',
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        '',
        `Sitemap: ${origin}/sitemap.xml`,
        ''
      ].join('\n');
      res.writeHead(200, { ...headers, 'Content-Type': MIME['.txt'], 'Content-Length': Buffer.byteLength(body) });
      res.end(head ? undefined : body);
      return;
    }

    if (url.pathname === '/sitemap.xml') {
      const origin = config.siteUrl || `${isSecure(req) ? 'https' : 'http'}://${req.headers.host || 'localhost'}`;
      const pages = ['/', '/search.html'];
      const urls = pages
        .map((page) => `  <url>\n    <loc>${origin}${page}</loc>\n  </url>`)
        .join('\n');
      const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
      res.writeHead(200, { ...headers, 'Content-Type': MIME['.xml'], 'Content-Length': Buffer.byteLength(body) });
      res.end(head ? undefined : body);
      return;
    }

    const target = resolve(url.pathname);
    if (!target) {
      res.writeHead(403, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(head ? undefined : 'Forbidden');
      return;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      log?.debug('static 404', { path: url.pathname });
      return notFound(res, head);
    }

    return stream(res, target, { cache: url.pathname.startsWith('/assets/'), head });
  };
}
