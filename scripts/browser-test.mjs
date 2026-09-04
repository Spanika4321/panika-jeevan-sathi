#!/usr/bin/env node
/** Real Chromium checks. Setup: npm ci && npx playwright install --with-deps chromium */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';
import { startTestApp, register, adminClient, ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/test-app.mjs';

let app;
let browser;
before(async () => {
  app = await startTestApp();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PJS_CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox']
  });
});
after(async () => {
  await browser?.close();
  await app?.stop();
});

async function pageFor(t, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ baseURL: app.base, viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], 'no browser JavaScript errors');
  });
  return page;
}

async function visit(page, url) {
  assert.equal((await page.goto(url)).status(), 200, url);
  await page.waitForFunction(() => document.querySelector('#siteHeader')?.children.length > 0);
}

async function fillRegistration(page, email) {
  await visit(page, '/register');
  await page.locator('#regName').fill('Browser Test Member');
  await page.locator('#regEmail').fill(email);
  await page.locator('#regPassword').fill('BrowserPass123');
  await page.locator('#regCommunity').selectOption('Panika');
  await page.locator('#regTerms').check();
  await page.locator('#registerBtn').click();
}

test('mobile public pages and legacy registration links render without errors or overflow', async (t) => {
  const page = await pageFor(t, { width: 390, height: 844 });
  for (const url of ['/', '/about.html', '/contact.html', '/login.html', '/privacy.html', '/terms.html', '/register.html', '/forgot-password.html']) {
    await visit(page, url);
    assert.ok(await page.locator('main').isVisible(), url);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${url}: no horizontal overflow`);
  }
  assert.ok(await page.locator('#forgotForm').isVisible());
});

test('registration, profile editing and all member pages work in the browser', async (t) => {
  const page = await pageFor(t);
  await fillRegistration(page, 'browser@test.example');
  await page.waitForURL('**/edit-profile.html?welcome=1');
  await page.locator('#f_age').fill('26');
  await page.locator('#f_city').fill('Bilaspur');
  await page.locator('#f_education').selectOption('Graduate');
  await page.locator('#saveTop').click();
  await page.waitForFunction(() => /saved/i.test(document.querySelector('#status')?.textContent || ''));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#f_age')?.value === '26');
  assert.equal(await page.locator('#f_city').inputValue(), 'Bilaspur');
  const me = await (await page.request.get('/api/me')).json();
  for (const url of ['/dashboard.html', '/search.html', '/matches.html', '/interests.html', '/shortlist.html', '/messages.html', '/notifications.html', '/settings.html', `/profile.html?id=${me.user.id}`]) {
    await visit(page, url);
    assert.ok(await page.locator('main').isVisible(), url);
  }
  await page.request.post('/api/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  await visit(page, '/admin.html');
  await page.waitForFunction(() => window.PJS?.me?.role === 'admin');
});

test('verification-required signup waits for the real emailed link without auto-verifying', async (t) => {
  const admin = await adminClient(app);
  await admin.put('/api/admin/settings', { require_email_verification: '1' });
  t.after(() => admin.put('/api/admin/settings', { require_email_verification: '0' }));
  const page = await pageFor(t);
  await fillRegistration(page, 'verify-browser@test.example');
  await page.waitForFunction(() => document.querySelector('#message')?.textContent.includes('Account created'));
  assert.equal(await page.locator('#message a[href*="token="]').count(), 0);
  assert.equal((await page.request.get('/api/me')).status(), 401);
  const link = app.mailLink('verify-browser@test.example', 'verify-email.html');
  await visit(page, link.pathname + link.search);
  await page.waitForFunction(() => document.querySelector('#state')?.textContent.includes('Email verified'));
  await page.locator('a', { hasText: 'Log in now' }).click();
  await page.locator('#loginEmail').fill('verify-browser@test.example');
  await page.locator('#loginPassword').fill('BrowserPass123');
  await page.locator('#loginBtn').click();
  await page.waitForURL('**/dashboard.html');
});

test('chat refresh updates read receipts, isolates drafts and ignores stale responses', async (t) => {
  const sender = app.client();
  const senderUser = await register(sender, 'chat-sender@test.example');
  const recipients = [];
  for (const suffix of ['b', 'c']) {
    const client = app.client();
    const user = await register(client, `chat-${suffix}@test.example`);
    await sender.post('/api/interests', { to_user_id: user.id });
    const received = await client.get('/api/interests');
    await client.post(`/api/interests/${received.body.interests[0].id}/respond`, { decision: 'accept' });
    await sender.post('/api/messages', { to: user.id, body: `Namaste ${suffix}` });
    recipients.push({ client, user });
  }
  const [b, c] = recipients;
  const page = await pageFor(t);
  await page.request.post('/api/auth/login', { data: { email: 'chat-sender@test.example', password: 'MemberPass123' } });
  await visit(page, `/messages.html?with=${b.user.id}`);
  await page.locator('#draft').waitFor();
  await b.client.post(`/api/conversations/${senderUser.id}/read`);
  await page.waitForFunction(() => document.querySelector('.bubble.mine time')?.textContent.includes('Read'), null, { timeout: 8000 });

  await page.locator('#draft').fill('Private draft for B');
  await page.locator(`#conversations [data-id="${c.user.id}"]`).click();
  await page.locator(`.thread-head a[href="/profile.html?id=${c.user.id}"]`).first().waitFor();
  assert.equal(await page.locator('#draft').inputValue(), '', 'do not carry a draft to another recipient');
  await page.locator('#draft').fill('Private draft for C');
  await page.locator(`#conversations [data-id="${b.user.id}"]`).click();
  await page.locator(`.thread-head a[href="/profile.html?id=${b.user.id}"]`).first().waitFor();
  assert.equal(await page.locator('#draft').inputValue(), 'Private draft for B');

  let release;
  let intercepted;
  const waiting = new Promise((resolve) => { intercepted = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(`**/api/conversations/${b.user.id}`, async (route) => {
    const response = await route.fetch();
    intercepted();
    await gate;
    await route.fulfill({ response });
  }, { times: 1 });
  await page.locator(`#conversations [data-id="${b.user.id}"]`).click();
  await waiting;
  await page.locator(`#conversations [data-id="${c.user.id}"]`).click();
  await page.locator(`.thread-head a[href="/profile.html?id=${c.user.id}"]`).first().waitFor();
  const oldResponse = page.waitForResponse(`**/api/conversations/${b.user.id}`);
  release();
  await oldResponse;
  // Await completion of the old fetch callback, not just response headers.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  assert.ok(await page.locator(`.thread-head a[href="/profile.html?id=${c.user.id}"]`).first().isVisible());
  assert.equal(await page.locator('#draft').inputValue(), 'Private draft for C');
  await page.locator('#sendForm button').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.bubble.mine')].some((bubble) => bubble.textContent.includes('Private draft for C')));
  const cMessages = await c.client.get(`/api/conversations/${senderUser.id}`);
  const bMessages = await b.client.get(`/api/conversations/${senderUser.id}`);
  assert.ok(cMessages.body.messages.some((message) => message.body === 'Private draft for C'));
  assert.ok(!bMessages.body.messages.some((message) => message.body === 'Private draft for C'));
});

test('missing chats and non-JSON API responses show errors instead of crashing or reporting success', async (t) => {
  const page = await pageFor(t);
  await page.request.post('/api/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  await visit(page, '/messages.html?with=999999');
  await page.waitForFunction(() => /not available|could not/i.test(document.querySelector('#thread')?.textContent || ''), null, { timeout: 5000 });
  await page.route('**/api/browser-response-check', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Server loading</h1>' }));
  const response = await page.evaluate(() => window.PJS.get('/api/browser-response-check'));
  assert.equal(response.ok, false);
  assert.ok(response.error);
});


test('confirmation dialogs resolve on backdrop and Escape without confirming an action', async (t) => {
  const page = await pageFor(t);
  await visit(page, '/');
  for (const action of ['backdrop', 'escape', 'confirm']) {
    await page.evaluate(() => {
      window.dialogResult = null;
      window.PJS.confirm('Confirm?', 'Test action', 'Continue').then((result) => { window.dialogResult = result; });
    });
    if (action === 'backdrop') await page.locator('.modal-back').click({ position: { x: 2, y: 2 } });
    else if (action === 'escape') await page.keyboard.press('Escape');
    else await page.locator('[data-x="ok"]').click();
    await page.waitForFunction(() => window.dialogResult !== null);
    assert.equal(await page.evaluate(() => window.dialogResult), action === 'confirm');
  }
});

test('CSP blocks injected scripts and the empty-search reset button still works', async (t) => {
  const page = await pageFor(t);
  await visit(page, '/');
  const injected = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.textContent = 'window.untrustedScriptRan = true';
    document.body.append(script);
    const image = document.createElement('img');
    image.setAttribute('onerror', 'window.untrustedHandlerRan = true');
    document.body.append(image);
    image.dispatchEvent(new Event('error'));
    return Boolean(window.untrustedScriptRan || window.untrustedHandlerRan);
  });
  assert.equal(injected, false, 'neither an injected script nor an inline handler executes');
  await page.request.post('/api/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  await visit(page, '/search.html?keyword=ThisNameDoesNotExistAnywhere');
  await page.locator('#emptyResetBtn').click();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('keyword'));
});
