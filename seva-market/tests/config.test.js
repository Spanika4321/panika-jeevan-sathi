import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, validateConfig, assertValidConfig, SITE } from '../lib/config.js';
import { ConfigError } from '../lib/errors.js';

describe('configuration', () => {
  test('defaults are safe for local development', () => {
    const config = loadConfig({});
    assert.equal(config.env, 'development');
    assert.equal(config.driver, 'sqlite');
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.site.name, 'SEVA MARKET INDIA');
    assert.equal(config.site.country, 'IN');
    assert.equal(config.site.currency, 'INR');
    assert.ok(config.sessionSecret, 'a development signing key is generated');
  });

  test('environment variables are honoured', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      SEVA_PORT: '4321',
      SEVA_DB_DRIVER: 'memory',
      SEVA_SITE_URL: 'https://sevamarket.example/',
      SEVA_LOG_LEVEL: 'warn'
    });
    assert.equal(config.port, 4321);
    assert.equal(config.driver, 'memory');
    assert.equal(config.logLevel, 'warn');
    assert.equal(config.siteUrl, 'https://sevamarket.example', 'trailing slash is trimmed');
  });

  test('a valid development configuration has no errors', () => {
    assert.deepEqual(validateConfig(loadConfig({ NODE_ENV: 'development' })), []);
  });

  test('rejects an out-of-range port', () => {
    const errors = validateConfig(loadConfig({ NODE_ENV: 'test', SEVA_PORT: '70000' }));
    assert.ok(errors.some((message) => message.includes('port')));
  });

  test('rejects an unknown database driver', () => {
    const errors = validateConfig(loadConfig({ NODE_ENV: 'test', SEVA_DB_DRIVER: 'mongodb' }));
    assert.ok(errors.some((message) => message.includes('SEVA_DB_DRIVER')));
  });

  test('port 0 is allowed for tests but not in production', () => {
    assert.deepEqual(
      validateConfig(loadConfig({ NODE_ENV: 'test', SEVA_PORT: '0' })).filter((m) => m.includes('port')),
      []
    );
    assert.ok(validateConfig(loadConfig({ NODE_ENV: 'production', SEVA_PORT: '0' })).some((m) => m.includes('port')));
  });

  test('production demands HTTPS, a long secret, a real driver and no auto-seed', () => {
    const errors = validateConfig(
      loadConfig({
        NODE_ENV: 'production',
        SEVA_SITE_URL: 'http://insecure.example',
        SEVA_DB_DRIVER: 'memory',
        SEVA_SESSION_SECRET: 'short',
        SEVA_AUTO_SEED: '1'
      })
    );
    assert.ok(errors.some((m) => m.includes('HTTPS')));
    assert.ok(errors.some((m) => m.includes('SEVA_SESSION_SECRET')));
    assert.ok(errors.some((m) => m.includes('in-memory')));
    assert.ok(errors.some((m) => m.includes('SEVA_AUTO_SEED')));
  });

  test('a complete production configuration validates', () => {
    const errors = validateConfig(
      loadConfig({
        NODE_ENV: 'production',
        SEVA_SITE_URL: 'https://sevamarket.example',
        SEVA_DB_DRIVER: 'sqlite',
        SEVA_SESSION_SECRET: 'a'.repeat(48),
        SEVA_AUTO_SEED: '0'
      })
    );
    assert.deepEqual(errors, []);
  });

  test('assertValidConfig throws ConfigError listing every problem', () => {
    assert.throws(
      () => assertValidConfig(loadConfig({ NODE_ENV: 'production', SEVA_DB_DRIVER: 'memory' })),
      (error) => {
        assert.ok(error instanceof ConfigError);
        assert.equal(error.status, 500);
        assert.ok(Array.isArray(error.details));
        assert.ok(error.details.length >= 3);
        return true;
      }
    );
  });

  test('site defaults describe an India-wide marketplace', () => {
    assert.equal(SITE.locale, 'en_IN');
    assert.equal(SITE.defaultRadiusKm, 10);
  });
});
