/**
 * User service — registration, sign-in and session resolution.
 *
 * Security rules enforced here (not in the HTTP layer, so they hold for any
 * future caller):
 *   • a wrong password and an unknown email produce the *same* error,
 *   • suspended accounts cannot obtain a session,
 *   • the password hash never leaves this module.
 */
import { user } from '../domain/index.js';
import { validate, normaliseEmail } from '../validate.js';
import { BadRequestError, ConflictError, UnauthorizedError } from '../errors.js';
import {
  assertStrongPassword,
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  parseCookies,
  sessionCookie,
  verifyPassword,
  verifySessionToken,
  SESSION_COOKIE
} from './auth.js';

/** Never let a password hash escape the service layer. */
function safeUser(row) {
  if (!row) return null;
  const { password_hash: _ignored, ...safe } = row;
  return safe;
}

export function createUserService({ users, config, log }) {
  const genericFailure = () => new UnauthorizedError('Email or password is incorrect');

  return {
    async register(input, { ip } = {}) {
      const clean = validate(input, {
        name: user.rules.name,
        email: user.rules.email,
        password: { type: 'string', required: true, min: 8, max: 200 },
        phone: { ...user.rules.phone, required: false },
        role: { ...user.rules.role, default: 'customer' },
        city_id: { ...user.rules.city_id, required: false },
        state_id: { ...user.rules.state_id, required: false },
        pincode: { ...user.rules.pincode, required: false }
      });

      assertStrongPassword(input.password);

      if (clean.role === 'admin') throw new BadRequestError('This role cannot be self-assigned');

      const existing = await users.byEmail(clean.email);
      if (existing) throw new ConflictError('An account with this email already exists');

      if (clean.phone && (await users.byPhone(clean.phone))) {
        throw new ConflictError('An account with this phone number already exists');
      }

      const created = await users.create({
        ...clean,
        password_hash: hashPassword(input.password),
        status: 'active'
      });

      log?.info('user registered', { userId: created.id, role: created.role, ip });
      return { user: safeUser(created), ...this.issueSession(created) };
    },

    async login(input, { ip } = {}) {
      const clean = validate(input, {
        email: user.rules.email,
        password: { type: 'string', required: true }
      });

      const found = await users.byEmail(normaliseEmail(clean.email));
      // Constant-ish work whether or not the account exists.
      const hash = found?.password_hash || hashPassword('seva-market-placeholder-password');
      const passwordOk = verifyPassword(clean.password, hash);

      if (!found || !passwordOk) {
        log?.warn('login failed', { email: clean.email, ip, reason: found ? 'bad_password' : 'unknown_email' });
        throw genericFailure();
      }
      if (found.status !== 'active') throw new UnauthorizedError('This account is not active. Contact support.');

      await users.update(found.id, { last_login_at: Date.now() });
      log?.info('user signed in', { userId: found.id, ip });
      return { user: safeUser(found), ...this.issueSession(found) };
    },

    issueSession(record) {
      const token = createSessionToken({
        userId: record.id,
        tokenVersion: record.token_version || 1,
        secret: config.sessionSecret,
        ttlHours: config.sessionTtlHours
      });
      return {
        token,
        cookie: sessionCookie(token, { isProduction: config.isProduction, ttlHours: config.sessionTtlHours }),
        expiresInHours: config.sessionTtlHours
      };
    },

    clearCookie() {
      return clearSessionCookie({ isProduction: config.isProduction });
    },

    /** Resolve the signed cookie on a request into a live user record. */
    async fromRequest(req) {
      const cookies = parseCookies(req?.headers?.cookie);
      const token = cookies[SESSION_COOKIE];
      if (!token) return null;
      const session = verifySessionToken(token, config.sessionSecret);
      if (!session) return null;
      const record = await users.byId(session.uid);
      if (!record) return null;
      if (record.status !== 'active') return null;
      if (Number(record.token_version || 1) !== Number(session.tv || 1)) return null;
      return record;
    }
  };
}
