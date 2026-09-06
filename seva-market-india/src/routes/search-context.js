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

  const place = cleanText(params.get('place'), 80);
  let location = null;
  if (place) {
    const matches = locationModel.search(db, place, { limit: 1 });
    location = matches.length ? matches[0] : null;
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
    location,
    locationId: location ? location.id : null,
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
