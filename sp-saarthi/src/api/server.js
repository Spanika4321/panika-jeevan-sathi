'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleRoutes } = require('./routes');
const { Logger } = require('../engine/logger');
const { saarthi } = require('../master/saarthi');

const logger = new Logger('API-SERVER');

const PUBLIC_DIR = path.join(__dirname, '../../dashboard/public');
const PORT = process.env.SAARTHI_PORT ? parseInt(process.env.SAARTHI_PORT, 10) : 3100;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendFile(res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}

function resolveStatic(pathname) {
  let clean = decodeURIComponent(pathname);
  if (clean === '/' || clean === '') clean = '/index.html';
  const target = path.normalize(path.join(PUBLIC_DIR, clean));
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) return null;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) return path.join(target, 'index.html');
  return target;
}

const server = http.createServer((req, res) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // API routes first
  handleRoutes(req, res, url).then(handled => {
    if (handled) return;

    // Static dashboard
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    const target = resolveStatic(url.pathname);
    if (!target) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // If file doesn't exist and it's not API, serve index.html for SPA
    if (!fs.existsSync(target) && !url.pathname.startsWith('/api/')) {
      const index = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(index)) {
        sendFile(res, index);
        return;
      }
    }

    sendFile(res, target);
  }).catch(err => {
    logger.error(`Request error: ${err.message}`, { stack: err.stack });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
    }
  });
});

function start() {
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║        SP SAARTHI CONTROL PANEL          ║');
    console.log('  ║        Master Agent System v1.0          ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
    console.log(`  Dashboard : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${server.address().port}`);
    console.log(`  API       : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${server.address().port}/api/status`);
    console.log(`  Safe Mode : ${require('../engine/safe-mode').safeMode.isEnabled() ? 'ON (Protected)' : 'OFF (Unsafe)'}`);
    console.log(`  Agents    : SAARTHI, RAKSHAK, NIYOJAK, SAMANVAYAK, VIKAS`);
    console.log('');
    console.log('  Ready to receive commands...');
    console.log('');
  });
}

if (require.main === module) {
  start();
}

module.exports = { server, start, PORT, HOST };
