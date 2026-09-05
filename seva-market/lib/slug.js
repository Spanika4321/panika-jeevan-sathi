/**
 * URL-safe slugs for categories, services, providers and places.
 *
 * Slugs are the public identity of a record in search-engine friendly URLs
 * ( /providers/sharma-plumbing-delhi ), so they must be stable, lowercase and
 * ASCII. Non-Latin scripts are transliterated to nothing on purpose: an
 * explicit English slug can always be supplied by an editor later.
 */

const MAX_SLUG_LENGTH = 80;

export function slugify(input, fallback = '') {
  const text = String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop combining marks
    .toLowerCase();

  const slug = text
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  if (slug) return slug;
  // Guard the recursion: an empty fallback must not call us again forever.
  return fallback ? slugify(fallback) : 'item';
}

/**
 * Build a slug that is not yet taken.
 * `isTaken(candidate)` must return a boolean (or a promise of one).
 */
export async function uniqueSlug(value, isTaken, { fallback = 'item' } = {}) {
  const base = slugify(value, fallback);
  if (!(await isTaken(base))) return base;
  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const candidate = `${base}-${suffix}`.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, MAX_SLUG_LENGTH);
}

export function isSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value ?? ''));
}
