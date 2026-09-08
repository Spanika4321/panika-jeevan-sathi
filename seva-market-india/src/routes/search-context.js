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

  // A place name ("guwahati") wins over a state slug ("assam") when both
  // are present; either resolves to a locations row.
  const place = cleanText(params.get('place'), 80);
  const stateSlug = place ? null : cleanText(params.get('state'), 80);
  let location = null;
  if (place) {
    const matches = locationModel.search(db, place, { limit: 1 });
    location = matches.length ? matches[0] : null;
  } else if (stateSlug) {
    location = locationModel.findBySlug(db, 'state', stateSlug);
  }

  // A service hangs off its locality row. When the filter names a state,
  // district or city, expand to every descendant so the whole area matches.
  const locationId = location ? location.id : null;
  const locationIds = locationId
    ? (location.kind === 'locality' || location.kind === 'pincode'
      ? [locationId]
      : locationModel.descendantIds(db, locationId))
    : null;

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
    stateSlug,
    location,
    locationId,
    locationIds,
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
  if (filters.category) parts.push(filters.category.name);
  if (filters.location) parts.push(`in ${filters.location.name}`);
  if (filters.pin) parts.push(`near ${filters.pin}`);
  if (!parts.length && filters.query) parts.push(`"${filters.query}"`);
  if (!parts.length) return 'All services across India';
  return parts.join(' ');
}

module.exports = { resolveSearchFilters, describeFilters, validators };
