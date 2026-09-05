/**
 * Fixed-window rate limiter.
 *
 * In-process and therefore per-instance: good enough to stop credential
 * stuffing and scraping on a single node. A multi-instance deployment swaps
 * this for a shared store without changing the call sites.
 */
export function createRateLimiter({ windowMs = 60_000, max = 60, now = () => Date.now() } = {}) {
  const hits = new Map();

  return {
    windowMs,
    max,

    /** @returns {{allowed: boolean, remaining: number, retryAfter: number}} */
    check(key, { max: limit = max, windowMs: window = windowMs } = {}) {
      const current = now();
      const bucketStart = Math.floor(current / window) * window;
      const entry = hits.get(key);

      if (!entry || entry.window !== bucketStart) {
        hits.set(key, { window: bucketStart, count: 1 });
        this.sweep(current, window);
        return { allowed: true, remaining: limit - 1, retryAfter: 0 };
      }

      entry.count += 1;
      if (entry.count > limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.max(1, Math.ceil((bucketStart + window - current) / 1000))
        };
      }
      return { allowed: true, remaining: limit - entry.count, retryAfter: 0 };
    },

    sweep(current = now(), window = windowMs) {
      if (hits.size < 5000) return;
      const cutoff = current - window * 2;
      for (const [key, entry] of hits) if (entry.window < cutoff) hits.delete(key);
    },

    reset() {
      hits.clear();
    }
  };
}
