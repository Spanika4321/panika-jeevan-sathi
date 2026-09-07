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
 * SITE_URL is now `sync: false` in both blueprints (dashboard-owned, never
 * overwritten by a sync). This module is the second half of that fix: at boot
 * it compares the configured SITE_URL with the URL the host itself reports
 * (RENDER_EXTERNAL_URL on Render) and, when they disagree, prints a loud,
 * actionable warning instead of letting the site advertise a dead origin.
 *
 * An explicitly configured SITE_URL always wins (it may be a real custom
 * domain the platform does not know about); the warning only asks a human to
 * confirm. When SITE_URL is unset on a host that provides its own URL, we use
 * that URL rather than serving empty absolute links.
 *
 * Pure function: reads only the env object it is given, so tests cover every
 * branch without a server or network.
 */

/** Trim a trailing slash (and whitespace) from a configured origin. */
function normalizeOrigin(raw) {
  return String(raw || '').trim().replace(/\/+$/, '');
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

  // Host knows where it is reachable (Render sets this on every boot) but the
  // operator pinned a different origin. Respect the pin — custom domains live
  // here — but make the disagreement impossible to miss in the deploy log.
  if (configured && hostProvided && configured !== hostProvided) {
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

module.exports = { resolveSiteUrl, normalizeOrigin };
