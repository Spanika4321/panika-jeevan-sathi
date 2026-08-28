#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — end-to-end test.
 *
 * Boots a real server on a temporary data folder and exercises the complete
 * member journey:
 *
 *   Register → Login → Create/Edit Profile → Photo upload → Search & filters →
 *   Interest → Accept → Message → Receive message → Notifications → Shortlist →
 *   Privacy → Report → Admin panel → Logout → Login again → Restart persistence
 *
 *   node scripts/e2e-test.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-e2e-'));
const PORT = 3000 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Minimal browser-like client with its own cookie jar. */
function client() {
  const jar = new Map();
  async function call(method, urlPath, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(BASE + urlPath, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const cookie of setCookie) {
      const [pair] = cookie.split(';');
      const idx = pair.indexOf('=');
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /Max-Age=0/i.test(cookie)) jar.delete(key);
      else jar.set(key, value);
    }
    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      json = null;
    }
    return { status: res.status, body: json, headers: res.headers };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b || {}),
    put: (p, b) => call('PUT', p, b || {}),
    patch: (p, b) => call('PATCH', p, b || {}),
    del: (p, b) => call('DELETE', p, b || {}),
    hasSession: () => jar.size > 0,
    clear: () => jar.clear()
  };
}

function pngDataUrl() {
  // 8x8 solid PNG
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4nGP8//8/AzbAxIAHMGES+P//PxMDXsCEzjGMSg8AADJkCwlQn8RQAAAAAElFTkSuQmCC';
  return `data:image/png;base64,${base64}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(proc) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch (_) {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('Server did not start in time');
}

const ADMIN_EMAIL = 'admin@panikajeevansathi.com';
const ADMIN_PASSWORD = 'AdminTest#2026';

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      PJS_DATA_DIR: DATA_DIR,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      NODE_NO_WARNINGS: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  child.stdout.on('data', (d) => (serverLog += d.toString()));
  child.stderr.on('data', (d) => (serverLog += d.toString()));

  try {
    await waitForServer(child);

    /* ------------------------------------------------------------ 1. auth */
    section('1. Registration & login');
    const ravi = client();
    let res = await ravi.post('/api/auth/register', {
      name: 'Ravi Panika',
      email: 'ravi@example.com',
      password: 'Passw0rd123',
      gender: 'male',
      city: 'Bilaspur',
      state: 'Chhattisgarh',
      community: 'Panika',
      looking_for: 'female'
    });
    check('register creates account', res.status === 200 && res.body.ok, JSON.stringify(res.body));
    check('register starts a session', ravi.hasSession());

    res = await ravi.post('/api/auth/register', {
      name: 'Duplicate',
      email: 'ravi@example.com',
      password: 'Passw0rd123'
    });
    check('duplicate email rejected', res.status === 409);

    res = await ravi.post('/api/auth/register', {
      name: 'Weak',
      email: 'weak@example.com',
      password: 'abc'
    });
    check('weak password rejected', res.status === 400);

    const suresh = client();
    res = await suresh.post('/api/auth/register', {
      name: 'Suresh Manikpuri',
      email: 'suresh@example.com',
      password: 'Passw0rd123',
      gender: 'male',
      city: 'Raipur',
      state: 'Chhattisgarh'
    });
    check('second member registers', res.status === 200);

    const meera = client();
    res = await meera.post('/api/auth/register', {
      name: 'Meera Kanwar',
      email: 'meera@example.com',
      password: 'Passw0rd123',
      gender: 'female',
      city: 'Bilaspur',
      state: 'Chhattisgarh',
      community: 'Panika',
      looking_for: 'male'
    });
    check('female member registers', res.status === 200);
    const meeraId = res.body.user.id;

    res = await meera.get('/api/me');
    check('session returns own account', res.status === 200 && res.body.user.email === 'meera@example.com');

    /* ------------------------------------------------- 2. profile create */
    section('2. Profile creation & photo upload');
    res = await ravi.put('/api/profile', {
      headline: 'Simple, family oriented groom',
      age: 28,
      gender: 'Male',
      height_cm: 173,
      marital_status: 'Never Married',
      religion: 'Hindu',
      community: 'Panika',
      mother_tongue: 'Hindi',
      city: 'Bilaspur',
      state: 'Chhattisgarh',
      country: 'India',
      education: 'Graduate',
      education_detail: 'B.Com',
      occupation: 'Government Job',
      company: 'Revenue Department',
      annual_income: '5 - 10 Lakh',
      diet: 'Vegetarian',
      smoking: 'No',
      drinking: 'No',
      about_me: 'I am a simple person from Bilaspur working in a government office.',
      family_type: 'Joint',
      family_status: 'Middle Class',
      father_occupation: 'Farming',
      mother_occupation: 'Homemaker',
      siblings: '1 younger sister',
      pref_age_min: 22,
      pref_age_max: 28,
      pref_gender: 'Female',
      pref_location: 'Chhattisgarh',
      pref_education: 'Graduate',
      pref_community: 'Panika'
    });
    check('profile saves', res.status === 200 && res.body.profile.age === 28, JSON.stringify(res.body).slice(0, 200));
    check('completeness calculated', res.body.completeness >= 70, `got ${res.body.completeness}`);

    res = await ravi.put('/api/profile', { age: 150 });
    check('invalid age rejected', res.status === 400);

    res = await ravi.post('/api/profile/photo', { data_url: pngDataUrl() });
    check('photo uploads', res.status === 200 && /^\/uploads\//.test(res.body.photo), JSON.stringify(res.body));
    const photoPath = res.body.photo;

    const photoRes = await fetch(BASE + photoPath);
    check('photo is served back', photoRes.status === 200);

    res = await ravi.post('/api/profile/photo', { data_url: 'data:text/plain;base64,aGVsbG8=' });
    check('non-image upload rejected', res.status === 400);

    res = await meera.put('/api/profile', {
      headline: 'Teacher, loves family values',
      age: 25,
      gender: 'Female',
      height_cm: 157,
      marital_status: 'Never Married',
      religion: 'Hindu',
      community: 'Panika',
      mother_tongue: 'Hindi',
      city: 'Bilaspur',
      state: 'Chhattisgarh',
      country: 'India',
      education: 'Post Graduate',
      occupation: 'Teacher',
      diet: 'Vegetarian',
      about_me: 'I work as a school teacher and respect family traditions.',
      family_type: 'Joint',
      father_occupation: 'Business',
      pref_age_min: 25,
      pref_age_max: 32,
      pref_gender: 'Male',
      pref_location: 'Chhattisgarh',
      pref_community: 'Panika'
    });
    check('second profile saves', res.status === 200 && res.body.profile.gender === 'Female');

    res = await suresh.put('/api/profile', {
      age: 31,
      gender: 'Male',
      marital_status: 'Divorced',
      religion: 'Kabirpanth',
      community: 'Manikpuri',
      mother_tongue: 'Hindi',
      city: 'Raipur',
      state: 'Chhattisgarh',
      education: '12th Pass',
      occupation: 'Business / Self Employed',
      about_me: 'Running my own shop in Raipur.',
      pref_age_min: 24,
      pref_age_max: 30,
      pref_gender: 'Female'
    });
    check('third profile saves', res.status === 200);

    /* ------------------------------------------------------- 3. search */
    section('3. Search, filters & recommendations');
    res = await ravi.get('/api/profiles');
    check('search returns other profiles only', res.status === 200 && res.body.total === 2, `total=${res.body.total}`);
    check('own profile excluded', !res.body.results.some((r) => r.name === 'Ravi Panika'));

    res = await ravi.get('/api/profiles?gender=female');
    check('gender filter works', res.body.total === 1 && res.body.results[0].gender === 'Female');

    res = await ravi.get('/api/profiles?age_min=30&age_max=40');
    check('age filter works', res.body.total === 1 && res.body.results[0].age === 31);

    res = await ravi.get('/api/profiles?community=Panika');
    check('community filter works', res.body.total === 1);

    res = await ravi.get('/api/profiles?education=Post+Graduate');
    check('education filter works', res.body.total === 1);

    res = await ravi.get('/api/profiles?occupation=Teacher');
    check('occupation filter works', res.body.total === 1);

    res = await ravi.get('/api/profiles?state=Chhattisgarh&city=Bilaspur');
    check('location filter works', res.body.total === 1);

    res = await ravi.get('/api/profiles?keyword=teacher');
    check('keyword search works', res.body.total === 1);

    res = await ravi.get('/api/profiles?marital_status=Divorced');
    check('marital status filter works', res.body.total === 1);

    res = await ravi.get('/api/matches');
    check('recommended matches scored', res.status === 200 && res.body.results.length === 2);
    const topMatch = res.body.results[0];
    check('best match is the closest fit', topMatch.card.name === 'Meera Kanwar', `got ${topMatch.card.name}`);
    check('match reasons returned', Array.isArray(topMatch.reasons) && topMatch.reasons.length > 0);

    res = await ravi.get(`/api/profiles/${meeraId}`);
    check('profile detail page loads', res.status === 200 && res.body.profile.community === 'Panika');
    check('detail hides email from others', res.body.profile.email === undefined);

    /* ----------------------------------------------------- 4. interests */
    section('4. Interests (send → receive → accept)');
    res = await ravi.get('/api/me');
    const raviId = res.body.user.id;

    res = await ravi.post('/api/messages', { to: meeraId, body: 'Hello before acceptance' });
    check('messaging blocked before interest accepted', res.status === 403, JSON.stringify(res.body));

    res = await ravi.post('/api/interests', { to_user_id: meeraId, message: 'Our families may be a good match.' });
    check('interest sent', res.status === 200, JSON.stringify(res.body));

    res = await ravi.post('/api/interests', { to_user_id: meeraId });
    check('duplicate interest blocked', res.status === 409);

    res = await ravi.post('/api/interests', { to_user_id: raviId });
    check('self interest blocked', res.status === 400);

    res = await meera.get('/api/interests?direction=received');
    check('receiver sees interest', res.status === 200 && res.body.interests.length === 1);
    const interestId = res.body.interests[0].id;
    check('interest shows sender profile', res.body.interests[0].user.name === 'Ravi Panika');

    res = await ravi.get('/api/interests?direction=sent');
    check('sender sees sent interest', res.body.interests.length === 1 && res.body.interests[0].status === 'pending');

    res = await ravi.post(`/api/interests/${interestId}/respond`, { decision: 'accept' });
    check('only receiver can respond', res.status === 404 || res.status === 403, `status=${res.status}`);

    res = await meera.post(`/api/interests/${interestId}/respond`, { decision: 'accept' });
    check('interest accepted', res.status === 200 && res.body.status === 'accepted', JSON.stringify(res.body));

    res = await meera.post(`/api/interests/${interestId}/respond`, { decision: 'decline' });
    check('cannot answer twice', res.status === 409);

    res = await ravi.get('/api/unread');
    check('acceptance notification counted', res.body.counts.notifications >= 1);

    /* ------------------------------------------------------ 5. messaging */
    section('5. Private messaging');
    res = await ravi.post('/api/messages', { to: meeraId, body: 'Namaste Meera ji, our families may be a good match.' });
    check('message sent after acceptance', res.status === 200, JSON.stringify(res.body));
    await sleep(5);
    res = await ravi.post('/api/messages', { to: meeraId, body: 'When can our families talk?' });
    check('second message sent', res.status === 200);

    res = await meera.get('/api/unread');
    check('receiver sees unread count', res.body.counts.messages === 2, `unread=${res.body.counts.messages}`);

    res = await meera.get('/api/conversations');
    check('conversation list shows thread', res.body.conversations.length === 1);
    check('conversation shows unread badge', res.body.conversations[0].unread === 2);

    res = await meera.get(`/api/conversations/${raviId}`);
    check('history loads', res.body.messages.length === 2);
    check('messages attributed correctly', res.body.messages.every((m) => m.mine === false));
    check('connection flag set', res.body.connected === true);

    res = await meera.post('/api/messages', { to: raviId, body: 'Namaste Ravi ji, yes we can talk this weekend.' });
    check('reply sent', res.status === 200);

    res = await ravi.get(`/api/conversations/${meeraId}`);
    check('sender sees reply', res.body.messages.length === 3 && res.body.messages[2].mine === false);

    res = await ravi.post(`/api/conversations/${meeraId}/read`);
    check('messages marked read', res.body.marked === 1);

    res = await meera.post('/api/messages', { to: raviId, body: '' });
    check('empty message rejected', res.status === 400);

    res = await ravi.post('/api/messages', { to: 999999, body: 'hi' });
    check('unknown recipient rejected', res.status === 404);

    res = await ravi.get('/api/notifications');
    check('message notifications delivered', res.body.notifications.some((n) => n.type === 'message'));

    /* ------------------------------------------------------ 6. shortlist */
    section('6. Shortlist');
    res = await ravi.post('/api/shortlist', { user_id: meeraId });
    check('shortlist added', res.body.shortlisted === true);
    res = await ravi.get('/api/shortlist');
    check('shortlist lists profile', res.body.results.length === 1 && res.body.results[0].name === 'Meera Kanwar');
    res = await ravi.post('/api/shortlist', { user_id: meeraId });
    check('shortlist toggles off', res.body.shortlisted === false);
    res = await ravi.get('/api/shortlist');
    check('shortlist empty after toggle', res.body.results.length === 0);
    await ravi.post('/api/shortlist', { user_id: meeraId });

    /* ------------------------------------------------------- 7. privacy */
    section('7. Privacy & visibility');
    res = await suresh.put('/api/profile', { visibility: 'hidden' });
    check('visibility updates', res.status === 200);
    res = await ravi.get('/api/profiles');
    check('hidden profile removed from search', res.body.total === 1);
    const sureshRes = await suresh.get('/api/me');
    const sureshId = sureshRes.body.user.id;
    res = await ravi.get(`/api/profiles/${sureshId}`);
    check('hidden profile detail blocked', res.status === 404);
    await suresh.put('/api/profile', { visibility: 'members' });
    res = await ravi.get('/api/profiles');
    check('profile visible again', res.body.total === 2);

    res = await meera.put('/api/profile', { hide_photo: 1 });
    res = await ravi.get(`/api/profiles/${meeraId}`);
    check('photo hidden from others when privacy on', res.body.photo === null);
    await meera.put('/api/profile', { hide_photo: 0 });

    /* ------------------------------------------------------- 8. reports */
    section('8. Report a profile');
    res = await ravi.post('/api/reports', { user_id: sureshId, reason: 'Fake profile', details: 'Photos look copied.' });
    check('report submitted', res.status === 200);
    res = await ravi.post('/api/reports', { user_id: sureshId, reason: 'Fake profile' });
    check('duplicate report blocked', res.status === 409);

    /* ---------------------------------------------------- 9. contact us */
    section('9. Contact form & public content');
    const anon = client();
    res = await anon.post('/api/contact', {
      name: 'Family of Anita',
      email: 'family@example.com',
      phone: '918099834725',
      subject: 'Registration help',
      message: 'We need help creating a profile for our daughter.'
    });
    check('contact form saves', res.status === 200);
    res = await anon.post('/api/contact', { name: 'X', message: '' });
    check('empty contact rejected', res.status === 400);
    res = await anon.get('/api/site');
    check('site content is public', res.body.site.whatsapp_number === '918099834725');
    res = await anon.get('/api/profiles');
    check('search requires login', res.status === 401);

    /* ------------------------------------------------------------ 10. admin */
    section('10. Admin panel');
    const admin = client();
    res = await admin.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    check('admin login works', res.status === 200 && res.body.user.role === 'admin', JSON.stringify(res.body));

    res = await admin.get('/api/admin/stats');
    check('admin stats', res.status === 200 && res.body.stats.users === 4, JSON.stringify(res.body.stats));

    res = await ravi.get('/api/admin/stats');
    check('non-admin blocked from admin API', res.status === 403);

    res = await admin.get('/api/admin/users?q=meera');
    check('admin user search', res.body.users.length === 1 && res.body.users[0].name === 'Meera Kanwar');

    res = await admin.patch(`/api/admin/users/${meeraId}`, { name: 'Meera Kanwar (verified)' });
    check('admin edits user', res.body.user.name === 'Meera Kanwar (verified)');

    res = await admin.get('/api/admin/reports');
    check('admin sees reports', res.body.reports.length === 1 && res.body.reports[0].status === 'open');
    const reportId = res.body.reports[0].id;
    res = await admin.patch(`/api/admin/reports/${reportId}`, { status: 'resolved' });
    check('admin resolves report', res.status === 200);

    res = await admin.get('/api/admin/contact');
    check('admin sees contact messages', res.body.messages.length === 1);

    res = await admin.post('/api/admin/stories', {
      title: 'Together since 2024',
      couple: 'Ankit & Pooja',
      location: 'Bilaspur',
      body: 'We met on PANIKA JEEVAN SATHI and our families connected within a month.',
      approved: 1
    });
    check('admin adds success story', res.status === 200);
    const storyId = res.body.story.id;
    res = await anon.get('/api/stories');
    check('approved story is public', res.body.stories.length === 1);

    res = await admin.put('/api/admin/settings', { hero_title: 'Test headline', maintenance: '0' });
    check('admin edits website content', res.body.settings.hero_title === 'Test headline');
    res = await anon.get('/api/site');
    check('content change is live', res.body.site.hero_title === 'Test headline');
    await admin.put('/api/admin/settings', { hero_title: 'Find a life partner with trust, respect and family values' });

    res = await admin.del(`/api/admin/users/${sureshId}/photo`);
    check('admin manages profile photos', res.status === 200);

    /* ------------------------------------------------- 11. logout / login */
    section('11. Logout, login again & persistence');
    res = await ravi.post('/api/auth/logout');
    check('logout clears session', res.status === 200);
    res = await ravi.get('/api/me');
    check('session invalid after logout', res.status === 401);

    res = await ravi.post('/api/auth/login', { email: 'ravi@example.com', password: 'WrongPass123' });
    check('wrong password rejected', res.status === 401);

    res = await ravi.post('/api/auth/login', { email: 'ravi@example.com', password: 'Passw0rd123' });
    check('login again works', res.status === 200);

    res = await ravi.get('/api/profile');
    check('profile persisted after re-login', res.body.profile.community === 'Panika' && res.body.profile.age === 28);

    res = await ravi.get('/api/conversations');
    check('messages persisted after re-login', res.body.conversations.length === 1 && res.body.conversations[0].unread === 0);

    res = await ravi.get('/api/shortlist');
    check('shortlist persisted', res.body.results.length === 1);

    res = await ravi.get('/api/interests?direction=sent');
    check('interest persisted as accepted', res.body.interests[0].status === 'accepted');

    /* ---------------------------------------------------- 12. password */
    section('12. Forgot password & password change');
    res = await ravi.post('/api/auth/forgot', { email: 'ravi@example.com' });
    check('reset link issued', res.status === 200 && res.body.reset_link);
    const token = new URL(res.body.reset_link).searchParams.get('token');
    res = await ravi.post('/api/auth/reset', { token, password: 'NewPass1234' });
    check('password reset works', res.status === 200, JSON.stringify(res.body));
    res = await ravi.post('/api/auth/login', { email: 'ravi@example.com', password: 'Passw0rd123' });
    check('old password no longer valid', res.status === 401);
    res = await ravi.post('/api/auth/login', { email: 'ravi@example.com', password: 'NewPass1234' });
    check('new password works', res.status === 200);

    res = await ravi.post('/api/me/password', { current_password: 'Bad1234', new_password: 'Other1234' });
    check('wrong current password rejected', res.status === 400);
    res = await ravi.post('/api/me/password', { current_password: 'NewPass1234', new_password: 'Final1234' });
    check('password change works', res.status === 200);
    res = await ravi.get('/api/me');
    check('still logged in after password change', res.status === 200);

    /* ------------------------------------------------- 13. pages & assets */
    section('13. Pages, assets & security headers');
    const pages = [
      '/index.html', '/login.html', '/verify-email.html', '/reset-password.html', '/dashboard.html',
      '/edit-profile.html', '/profile.html', '/search.html', '/matches.html', '/interests.html',
      '/shortlist.html', '/messages.html', '/notifications.html', '/settings.html', '/contact.html',
      '/admin.html', '/about.html', '/privacy.html', '/terms.html', '/assets/css/app.css',
      '/assets/js/app.js', '/assets/js/cards.js', '/assets/img/favicon.svg'
    ];
    let pagesOk = 0;
    for (const p of pages) {
      const r = await fetch(BASE + p);
      if (r.status === 200) pagesOk++;
      else console.log(`    ! ${p} returned ${r.status}`);
    }
    check('every page and asset is served (200)', pagesOk === pages.length, `${pagesOk}/${pages.length}`);

    const home = await (await fetch(BASE + '/index.html')).text();
    check('home page loads the app shell', home.includes('/assets/css/app.css') && home.includes('/assets/js/app.js'));
    check('home page carries the WhatsApp number', home.includes('918099834725'));
    check('home page states the service is free', /free/i.test(home));
    const paywall = /₹\s?\d|buy now|subscribe now|payment gateway|razorpay|stripe|upgrade to (gold|premium)|pricing plan/i;
    check('no payment or paywall UI anywhere', !paywall.test(home), 'found paywall wording on the home page');
    check('home page promises no locked profiles', /no locked profiles/i.test(home));

    const loginPage = await (await fetch(BASE + '/login.html')).text();
    check('login page has register + forgot forms', loginPage.includes('registerForm') && loginPage.includes('forgotForm'));

    const head = await fetch(BASE + '/index.html');
    check('security headers sent', head.headers.get('x-content-type-options') === 'nosniff');

    const missing = await fetch(BASE + '/no-such-page.html');
    check('unknown page returns 404', missing.status === 404);

    const traversal = await fetch(BASE + '/../server.js');
    check('path traversal is blocked', traversal.status !== 200);

    for (const blocked of ['/data/admin-credentials.txt', '/data/panika-jeevan-sathi.db', '/server.js', '/lib/api.js']) {
      const r = await fetch(BASE + blocked);
      check('server file not reachable over HTTP: ' + blocked, r.status !== 200, `got ${r.status}`);
    }

    const anonProfile = await anon.get('/api/profiles/' + meeraId);
    check('anonymous visitor cannot open a members-only profile', anonProfile.status === 401, `got ${anonProfile.status}`);
    const anonMatches = await anon.get('/api/matches');
    check('anonymous visitor cannot read recommendations', anonMatches.status === 401);

    const badApi = await fetch(BASE + '/api/does-not-exist');
    check('unknown API route returns 404', badApi.status === 404);

    /* ------------------------------------------------ 14. restart persists */
    section('14. Data survives a server restart');
    child.kill('SIGTERM');
    await new Promise((r) => child.on('exit', r));

    const child2 = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), PJS_DATA_DIR: DATA_DIR, NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child2.stdout.on('data', (d) => (serverLog += d.toString()));
    child2.stderr.on('data', (d) => (serverLog += d.toString()));
    await waitForServer(child2);

    const after = client();
    res = await after.post('/api/auth/login', { email: 'meera@example.com', password: 'Passw0rd123' });
    check('account survives restart', res.status === 200);
    res = await after.get('/api/conversations');
    check('messages survive restart', res.body.conversations.length === 1);
    res = await after.get(`/api/conversations/${raviId}`);
    check('message history intact', res.body.messages.length === 3, `got ${res.body.messages.length}`);
    res = await after.get('/api/profile');
    check('profile survives restart', res.body.profile.occupation === 'Teacher');
    const photoAgain = await fetch(BASE + photoPath);
    check('uploaded photo survives restart', photoAgain.status === 200);

    child2.kill('SIGTERM');
    await new Promise((r) => child2.on('exit', r));

    /* ----------------------------------------------------------- summary */
    console.log('\n' + '─'.repeat(58));
    console.log(`  ${passed} passed, ${failed} failed`);
    if (failures.length) {
      console.log('\n  Failures:');
      for (const f of failures) console.log(`   • ${f}`);
    }
    console.log('─'.repeat(58));
    if (failed) console.log('\nServer log tail:\n' + serverLog.split('\n').slice(-40).join('\n'));
    process.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('\nE2E test crashed:', err);
    console.error('\nServer log tail:\n' + serverLog.split('\n').slice(-40).join('\n'));
    try {
      child.kill('SIGKILL');
    } catch (_) {
      /* ignore */
    }
    process.exit(1);
  }
}

main();
