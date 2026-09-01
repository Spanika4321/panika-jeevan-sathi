/**
 * PANIKA JEEVAN SATHI — Google Apps Script Web App
 * Receives registration backups from the Node.js server and appends them
 * to a Google Sheet.
 *
 * Protocol (must match lib/gsheet.js exactly):
 *   POST body (JSON):
 *     { event, ts, nonce, sig, data }
 *   sig = HMAC-SHA256(sharedSecret, ts + "|" + nonce + "|" + canonicalJSON(data))
 *   canonicalJSON = JSON.stringify with keys sorted recursively (ascending).
 *
 * Script Properties required:
 *   SHARED_SECRET — must match GAS_SHARED_SECRET on the Node.js server
 *   SHEET_ID      — the Google Spreadsheet ID to write registrations to
 *
 * Deploy:  Deploy → New deployment → Web app
 *          Execute as: Me   |   Who has access: Anyone
 */

// ────────────────────────────────────────────────────────────────────────────
//  CONFIGURATION
// ────────────────────────────────────────────────────────────────────────────

/** Maximum age of a request timestamp (ms) before it is rejected as stale. */
var TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

/** How long a nonce is remembered to prevent replay (seconds). */
var NONCE_CACHE_TTL_SEC = 600; // 10 minutes

/**
 * Whitelisted columns — order matters, must match the header row.
 * NEVER add password, passwordHash, OTP, verification_token, reset_token,
 * reset_expires, token_version, session or any secret/credential here.
 */
var COLUMNS = [
  'received_at',
  'user_id',
  'email',
  'name',
  'role',
  'status',
  'gender',
  'city',
  'state',
  'community',
  'religion',
  'pref_gender',
  'created_at',
  'event',
  'nonce'
];

// ────────────────────────────────────────────────────────────────────────────
//  ENTRY POINTS
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET — health / status check.  Never exposes secrets.
 */
function doGet(e) {
  var props = PropertiesService.getScriptProperties();
  var sheetId = (props.getProperty('SHEET_ID') || '').trim();
  var secretConfigured = Boolean((props.getProperty('SHARED_SECRET') || '').trim());

  return jsonResponse(200, {
    ok: true,
    service: 'panika-jeevan-sathi-sheet-backup',
    time: new Date().toISOString(),
    configured: {
      sheet: Boolean(sheetId),
      secret: secretConfigured
    }
  });
}

/**
 * POST — receives registration data, verifies HMAC, appends to sheet.
 */
function doPost(e) {
  try {
    return handlePost(e);
  } catch (err) {
    // Never log or return the secret or any sensitive detail.
    logSafe('doPost fatal: ' + (err && err.message ? err.message : String(err)));
    return jsonResponse(500, { ok: false, error: 'Internal error.' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  POST HANDLER
// ────────────────────────────────────────────────────────────────────────────

function handlePost(e) {
  // ── 1. Load configuration ──────────────────────────────────────────────
  var props = PropertiesService.getScriptProperties();
  var secret = (props.getProperty('SHARED_SECRET') || '').trim();
  var sheetId = (props.getProperty('SHEET_ID') || '').trim();

  if (!secret) {
    logSafe('SHARED_SECRET not set in Script Properties.');
    return jsonResponse(500, { ok: false, error: 'Server misconfigured.' });
  }
  if (!sheetId) {
    logSafe('SHEET_ID not set in Script Properties.');
    return jsonResponse(500, { ok: false, error: 'Server misconfigured.' });
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────
  var raw = (e && e.postData && e.postData.contents) || '';
  if (!raw) {
    return jsonResponse(400, { ok: false, error: 'Empty body.' });
  }

  var body;
  try {
    body = JSON.parse(raw);
  } catch (_parseErr) {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON.' });
  }

  if (!body || typeof body !== 'object') {
    return jsonResponse(400, { ok: false, error: 'Invalid payload.' });
  }

  // ── 3. Extract envelope fields ─────────────────────────────────────────
  var event = String(body.event || '');
  var ts = Number(body.ts);
  var nonce = String(body.nonce || '');
  var sig = String(body.sig || '');
  var data = body.data;

  if (!event) {
    return jsonResponse(400, { ok: false, error: 'Missing event.' });
  }
  if (!ts || isNaN(ts)) {
    return jsonResponse(400, { ok: false, error: 'Missing or invalid timestamp.' });
  }
  if (!nonce || nonce.length < 8) {
    return jsonResponse(400, { ok: false, error: 'Missing or invalid nonce.' });
  }
  if (!sig) {
    return jsonResponse(400, { ok: false, error: 'Missing signature.' });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return jsonResponse(400, { ok: false, error: 'Missing or invalid data.' });
  }

  // ── 4. Timestamp freshness check ───────────────────────────────────────
  var now = Date.now();
  if (Math.abs(now - ts) > TIMESTAMP_TOLERANCE_MS) {
    return jsonResponse(401, { ok: false, error: 'Request expired.' });
  }

  // ── 5. Nonce replay protection ─────────────────────────────────────────
  var cache = CacheService.getScriptCache();
  var nonceKey = 'nonce:' + nonce.replace(/[^a-fA-F0-9]/g, '').slice(0, 64);
  var seen = cache.get(nonceKey);
  if (seen) {
    return jsonResponse(409, { ok: false, error: 'Duplicate request.' });
  }

  // ── 6. HMAC-SHA256 verification ────────────────────────────────────────
  var canonical = canonicalJSON(data);
  var message = String(ts) + '|' + nonce + '|' + canonical;
  var expectedSig = computeHmacHex(secret, message);

  if (!secureCompare(sig.toLowerCase(), expectedSig.toLowerCase())) {
    logSafe('Signature mismatch for event=' + event + ' nonce=' + nonce.slice(0, 8) + '…');
    return jsonResponse(401, { ok: false, error: 'Invalid signature.' });
  }

  // Nonce is only consumed after signature passes — avoids wasting cache
  // entries on forged requests.
  cache.put(nonceKey, '1', NONCE_CACHE_TTL_SEC);

  // ── 7. Event routing ───────────────────────────────────────────────────
  if (event === 'registration') {
    return handleRegistration(sheetId, data, nonce, ts);
  }

  return jsonResponse(400, { ok: false, error: 'Unknown event: ' + event });
}

// ────────────────────────────────────────────────────────────────────────────
//  REGISTRATION HANDLER
// ────────────────────────────────────────────────────────────────────────────

function handleRegistration(sheetId, data, nonce, ts) {
  var ss;
  try {
    ss = SpreadsheetApp.openById(sheetId);
  } catch (_openErr) {
    logSafe('Cannot open spreadsheet — check SHEET_ID and sharing.');
    return jsonResponse(500, { ok: false, error: 'Spreadsheet inaccessible.' });
  }

  var sheet = ss.getSheets()[0];
  if (!sheet) {
    sheet = ss.insertSheet('Registrations');
  }

  // ── Ensure header row ──────────────────────────────────────────────────
  ensureHeaderRow(sheet);

  // ── Build row with ONLY whitelisted values ─────────────────────────────
  var receivedAt = new Date().toISOString();
  var safeData = sanitizeData(data);

  var row = COLUMNS.map(function (col) {
    if (col === 'received_at') return receivedAt;
    if (col === 'event') return 'registration';
    if (col === 'nonce') return nonce;
    var val = safeData[col];
    if (val === null || val === undefined) return '';
    return val;
  });

  try {
    sheet.appendRow(row);
  } catch (_writeErr) {
    logSafe('Sheet appendRow failed: ' + (_writeErr && _writeErr.message));
    return jsonResponse(500, { ok: false, error: 'Could not write to sheet.' });
  }

  return jsonResponse(200, {
    ok: true,
    event: 'registration',
    user_id: safeData.user_id || '',
    nonce: nonce,
    received_at: receivedAt
  });
}

// ────────────────────────────────────────────────────────────────────────────
//  HEADER ROW
// ────────────────────────────────────────────────────────────────────────────

function ensureHeaderRow(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 0) {
    // Check if row 1 looks like our header — if first cell matches, skip.
    var firstCell = sheet.getRange(1, 1).getValue();
    if (String(firstCell) === COLUMNS[0]) return;
  }

  // Sheet is empty or header doesn't match — write/overwrite row 1.
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);

  // Bold + freeze the header row.
  try {
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } catch (_fmtErr) {
    // Formatting is best-effort; don't fail the request.
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  DATA SANITIZATION  (whitelist only — never trust incoming keys blindly)
// ────────────────────────────────────────────────────────────────────────────

var SENSITIVE_KEYS = {
  'password': 1, 'password_hash': 1, 'passwordhash': 1, 'passwordHash': 1,
  'otp': 1, 'pin': 1, 'secret': 1, 'token': 1,
  'verification_token': 1, 'reset_token': 1, 'reset_expires': 1,
  'token_version': 1, 'session': 1, 'cookie': 1, 'api_key': 1,
  'apikey': 1, 'private_key': 1, 'privatekey': 1, 'credential': 1,
  'credit_card': 1, 'cvv': 1, 'ssn': 1
};

function sanitizeData(data) {
  var out = {};
  // Only copy known, safe columns from the incoming data.
  var allowedKeys = [
    'user_id', 'email', 'name', 'role', 'status',
    'gender', 'city', 'state', 'community', 'religion',
    'pref_gender', 'created_at'
  ];

  for (var i = 0; i < allowedKeys.length; i++) {
    var key = allowedKeys[i];
    if (!(key in data)) continue;

    // Extra safety: drop anything that looks sensitive even if whitelisted.
    if (SENSITIVE_KEYS[key]) continue;

    var val = data[key];
    if (val === null || val === undefined) {
      out[key] = '';
    } else if (typeof val === 'object') {
      // Nested objects are not expected — skip.
      continue;
    } else {
      // Coerce to string/number; cap length defensively.
      out[key] = String(val).slice(0, 500);
    }
  }

  // Type coercion for numeric fields.
  if (out.user_id !== undefined && out.user_id !== '') {
    out.user_id = Number(out.user_id) || '';
  }
  if (out.created_at !== undefined && out.created_at !== '') {
    out.created_at = Number(out.created_at) || '';
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
//  CANONICAL JSON  (must match lib/gsheet.js exactly)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Produces a deterministic JSON string with keys sorted ascending at every
 * level.  This is the same algorithm used by the Node.js connector so the
 * HMAC matches on both sides.
 */
function canonicalJSON(value) {
  if (value === null || value === undefined) return 'null';

  var t = typeof value;
  if (t === 'boolean' || t === 'number') return JSON.stringify(value);
  if (t === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    var parts = [];
    for (var i = 0; i < value.length; i++) {
      parts.push(canonicalJSON(value[i]));
    }
    return '[' + parts.join(',') + ']';
  }

  if (t === 'object') {
    var keys = Object.keys(value).sort();
    var segments = [];
    for (var k = 0; k < keys.length; k++) {
      segments.push(JSON.stringify(keys[k]) + ':' + canonicalJSON(value[keys[k]]));
    }
    return '{' + segments.join(',') + '}';
  }

  return JSON.stringify(value);
}

// ────────────────────────────────────────────────────────────────────────────
//  HMAC-SHA256
// ────────────────────────────────────────────────────────────────────────────

function computeHmacHex(secret, message) {
  var rawKey = Utilities.newBlob(secret).getBytes();
  var rawMsg = Utilities.newBlob(message).getBytes();
  var sig = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    rawMsg,
    rawKey
  );
  return bytesToHex(sig);
}

function bytesToHex(bytes) {
  var hex = [];
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    hex.push((b < 16 ? '0' : '') + b.toString(16));
  }
  return hex.join('');
}

// ────────────────────────────────────────────────────────────────────────────
//  CONSTANT-TIME STRING COMPARE
// ────────────────────────────────────────────────────────────────────────────

function secureCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var result = 0;
  for (var i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ────────────────────────────────────────────────────────────────────────────

function jsonResponse(status, payload) {
  var body = JSON.stringify(payload);
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

function logSafe(message) {
  // Log operational errors but never secrets or full request bodies.
  try {
    console.log('[pjs-sheet] ' + String(message).slice(0, 400));
  } catch (_) {
    // Logger fallback for older GAS versions.
    try { Logger.log('[pjs-sheet] ' + String(message).slice(0, 400)); } catch (__) { /* noop */ }
  }
}
