#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — real-browser end-to-end test (Playwright + Chromium).
 *
 *   node run.mjs                                   # local server, full suite
 *   SITE_URL=https://panika-jeevan-sathi-gzza.onrender.com node run.mjs
 *
 * Covers: loading, navigation, signup (+email verification), login, session
 * persistence across refresh, profile create/edit, photo upload, search with
 * filters, interest → accept, two-way messaging, shortlist, notifications,
 * logout/login, contact form, error handling (404 UI, API 404, wrong password,
 * short password, duplicate email) and mobile responsive behaviour.
 *
 * Chromium comes from @sparticuz/chromium (npm) — see package.json. The NSS
 * libraries bundled in that package are extracted and injected via
 * LD_LIBRARY_PATH so the binary runs on any modern Linux.
 */

import { chromium as pw } from 'playwright-core';
import chromiumPkg from '@sparticuz/chromium';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ------------------------------------------------------------------ options */

const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
const HEADLESS = process.env.HEADLESS !== '0';
const PORT = 3987;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* --------------------------------------------------- local server (default) */

let serverChild = null;
let baseUrl = SITE_URL;

async function startLocalServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-browser-'));
  serverChild = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      PJS_DATA_DIR: dataDir,
      ADMIN_EMAIL: 'admin@browser-test.local',
      ADMIN_PASSWORD: 'AdminBrowser#2026',
      NODE_NO_WARNINGS: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverChild.stdout.on('data', () => {});
  serverChild.stderr.on('data', () => {});
  baseUrl = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) return;
    } catch (_) {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('local server did not start');
}

/* ------------------------------------------------------------- browser boot */

async function launchBrowser() {
  const libDir = '/tmp/pjs-libs/lib';
  if (!fs.existsSync(libDir)) {
    fs.mkdirSync('/tmp/pjs-libs', { recursive: true });
    const br = path.join(HERE, 'node_modules', '@sparticuz/chromium/bin/al2023.tar.br');
    fs.writeFileSync('/tmp/al2023.tar', zlib.brotliDecompressSync(fs.readFileSync(br)));
    execSync('tar xf /tmp/al2023.tar -C /tmp/pjs-libs');
  }
  const executablePath = await chromiumPkg.executablePath();
  return pw.launch({
    executablePath,
    headless: HEADLESS,
    args: chromiumPkg.args.filter((a) => a !== '--single-process'),
    env: { ...process.env, LD_LIBRARY_PATH: libDir }
  });
}

/** Error collector attached to every page we open. */
function watch(page, label, bucket) {
  page.on('pageerror', (err) => bucket.push(`[${label}] JS exception: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Resource errors we trigger on purpose (favicons, the 404 probes and
    // expected 401s after logout / wrong-password) are not app bugs.
    if (/favicon|status of 404|status of 401/.test(text)) return;
    bucket.push(`[${label}] console.error: ${text}`);
  });
  page.on('response', (res) => {
    const url = res.url();
    // A 401 on /api/me right after logout, or on /api/auth/login for the
    // wrong-password probe, is the app working correctly — everything else
    // with status >= 400 is a failure.
    if (res.status() >= 400 && !/favicon|nonexistent|not-a-page|\/api\/me$|\/api\/auth\/login/.test(url)) {
      bucket.push(`[${label}] HTTP ${res.status()} ${url.replace(baseUrl, '')}`);
    }
  });
}

/** 8×8 test PNG written to disk for the photo-upload input. */
function testPhotoFile() {
  const file = path.join(HERE, 'artifacts', 'test-photo.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4nGP8//8/AzbAxIAHMGES+P//PxMDXsCEzjGMSg8AADJkCwlQn8RQAAAAAElFTkSuQmCC',
      'base64'
    )
  );
  return file;
}

/* ------------------------------------------------------------------- helpers */

async function registerViaUi(page, { name, email, gender }) {
  await page.goto(`${baseUrl}/login.html?tab=register`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#registerForm:not(.hide) #regName', { state: 'visible' });
  await page.fill('#regName', name);
  await page.fill('#regEmail', email);
  await page.fill('#regPassword', 'Passw0rd!123');
  await page.selectOption('#regGender', gender);
  await page.selectOption('#regLookingFor', gender === 'male' ? 'female' : 'male');
  await page.waitForFunction(() => document.querySelectorAll('#regCommunity option').length > 1);
  await page.selectOption('#regCommunity', { label: 'Panika' });
  await page.selectOption('#regReligion', { index: 1 });
  await page.fill('#regCity', 'Dispur');
  await page.fill('#regState', 'Assam');
  await page.check('#regTerms');
  await page.click('#registerBtn');
  // Depending on the site settings the app either opens the verification page
  // (auto-verifies the token) or goes straight to the profile editor.
  await page.waitForURL(/(verify-email\.html\?token=|edit-profile\.html\?welcome=1|dashboard\.html)/, {
    timeout: 20000
  });
  if (/verify-email\.html/.test(page.url())) {
    await page.waitForSelector('text=Email verified', { timeout: 20000 });
  }
}

async function loginViaUi(page, email) {
  await page.goto(`${baseUrl}/login.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginForm:not(.hide) #loginEmail', { state: 'visible' });
  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', 'Passw0rd!123');
  await page.click('#loginBtn');
  await page.waitForURL(/dashboard\.html/, { timeout: 20000 });
}

/** Make the profile public + searchable and fill the fields search needs. */
async function completeProfile(page, { headline, age, occupation, city }) {
  await page.goto(`${baseUrl}/edit-profile.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#f_headline', { timeout: 15000 });
  await page.fill('#f_headline', headline);
  await page.fill('#f_age', String(age));
  // occupation is a <select> of common occupations — pick Teacher, else any.
  const occ = page.locator('#f_occupation');
  if (await occ.count()) {
    await occ.selectOption({ label: 'Teacher' }).catch(() => occ.selectOption({ index: 1 }));
  }
  await page.selectOption('#f_visibility', { label: /public|everyone|all members/i }).catch(async () => {
    const n = await page.locator('#f_visibility option').count();
    await page.selectOption('#f_visibility', { index: Math.min(1, n - 1) });
  });
  const searchable = page.locator('#f_searchable');
  if (await searchable.count()) await searchable.check();
  await page.click('#saveTop');
  await page.waitForFunction(
    () => /Saved at/.test(document.querySelector('#savedNote')?.textContent || ''),
    null,
    { timeout: 15000 }
  );
}

/* ---------------------------------------------------------------------- main */

async function main() {
  if (!SITE_URL) {
    console.log('Starting local server (set SITE_URL to test another deployment)…');
    await startLocalServer();
    console.log(`Local server: ${baseUrl}`);
  }

  const consoleErrors = [];
  const browser = await launchBrowser();
  const contextA = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const contextB = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  watch(pageA, 'userA', consoleErrors);
  watch(pageB, 'userB', consoleErrors);

  const stamp = uniq();
  const userA = { name: 'Arjun Test', email: `arjun.${stamp}@browser-test.local` };
  const userB = { name: 'Anjali Test', email: `anjali.${stamp}@browser-test.local` };

  try {
    /* 1 ─ loading */
    section('1. Loading');
    await pageA.goto(baseUrl + '/', { waitUntil: 'load', timeout: 60000 });
    const title = await pageA.title();
    check('home page title', /PANIKA JEEVAN SATHI/i.test(title), title);
    check('home page hero renders', await pageA.locator('h1').first().isVisible());
    const homeText = await pageA.locator('body').innerText();
    check('home states the service is free', /free/i.test(homeText));

    /* 2 ─ navigation */
    section('2. Navigation');
    for (const [pathText] of [
      ['/about.html'],
      ['/contact.html'],
      ['/terms.html'],
      ['/privacy.html']
    ]) {
      const res = await pageA.goto(baseUrl + pathText, { waitUntil: 'domcontentloaded' });
      check(`${pathText} loads (${res.status()})`, res.status() === 200);
      check(`${pathText} renders header/footer`, (await pageA.locator('#siteHeader').count()) === 1);
    }
    for (const memberPage of ['/search.html', '/dashboard.html', '/messages.html', '/edit-profile.html']) {
      await pageA.goto(baseUrl + memberPage, { waitUntil: 'commit' });
      await pageA.waitForURL(/login\.html\?next=/, { timeout: 15000 });
      check(`${memberPage} requires login (redirects)`, true);
    }
    await pageA.goto(baseUrl + '/definitely-not-a-page-' + stamp, { waitUntil: 'domcontentloaded' });
    check('unknown URL shows friendly 404', /does not exist/i.test(await pageA.locator('body').innerText()));

    /* 3 ─ responsive (mobile) */
    section('3. Responsive (mobile 390×844)');
    const mob = await contextA.newPage();
    watch(mob, 'mobile', consoleErrors);
    await mob.setViewportSize({ width: 390, height: 844 });
    await mob.goto(baseUrl + '/', { waitUntil: 'load' });
    const overflow = await mob.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    check('home has no horizontal overflow on mobile', overflow <= 2, `overflow=${overflow}px`);
    await mob.goto(baseUrl + '/login.html?tab=register', { waitUntil: 'domcontentloaded' });
    await mob.waitForSelector('#regName', { state: 'visible' });
    check('register form usable on mobile', await mob.locator('#registerBtn').isVisible());
    const overflowLogin = await mob.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    check('login page has no horizontal overflow', overflowLogin <= 2, `overflow=${overflowLogin}px`);
    await mob.close();

    /* 4 ─ form validation & errors */
    section('4. Forms & error handling');
    await pageA.goto(baseUrl + '/login.html?tab=register', { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#regName', { state: 'visible' });
    await pageA.fill('#regName', 'Short Pass');
    await pageA.fill('#regEmail', `short.${stamp}@browser-test.local`);
    await pageA.fill('#regPassword', 'abc1');
    await pageA.selectOption('#regGender', 'male');
    await pageA.waitForFunction(() => document.querySelectorAll('#regCommunity option').length > 1);
    await pageA.selectOption('#regCommunity', { label: 'Panika' });
    await pageA.fill('#regCity', 'Dispur');
    await pageA.fill('#regState', 'Assam');
    await pageA.check('#regTerms');
    await pageA.click('#registerBtn');
    const validity = await pageA.evaluate(() => ({
      formValid: document.getElementById('registerForm').checkValidity(),
      pwValid: document.getElementById('regPassword').checkValidity()
    }));
    check(
      'short password is blocked by form validation',
      validity.formValid === false && validity.pwValid === false,
      JSON.stringify(validity)
    );

    await pageA.goto(baseUrl + '/login.html', { waitUntil: 'domcontentloaded' });
    await pageA.fill('#loginEmail', 'nobody@nowhere.local');
    await pageA.fill('#loginPassword', 'WrongPass1x');
    await pageA.click('#loginBtn');
    await pageA.waitForSelector('#message .alert', { timeout: 10000 });
    check('wrong credentials show an error', /(no account|password|credentials|not found|invalid)/i.test(await pageA.locator('#message').innerText()));

    const apiStatus = await pageA.evaluate(async () => {
      const res = await fetch('/api/nonexistent');
      return res.status;
    });
    check('unknown API route returns 404', apiStatus === 404, `status=${apiStatus}`);

    /* 5 ─ signup user A */
    section('5. Signup (user A — groom)');
    await registerViaUi(pageA, { name: userA.name, email: userA.email, gender: 'male' });
    check('account created and email auto-verified', true);

    /* 6 ─ login + session */
    section('6. Login & session persistence');
    await loginViaUi(pageA, userA.email);
    check('login lands on dashboard', /dashboard\.html/.test(pageA.url()));
    await pageA.waitForSelector('#greeting', { timeout: 15000 });
    const greeting = await pageA.locator('#greeting').innerText();
    check('dashboard greets the member', greeting.length > 0, greeting);
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#greeting', { timeout: 15000 });
    check('session survives a page refresh', (await pageA.locator('#greeting').innerText()).length > 0);

    // mobile check for the member area (bottom nav is a members-only control)
    const mobDash = await contextA.newPage();
    watch(mobDash, 'mobile-dashboard', consoleErrors);
    await mobDash.setViewportSize({ width: 390, height: 844 });
    await mobDash.goto(baseUrl + '/dashboard.html', { waitUntil: 'load' });
    await mobDash.waitForSelector('#bottomNav .bottom-nav', { timeout: 15000 });
    check('mobile bottom navigation visible for members', await mobDash.locator('#bottomNav .bottom-nav').isVisible());
    const dashOverflow = await mobDash.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    check('dashboard has no horizontal overflow on mobile', dashOverflow <= 2, `overflow=${dashOverflow}px`);
    await mobDash.close();

    /* 7 ─ profile create/edit */
    section('7. Profile create/edit (user A)');
    await completeProfile(pageA, { headline: 'Teacher in Dispur', age: 29, occupation: 'Teacher' });
    check('profile saves (Saved at …)', true);

    /* 8 ─ photo upload */
    section('8. Photo upload (user A)');
    await pageA.goto(baseUrl + '/edit-profile.html', { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#photoInput', { state: 'attached', timeout: 15000 });
    await pageA.setInputFiles('#photoInput', testPhotoFile());
    await pageA.waitForFunction(
      () => {
        const img = document.querySelector('#photoPreview');
        return img && img.getAttribute('src') && img.style.visibility === 'visible';
      },
      null,
      { timeout: 20000 }
    );
    check('photo preview appears after upload', true);
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await pageA.waitForFunction(
      () => {
        const img = document.querySelector('#photoPreview');
        return img && img.getAttribute('src') && img.style.visibility === 'visible';
      },
      null,
      { timeout: 15000 }
    );
    check('photo persists after reload', true);

    /* 9 ─ signup user B + profile */
    section('9. Signup + profile (user B — bride)');
    await registerViaUi(pageB, { name: userB.name, email: userB.email, gender: 'female' });
    await loginViaUi(pageB, userB.email);
    await completeProfile(pageB, { headline: 'Nurse in Guwahati', age: 26, occupation: 'Nurse' });
    check('user B registered and profile saved', true);

    /* 10 ─ search & filters */
    section('10. Search & filters');
    await pageA.goto(baseUrl + '/search.html', { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#results .card, #results .profile-card, #results a, #results .p-card', { timeout: 20000 });
    await pageA.selectOption('#gender', 'female');
    await pageA.fill('#age_min', '20');
    await pageA.fill('#age_max', '35');
    await pageA.click('#filterForm button[type="submit"], #filterForm .btn');
    await pageA.waitForFunction(
      (name) => document.querySelector('#results').innerText.includes(name),
      userB.name,
      { timeout: 20000 }
    );
    check(`search finds ${userB.name} with filters`, true);
    const countText = await pageA.locator('#resultCount').innerText();
    check('result count is shown', /[0-9]/.test(countText), countText);

    /* 11 ─ interest flow */
    section('11. Interest → accept');
    const cardB = pageA.locator('#results *', { hasText: userB.name }).first();
    const viewBtn = pageA.locator(`#results [data-act="view"]`).first();
    await viewBtn.click();
    await pageA.waitForURL(/profile\.html\?id=/, { timeout: 15000 });
    await pageA.waitForSelector('#actInterest', { timeout: 15000 });
    await pageA.click('#actInterest');
    // Sending interest opens a short modal with an optional note.
    await pageA.waitForSelector('[data-x="send"]', { timeout: 10000 });
    await pageA.fill('#note', 'Namaste, we would like to know more about your family.');
    await pageA.click('[data-x="send"]');
    await pageA.waitForFunction(
      () => {
        const b = document.querySelector('#actInterest');
        return b && (b.disabled || /sent/i.test(b.textContent || ''));
      },
      null,
      { timeout: 15000 }
    );
    check('interest sent from profile page', true);

    await pageB.goto(baseUrl + '/interests.html', { waitUntil: 'domcontentloaded' });
    await pageB.click('#tabReceived');
    await pageB.waitForSelector('[data-accept]', { timeout: 20000 });
    check('user B sees the received interest', true);
    await pageB.click('[data-accept]');
    await pageB.waitForSelector('[data-accept]', { state: 'detached', timeout: 20000 });
    check('user B accepted the interest', true);

    /* 12 ─ messaging */
    section('12. Messaging (two-way)');
    await pageB.click('#tabAccepted');
    await pageB.waitForSelector('a[href*="messages.html?with="]', { timeout: 20000 });
    await pageB.click('a[href*="messages.html?with="]');
    await pageB.waitForURL(/messages\.html\?with=/, { timeout: 15000 });
    await pageB.waitForSelector('#draft:enabled', { timeout: 15000 });
    const msgFromB = `Hello from Anjali ${stamp}`;
    await pageB.fill('#draft', msgFromB);
    await pageB.click('#sendForm button');
    await pageB.waitForFunction(
      (t) => document.querySelector('#threadBody').innerText.includes(t),
      msgFromB,
      { timeout: 20000 }
    );
    check('user B sends a message', true);

    await pageA.goto(baseUrl + '/messages.html', { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#conversations a, #conversations .conv, #conversations [data-id]', { timeout: 20000 });
    await pageA.locator('#conversations a, #conversations .conv, #conversations [data-id]').first().click();
    await pageA.waitForSelector('#threadBody', { timeout: 15000 });
    await pageA.waitForFunction(
      (t) => document.querySelector('#threadBody').innerText.includes(t),
      msgFromB,
      { timeout: 20000 }
    );
    check('user A receives the message', true);
    const msgFromA = `Hi Anjali, reply from Arjun ${stamp}`;
    await pageA.waitForSelector('#draft:enabled', { timeout: 15000 });
    await pageA.fill('#draft', msgFromA);
    await pageA.click('#sendForm button');
    await pageA.waitForFunction(
      (t) => document.querySelector('#threadBody').innerText.includes(t),
      msgFromA,
      { timeout: 20000 }
    );
    check('user A replies', true);

    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await pageB.waitForSelector('#threadBody', { timeout: 15000 });
    await pageB.waitForFunction(
      (t) => document.querySelector('#threadBody').innerText.includes(t),
      msgFromA,
      { timeout: 20000 }
    );
    check('user B sees the reply', true);

    /* 13 ─ shortlist */
    section('13. Shortlist');
    await pageA.goto(baseUrl + '/shortlist.html', { waitUntil: 'domcontentloaded' });
    const shortlistBefore = await pageA.locator('body').innerText();
    check('shortlist page loads', /shortlist/i.test(shortlistBefore));

    /* 14 ─ notifications */
    section('14. Notifications');
    await pageA.goto(baseUrl + '/notifications.html', { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#app, .card, body *', { timeout: 15000 });
    const notifText = await pageA.locator('body').innerText();
    check('notifications page lists activity', /(interest|message|accepted)/i.test(notifText), notifText.slice(0, 80));

    /* 15 ─ logout / login again */
    section('15. Logout & login again');
    await pageA.goto(baseUrl + '/settings.html', { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#logoutBtn', { timeout: 15000 });
    await pageA.click('#logoutBtn');
    // settings uses a confirm dialog before logging out
    await pageA.waitForSelector('[data-x="ok"]', { timeout: 10000 });
    await pageA.click('[data-x="ok"]');
    await pageA.waitForURL(/loggedout=1/, { timeout: 20000 });
    check('logout returns to home', true);
    await loginViaUi(pageA, userA.email);
    check('login again works with same credentials', /dashboard\.html/.test(pageA.url()));

    /* 16 ─ contact form */
    section('16. Contact form');
    await pageA.goto(baseUrl + '/contact.html', { waitUntil: 'domcontentloaded' });
    await pageA.fill('#name', 'Concerned Member');
    await pageA.fill('#email', 'member@example.com');
    await pageA.fill('#message', 'This is a browser-automation test of the contact form.');
    await pageA.click('#sendBtn');
    await pageA.waitForFunction(
      () => /(thank|sent|received)/i.test(document.querySelector('#formMsg')?.textContent || ''),
      null,
      { timeout: 20000 }
    );
    check('contact form submits successfully', true);

    /* 17 ─ duplicate email error */
    section('17. Duplicate signup error');
    await pageA.goto(baseUrl + '/login.html?tab=register', { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#regName', { state: 'visible' });
    await pageA.fill('#regName', userA.name);
    await pageA.fill('#regEmail', userA.email);
    await pageA.fill('#regPassword', 'Passw0rd!123');
    await pageA.check('#regTerms');
    await pageA.click('#registerBtn');
    await pageA.waitForSelector('#message .alert', { timeout: 15000 });
    check('duplicate email is rejected with a message', /(exist|already|registered)/i.test(await pageA.locator('#message').innerText()));

    /* 18 ─ console errors across the whole journey */
    section('18. Console / JS errors');
    check('no unexpected console or page errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  } catch (err) {
    failed += 1;
    failures.push(`suite crashed: ${err.message}`);
    console.error('\nSUITE CRASHED:', err.message);
    for (const [name, pg] of [['userA', pageA], ['userB', pageB]]) {
      try {
        fs.mkdirSync(path.join(HERE, 'artifacts'), { recursive: true });
        await pg.screenshot({ path: path.join(HERE, 'artifacts', `crash-${name}.png`), fullPage: true });
      } catch (_) { /* page may be gone */ }
    }
  } finally {
    await browser.close().catch(() => {});
    if (serverChild) serverChild.kill('SIGTERM');
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('  Failures:');
    for (const f of failures) console.log(`   • ${f}`);
  }
  console.log('──────────────────────────────────────────────');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
