/**
 * PANIKA JEEVAN SATHI — Google Apps Script bridge
 * ================================================
 *
 * This file is stored in the GitHub repository (apps-script/Code.gs) and can be
 * pushed into your existing Apps Script project automatically — see APPS-SCRIPT.md.
 *
 * It turns a Google Sheet into the website's database. Every table of the site
 * (users, profiles, interests, shortlist, messages, notifications, reports,
 * stories, contact_messages, settings, audit_logs) becomes one tab of the sheet.
 *
 * Protocol : pjs-bridge/1
 * Endpoint : https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
 *
 * Requests (GET uses query parameters, POST uses a JSON body — both work):
 *
 *   ?action=ping                       → who am I, is the sheet ready
 *   ?action=setup&token=SECRET         → first run: create the sheet, set the token
 *   ?action=dump                       → { tables: { users: [...], ... } }
 *   ?action=mutate  {ops:[{type:'insert'|'update'|'remove', table, row|patch|where}]}
 *   ?action=query   {table, where, opts:{order, limit, offset}}
 *   ?action=backup                     → dump + metadata (same as dump)
 *   ?action=setToken {token, next}     → rotate the shared secret
 *   ?action=reset&confirm=DELETE       → empty every table (needs the token)
 *
 * Every response is JSON:  { ok: true, protocol, action, data, ms }
 *                     or   { ok: false, protocol, action, error }
 *
 * Security
 *   A shared secret stored in Script Properties (PJS_TOKEN) protects the web
 *   app. Set it once by opening  /exec?action=setup&token=YOUR_SECRET  in any
 *   browser — no need to open the Apps Script editor. After that every request
 *   must carry the same token, otherwise it is refused.
 */

/* ------------------------------------------------------------- configuration */

var PJS_PROTOCOL = 'pjs-bridge/1';
var PJS_VERSION = '1.0.0';
var PJS_SHEET_TITLE = 'PANIKA JEEVAN SATHI — database';
var PJS_PROP_TOKEN = 'PJS_TOKEN';
var PJS_PROP_SHEET_ID = 'PJS_SPREADSHEET_ID';

/* Table → primary key + default columns (generated from the website schema). */
const PJS_TABLES = {
  users: { key: 'id', columns: [
    'id',
    'email',
    'password_hash',
    'name',
    'role',
    'status',
    'email_verified',
    'verification_token',
    'reset_token',
    'reset_expires',
    'token_version',
    'photo',
    'last_login',
    'created_at'
  ] },
  profiles: { key: 'user_id', columns: [
    'user_id',
    'headline',
    'phone',
    'age',
    'gender',
    'height_cm',
    'marital_status',
    'religion',
    'community',
    'sub_community',
    'mother_tongue',
    'city',
    'state',
    'country',
    'education',
    'education_detail',
    'occupation',
    'company',
    'annual_income',
    'diet',
    'smoking',
    'drinking',
    'about_me',
    'family_type',
    'family_status',
    'father_occupation',
    'mother_occupation',
    'siblings',
    'gotra',
    'manglik',
    'pref_age_min',
    'pref_age_max',
    'pref_gender',
    'pref_location',
    'pref_education',
    'pref_occupation',
    'pref_marital_status',
    'pref_religion',
    'pref_community',
    'pref_message',
    'visibility',
    'hide_photo',
    'hide_contact',
    'searchable',
    'profile_complete',
    'updated_at'
  ] },
  interests: { key: 'id', columns: [
    'id',
    'from_user_id',
    'to_user_id',
    'message',
    'status',
    'created_at',
    'responded_at'
  ] },
  shortlist: { key: 'id', columns: [
    'id',
    'user_id',
    'target_user_id',
    'created_at'
  ] },
  messages: { key: 'id', columns: [
    'id',
    'sender_id',
    'receiver_id',
    'body',
    'created_at',
    'read_at'
  ] },
  notifications: { key: 'id', columns: [
    'id',
    'user_id',
    'type',
    'title',
    'body',
    'link',
    'is_read',
    'created_at'
  ] },
  reports: { key: 'id', columns: [
    'id',
    'reporter_id',
    'target_user_id',
    'reason',
    'details',
    'status',
    'created_at'
  ] },
  stories: { key: 'id', columns: [
    'id',
    'title',
    'couple',
    'location',
    'body',
    'photo',
    'approved',
    'created_at'
  ] },
  contact_messages: { key: 'id', columns: [
    'id',
    'name',
    'email',
    'phone',
    'subject',
    'message',
    'handled',
    'created_at'
  ] },
  settings: { key: 'key', columns: [
    'key',
    'value'
  ] },
  audit_logs: { key: 'id', columns: [
    'id',
    'actor_id',
    'actor_email',
    'action',
    'target_type',
    'target_id',
    'detail',
    'created_at'
  ] }
};

/* -------------------------------------------------------------- entry points */

function doGet(e) {
  return respond_(handle_(normalise_(e && e.parameter ? e.parameter : {}, {})));
}

function doPost(e) {
  var params = e && e.parameter ? e.parameter : {};
  var raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
  var body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch (err) {
      body = formDecode_(raw);
    }
  }
  return respond_(handle_(normalise_(params, body)));
}

function normalise_(params, body) {
  var req = {};
  for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) req[k] = params[k];
  for (var j in body) if (Object.prototype.hasOwnProperty.call(body, j)) req[j] = body[j];
  // `?payload={"ops":[...]}` lets a plain GET carry a structured payload too.
  if (typeof req.payload === 'string') {
    try {
      var parsed = JSON.parse(req.payload);
      for (var p in parsed) if (Object.prototype.hasOwnProperty.call(parsed, p)) req[p] = parsed[p];
    } catch (err2) {
      /* leave it as a string */
    }
  }
  return req;
}

function formDecode_(raw) {
  var out = {};
  String(raw)
    .split('&')
    .forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      if (i < 1) return;
      out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(
        pair
          .slice(i + 1)
          .replace(/\+/g, ' ')
      );
    });
  return out;
}

function respond_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* ------------------------------------------------------------------ dispatch */

function handle_(req) {
  var started = Date.now();
  var action = String(req.action || 'ping').toLowerCase();
  var result;

  try {
    if (action === 'ping') {
      result = { ok: true, data: ping_(req) };
    } else if (action === 'setup' || action === 'settoken') {
      // The very first call is what installs the shared secret, so it is allowed
      // through once — afterwards every request must carry the token.
      if (tokenSet_() && !authorised_(req)) result = { ok: false, error: 'bad token' };
      else result = { ok: true, data: setup_(req) };
    } else if (!authorised_(req)) {
      result = { ok: false, error: tokenSet_() ? 'bad token' : 'no token configured — run ?action=setup&token=YOUR_SECRET first' };
    } else if (action === 'dump' || action === 'backup') {
      result = { ok: true, data: dump_(req) };
    } else if (action === 'mutate') {
      result = { ok: true, data: mutate_(req) };
    } else if (action === 'query') {
      result = { ok: true, data: query_(req) };
    } else if (action === 'reset') {
      result = { ok: true, data: reset_(req) };
    } else {
      result = { ok: false, error: 'unknown action: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
    if (typeof console !== 'undefined' && console.error) {
      console.error({ action: action, message: String((err && err.message) || err), stack: err && err.stack });
    }
  }

  result.protocol = PJS_PROTOCOL;
  result.action = action;
  result.ms = Date.now() - started;
  return result;
}

/* ---------------------------------------------------------------- security */

function props_() {
  return PropertiesService.getScriptProperties();
}

function tokenSet_() {
  var value = props_().getProperty(PJS_PROP_TOKEN);
  return !!(value && String(value).length >= 6);
}

/** True when the request may run. An unconfigured bridge only allows setup. */
function authorised_(req) {
  var expected = props_().getProperty(PJS_PROP_TOKEN);
  if (!expected) return false;
  return safeEqual_(String(req.token || ''), String(expected));
}

/** Length-safe comparison (Apps Script has no crypto.timingSafeEqual). */
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------- spreadsheet */

function spreadsheet_() {
  var store = props_();
  var id = store.getProperty(PJS_PROP_SHEET_ID);
  if (id) {
    try {
      return ensureTabs_(SpreadsheetApp.openById(id));
    } catch (err) {
      /* the sheet was deleted or moved — fall through and make a new one */
    }
  }
  var ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet(); // container-bound scripts
  } catch (err2) {
    ss = null;
  }
  if (!ss) ss = SpreadsheetApp.create(PJS_SHEET_TITLE);
  store.setProperty(PJS_PROP_SHEET_ID, ss.getId());
  return ensureTabs_(ss);
}

function sheetFor_(ss, table) {
  var sheet = ss.getSheetByName(table);
  if (!sheet) {
    sheet = ss.insertSheet(table);
    var spec = PJS_TABLES[table];
    if (spec) {
      sheet.getRange(1, 1, 1, spec.columns.length).setValues([spec.columns.slice()]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function ensureTabs_(ss) {
  Object.keys(PJS_TABLES).forEach(function (table) {
    sheetFor_(ss, table);
  });
  return ss;
}

/** Read a tab into { headers: [], rows: [[...]] }. */
function readSheet_(sheet) {
  var values = sheet.getDataRange().getValues();
  var spec = PJS_TABLES[sheet.getName()];
  var headers = [];
  var dataRows = [];

  if (!values.length) {
    headers = spec ? spec.columns.slice() : [];
  } else {
    headers = values[0].map(function (cell, i) {
      var name = String(cell == null ? '' : cell).trim();
      return name || (spec && spec.columns[i] ? spec.columns[i] : 'col' + (i + 1));
    });
    dataRows = values.slice(1);
  }

  // Make sure every column the app knows about exists, in schema order first.
  if (spec) {
    spec.columns.forEach(function (col) {
      if (headers.indexOf(col) < 0) headers.push(col);
    });
  }

  var rows = dataRows.map(function (row) {
    var out = new Array(headers.length);
    for (var i = 0; i < headers.length; i++) out[i] = row[i] === undefined ? '' : row[i];
    return out;
  });
  // Drop rows that are entirely empty (Sheets keeps trailing blank rows).
  rows = rows.filter(function (row) {
    return row.some(function (cell) {
      return !(cell === '' || cell === null || cell === undefined);
    });
  });

  return { headers: headers, rows: rows };
}

function writeSheet_(sheet, model, dirty) {
  if (!dirty) return;
  var width = Math.max(1, model.headers.length);
  var height = Math.max(1, model.rows.length + 1);
  sheet.clear();
  var out = [model.headers.slice()];
  for (var i = 0; i < model.rows.length; i++) {
    var row = new Array(width);
    for (var c = 0; c < width; c++) {
      var value = model.rows[i][c];
      row[c] = value === undefined ? '' : value;
    }
    out.push(row);
  }
  sheet.getRange(1, 1, height, width).setValues(out);
  sheet.setFrozenRows(1);
}

function modelToObjects_(model) {
  return model.rows.map(function (row) {
    var obj = {};
    for (var i = 0; i < model.headers.length; i++) {
      var value = row[i];
      obj[model.headers[i]] = value === '' ? null : value;
    }
    return obj;
  });
}

function columnIndex_(model, name) {
  var i = model.headers.indexOf(name);
  if (i >= 0) return i;
  model.headers.push(name);
  return model.headers.length - 1;
}

/* ------------------------------------------------------------------ actions */

function ping_(req) {
  var tokenConfigured = tokenSet_();
  var data = {
    protocol: PJS_PROTOCOL,
    bridge: PJS_VERSION,
    tokenConfigured: tokenConfigured,
    tables: Object.keys(PJS_TABLES)
  };
  data.scriptId = ScriptApp.getScriptId ? ScriptApp.getScriptId() : '';
  try {
    data.owner = Session.getEffectiveUser().getEmail();
  } catch (err) {
    data.owner = '';
  }
  if (tokenConfigured) {
    var ss = spreadsheet_();
    data.spreadsheetId = ss.getId();
    data.spreadsheetUrl = ss.getUrl();
    data.tabs = Object.keys(PJS_TABLES).map(function (table) {
      var model = readSheet_(sheetFor_(ss, table));
      return { table: table, rows: model.rows.length, columns: model.headers.length };
    });
  } else {
    data.hint = 'Open ?action=setup&token=YOUR_SECRET once to create the spreadsheet and set the shared secret.';
  }
  return data;
}

function setup_(req) {
  var store = props_();
  var current = store.getProperty(PJS_PROP_TOKEN);
  var next = String(req.token || req.next || '').trim();

  if (!current) {
    if (next.length < 6) throw new Error('setup needs a token of at least 6 characters: ?action=setup&token=YOUR_SECRET');
    store.setProperty(PJS_PROP_TOKEN, next);
  } else if (next && safeEqual_(String(req.token || ''), current)) {
    var rotate = String(req.next || '').trim();
    if (rotate.length >= 6) store.setProperty(PJS_PROP_TOKEN, rotate);
  }

  var ss = spreadsheet_();
  return {
    tokenConfigured: true,
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    tabs: Object.keys(PJS_TABLES).map(function (table) {
      return { table: table, rows: readSheet_(sheetFor_(ss, table)).rows.length };
    })
  };
}

function dump_(req) {
  var ss = spreadsheet_();
  var only = null;
  if (req.tables) {
    only = String(req.tables)
      .split(',')
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }
  var tables = {};
  var counts = {};
  var total = 0;
  Object.keys(PJS_TABLES).forEach(function (table) {
    if (only && only.indexOf(table) < 0) return;
    var rows = modelToObjects_(readSheet_(sheetFor_(ss, table)));
    tables[table] = rows;
    counts[table] = rows.length;
    total += rows.length;
  });
  return { tables: tables, counts: counts, rows: total, spreadsheetId: ss.getId(), spreadsheetUrl: ss.getUrl() };
}

function query_(req) {
  var table = String(req.table || '');
  if (!PJS_TABLES[table]) throw new Error('unknown table: ' + table);
  var ss = spreadsheet_();
  var model = readSheet_(sheetFor_(ss, table));
  var rows = modelToObjects_(model);
  var where = req.where || null;
  if (where) rows = rows.filter(function (row) {
    return matches_(row, where);
  });

  var opts = req.opts || {};
  if (opts.order) {
    var sort = String(opts.order)
      .split(',')
      .map(function (part) {
        var t = part.trim();
        if (!t) return null;
        var desc = t.charAt(0) === '-';
        return { col: desc ? t.slice(1) : t, desc: desc };
      })
      .filter(Boolean);
    rows.sort(function (a, b) {
      for (var i = 0; i < sort.length; i++) {
        var av = a[sort[i].col];
        var bv = b[sort[i].col];
        if (av === bv) continue;
        if (av === null || av === undefined) return -1;
        if (bv === null || bv === undefined) return 1;
        var cmp = av < bv ? -1 : 1;
        return sort[i].desc ? -cmp : cmp;
      }
      return 0;
    });
  }
  if (opts.offset) rows = rows.slice(Number(opts.offset));
  if (opts.limit !== undefined && opts.limit !== null) rows = rows.slice(0, Math.max(0, Number(opts.limit) | 0));
  return { table: table, rows: rows, total: rows.length };
}

function mutate_(req) {
  var ops = req.ops || (req.op ? [req.op] : []);
  if (!ops.length) return { applied: 0, touched: [] };

  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(25000);
    locked = true;
  } catch (err) {
    /* continue without the lock rather than failing the request */
  }

  try {
    var ss = spreadsheet_();
    var grouped = {};
    var order = [];
    ops.forEach(function (op) {
      var table = String((op && op.table) || '');
      if (!PJS_TABLES[table]) return;
      if (!grouped[table]) {
        grouped[table] = [];
        order.push(table);
      }
      grouped[table].push(op);
    });

    var applied = 0;
    var touched = [];
    order.forEach(function (table) {
      var sheet = sheetFor_(ss, table);
      var model = readSheet_(sheet);
      var dirty = false;
      grouped[table].forEach(function (op) {
        var changed = applyOp_(model, table, op);
        if (changed) {
          dirty = true;
          applied++;
        }
      });
      writeSheet_(sheet, model, dirty);
      touched.push({ table: table, rows: model.rows.length, changed: dirty });
    });

    return { applied: applied, touched: touched };
  } finally {
    if (locked) lock.releaseLock();
  }
}

function reset_(req) {
  if (String(req.confirm) !== 'DELETE') throw new Error('reset needs confirm=DELETE');
  var ss = spreadsheet_();
  var cleared = [];
  Object.keys(PJS_TABLES).forEach(function (table) {
    var sheet = sheetFor_(ss, table);
    var spec = PJS_TABLES[table];
    sheet.clear();
    sheet.getRange(1, 1, 1, spec.columns.length).setValues([spec.columns.slice()]);
    sheet.setFrozenRows(1);
    cleared.push(table);
  });
  return { cleared: cleared };
}

/* ------------------------------------------------------------- row matching */

/** Apply one insert / update / remove to the in-memory model. */
function applyOp_(model, table, op) {
  var spec = PJS_TABLES[table];
  var type = String((op && op.type) || '').toLowerCase();

  if (type === 'insert') {
    var row = (op && op.row) || {};
    var keyCol = spec.key;
    var values = new Array(model.headers.length);
    for (var i = 0; i < values.length; i++) values[i] = '';
    Object.keys(row).forEach(function (col) {
      if (row[col] === undefined) return;
      var idx = columnIndex_(model, col);
      while (values.length <= idx) values.push('');
      values[idx] = row[col] === null ? '' : row[col];
    });
    if (keyCol === 'id' && (row[keyCol] === undefined || row[keyCol] === null || row[keyCol] === '')) {
      var nextId = 1;
      var keyIdx = columnIndex_(model, keyCol);
      model.rows.forEach(function (existing) {
        var v = Number(existing[keyIdx]);
        if (v >= nextId) nextId = v + 1;
      });
      while (values.length <= keyIdx) values.push('');
      values[keyIdx] = nextId;
    }

    // Upsert: if a row with the same key is already there, update it instead of
    // adding a second one. A retried write can then never duplicate a member.
    var keyPosition = columnIndex_(model, keyCol);
    var keyValue = values[keyPosition];
    if (keyValue !== '' && keyValue !== null && keyValue !== undefined) {
      for (var r = 0; r < model.rows.length; r++) {
        if (loose_(model.rows[r][keyPosition], keyValue)) {
          for (var c = 0; c < values.length; c++) {
            while (model.rows[r].length <= c) model.rows[r].push('');
            if (row[model.headers[c]] !== undefined) model.rows[r][c] = values[c];
          }
          return true;
        }
      }
    }

    model.rows.push(values);
    return true;
  }

  if (type === 'update') {
    var patch = (op && op.patch) || op.row || {};
    var where = op.where || null;
    var count = 0;
    for (var r = 0; r < model.rows.length; r++) {
      var asObject = rowToObject_(model, model.rows[r]);
      if (where && !matches_(asObject, where)) continue;
      Object.keys(patch).forEach(function (col) {
        if (patch[col] === undefined) return;
        var idx = columnIndex_(model, col);
        while (model.rows[r].length <= idx) model.rows[r].push('');
        model.rows[r][idx] = patch[col] === null ? '' : patch[col];
      });
      count++;
    }
    return count > 0;
  }

  if (type === 'remove') {
    var cond = op.where || null;
    if (!cond) return false;
    var before = model.rows.length;
    model.rows = model.rows.filter(function (values2) {
      return !matches_(rowToObject_(model, values2), cond);
    });
    return model.rows.length !== before;
  }

  return false;
}

function rowToObject_(model, values) {
  var obj = {};
  for (var i = 0; i < model.headers.length; i++) {
    var value = i < values.length ? values[i] : '';
    obj[model.headers[i]] = value === '' ? null : value;
  }
  return obj;
}

/**
 * Mirror of the website's where-clause rules:
 *   { col: value }             → ==
 *   { col: null }              → is null
 *   { col: { gte, lte, gt, lt, ne, like, in:[...] } }
 */
function matches_(row, where) {
  if (!where) return true;
  var keys = Object.keys(where);
  for (var i = 0; i < keys.length; i++) {
    var col = keys[i];
    var rule = where[col];
    var value = row[col];
    if (value === '' ) value = null;

    if (rule === null || rule === undefined) {
      if (!(value === null || value === undefined)) return false;
      continue;
    }
    if (typeof rule === 'object') {
      if (Array.isArray(rule.in)) {
        var hit = rule.in.some(function (candidate) {
          return loose_(value, candidate);
        });
        if (!hit) return false;
      }
      if (rule.gte !== undefined && !(value !== null && value >= rule.gte)) return false;
      if (rule.lte !== undefined && !(value !== null && value <= rule.lte)) return false;
      if (rule.gt !== undefined && !(value !== null && value > rule.gt)) return false;
      if (rule.lt !== undefined && !(value !== null && value < rule.lt)) return false;
      if (rule.ne !== undefined && loose_(value, rule.ne)) return false;
      if (rule.like !== undefined) {
        if (value === null || value === undefined) return false;
        var pattern = String(rule.like)
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/%/g, '.*')
          .replace(/_/g, '.');
        if (!new RegExp('^' + pattern + '$', 'i').test(String(value))) return false;
      }
      continue;
    }
    if (!loose_(value, rule)) return false;
  }
  return true;
}

/** Loose equality, the same rule the website uses (1 == '1'). */
function loose_(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
}
