/**
 * SEVA MARKET INDIA — deployment manifest tests.
 *
 * Render drives this repository from ONE blueprint file: `render.yaml` at the
 * repository root. The service definition therefore lives there *and* here —
 * this folder has to stay deployable on its own — and two copies of anything
 * drift. So the copies are asserted to be identical, the durability switches
 * are asserted to be present, and the empty lockfile is asserted to stay
 * empty, because Render's `npm ci` is what makes a zero-dependency build
 * reproducible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(ROOT, '..');

const APP_BLUEPRINT = path.join(ROOT, 'render.yaml');
const REPO_BLUEPRINT = path.join(REPO_ROOT, 'render.yaml');

/**
 * The SEVA service item, from its `- type:` line to the end of the file.
 * Both blueprints declare it last, so "to the end" is the whole item — and
 * comparing whole blocks means the comments around it (which legitimately
 * differ: one file explains PJS too) never cause a false alarm.
 */
function sevaServiceBlock(file) {
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf('  - type: web\n    name: seva-market-india\n');
  assert.ok(start >= 0, `${path.relative(REPO_ROOT, file)} must declare the seva-market-india web service`);
  return text.slice(start).trimEnd();
}

test('the root blueprint carries this service, byte for byte as this app declares it', () => {
  const appBlock = sevaServiceBlock(APP_BLUEPRINT);
  const rootBlock = sevaServiceBlock(REPO_BLUEPRINT);
  assert.equal(
    rootBlock,
    appBlock,
    'the two blueprints disagree. Copy the service block from seva-market-india/render.yaml ' +
      'into the root render.yaml (or the other way round) so Render and this folder deploy the same thing',
  );

  // Mirroring must never displace the matrimonial service in its own blueprint.
  const root = fs.readFileSync(REPO_BLUEPRINT, 'utf8');
  assert.equal((root.match(/^ {2}- type: /gm) || []).length, 2, 'the root blueprint declares exactly two services');
  assert.match(root, /^ {2}- type: web\n {4}name: panikajeevansathi$/m);
  assert.ok(
    root.indexOf('name: panikajeevansathi') < root.indexOf('name: seva-market-india'),
    'panikajeevansathi stays first: reordering makes Render diff existing services against the wrong item',
  );
});

test('the SEVA service is deployed the only safe way on a free ephemeral host', () => {
  const block = sevaServiceBlock(REPO_BLUEPRINT);
  const has = (pattern, why) => assert.match(block, pattern, why);

  has(/^ {4}rootDir: seva-market-india$/m, 'Render must build this folder, not the repo root');
  has(/^ {4}plan: free$/m, 'the launch target is the free plan');
  has(/^ {4}region: singapore\b/m, 'closest Render region to India');
  has(/^ {4}healthCheckPath: \/api\/v1\/health$/m, 'the health route reports storage durability');
  has(/^ {4}autoDeploy: true$/m, 'main is the release branch');

  has(/^ {6}- key: SEVA_STORAGE\n {8}value: supabase/m, 'accounts + enquiries must go to Postgres');
  has(/^ {6}- key: SEVA_REQUIRE_REMOTE\n {8}value: '1'/m, 'fail closed rather than store customer data on a wiped disk');
  has(/^ {6}- key: SEVA_SEED_ON_BOOT\n {8}value: '1'/m, 'the catalog is rebuilt after every filesystem wipe');
  has(/^ {6}- key: NODE_ENV\n {8}value: production/m, 'production logging and headers');
  has(/^ {6}- key: TRUST_PROXY_HOPS\n {8}value: '1'/m, 'Render is behind one proxy hop');

  for (const secret of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    assert.ok(
      new RegExp(`^ {6}- key: ${secret}\\n {8}sync: false`, 'm').test(block),
      `${secret} is a secret: it must stay out of git and be entered in the dashboard`,
    );
    assert.ok(!new RegExp(`^ {6}- key: ${secret}\\n {8}value:`, 'm').test(block), `${secret} must never have a committed value`);
  }
  assert.ok(!/^ {6}- key: SEVA_ALLOW_EPHEMERAL/m.test(block), 'SEVA_ALLOW_EPHEMERAL must not appear: it silences the very warning this service exists to honour');

  // Account email: the keys are declared so a fresh deploy prompts for them,
  // but the values belong to the dashboard — a blueprint sync must never
  // overwrite (or commit) an SMTP credential.
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'MAIL_FROM']) {
    assert.ok(
      new RegExp(`^ {6}- key: ${key}\\n(?:^ {8}#.*\\n)*^ {8}sync: false`, 'm').test(block),
      `${key} must be declared with sync:false so a blueprint sync cannot overwrite the dashboard value`,
    );
    assert.ok(
      !new RegExp(`^ {6}- key: ${key}\\n(?:^ {8}#.*\\n)*^ {8}value:`, 'm').test(block),
      `${key} must never carry a committed value`,
    );
  }

  // SITE_URL must be dashboard-owned, never committed. A pinned value pointed
  // at seva-market-india.onrender.com even after Render suffixed the live
  // service to seva-market-india-tast — and every blueprint sync reverted the
  // dashboard fix. sync:false makes the dashboard value stick; the boot guard
  // (src/site-url.js, tested in tests/site-url.test.mjs) warns when it is
  // wrong for the host.
  assert.ok(
    /^ {6}- key: SITE_URL\n(?:^ {8}#.*\n)*^ {8}sync: false$/m.test(block),
    'SITE_URL must be sync:false with no committed value: set the URL Render actually gave you in the dashboard',
  );
  assert.ok(!/^ {6}- key: SITE_URL\n(?:^ {8}#.*\n)*^ {8}value:/m.test(block), 'SITE_URL must never carry a committed value — a suffix from Render (e.g. -tast) makes it wrong');
});

test('the lockfile keeps `npm ci` working without adding a dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {}, 'the app is dependency-free by design');

  const lockPath = path.join(ROOT, 'package-lock.json');
  assert.ok(fs.existsSync(lockPath), 'package-lock.json must be committed — Render runs `npm ci`, which refuses to work without one');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(lock.lockfileVersion, 3, 'npm 10 writes v3; Render needs the format its npm understands');
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.deepEqual(Object.keys(lock.packages), [''], 'the only entry is the project itself: nothing to download');
  assert.equal(lock.packages[''].dependencies, undefined, 'a runtime dependency appeared — the zero-dependency promise is broken');
});
