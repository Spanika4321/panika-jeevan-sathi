#!/usr/bin/env node
/**
 * EK BAAR ka setup: GAS_REFRESH_TOKEN banata hai (phone par bhi ho jata hai).
 *
 *   GAS_CLIENT_ID=... GAS_CLIENT_SECRET=... node scripts/appsscript-auth.mjs
 *
 * 1) Ye ek Google login link print karta hai — browser mein kholein, allow karein.
 * 2) Google ek code dega — usko yahan paste karein.
 * 3) Script aapka refresh token print karega → GitHub Secret GAS_REFRESH_TOKEN.
 *
 * Isme koi password kahin store nahi hota.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const CLIENT_ID = process.env.GAS_CLIENT_ID;
const CLIENT_SECRET = process.env.GAS_CLIENT_SECRET;
const REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';
const SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments'
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n  GAS_CLIENT_ID aur GAS_CLIENT_SECRET chahiye.');
  console.error('  console.cloud.google.com → APIs & Services → Credentials →');
  console.error('  Create credentials → OAuth client ID → Desktop app.\n');
  process.exit(1);
}

const url =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });

console.log('\n  1) Ye link kholein aur allow karein:\n');
console.log(`     ${url}\n`);

const rl = readline.createInterface({ input, output });
const code = (await rl.question('  2) Google se mila code yahan paste karein: ')).trim();
rl.close();

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code'
  })
});
const data = await res.json();
if (!res.ok || !data.refresh_token) {
  console.error(`\n  ✖ Nahi mila: ${JSON.stringify(data)}\n`);
  process.exit(1);
}
console.log('\n  ✓ GAS_REFRESH_TOKEN =\n');
console.log(`    ${data.refresh_token}\n`);
console.log('  Isko GitHub → Settings → Secrets → Actions mein save karein.\n');
