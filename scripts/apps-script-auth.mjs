#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI — one-time Google authorisation for the Apps Script
 * deploy workflow.
 *
 * Uses the OAuth 2.0 device flow, which is the only flow that works when you
 * have no terminal with a browser (for example: you set everything up from an
 * Android phone).
 *
 *   node scripts/apps-script-auth.mjs --client-id YOUR_CLIENT_ID
 *
 * It prints a short code, you open https://google.com/device on your phone,
 * type the code, tap Allow — and the script prints the refresh token that the
 * GitHub Actions workflow needs.
 *
 * Required Google Cloud setup (once):
 *   1. console.cloud.google.com → new project (or reuse one)
 *   2. APIs & Services → Library → enable "Apps Script API"
 *   3. APIs & Services → OAuth consent screen → External → add your own
 *      Google account as a test user
 *   4. APIs & Services → Credentials → Create credentials → OAuth client ID →
 *      Application type: "TVs and Limited Input devices"
 *
 * Zero dependencies.
 */

const DEVICE_ENDPOINT = 'https://oauth2.googleapis.com/device/code';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const SCOPES = [
  'https://www.googleapis.com/auth/script.projects', // read + write the project code
  'https://www.googleapis.com/auth/script.deployments' // bump a pinned deployment
];

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const has = (name) => process.argv.includes(`--${name}`);

const clientId = arg('client-id', process.env.PJS_AS_CLIENT_ID || '');
const clientSecret = arg('client-secret', process.env.PJS_AS_CLIENT_SECRET || '');
const timeoutMinutes = Number(arg('timeout-minutes', '10'));
const noPoll = has('no-poll');
const asJson = has('json');

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function postForm(endpoint, params) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error(`Google returned something that is not JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return { status: res.status, data };
}

async function requestDeviceCode() {
  const { status, data } = await postForm(DEVICE_ENDPOINT, {
    client_id: clientId,
    scope: SCOPES.join(' ')
  });
  if (status !== 200) {
    die(
      `Google refused the device request (HTTP ${status}): ${data.error} — ${data.error_description || ''}\n` +
        `  Make sure the OAuth client's application type is "TVs and Limited Input devices".`
    );
  }
  return data;
}

async function pollForToken(deviceCode, intervalSeconds, deadline) {
  let interval = Math.max(2, Number(intervalSeconds) || 5);
  while (Date.now() < deadline) {
    const { status, data } = await postForm(TOKEN_ENDPOINT, {
      client_id: clientId,
      client_secret: clientSecret,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    });

    if (data.refresh_token) return data;
    if (data.error === 'slow_down') interval += 5;
    if (data.error === 'expired_token') die('The code expired before it was used. Run the command again.');
    if (data.error === 'access_denied') die('The request was declined. Nothing was authorised.');
    if (data.error && data.error !== 'authorization_pending' && data.error !== 'slow_down') {
      die(`Google said: ${data.error} — ${data.error_description || ''} (HTTP ${status})`);
    }
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
  die(`No approval within ${timeoutMinutes} minute(s). Run the command again for a fresh code.`);
  return null;
}

async function main() {
  if (!clientId) {
    die('Missing --client-id (the OAuth client ID of type "TVs and Limited Input devices").');
  }

  const device = await requestDeviceCode();

  if (asJson) {
    console.log(JSON.stringify({ step: 'code', ...device }, null, 2));
  } else {
    console.log('');
    console.log('  ────────────────────────────────────────────────────────────');
    console.log('  1. On your phone open      : ' + (device.verification_url || 'https://google.com/device'));
    console.log('  2. Type this code          : ' + device.user_code);
    console.log('  3. Choose your Google account and tap Allow.');
    console.log('  ────────────────────────────────────────────────────────────');
    console.log('');
    console.log('  Waiting for approval…');
  }

  if (noPoll) {
    console.log(JSON.stringify({ step: 'pending', device_code: device.device_code, expires_in: device.expires_in }, null, 2));
    return;
  }

  const token = await pollForToken(device.device_code, device.interval, Date.now() + timeoutMinutes * 60 * 1000);

  if (asJson) {
    console.log(JSON.stringify({ step: 'done', refresh_token: token.refresh_token, scope: token.scope }, null, 2));
    return;
  }

  console.log('');
  console.log('  ✓ Authorised. Copy the refresh token below and store it as a');
  console.log('    GitHub repository secret named PJS_AS_REFRESH_TOKEN.');
  console.log('');
  console.log(`  ${token.refresh_token}`);
  console.log('');
  console.log('  Secrets needed by the deploy workflow:');
  console.log('    PJS_APPS_SCRIPT_ID      the script id from Project Settings');
  console.log('    PJS_AS_CLIENT_ID        the same client id you used here');
  console.log('    PJS_AS_CLIENT_SECRET    (optional) the client secret');
  console.log('    PJS_AS_REFRESH_TOKEN    the token printed above');
  console.log('    PJS_AS_DEPLOYMENT_ID    only for pinned mode (the AKfycb… in the /exec URL)');
  console.log('');
  console.log('  Keep the token private: it can update your Apps Script projects.');
  console.log('  Revoke it any time at myaccount.google.com/permissions.');
  console.log('');
}

main().catch((err) => {
  console.error(`\n  Failed: ${err.message}\n`);
  process.exit(1);
});
