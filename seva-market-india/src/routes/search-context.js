'use strict';
/**
 * SEVA MARKET INDIA — search filter resolution.
 *
 * Turns raw query strings (?category=plumber&pin=781001&place=guwahati)
 * into the typed filter object the models expect. Shared by the HTML search
 * page and the JSON API so both always agree.
 */

const categoryModel = require('../models/category');
const locationModel = require('../models/location');

/** Query parameters that name a place by hierarchy level, deepest first. */
const PLACE_KINDS = ['locality', 'city', 'district', 'state', 'country'];
const { pagination } = require('../http/request');
const { validators } = require('../http/request');
const { isValidPin, cleanText } = require('../db/values');

/**
 * @param {object} db
 * @param {URLSearchParams} params
 * @param {{defaultSize?: number, maxSize?: number}} [options]
 */
function resolveSearchFilters(db, params, options = {}) {
  const categorySlug = cleanText(params.get('category'), 80);
  const category = categorySlug ? categoryModel.findBySlug(db, categorySlug) : null;
  const categoryIds = category ? categoryModel.selfAndDescendantIds(db, category.id) : null;

  // `?state=assam&city=guwahati` drill the tree; `?place=guwahati` is the
  // fuzzy box on the homepage. The deepest level named wins, because that is
  // the most specific thing the visitor asked for.
  let location = null;
  let placeKind = null;
  let placeRequested = null;
  for (const kind of PLACE_KINDS) {
    const slug = cleanText(params.get(kind), 80);
    if (!slug) continue;
    placeRequested = placeRequested || slug;
    const found = locationModel.findBySlug(db, kind, slug);
    if (found) {
      location = found;
      placeKind = kind;
      break;
    }
  }

  const place = cleanText(params.get('place'), 80);
  if (!location && place) {
    placeRequested = placeRequested || place;
    const matches = locationModel.search(db, place, { limit: 1 });
    location = matches.length ? matches[0] : null;
    placeKind = location ? location.kind : null;
  }

  const rawPin = cleanText(params.get('pin'), 6);
  const pin = rawPin && isValidPin(rawPin) ? rawPin : null;

  const query = cleanText(params.get('q'), 80);
  const paging = pagination(params, options);

  return {
    query,
    categorySlug,
    category,
    categoryIds,
    place,
    placeKind,
    location,
    // A state or district has no providers of its own — they hang off
    // localities and cities. Expanding to descendants would need a recursive
    // walk, so instead the level is passed down and matched by breadcrumb,
    // which every location row already denormalises.
    locationId: location ? location.id : null,
    // A state, district or country has no listings of its own — they hang off
    // localities — so those levels match their whole subtree instead.
    // Cities, districts, states and the country own no listings directly —
    // they hang off localities — so those levels match their whole subtree.
    expandTree: Boolean(location) && ['country', 'state', 'district', 'city'].includes(location.kind),
    // A typed place that resolves to nothing must not quietly become
    // "everything": the caller shows an honest empty state instead.
    placeRequested,
    locationNotFound: Boolean(placeRequested) && !location,
    pin,
    pinValid: rawPin ? Boolean(pin) : true,
    ...paging,
  };
}

/**
 * Describe the active filters in plain words, for the results heading and
 * the SEO <title>: "Plumber in Guwahati near 781001".
 */
function describeFilters(filters) {
  const parts = [];
  if (filters.locationNotFound && filters.placeRequested) parts.push(`in ${filters.placeRequested}`);
  if (filters.category) parts.push(filters.category.name);
  if (filters.location) {
    // "near" for a PIN code, "in" for anything with borders.
    const preposition = filters.location.kind === 'pincode' ? 'near' : 'in';
    parts.push(`${preposition} ${filters.location.name}`);
  }
  if (filters.pin) parts.push(`near ${filters.pin}`);
  if (!parts.length && filters.query) parts.push(`"${filters.query}"`);
  if (!parts.length) return 'All services across India';
  return parts.join(' ');
}

module.exports = { resolveSearchFilters, describeFilters, validators };
