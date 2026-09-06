'use strict';
/**
 * SEVA MARKET INDIA — provider dashboard actions.
 *
 * Everything here is *ownership-scoped*: each function resolves the caller's
 * listing first and then filters every query by `provider_id`. A dashboard
 * mutation that trusts a client-supplied provider id is how one business ends
 * up editing another one's prices.
 */

const { HttpError } = require('../http/respond');
const users = require('../models/user');
const providers = require('../models/provider');
const services = require('../models/service');
const leads = require('../models/lead');
const locations = require('../models/location');
const verification = require('../models/verification');
const categoryModel = require('../models/category');
const auth = require('../models/auth');
const { cleanText, isValidPin, normalizePhone } = require('../db/values');

/**
 * The listing the signed-in user manages. Admins may pass `asProviderId` to
 * act on someone's behalf, which is also what the admin panel uses.
 */
function ownedProvider(db, user, { asProviderId = null, allowSuspended = true } = {}) {
  if (!user) throw new HttpError(401, 'Sign in to manage your listing.');
  let provider = null;
  if (asProviderId && user.role === 'admin') {
    provider = db.get('SELECT * FROM providers WHERE id = ?', [Number(asProviderId)]);
  } else {
    provider = db.get('SELECT * FROM providers WHERE user_id = ? ORDER BY status = \'active\' DESC, id DESC LIMIT 1', [user.id]);
  }
  if (!provider) throw new HttpError(404, 'You do not have a listing yet. Add your business first.');
  if (!allowSuspended && provider.status === 'suspended') throw new HttpError(403, 'This listing is suspended. Contact support.');
  return provider;
}

/** Categories for the pickers: flat list, children labelled by parent. */
function categoryOptions(db) {
  return categoryModel.tree(db).flatMap((parent) => [
    { id: parent.id, label: parent.name, level: 0 },
    ...parent.children.map((child) => ({ id: child.id, label: `${parent.name} · ${child.name}`, level: 1 })),
  ]);
}

/* ------------------------------------------------------------ profile */

function saveProfile(db, config, { user, body, asProviderId = null } = {}) {
  const provider = ownedProvider(db, user, { asProviderId });
  const errors = {};
  const patch = {};

  if (body.business_name !== undefined) patch.business_name = cleanText(body.business_name, 140) || undefined;
  if (body.contact_name !== undefined) patch.contact_name = body.contact_name;
  if (body.phone !== undefined) {
    if (!normalizePhone(body.phone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';
    else patch.phone = body.phone;
  }
  if (body.alt_phone !== undefined) patch.alt_phone = body.alt_phone;
  if (body.email !== undefined) patch.email = body.email;
  if (body.address_line !== undefined) patch.address_line = body.address_line;
  if (body.about !== undefined) patch.about = body.about;
  if (body.experience_years !== undefined) patch.experience_years = body.experience_years;
  if (body.website !== undefined) patch.website = body.website;
  if (body.gst_number !== undefined) {
    const gst = providers.cleanGst(body.gst_number);
    if (body.gst_number && !gst) errors.gst_number = 'A GSTIN is 15 characters, e.g. 22AAAAA0000A1Z5.';
    else patch.gst_number = gst;
  }
  if (body.category_id !== undefined) patch.category_id = body.category_id;
  const pin = cleanText(body.pin_code ?? body.pin, 6);
  if (pin) {
    if (!isValidPin(pin)) errors.pin_code = 'PIN code must be 6 digits.';
    else {
      const place = providersPinLocation(db, pin);
      if (place) {
        patch.location_id = place.id;
        patch.pin_code = pin;
      } else {
        patch.pin_code = pin;
      }
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const updated = providers.updateProvider(db, provider.id, patch);
  auth.audit(db, { actor: `user:${user.id}`, action: 'provider.profile_update', entity: 'provider', entityId: provider.id, detail: Object.keys(patch).join(',') });
  return { ok: true, provider: updated, stats: providers.statsFor(db, provider.id) };
}

function providersPinLocation(db, pin) {
  const found = locations.findByPin(db, pin);
  if (!found) return null;
  return found.chain.find((node) => node.kind === 'locality') || found.node;
}

/* ------------------------------------------------------------ services */

function saveService(db, config, { user, body, serviceId = null, asProviderId = null, publish = null } = {}) {
  const provider = ownedProvider(db, user, { asProviderId });
  const errors = {};
  const title = cleanText(body.title, 140);
  if (!title) errors.title = 'Give the service a clear name, e.g. "Bathroom fitting".';

  const priceMin = body.price_min === '' || body.price_min === undefined ? null : Number(body.price_min);
  const priceMax = body.price_max === '' || body.price_max === undefined ? null : Number(body.price_max);
  if (priceMin !== null && (!Number.isFinite(priceMin) || priceMin < 0)) errors.price_min = 'Enter a number in rupees, or leave it blank.';
  if (priceMax !== null && (!Number.isFinite(priceMax) || priceMax < 0)) errors.price_max = 'Enter a number in rupees, or leave it blank.';
  if (priceMin !== null && priceMax !== null && priceMax < priceMin) errors.price_max = 'The maximum price cannot be below the minimum.';
  if (Object.keys(errors).length) return { ok: false, errors };

  const categoryId = Number(body.category_id) || provider.category_id;
  const locationId = Number(body.location_id) || provider.location_id;
  const pin = cleanText(body.pin_code, 6) || provider.pin_code || null;
  if (pin && !isValidPin(pin)) return { ok: false, errors: { pin_code: 'PIN code must be 6 digits.' } };

  const status = publish === null
    ? (body.status && services.STATUSES.includes(body.status) ? body.status : undefined)
    : publish;

  const payload = {
    providerId: provider.id,
    title,
    description: body.description,
    priceMin,
    priceMax,
    priceUnit: ['visit', 'hour', 'day', 'sqft', 'job', 'month'].includes(body.price_unit) ? body.price_unit : 'visit',
    category_id: categoryId,
    location_id: locationId,
    pin_code: pin,
  };

  if (serviceId) {
    const owned = services.findByIdForProvider(db, Number(serviceId), provider.id);
    if (!owned) return { ok: false, status: 404, error: 'That service is not part of your listing.' };
    const updated = services.updateService(db, owned.id, { providerId: provider.id, ...payload, ...(status ? { status } : {}) });
    auth.audit(db, { actor: `user:${user.id}`, action: 'provider.service_update', entity: 'service', entityId: owned.id, detail: `status=${updated.status}` });
    return { ok: true, service: updated, created: false };
  }

  const created = services.createService(db, {
    providerId: provider.id,
    categoryId,
    locationId,
    title,
    description: body.description,
    pinCode: pin,
    priceMin,
    priceMax,
    priceUnit: payload.priceUnit,
    // A brand-new service starts as a draft unless the listing is approved:
    // nothing goes public before a human (or auto-approve) says so.
    status: status || (provider.status === 'active' ? 'active' : 'draft'),
  });
  auth.audit(db, { actor: `user:${user.id}`, action: 'provider.service_create', entity: 'service', entityId: created.id, detail: `status=${created.status}` });
  return { ok: true, service: created, created: true };
}

function setServiceStatus(db, { user, serviceId, status, asProviderId = null } = {}) {
  const provider = ownedProvider(db, user, { asProviderId });
  const owned = services.findByIdForProvider(db, Number(serviceId), provider.id);
  if (!owned) return { ok: false, status: 404, error: 'That service is not part of your listing.' };
  if (!services.STATUSES.includes(status)) return { ok: false, status: 400, error: `Unknown status: ${status}` };
  if (status === 'active' && provider.status !== 'active') {
    return { ok: false, status: 409, error: 'Publish your listing first — services go live once your business is approved.' };
  }
  const updated = services.setServiceStatus(db, owned.id, status, { providerId: provider.id });
  auth.audit(db, { actor: `user:${user.id}`, action: `provider.service_${status}`, entity: 'service', entityId: owned.id });
  return { ok: true, service: updated };
}

/* ------------------------------------------------------------ coverage */

function saveCoverage(db, config, { user, pins, asProviderId = null } = {}) {
  const provider = ownedProvider(db, user, { asProviderId });
  const list = Array.isArray(pins) ? pins : String(pins ?? '').split(/[,\s]+/);
  const cleaned = [...new Set(list.map((pin) => String(pin).trim()).filter(Boolean))];
  const invalid = cleaned.filter((pin) => !isValidPin(pin));
  if (invalid.length) {
    return { ok: false, errors: { service_areas: `Not a valid PIN code: ${invalid.slice(0, 3).join(', ')}` } };
  }
  if (cleaned.length > config.onboarding.maxServiceAreas) {
    return { ok: false, errors: { service_areas: `Keep it to ${config.onboarding.maxServiceAreas} PIN codes or fewer.` } };
  }
  const saved = providers.setServiceAreas(db, provider.id, cleaned);
  auth.audit(db, { actor: `user:${user.id}`, action: 'provider.coverage_update', entity: 'provider', entityId: provider.id, detail: `${saved.length} pins` });
  return { ok: true, serviceAreas: saved, removed: cleaned.length === 0 };
}

/* ------------------------------------------------------------ enquiries */

function triageLead(db, { user, leadId, status, note = null, asProviderId = null } = {}) {
  const provider = ownedProvider(db, user, { asProviderId });
  if (!leads.LEAD_STATUSES.includes(status)) return { ok: false, status: 400, error: `Unknown enquiry status: ${status}` };
  const updated = leads.updateStatus(db, provider.id, Number(leadId), { status, note });
  if (!updated) return { ok: false, status: 404, error: 'That enquiry is not part of your listing.' };
  auth.audit(db, { actor: `user:${user.id}`, action: `lead.${status}`, entity: 'lead', entityId: updated.id });
  return { ok: true, lead: updated };
}

/* ----------------------------------------------------- verification doc */

function submitDocument(db, { user, kind, reference, note = null, asProviderId = null } = {}) {
  const provider = ownedProvider(db, user, { asProviderId });
  if (!reference || !String(reference).trim()) return { ok: false, errors: { reference: 'Add the number on the document (we store it masked).' } };
  try {
    const doc = verification.submitDocument(db, provider.id, { kind: kind || 'other', reference, note });
    auth.audit(db, { actor: `user:${user.id}`, action: 'provider.document_submit', entity: 'provider', entityId: provider.id, detail: kind });
    return { ok: true, document: doc };
  } catch (err) {
    return { ok: false, errors: { reference: err.message } };
  }
}

/** Everything `/dashboard` renders, fetched once. */
function overview(db, config, user, { asProviderId = null } = {}) {
  const provider = ownedProvider(db, user, { asProviderId });
  const full = providers.findForUser(db, user.id) || provider;
  const serviceRows = services.listForProvider(db, provider.id);
  const stats = providers.statsFor(db, provider.id);
  const inbox = leads.listForProvider(db, provider.id, { limit: 5 });
  return {
    provider,
    profile: { ...provider, ...full },
    services: serviceRows,
    stats,
    leadCounts: leads.countsByStatus(db, provider.id),
    recentLeads: inbox.items,
    completeness: providers.completeness({ ...provider, service_areas: providers.serviceAreas(db, provider.id) }),
    categories: categoryOptions(db),
    documents: verification.documents(db, provider.id),
  };
}

module.exports = {
  ownedProvider,
  categoryOptions,
  saveProfile,
  saveService,
  setServiceStatus,
  saveCoverage,
  triageLead,
  submitDocument,
  overview,
};
