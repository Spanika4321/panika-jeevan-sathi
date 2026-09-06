'use strict';
/**
 * SEVA MARKET INDIA — price formatting.
 *
 * One place decides how money is written, so a card, a profile page and the
 * dashboard can never disagree about what "₹299–₹699/visit" means.
 */

const UNITS = { visit: '/visit', hour: '/hour', day: '/day', sqft: '/sq.ft', job: '/job', month: '/month' };

/** ₹ for every rupee amount in India; blank prices read as "on request". */
function priceLabel(service) {
  if (!service) return 'Price on request';
  const hasMin = service.price_min !== null && service.price_min !== undefined;
  const hasMax = service.price_max !== null && service.price_max !== undefined;
  if (!hasMin && !hasMax) return 'Price on request';
  const suffix = UNITS[service.price_unit] || '';
  if (hasMin && hasMax) {
    if (Number(service.price_min) === Number(service.price_max)) return `₹${service.price_min}${suffix}`;
    return `₹${service.price_min}–₹${service.price_max}${suffix}`;
  }
  return `₹${hasMin ? service.price_min : service.price_max}${suffix}`;
}

module.exports = { priceLabel, UNITS };
