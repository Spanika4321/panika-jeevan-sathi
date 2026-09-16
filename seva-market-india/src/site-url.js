'use strict';
/**
 * SEVA MARKET INDIA — canonical site URL guard.
 *
 * The failure mode this guards against:
 *
 *   1. The blueprint used to pin SITE_URL to seva-market-india.onrender.com.
 *   2. That name was taken, so Render gave the service a suffixed URL
 *      (seva-market-india-tast.onrender.com).
 *   3. Canonical links, sitemap entries and absolute URLs then pointed at the
 *      wrong host — and because the value was committed, every blueprint sync
 *      reverted the dashboard fix back to the file's stale value.
 *
 * SITE_URL is `sync: false` in both blueprints (dashboard-owned, never
 * overwritten by a sync). A warning in the deploy log turned out not to be
 * enough on its own: the stale pin survived for days and the live site kept
 * advertising a sitemap, canonical links and JSON-LD for a host that does not
 * serve it, which is exactly what makes Google drop every page.
 *
 * So this module now distinguishes two kinds of disagreement:
 *
 *   • SITE_URL is a Render free hostname (*.onrender.com) and the host reports
 *     a *different* Render free hostname. Only one of them can be this
 *     instance, and it is the one the host reports — a free hostname cannot be
 *     a custom domain parked elsewhere. The host URL wins, loudly.
 *
 *   • SITE_URL is anything else (a real custom domain, a different origin on
 *     purpose). The explicit pin wins, because only the operator knows about a
 *     domain the platform has never seen; the warning asks a human to confirm.
 *
 * Set SEVA_TRUST_SITE_URL=1 to restore "the pin always wins" while debugging
 * a hostname change.
 *
 * Pure function: reads only the env object it is given, so tests cover every
 * branch without a server or network.
 */

/** Trim a trailing slash (and whitespace) from a configured origin. */
function normalizeOrigin(raw) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

/** True for a Render-generated free hostname (never a custom domain). */
function isRenderFreeHost(origin) {
  try {
    return new URL(origin).hostname.endsWith('.onrender.com');
  } catch (_) {
    return false;
  }
}

/** True for `1/true/yes/on`, matching src/store/guard.js flag(). */
function flag(env, name) {
  const raw = String(env[name] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Resolve the canonical site origin from the environment.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ url: string, warnings: string[] }}
 */
function resolveSiteUrl(env = process.env) {
  const configured = normalizeOrigin(env.SITE_URL);
  const hostProvided = normalizeOrigin(env.RENDER_EXTERNAL_URL);
  const warnings = [];

  if (configured && hostProvided && configured !== hostProvided) {
    // Two Render free hostnames that disagree: the host knows where this
    // instance is actually reachable, so the stale pin is simply wrong.
    if (isRenderFreeHost(configured) && isRenderFreeHost(hostProvided) && !flag(env, 'SEVA_TRUST_SITE_URL')) {
      warnings.push(
        `SITE_URL is "${configured}" but this instance is served at "${hostProvided}". `
        + `Both are Render-generated hostnames, and only one can be this service, so the `
        + `host-provided origin is used for canonical links, robots.txt, sitemap.xml and `
        + `JSON-LD. Set Settings -> Environment -> SITE_URL to "${hostProvided}" to silence `
        + `this (the blueprint does not pin SITE_URL, so the dashboard value survives a `
        + `sync). SEVA_TRUST_SITE_URL=1 keeps the pinned value instead.`,
      );
      return { url: hostProvided, warnings };
    }

    // A custom domain (or any deliberate pin) is respected: the platform does
    // not know about it, the operator does.
    warnings.push(
      `SITE_URL is "${configured}" but this instance is served at `
      + `"${hostProvided}". Canonical/absolute links point at SITE_URL. If that `
      + `is not a real custom domain, set Settings -> Environment -> SITE_URL to `
      + `"${hostProvided}". The blueprint no longer pins SITE_URL (sync: false), `
      + `so a dashboard fix survives every blueprint sync.`,
    );
  }

  // No pin at all on a host that tells us its URL: use it so absolute links
  // still work, and say so — an empty SITE_URL would silently produce links
  // pointing at "/".
  if (!configured && hostProvided) {
    warnings.push(
      `SITE_URL is not set; using the host-provided origin "${hostProvided}". `
      + `Set SITE_URL in the dashboard (Settings -> Environment) to pin the `
      + `canonical origin explicitly.`,
    );
    return { url: hostProvided, warnings };
  }

  return { url: configured, warnings };
}

module.exports = { resolveSiteUrl, normalizeOrigin, isRenderFreeHost };
