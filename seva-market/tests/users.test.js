import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from './helpers/app.js';
import { hashPassword, verifyPassword, passwordProblem } from '../lib/services/auth.js';
import { user } from '../lib/domain/index.js';

async function appWithUsers() {
  return createTestApp();
}

describe('user model and accounts', () => {
  test('the users table stores the account fields the marketplace needs', async () => {
    const app = await appWithUsers();
    const columns = await app.db.columns('users');
    for (const column of ['email', 'phone', 'password_hash', 'name', 'role', 'status', 'city_id', 'pincode']) {
      assert.ok(columns.includes(column), `users.${column} exists`);
    }
  });

  test('toRow normalises an account and never invents a role', () => {
    const row = user.toRow({
      email: '  Ravi@Example.com ',
      name: ' Ravi Kumar ',
      phone: '+91 98765 43210',
      pincode: '110 001'
    });
    assert.equal(row.email, 'ravi@example.com');
    assert.equal(row.phone, '9876543210');
    assert.equal(row.pincode, '110001');
    assert.equal(row.role, 'customer');
    assert.equal(row.status, 'active');
    assert.equal(row.password_hash, '');
    assert.match(row.id, /^[0-9a-f-]{36}$/);
  });

  test('toPublic never leaks the password hash or token version', () => {
    const row = user.toRow({ email: 'a@b.com', name: 'A B', password_hash: 'scrypt$x' });
    const safe = user.toPublic(row);
    assert.equal('password_hash' in safe, false);
    assert.equal('token_version' in safe, false);
    assert.equal(safe.email, 'a@b.com');
  });

  test('registration creates a customer account and issues a session cookie', async () => {
    const app = await appWithUsers();
    const result = await app.services.users.register({
      name: 'Ravi Kumar',
      email: 'ravi@example.com',
      password: 'strongpass1',
      phone: '9876543210'
    });

    assert.equal(result.user.role, 'customer');
    assert.equal(result.user.status, 'active');
    assert.equal('password_hash' in result.user, false, 'the register result omits the hash');
    assert.match(result.cookie, /^sm_session=/);
    assert.match(result.cookie, /HttpOnly/);
    assert.match(result.cookie, /SameSite=Lax/);

    const stored = await app.services.usersRepository.byEmail('ravi@example.com');
    assert.ok(verifyPassword('strongpass1', stored.password_hash));
  });

  test('weak passwords are rejected before any write', async () => {
    const app = await appWithUsers();
    for (const password of ['short', 'allletters', '12345678', 'has space 1']) {
      await assert.rejects(
        () => app.services.users.register({ name: 'Test User', email: `t${Math.random()}@example.com`, password }),
        (error) => {
          assert.equal(error.status, 422);
          assert.ok(error.fields.password, 'a field-level password message is returned');
          return true;
        }
      );
    }
    assert.equal(passwordProblem('strongpass1'), null);
  });

  test('duplicate emails and phones are refused', async () => {
    const app = await appWithUsers();
    await app.services.users.register({ name: 'First', email: 'dup@example.com', password: 'strongpass1', phone: '9876543210' });

    await assert.rejects(
      () => app.services.users.register({ name: 'Second', email: 'dup@example.com', password: 'strongpass1' }),
      (error) => error.status === 409 && /email/i.test(error.message)
    );
    await assert.rejects(
      () => app.services.users.register({ name: 'Third', email: 'other@example.com', password: 'strongpass1', phone: '9876543210' }),
      (error) => error.status === 409 && /phone/i.test(error.message)
    );
  });

  test('self-registering as an administrator is refused', async () => {
    const app = await appWithUsers();
    await assert.rejects(
      () => app.services.users.register({ name: 'Sneaky', email: 'admin@example.com', password: 'strongpass1', role: 'admin' }),
      (error) => error.status === 400
    );
  });

  test('login works and rejects a wrong password with the same message as an unknown email', async () => {
    const app = await appWithUsers();
    await app.services.users.register({ name: 'Ravi', email: 'ravi@example.com', password: 'strongpass1' });

    const signedIn = await app.services.users.login({ email: 'ravi@example.com', password: 'strongpass1' });
    assert.equal(signedIn.user.email, 'ravi@example.com');
    assert.ok(signedIn.cookie.includes('sm_session='));

    const wrongPassword = await app.services.users.login({ email: 'ravi@example.com', password: 'wrongpass1' }).catch((e) => e);
    const unknownEmail = await app.services.users.login({ email: 'nobody@example.com', password: 'strongpass1' }).catch((e) => e);
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPassword.message, unknownEmail.message, 'the two failures are indistinguishable');
  });

  test('suspended accounts cannot sign in', async () => {
    const app = await appWithUsers();
    const created = await app.services.users.register({ name: 'Ravi', email: 'susp@example.com', password: 'strongpass1' });
    await app.services.usersRepository.update(created.user.id, { status: 'suspended' });

    await assert.rejects(
      () => app.services.users.login({ email: 'susp@example.com', password: 'strongpass1' }),
      (error) => error.status === 401 && /not active/i.test(error.message)
    );
  });

  test('sessions survive a round trip and can be read from a request', async () => {
    const app = await appWithUsers();
    const created = await app.services.users.register({ name: 'Ravi', email: 'sess@example.com', password: 'strongpass1' });
    const cookies = created.cookie.split(';')[0];
    const request = { headers: { cookie: cookies } };

    const account = await app.services.users.fromRequest(request);
    assert.equal(account.email, 'sess@example.com');

    assert.equal(await app.services.users.fromRequest({ headers: {} }), null);
    assert.equal(await app.services.users.fromRequest({ headers: { cookie: 'sm_session=tampered.sig' } }), null);
  });

  test('password hashes are salted, so identical passwords differ', () => {
    const first = hashPassword('strongpass1');
    const second = hashPassword('strongpass1');
    assert.notEqual(first, second);
    assert.ok(verifyPassword('strongpass1', first));
    assert.equal(verifyPassword('wrongpass1', first), false);
    assert.equal(verifyPassword('strongpass1', 'not-a-hash'), false);
  });
});
