'use strict';
/**
 * SEVA MARKET INDIA — seed loader.
 *
 * Idempotent: every insert goes through `ensure*` helpers that match on
 * slug, so re-running the seed updates nothing and duplicates nothing.
 * After the foundation seed, the comprehensive Category → Subcategory →
 * Service catalog is seeded from `catalog-data.js`.
 */

const { categories, geography, providers } = require('./seed-data');
const { catalog } = require('./catalog-data');
const categoryModel = require('../models/category');
const subcategoryModel = require('../models/subcategory');
const catalogServiceModel = require('../models/catalogService');
const locationModel = require('../models/location');
const providerModel = require('../models/provider');
const serviceModel = require('../models/service');
const { slugify } = require('./values');

/**
 * Insert the full seed dataset.
 * @param {import('./client').Database} db
 * @returns {{categories:number, locations:number, providers:number, services:number, catalogCategories:number, subcategories:number, catalogServices:number}}
 */
function seed(db) {
  const counters = { categories: 0, locations: 0, providers: 0, services: 0, catalogCategories: 0, subcategories: 0, catalogServices: 0 };

  db.transaction(() => {
    /* ------------------------------------------------------- categories */
    const categoryBySlug = new Map();
    for (const parent of categories) {
      const parentRow = categoryModel.ensureCategory(db, {
        name: parent.name,
        icon: parent.icon,
        sortOrder: parent.sortOrder,
      });
      categoryBySlug.set(parentRow.slug, parentRow);
      counters.categories += 1;
      for (const child of parent.children || []) {
        const childRow = categoryModel.ensureCategory(db, {
          name: child.name,
          parentId: parentRow.id,
          icon: child.icon,
          sortOrder: child.sortOrder,
        });
        categoryBySlug.set(childRow.slug, childRow);
        counters.categories += 1;
      }
    }

    /* ------------------- backfill legacy categories with descriptions */
    // Foundation categories from 0001 were seeded without descriptions.
    // For a complete, SEO-ready catalog every row must have one.
    const legacyWithoutDesc = db.all('SELECT id, name FROM categories WHERE description IS NULL OR description = ?', ['']);
    for (const row of legacyWithoutDesc) {
      const seoDesc = `${row.name} — professional ${row.name.toLowerCase()} services across India. Book verified providers near your PIN code. Compare prices, reviews and availability.`;
      try { categoryModel.updateCategory(db, row.id, { description: seoDesc }); } catch (_) {}
    }

    /* ------------------------------------------ comprehensive catalog */
    // New 23-category catalog (idempotent via slug). This runs after the
    // foundation categories so existing slugs (e.g. beauty-personal-care)
    // are reused rather than duplicated.
    for (const cat of catalog) {
      const catRow = categoryModel.ensureCategory(db, {
        name: cat.name,
        description: cat.description,
        icon: cat.icon,
        sortOrder: cat.sortOrder,
      });
      // Ensure description/icon are populated on re-seed if previously empty.
      if ((!catRow.description || catRow.description.length < 10) && cat.description) {
        categoryModel.updateCategory(db, catRow.id, { description: cat.description, icon: cat.icon });
      }
      categoryBySlug.set(catRow.slug, catRow);
      counters.catalogCategories += 1;

      for (const sub of cat.subcategories || []) {
        const subRow = subcategoryModel.ensureSubcategory(db, {
          categoryId: catRow.id,
          name: sub.name,
          description: sub.description,
          icon: sub.icon,
          sortOrder: sub.sortOrder,
        });
        counters.subcategories += 1;

        for (const svc of sub.services || []) {
          catalogServiceModel.ensureCatalogService(db, {
            categoryId: catRow.id,
            subcategoryId: subRow.id,
            name: svc.name,
            description: svc.description,
            icon: svc.icon,
            sortOrder: svc.sortOrder,
          });
          counters.catalogServices += 1;
        }
      }
    }

    /* -------------------------------------------------------- geography */
    const india = locationModel.ensureIndia(db);
    counters.locations += 1;
    const pinToLocation = new Map();

    for (const entry of geography) {
      const state = locationModel.ensureLocation(db, {
        kind: 'state', parentId: india.id, name: entry.state, code: entry.code,
      });
      counters.locations += 1;

      for (const districtEntry of entry.districts) {
        const district = locationModel.ensureLocation(db, {
          kind: 'district', parentId: state.id, name: districtEntry.district,
        });
        counters.locations += 1;

        for (const cityEntry of districtEntry.cities) {
          const city = locationModel.ensureLocation(db, {
            kind: 'city',
            parentId: district.id,
            name: cityEntry.city,
            latitude: cityEntry.latitude ?? null,
            longitude: cityEntry.longitude ?? null,
          });
          counters.locations += 1;

          for (const localityEntry of cityEntry.localities) {
            const locality = locationModel.ensureLocation(db, {
              kind: 'locality', parentId: city.id, name: localityEntry.name,
            });
            counters.locations += 1;

            const pin = locationModel.ensureLocation(db, {
              kind: 'pincode', parentId: locality.id, name: localityEntry.pin, pinCode: localityEntry.pin,
            });
            counters.locations += 1;
            pinToLocation.set(localityEntry.pin, { locality, pin });
          }
        }
      }
    }

    /* --------------------------------------------------- providers */
    for (const entry of providers) {
      const category = categoryBySlug.get(slugify(entry.category));
      if (!category) throw new Error(`Seed refers to unknown category slug: ${entry.category}`);

      const place = pinToLocation.get(entry.pin);
      if (!place) throw new Error(`Seed refers to unknown PIN code: ${entry.pin}`);

      // Skip providers that are already present. createProvider() would
      // otherwise insert a second row with a "-2" slug, so without this check
      // the seed would silently double the catalogue on every run.
      if (providerModel.findBySlug(db, slugify(entry.business))) continue;

      const provider = providerModel.createProvider(db, {
        businessName: entry.business,
        contactName: entry.contact,
        phone: entry.phone,
        categoryId: category.id,
        locationId: place.locality.id,
        pinCode: entry.pin,
        about: entry.about,
        experienceYears: entry.experience,
        status: 'active',
      });
      counters.providers += 1;

      db.run('UPDATE providers SET is_verified = ?, rating_avg = ?, rating_count = ? WHERE id = ?', [
        entry.verified ? 1 : 0,
        entry.rating,
        entry.ratingCount,
        provider.id,
      ]);

      providerModel.setServiceAreas(db, provider.id, entry.areas);

      for (const service of entry.services) {
        serviceModel.createService(db, {
          providerId: provider.id,
          categoryId: category.id,
          locationId: place.locality.id,
          title: service.title,
          pinCode: entry.pin,
          priceMin: service.min,
          priceMax: service.max,
          priceUnit: service.unit,
          status: service.status,
        });
        counters.services += 1;
      }
    }
  });

  return counters;
}

module.exports = { seed };
