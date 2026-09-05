/**
 * Catalogue domain — categories and the services inside them.
 *
 * A category (Plumbing) is what a customer browses; a service (Tap repair) is
 * what they actually book. Providers link to services, so search can answer
 * "who fixes a leaking tap in 110001" without string matching.
 */
import { newId } from '../ids.js';
import { slugify, uniqueSlug } from '../slug.js';
import { cleanText } from '../validate.js';

function timestamps(now) {
  return { created_at: now, updated_at: now };
}

export const category = {
  table: 'categories',
  columns: [
    'id',
    'parent_id',
    'name',
    'slug',
    'description',
    'icon',
    'sort_order',
    'is_active',
    'created_at',
    'updated_at'
  ],
  unique: [['slug'], ['name']],
  rules: {
    parent_id: { type: 'uuid' },
    name: { type: 'string', required: true, min: 2, max: 60 },
    slug: { type: 'slug' },
    description: { type: 'text', max: 240 },
    icon: { type: 'string', max: 40 },
    sort_order: { type: 'integer', min: 0, max: 9999, default: 100 }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      parent_id: input.parent_id || null,
      name: cleanText(input.name),
      slug: input.slug ? slugify(input.slug) : slugify(input.name, 'category'),
      description: cleanText(input.description || ''),
      icon: cleanText(input.icon || ''),
      sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 100,
      is_active: input.is_active === false ? 0 : 1,
      ...timestamps(now)
    };
  },
  toPublic(row) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      icon: row.icon,
      sort_order: row.sort_order
    };
  },
  async withUniqueSlug(input, isTaken) {
    const base = input.slug ? slugify(input.slug) : slugify(input.name, 'category');
    return { ...input, slug: await uniqueSlug(base, isTaken, { fallback: 'category' }) };
  }
};

export const service = {
  table: 'services',
  columns: [
    'id',
    'category_id',
    'name',
    'slug',
    'description',
    'sort_order',
    'is_active',
    'created_at',
    'updated_at'
  ],
  unique: [['category_id', 'slug'], ['category_id', 'name']],
  rules: {
    category_id: { type: 'uuid', required: true },
    name: { type: 'string', required: true, min: 2, max: 80 },
    slug: { type: 'slug' },
    description: { type: 'text', max: 240 },
    sort_order: { type: 'integer', min: 0, max: 9999, default: 100 }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      category_id: input.category_id,
      name: cleanText(input.name),
      slug: input.slug ? slugify(input.slug) : slugify(input.name, 'service'),
      description: cleanText(input.description || ''),
      sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 100,
      is_active: input.is_active === false ? 0 : 1,
      ...timestamps(now)
    };
  },
  toPublic(row) {
    return {
      id: row.id,
      category_id: row.category_id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      sort_order: row.sort_order
    };
  },
  async withUniqueSlug(input, isTaken) {
    const base = input.slug ? slugify(input.slug) : slugify(input.name, 'service');
    return { ...input, slug: await uniqueSlug(base, isTaken, { fallback: 'service' }) };
  }
};

export const CATALOG_MODELS = { category, service };
