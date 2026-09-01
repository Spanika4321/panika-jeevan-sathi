/**
 * PANIKA JEEVAN SATHI — Google Apps Script Web App
 * Receives new registrations from the website and appends them to a Sheet.
 *
 * SETUP (5 minutes, see apps-script/README.md for screenshots-level detail):
 *   1. Create a Google Sheet. Copy its ID from the URL:
 *        https://docs.google.com/spreadsheets/d/<THIS_IS_THE_ID>/edit
 *   2. Extensions → Apps Script. Delete the sample code, paste this file.
 *   3. Project Settings → Script Properties → add two properties:
 *        SHARED_SECRET  = the same long random string you put in GAS_SHARED_SECRET
 *        SHEET_ID       = the Sheet ID from step 1   (optional if the script is
 *                         bound to the Sheet — then it uses the active Sheet)
 *   4. Deploy → New deployment → type "Web app"
 *        Execute as:      Me
 *        Who has access:  Anyone            <-- required, the signature is the real lock
 *   5. Copy the /exec URL → set it as GAS_WEBAPP_URL on the server.
 *
 * SECURITY: the /exec URL is public, so every request must carry a valid
 * HMAC-SHA256 signature of the exact body, keyed with SHARED_SECRET.
 * Unsigned or wrongly-signed requests are rejected and never touch the Sheet.
 */

var SHEET_NAME = 'Registrations';

var HEADERS = [
  'Received At',
  'Registered At',
  'User ID',
  'Name',
  'Email',
  'Gender',
  'Looking For',
  'City',
  'State',
  'Community',
  'Religion',
  'Phone',
  'Email Verified',
  'Role',
  'Status'
];

/* ------------------------------------------------------------------ helpers */

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** Hex HMAC-SHA256, byte-for-byte identical to Node's crypto.createHmac. */
function hmacHex_(message, secret) {
  var raw = Utilities.computeHmacSha256Signature(message, secret);
  var hex = '';
  for (var i = 0; i < raw.length; i++) {
    var b = (raw[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/** Length-safe comparison so we do not leak the secret through timing. */
function equals_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sheet_() {
  var id = prop_('SHEET_ID');
  var book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('No spreadsheet: set the SHEET_ID script property.');

  var sh = book.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = book.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function value_(row, key) {
  return row[key] === null || row[key] === undefined ? '' : String(row[key]);
}

/* -------------------------------------------------------------- entrypoints */

function doPost(e) {
  try {
    var body = e && e.postData ? e.postData.contents : '';
    if (!body) return json_({ ok: false, error: 'empty body' });

    var secret = prop_('SHARED_SECRET');
    if (!secret) return json_({ ok: false, error: 'SHARED_SECRET script property is not set' });

    // The server sends { payload: "<json string>", sig: "<hex hmac>" }.
    // We verify the signature against the payload STRING exactly as received,
    // then parse it. Apps Script does not expose custom request headers, which
    // is why the signature travels in the body.
    var envelope = JSON.parse(body);
    var payloadStr = envelope && envelope.payload;
    var sig = envelope && envelope.sig;
    if (typeof payloadStr !== 'string' || !sig) {
      return json_({ ok: false, error: 'malformed envelope' });
    }

    if (!equals_(hmacHex_(payloadStr, secret), String(sig))) {
      return json_({ ok: false, error: 'bad signature' });
    }

    var payload = JSON.parse(payloadStr);
    var rows = payload.rows || [];
    if (!rows.length) return json_({ ok: true, appended: 0 });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sh = sheet_();
      var now = new Date().toISOString();
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (String(r.event) === 'ping') continue; // connectivity probe, not data
        out.push([
          now,
          value_(r, 'registered_at'),
          value_(r, 'user_id'),
          value_(r, 'name'),
          value_(r, 'email'),
          value_(r, 'gender'),
          value_(r, 'looking_for'),
          value_(r, 'city'),
          value_(r, 'state'),
          value_(r, 'community'),
          value_(r, 'religion'),
          value_(r, 'phone'),
          value_(r, 'email_verified'),
          value_(r, 'role'),
          value_(r, 'status')
        ]);
      }
      if (out.length) {
        sh.getRange(sh.getLastRow() + 1, 1, out.length, HEADERS.length).setValues(out);
      }
      return json_({ ok: true, appended: out.length });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** GET is only a liveness probe — it never returns or accepts data. */
function doGet() {
  return json_({ ok: true, service: 'panika-jeevan-sathi', mode: 'write-only' });
}
