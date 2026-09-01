/**
 * OPTIONAL — self-syncing Apps Script (no Google Cloud project, no OAuth
 * client, no GitHub secrets).
 *
 * Everything in apps-script/_optional/ is documentation: the deploy workflow
 * and scripts/apps-script-push.mjs never upload files whose name starts with
 * "_", so this file is never pushed to the project. To use it, paste it into
 * the Apps Script project once by hand and run installSelfSync() one time.
 *
 * After that the project downloads apps-script/Code.gs from GitHub on a timer
 * and replaces its own code with it.
 *
 * Requirements
 *   1. Project Settings → Google Cloud Platform project → switch the script to
 *      a STANDARD Cloud project, and enable the Apps Script API in it.
 *      (The default hidden project rejects calls to script.googleapis.com.)
 *   2. appsscript.json must list these scopes:
 *        "https://www.googleapis.com/auth/script.external_request"
 *        "https://www.googleapis.com/auth/script.projects"
 *   3. The web app deployment must be on "Latest (Head)", otherwise the new
 *      code is stored but not served (see APPS-SCRIPT.md §A5).
 */

var PJS_SYNC_REPO = 'Spanika4321/panika-jeevan-sathi'; // owner/repo
var PJS_SYNC_BRANCH = 'main';
var PJS_SYNC_FILES = ['Code']; // apps-script/Code.gs → file "Code"

/** Run this once from the editor to install the 6-hourly trigger. */
function installSelfSync() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) {
      return t.getHandlerFunction() === 'selfSync';
    })
    .forEach(function (t) {
      ScriptApp.deleteTrigger(t);
    });
  ScriptApp.newTrigger('selfSync').timeBased().everyHours(6).create();
  return selfSync();
}

function removeSelfSync() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) {
      return t.getHandlerFunction() === 'selfSync';
    })
    .forEach(function (t) {
      ScriptApp.deleteTrigger(t);
    });
}

/** Download the repository version and overwrite this project's code. */
function selfSync() {
  var base =
    'https://raw.githubusercontent.com/' +
    PJS_SYNC_REPO +
    '/' +
    PJS_SYNC_BRANCH +
    '/apps-script/';

  var files = [];
  for (var i = 0; i < PJS_SYNC_FILES.length; i++) {
    var name = PJS_SYNC_FILES[i];
    var res = UrlFetchApp.fetch(base + name + '.gs', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('could not download ' + name + '.gs — HTTP ' + res.getResponseCode());
    }
    files.push({ name: name, type: 'SERVER_JS', source: res.getContentText() });
  }

  var url = 'https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + '/content';
  var put = UrlFetchApp.fetch(url, {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ files: files }),
    muteHttpExceptions: true
  });

  var body = put.getContentText();
  if (put.getResponseCode() !== 200) throw new Error('updateContent failed: ' + body);
  console.log('selfSync: updated ' + files.length + ' file(s) from GitHub');
  return JSON.parse(body);
}
