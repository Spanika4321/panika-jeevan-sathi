'use strict';
/** API: geography tree — India -> State -> District -> City -> Locality -> PIN. */

const { HttpError } = require('../../http/respond');
const locationModel = require('../../models/location');
const { validators } = require('../../http/request');
const { LOCATION_KINDS } = require('../../db/values');

function register(router, { db }) {
  /**
   * GET /api/v1/locations
   *   ?pin=781001            resolve one PIN to its full chain
   *   &q=guwahati            free-text search over breadcrumbs
   *   &parent=1&kind=city    children of a node
   *   (no params)            India + its states
   */
  router.get('/api/v1/locations', ({ query }) => {
    const pin = query.get('pin');
    if (pin) {
      const found = locationModel.findByPin(db, pin);
      if (!found) throw HttpError.notFound(`No location matches PIN code ${pin}.`);
      return {
        pin: found.node.pin_code,
        chain: found.chain.map((node) => ({ id: node.id, kind: node.kind, name: node.name, slug: node.slug })),
        label: found.chain.map((node) => node.name).reverse().join(', '),
      };
    }

    const q = query.get('q');
    if (q) {
      const kind = query.get('kind');
      if (kind && !LOCATION_KINDS.includes(kind)) {
        throw HttpError.badRequest(`kind must be one of: ${LOCATION_KINDS.join(', ')}.`);
      }
      const items = locationModel.search(db, q, { kind: kind || null, limit: 25 });
      return { items, total: items.length };
    }

    const parent = query.get('parent');
    if (parent !== null && parent !== '') {
      const parentId = validators.int(parent, { field: 'parent', min: 1 });
      const kind = query.get('kind');
      const items = locationModel.findChildren(db, parentId, LOCATION_KINDS.includes(kind) ? kind : null);
      return { items, total: items.length };
    }

    const roots = locationModel.findChildren(db, null);
    const india = roots.find((row) => row.kind === 'country') || null;
    const states = india ? locationModel.findChildren(db, india.id, 'state') : [];
    return { country: india, items: states, total: states.length };
  });

  /** GET /api/v1/locations/stats — counts per level. */
  router.get('/api/v1/locations/stats', () => locationModel.stats(db));

  /** GET /api/v1/locations/:id — one node with breadcrumb + children. */
  router.get('/api/v1/locations/:id', ({ params }) => {
    const id = validators.int(params.id, { field: 'id', min: 1 });
    const chain = locationModel.chainFor(db, id);
    if (!chain.length) throw HttpError.notFound(`Location ${id} not found.`);
    const node = chain[chain.length - 1];
    return {
      ...node,
      is_active: Boolean(node.is_active),
      breadcrumb: chain.map((row) => ({ id: row.id, kind: row.kind, name: row.name })),
      children: locationModel.findChildren(db, id),
    };
  });
}

module.exports = { register };
