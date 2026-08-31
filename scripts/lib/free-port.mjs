/**
 * PANIKA JEEVAN SATHI — free port probe
 * =====================================
 *
 * Problem jo isne solve kiya:
 *   e2e-test, e2e-cloud-test aur health-check teenon apna port
 *   `BASE + Math.random()` se chunte the. Ranges overlap karti thin
 *   (3000-3399, 3500-3899, 4000-4899) aur sandbox/CI mein doosre servers
 *   (preview 3000, purana leaked test server) pehle se sun rahe hote the.
 *   Natija: kabhi-kabhi EADDRINUSE → poora suite red, bina kisi asli bug ke.
 *
 * Fix: port guess karna band. OS se poochho.
 *   - `freePort()` ek port 0 par listen karke OS ka diya hua ephemeral port
 *     leta hai, socket band karta hai aur wo number return karta hai.
 *   - Phir `isFree()` se dobara confirm karta hai (race window chhota rakhne
 *     ke liye), aur milne tak N baar retry karta hai.
 *   - Kuch bhi na mile to saaf error: "no free TCP port found …" — chupchaap
 *     random port par crash nahi.
 *
 * Note: 100% race-free port reservation possible hi nahi hai (server ko hum
 * khud baad mein bind karte hain), isliye `listenOnFreePort()` bhi diya hai —
 * wo EADDRINUSE aane par apne aap agla port try karta hai.
 */

import net from 'node:net';

/** Ek ephemeral port maango jo abhi khaali hai. */
export function probePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen({ port: 0, host: '127.0.0.1' }, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Kya `port` abhi bind ho sakta hai? */
export function isFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => resolve(false));
    srv.listen({ port, host: '127.0.0.1' }, () => srv.close(() => resolve(true)));
  });
}

/**
 * Ek free TCP port do. Guess nahi — OS se liya hua.
 * @param {{attempts?: number, avoid?: number[]}} [opts]
 */
export async function freePort(opts = {}) {
  const attempts = opts.attempts ?? 10;
  const avoid = new Set(opts.avoid || []);
  const tried = [];
  for (let i = 0; i < attempts; i += 1) {
    let port;
    try {
      port = await probePort();
    } catch (err) {
      throw new Error(`free-port: OS ne port dene se mana kar diya (${err.code || err.message})`);
    }
    tried.push(port);
    if (avoid.has(port)) continue;
    if (await isFree(port)) return port;
  }
  throw new Error(
    `free-port: no free TCP port found after ${attempts} attempts (tried ${tried.join(', ')}). ` +
    `Ye asli environment problem hai — koi process saare ephemeral ports le raha hai.`
  );
}

/**
 * Callback ko free port dekar chalao; EADDRINUSE aaye to agla port lo.
 * `start(port)` ko ek Promise return karna chahiye jo bind hone par resolve ho.
 */
export async function withFreePort(start, opts = {}) {
  const attempts = opts.attempts ?? 5;
  const avoid = [];
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    const port = await freePort({ avoid });
    try {
      const result = await start(port);
      return { port, result };
    } catch (err) {
      if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
        avoid.push(port);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`free-port: ${attempts} attempts ke baad bhi bind nahi ho paya (${lastErr && lastErr.code})`);
}

export default freePort;
