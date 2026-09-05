/**
 * Catalogue repository — categories and the services they contain.
 */
import { category, service } from '../domain/index.js';
import { validate } from '../validate.js';

export function createCatalogRepository(db) {
  return {
    async createCategory(input) {
      const clean = validate(input, category.rules);
      const withSlug = await category.withUniqueSlug(clean, async (slug) => Boolean(await db.one(category.table, { slug })));
      const row = category.toRow(withSlug);
      const existing = await db.one(category.table, { name: row.name });
      if (existing) return existing;
      return db.insert(category.table, row);
    },

    listCategories({ activeOnly = true } = {}) {
      return db.all(category.table, {
        where: activeOnly ? { is_active: 1 } : undefined,
        order: ['sort_order', 'name']
      });
    },

    categoryBySlug(slug) {
      return db.one(category.table, { slug: String(slug || '').toLowerCase() });
    },

    categoryById(id) {
      return db.one(category.table, { id });
    },

    async createService(input) {
      const clean = validate(input, service.rules);
      const withSlug = await service.withUniqueSlug(clean, async (slug) =>
        Boolean(await db.one(service.table, { category_id: clean.category_id, slug }))
      );
      const row = service.toRow(withSlug);
      const existing = await db.one(service.table, { category_id: row.category_id, name: row.name });
      if (existing) return existing;
      return db.insert(service.table, row);
    },

    async listServices({ categoryId, categorySlug } = {}) {
      let resolvedCategoryId = categoryId || null;
      if (!resolvedCategoryId && categorySlug) {
        const categoryRow = await db.one(category.table, { slug: String(categorySlug).toLowerCase() });
        if (!categoryRow) return [];
        resolvedCategoryId = categoryRow.id;
      }
      return db.all(service.table, {
        where: resolvedCategoryId ? { category_id: resolvedCategoryId, is_active: 1 } : { is_active: 1 },
        order: ['sort_order', 'name']
      });
    },

    serviceById(id) {
      return db.one(service.table, { id });
    },

    serviceBySlug(slug, { categoryId } = {}) {
      return db.one(service.table, {
        slug: String(slug || '').toLowerCase(),
        ...(categoryId ? { category_id: categoryId } : {})
      });
    },

    /** Categories with their services nested — one payload for the home page. */
    async categoriesWithServices({ limit } = {}) {
      const categories = await this.listCategories();
      const services = await this.listServices();
      const bySlug = new Map(categories.map((row) => [row.slug, []]));
      for (const row of services) {
        const owner = categories.find((entry) => entry.id === row.category_id);
        if (owner) bySlug.get(owner.slug).push(service.toPublic(row));
      }
      const list = categories.map((row) => ({
        ...category.toPublic(row),
        services: bySlug.get(row.slug) || []
      }));
      return limit ? list.slice(0, limit) : list;
    }
  };
}
