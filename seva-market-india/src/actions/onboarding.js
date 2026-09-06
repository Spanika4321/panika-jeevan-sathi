'use strict';
/**
 * SEVA MARKET INDIA — provider onboarding.
 *
 * One form, one action: an account (if the person does not have one), a
 * business listing, a first service and the PIN codes it covers. Everything
 * the review queue needs is captured here so an admin can decide in one pass.
 *
 * The reason it is one flow rather than four endpoints is the user: a plumber
 * on a 5-inch screen in Guwahati will not survive a five-tab wizard.
 */

const { HttpError } = require('../http/respond');
const authActions = require('./auth');
const users = require('../models/user');
const providers = require('../models/provider');
const services = require('../models/service');
const locations = require('../models/location');
const verification = require('../models/verification');
const auth = require('../models/auth');
const mail = require('../mail/mailer');
const { cleanText, isValidPin, normalizePhone } = require('../db/values');

/**
 * Resolve whatever "place" the provider typed into a location row to hang
 * the listing on. A PIN code wins (it is the most precise thing an Indian
 * address has), then an explicit location id, then free-text search.
 */
function resolvePlace(db, { pin, locationId, place }) {
  if (locationId) {
    const row = db.get('SELECT id, pin_code FROM locations WHERE id = ?', [Number(locationId)]);
    if (row) return row;
  }
  if (pin && isValidPin(pin)) {
    const found = locations.findByPin(db, pin);
    if (found) {
      // Prefer the locality so a city-level page can still find the listing.
      const locality = found.chain.find((node) => node.kind === 'locality') || found.node;
      return { id: locality.id, pin_code: pin };
    }
    // An unknown-but-valid PIN is not a mistake: the location master is a
    // partial import today. Create the smallest valid branch we can, under
    // "India", so the listing is never lost for want of a lookup table.
    const india = locations.ensureIndia(db);
    const state = locations.ensureLocation(db, { kind: 'state', parentId: india.id, name: `PIN ${pin.slice(0, 1)} region` });
    const district = locations.ensureLocation(db, { kind: 'district', parentId: state.id, name: `PIN ${pin.slice(0, 2)} region` });
    const city = locations.ensureLocation(db, { kind: 'city', parentId: district.id, name: `PIN ${pin}` });
    const locality = locations.ensureLocation(db, { kind: 'locality', parentId: city.id, name: `PIN ${pin} area` });
    const pinNode = locations.ensureLocation(db, { kind: 'pincode', parentId: locality.id, name: pin, pinCode: pin });
    return { id: locality.id, pin_code: pinNode.pin_code, created: true };
  }
  const text = cleanText(place, 80);
  if (text) {
    const matches = locations.search(db, text, { limit: 1 });
    if (matches.length) return { id: matches[0].id, pin_code: matches[0].pin_code };
  }
  return null;
}

/**
 * @param {object} db
 * @param {object} config
 * @param {object|null} options.user  the signed-in user, or null for the
 *        one-step "create my account and list my business" flow
 */
function onboard(db, config, { user = null, body = {}, ip = null, userAgent = null, linkBase = '' } = {}) {
  const errors = {};
  const businessName = cleanText(body.business_name, 140);
  if (!businessName) errors.business_name = 'Business name is required. Even "Ravi Plumbing" is enough.';

  const phone = normalizePhone(body.phone);
  if (!phone) errors.phone = 'Enter the 10-digit mobile number customers should call.';

  const category = body.category_id ? db.get('SELECT id FROM categories WHERE id = ? AND is_active = 1', [Number(body.category_id)]) : null;
  if (!category) errors.category_id = 'Choose the category that fits your work best.';

  const place = resolvePlace(db, {
    pin: cleanText(body.pin_code ?? body.pin, 6),
    locationId: body.location_id ? Number(body.location_id) : null,
    place: body.place,
  });
  if (!place) errors.pin_code = 'Enter your PIN code (or city) so customers nearby can find you.';

  const serviceTitle = cleanText(body.service_title, 140);
  if (!serviceTitle) errors.service_title = 'Add at least one service, e.g. "Tap and pipe repair".';

  // A brand-new account needs valid credentials too.
  let account = user;
  if (!account) {
    const problem = users.passwordProblem(body.password, { minLength: config.auth.minPasswordLength });
    if (problem) errors.password = problem;
    if (!cleanText(body.full_name, 120)) errors.full_name = 'Your name is required.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  const priceMin = body.price_min === undefined || body.price_min === null || body.price_min === '' ? null : Number(body.price_min);
  const priceMax = body.price_max === undefined || body.price_max === null || body.price_max === '' ? null : Number(body.price_max);
  if ((priceMin !== null && !Number.isFinite(priceMin)) || (priceMax !== null && !Number.isFinite(priceMax))) {
    return { ok: false, errors: { price_min: 'Prices must be numbers, or left blank for "on request".' } };
  }
  if (priceMin !== null && priceMax !== null && priceMax < priceMin) {
    return { ok: false, errors: { price_max: 'The maximum price cannot be below the minimum.' } };
  }

  return db.transaction(() => {
    let createdAccount = null;
    if (!account) {
      const result = authActions.registerAccount(db, config, {
        email: body.email,
        password: body.password,
        fullName: body.full_name,
        phone,
        role: 'provider',
        linkBase,
        ip,
      });
      if (!result.ok) {
        // Return, do not throw: the caller may be a browser form that has to
        // re-render with these field errors instead of a JSON 400.
        return { ok: false, status: 400, errors: result.errors };
      }
      account = result.user;
      createdAccount = { email: account.email, verificationSent: true };
    } else if (account.role === 'customer') {
      // Listing a business makes you a provider. Admins keep their role.
      db.run("UPDATE users SET role = 'provider' WHERE id = ? AND role = 'customer'", [account.id]);
      account = { ...account, role: 'provider' };
    }

    const duplicate = db.get('SELECT id, business_name, slug FROM providers WHERE user_id = ? AND status != ?', [account.id, 'suspended']);
    if (duplicate) {
      return {
        ok: false,
        status: 409,
        message: `You already have a listing (${duplicate.business_name}). Manage it from your dashboard.`,
        dashboardUrl: '/dashboard',
      };
    }

    const accountEmail = db.get('SELECT email FROM users WHERE id = ?', [account.id])?.email ?? null;
    const provider = providers.createProvider(db, {
      userId: account.id,
      businessName,
      contactName: body.contact_name,
      phone,
      altPhone: body.alt_phone,
      email: cleanText(body.email, 254)?.toLowerCase() || accountEmail,
      categoryId: category.id,
      locationId: place.id,
      pinCode: place.pin_code ?? null,
      addressLine: body.address_line,
      about: body.about,
      experienceYears: body.experience_years,
      status: config.onboarding.autoApprove ? 'active' : 'pending',
    });

    if (body.website || body.gst_number) {
      providers.updateProvider(db, provider.id, { website: body.website, gst_number: body.gst_number });
    }

    const pins = normalisePins(body.service_areas ?? body.areas, config.onboarding.maxServiceAreas);
    if (pins.length) providers.setServiceAreas(db, provider.id, pins);

    const service = services.createService(db, {
      providerId: provider.id,
      categoryId: category.id,
      locationId: place.id,
      title: serviceTitle,
      description: body.service_description,
      pinCode: place.pin_code ?? null,
      priceMin,
      priceMax,
      priceUnit: ['visit', 'hour', 'day', 'sqft', 'job', 'month'].includes(body.price_unit) ? body.price_unit : 'visit',
      // Drafts keep a pending listing out of search results entirely.
      status: config.onboarding.autoApprove ? 'active' : 'draft',
    });

    const doc = body.gst_number
      ? verification.submitDocument(db, provider.id, { kind: 'gst', reference: body.gst_number })
      : null;

    const finalProvider = providers.findById(db, provider.id);
    auth.audit(db, {
      actor: `user:${account.id}`,
      action: 'provider.onboard',
      entity: 'provider',
      entityId: provider.id,
      detail: `status=${finalProvider.status} pin=${finalProvider.pin_code ?? '-'} areas=${pins.length}`,
    });

    mail.providerSubmittedMessage({
      to: accountEmail ?? cleanText(body.email, 254),
      name: account.full_name || cleanText(body.full_name, 120) || finalProvider.contact_name || 'there',
      business: finalProvider.business_name,
      reviewNeeded: finalProvider.status !== 'active',
      config,
    });

    return {
      ok: true,
      provider: finalProvider,
      service,
      serviceAreas: pins,
      document: doc,
      account: createdAccount,
      needsReview: finalProvider.status !== 'active',
      statusUrl: `/dashboard`,
    };
  });
}

/** Unique, valid PIN codes, capped so one provider cannot flood the table. */
function normalisePins(raw, max = 25) {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,\s]+/);
  const pins = [...new Set(list.map((pin) => String(pin).trim()).filter(isValidPin))];
  return pins.slice(0, max);
}

module.exports = { onboard, resolvePlace, normalisePins };
