/**
 * User repository.
 */
import { user } from '../domain/index.js';
import { validate } from '../validate.js';

export function createUserRepository(db) {
  return {
    async create(input) {
      const clean = validate(input, {
        email: user.rules.email,
        phone: { ...user.rules.phone, required: false },
        name: user.rules.name,
        role: user.rules.role,
        status: user.rules.status,
        state_id: { ...user.rules.state_id, required: false },
        city_id: { ...user.rules.city_id, required: false },
        pincode: { ...user.rules.pincode, required: false }
      });
      const row = user.toRow({ ...clean, password_hash: input.password_hash || '' });
      return db.insert(user.table, row);
    },

    byId(id) {
      return db.one(user.table, { id });
    },

    byEmail(email) {
      return db.one(user.table, { email: String(email || '').trim().toLowerCase() });
    },

    byPhone(phone) {
      return db.one(user.table, { phone: String(phone || '').replace(/\D/g, '').slice(-10) });
    },

    update(id, patch) {
      return db.update(user.table, { id }, { ...patch, updated_at: Date.now() });
    },

    count() {
      return db.count(user.table, {});
    },

    list({ limit = 50, offset = 0, role } = {}) {
      return db.all(user.table, {
        where: role ? { role } : undefined,
        order: '-created_at',
        limit,
        offset
      });
    }
  };
}
