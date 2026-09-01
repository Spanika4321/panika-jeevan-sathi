#!/usr/bin/env node
/**
 * PANIKA JEEVAN SATHI - Google Apps Script connector CLI.
 *
 *   npm run gsheet:status   show configuration state and retry backlog
 *   npm run gsheet:secret   generate a strong GAS_SHARED_SECRET
 *   npm run gsheet:ping     send a signed test request to the Web App
 *   npm run gsheet:flush    retry any queued rows
 */

import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const gsheet = require('../lib/gsheet.js');
const crypto = require('node:crypto');

const dataDir = process.env.PJS_DATA_DIR || path.join(process.cwd(), 'data');
const cmd = (process.argv[2] || 'status').toLowerCase();

function line(label, value) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

async function main() {
  if (cmd === 'secret') {
    console.log(crypto.randomBytes(32).toString('base64url'));
    return 0;
  }

  if (cmd === 'status') {
    const s = gsheet.status();
    console.log('\nGoogle Apps Script connector\n');
    line('configured', s.configured ? 'YES' : 'NO');
    line('GAS_WEBAPP_URL', s.has_url ? (s.url_valid ? 'set (valid /exec URL)' : 'set (NOT a /exec URL)') : 'missing');
    line('GAS_SHARED_SECRET', s.has_secret ? 'set' : 'missing');
    line('GAS_DISABLED', s.disabled ? '1 (hard-disabled)' : 'no');
    line('timeout', `${s.timeout_ms} ms`);
    line('queued rows', String(gsheet.queueSize(dataDir)));
    line('data dir', dataDir);
    if (!s.configured) {
      console.log('\n  Not configured - registrations are saved normally, nothing is sent.');
      console.log('  See apps-script/README.md for the 5-minute setup.\n');
    } else {
      console.log('\n  Run "npm run gsheet:ping" to verify the connection.\n');
    }
    return 0;
  }

  if (cmd === 'ping') {
    if (!gsheet.configured()) {
      console.error('Not configured. Set GAS_WEBAPP_URL and GAS_SHARED_SECRET first.');
      return 1;
    }
    const res = await gsheet.ping();
    if (res.ok) {
      console.log('OK - Apps Script accepted the signed request.');
      return 0;
    }
    console.error(`FAILED - ${res.error}`);
    console.error('\nCommon causes:');
    console.error('  bad signature      -> SHARED_SECRET in Script Properties != GAS_SHARED_SECRET');
    console.error('  non-JSON response  -> deployment access is not set to "Anyone"');
    console.error('  HTTP 404           -> wrong /exec URL, or you copied the /dev URL');
    return 1;
  }

  if (cmd === 'flush') {
    const res = await gsheet.flushQueue(dataDir);
    if (res.skipped) {
      console.error('Not configured.');
      return 1;
    }
    if (res.ok) {
      console.log(`OK - ${res.drained} queued row(s) delivered.`);
      return 0;
    }
    console.error(`FAILED - ${res.error} (${res.pending} row(s) still queued)`);
    return 1;
  }

  console.error(`Unknown command "${cmd}". Use: status | secret | ping | flush`);
  return 1;
}

main().then((code) => process.exit(code));
