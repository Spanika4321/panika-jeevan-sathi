/**
 * User domain — one identity for customers, providers and administrators.
 *
 * A person is a `user`; running a business is a separate `provider` record that
 * points back at the user. That split lets one person be a customer and a
 * provider without two accounts, and keeps provider onboarding (verification,
 * approval) out of the authentication path.
 */
import { newId } from '../ids.js';
import { cleanText, normaliseEmail, normalisePhone, normalisePincode } from '../validate.js';

export const ROLES = ['customer', 'provider', 'admin'];
export const STATUSES = ['active', 'pending', 'suspended'];

export const user = {
  table: 'users',
  columns: [
    'id',
    'email',
    'phone',
    'password_hash',
    'name',
    'role',
    'status',
    'email_verified',
    'phone_verified',
    'state_id',
    'city_id',
    'pincode',
    'token_version',
    'last_login_at',
    'created_at',
    'updated_at'
  ],
  unique: [['email'], ['phone']],
  rules: {
    email: { type: 'email', required: true },
    phone: { type: 'phone' },
    password: { type: 'string', min: 8, max: 200 },
    name: { type: 'string', required: true, min: 2, max: 80 },
    role: { type: 'enum', values: ROLES, default: 'customer' },
    status: { type: 'enum', values: STATUSES, default: 'active' },
    state_id: { type: 'uuid' },
    city_id: { type: 'uuid' },
    pincode: { type: 'pincode' }
  },
  toRow(input, { now = Date.now() } = {}) {
    return {
      id: input.id || newId(),
      email: normaliseEmail(input.email),
      phone: input.phone ? normalisePhone(input.phone) : null,
      password_hash: input.password_hash || '',
      name: cleanText(input.name),
      role: ROLES.includes(input.role) ? input.role : 'customer',
      status: STATUSES.includes(input.status) ? input.status : 'active',
      email_verified: input.email_verified ? 1 : 0,
      phone_verified: input.phone_verified ? 1 : 0,
      state_id: input.state_id || null,
      city_id: input.city_id || null,
      pincode: input.pincode ? normalisePincode(input.pincode) : null,
      token_version: Number(input.token_version || 1),
      last_login_at: Number(input.last_login_at || 0),
      created_at: input.created_at || now,
      updated_at: now
    };
  },
  /** Never expose the password hash or verification internals to a client. */
  toPublic(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      status: row.status,
      email_verified: Boolean(row.email_verified),
      phone_verified: Boolean(row.phone_verified),
      city_id: row.city_id,
      state_id: row.state_id,
      pincode: row.pincode,
      created_at: row.created_at
    };
  }
};
