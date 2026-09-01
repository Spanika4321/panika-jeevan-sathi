/**
 * PANIKA JEEVAN SATHI — Google Apps Script bridge (SOURCE OF TRUTH).
 *
 * ⚠️ Isko phone par manually edit mat karna.
 * Ye file repository mein rehti hai. Jab bhi ye badalti hai,
 * `npm run appsscript:deploy` (ya GitHub Action) isi content ko
 * MAUJUDA Apps Script project mein push kar deta hai — wahi purana
 * script ID, wahi purana /exec URL. Naya project nahi banta.
 *
 * Kya karta hai:
 *   GET  ?action=ping        → health / version JSON
 *   POST {type,...}          → event ko Google Sheet mein log karta hai
 *                              (registration, contact, interest, report)
 *
 * Security: har request mein `token` hona chahiye jo Script Property
 * PJS_SHARED_SECRET se match kare (website ka APPS_SCRIPT_TOKEN).
 */

var PJS_VERSION = '2.1.0';

/** Script Properties helper. */
function prop_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === '' ? fallback || '' : v;
}

function json_(obj, status) {
  obj.ok = obj.ok !== false;
  obj.version = PJS_VERSION;
  if (status) obj.status = status;
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function authorised_(token) {
  var secret = prop_('PJS_SHARED_SECRET', '');
  if (!secret) return true; // secret set nahi hai → open mode (pehli baar setup)
  return String(token || '') === secret;
}

/** Sheet ko dhoondho ya bana do, header ke saath. */
function sheet_(name, headers) {
  var id = prop_('PJS_SHEET_ID', '');
  var book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('PJS_SHEET_ID script property set nahi hai.');
  var sh = book.getSheetByName(name);
  if (!sh) {
    sh = book.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

var TABLES = {
  registration: ['time', 'name', 'email', 'phone', 'city', 'state', 'community', 'gender'],
  contact: ['time', 'name', 'email', 'phone', 'subject', 'message'],
  interest: ['time', 'from', 'to', 'status'],
  report: ['time', 'reporter', 'target', 'reason', 'details'],
  event: ['time', 'type', 'payload']
};

function row_(type, data) {
  var now = new Date();
  switch (type) {
    case 'registration':
      return [now, data.name, data.email, data.phone, data.city, data.state, data.community, data.gender];
    case 'contact':
      return [now, data.name, data.email, data.phone, data.subject, data.message];
    case 'interest':
      return [now, data.from, data.to, data.status];
    case 'report':
      return [now, data.reporter, data.target, data.reason, data.details];
    default:
      return [now, type, JSON.stringify(data)];
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!authorised_(p.token)) return json_({ ok: false, error: 'unauthorised' });
  return json_({
    ok: true,
    service: 'panika-jeevan-sathi-apps-script',
    action: p.action || 'ping',
    time: new Date().toISOString(),
    sheet: prop_('PJS_SHEET_ID', '') ? 'configured' : 'missing'
  });
}

function doPost(e) {
  var body = {};
  try {
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'invalid JSON' });
  }
  var token = body.token || ((e && e.parameter && e.parameter.token) || '');
  if (!authorised_(token)) return json_({ ok: false, error: 'unauthorised' });

  var type = String(body.type || 'event');
  var data = body.data || {};
  var headers = TABLES[type] || TABLES.event;
  var name = TABLES[type] ? type : 'event';

  try {
    var sh = sheet_(name, headers);
    sh.appendRow(row_(name, data));
    notifyOwner_(type, data);
    return json_({ ok: true, saved: name });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** Optional email alert to the owner. */
function notifyOwner_(type, data) {
  var to = prop_('PJS_OWNER_EMAIL', '');
  if (!to) return;
  if (['registration', 'contact', 'report'].indexOf(type) === -1) return;
  try {
    MailApp.sendEmail(
      to,
      'PANIKA JEEVAN SATHI — naya ' + type,
      JSON.stringify(data, null, 2)
    );
  } catch (err) {
    // quota khatam ho to bhi sheet logging fail na ho
  }
}

/** Editor se manually chala kar setup test karein. */
function selfTest() {
  Logger.log(doGet({ parameter: { token: prop_('PJS_SHARED_SECRET', '') } }).getContent());
}
