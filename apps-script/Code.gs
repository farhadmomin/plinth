/**
 * Plinth — Google Drive upload service.
 * Author: Md. Farhad Momin.
 *
 * Receives building records and photos from the Plinth phone app and
 * stores them in the Drive of the account that deploys this script:
 *
 *   Hassan Index Field Data/
 *     Location Key (private)            <- addresses and GPS, one sheet for all projects
 *     <Project>/
 *       <Project> - Hassan data         <- Buildings, Columns and Walls sheets
 *       <Building code>/                <- photos + full JSON record
 *
 * Setup (once): see README.md. In short: paste this file, set APP_URL below,
 * run setup(), deploy as a Web app (Execute as: Me, Who has access: Anyone),
 * then run showSetupLink() and send that link to the students.
 */

// The address where the phone app is hosted (GitHub Pages), ending with a slash.
var APP_URL = 'https://farhadmomin.github.io/plinth/';
var ROOT_NAME = 'Hassan Index Field Data';

var LEN = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };

/* ---------- one-time helpers (run from the editor) ---------- */

function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('KEY')) p.setProperty('KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 12));
  root_();
  Logger.log('Upload key: ' + p.getProperty('KEY'));
  Logger.log('Drive folder ready: ' + ROOT_NAME);
  Logger.log('Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone). Then run showSetupLink().');
}

function showSetupLink() {
  var url = ScriptApp.getService().getUrl();
  if (!url) { Logger.log('Deploy the script as a Web app first.'); return; }
  var key = PropertiesService.getScriptProperties().getProperty('KEY');
  ['Jolshiri'].forEach(function (project) {
    Logger.log('Setup link for ' + project + ':\n' + APP_URL + '?url=' + encodeURIComponent(url) +
      '&key=' + encodeURIComponent(key) + '&project=' + encodeURIComponent(project));
  });
}

/** Change the key if a link leaks. Students then need the new setup link. */
function resetKey() {
  PropertiesService.getScriptProperties().deleteProperty('KEY');
  setup();
}

/* ---------- web endpoints ---------- */

function doGet() {
  return ContentService.createTextOutput('Plinth upload service is running.');
}

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    var key = PropertiesService.getScriptProperties().getProperty('KEY');
    if (!key || body.key !== key) throw new Error('Wrong upload key. Ask your supervisor for a new setup link.');
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (body.action === 'ping') out = { ok: true, owner: 'Drive of ' + Session.getEffectiveUser().getEmail() };
      else if (body.action === 'building') out = saveBuilding_(body);
      else if (body.action === 'photo') out = savePhoto_(body);
      else throw new Error('Unknown action.');
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- saving ---------- */

var B_HEAD = ['Record ID', 'Building ID', 'Project', 'Status', 'Survey date', 'Surveyors', 'Structural system', 'Storeys',
  'Assessed level', 'Basement', 'N', 'A_p (m²)', 'A_ft (m²)', 'Columns entered', 'Columns stated', 'A_col (m²)',
  'RC wall X (m²)', 'Masonry X (m²)', 'Eff. wall X (m²)', 'RC wall Y (m²)', 'Masonry Y (m²)', 'Eff. wall Y (m²)',
  'CI (%)', 'WI_X (%)', 'WI_Y (%)', 'WI_min (%)', 'Controlling direction', 'PI (%)', 'CD (%)', 'WD_X (%)', 'WD_Y (%)',
  'PI Case B (%)', 'WI_min Case B (%)', 'Classification-sensitive', 'Permission', 'Transfer above', 'Weaker storey above',
  'Plaster allowance (mm)', 'Open checks', 'Notes', 'Photos', 'Last change on phone', 'Uploaded', 'App version', 'Folder'];
var C_HEAD = ['Record ID', 'Building ID', 'Row', 'Count', 'Width', 'Depth', 'Unit', 'Over plaster', 'Width (m)', 'Depth (m)', 'Area of group (m²)'];
var W_HEAD = ['Record ID', 'Building ID', 'Row', 'Type', 'Case B type', 'Direction', 'Count', 'Length', 'Length unit',
  'Thickness', 'Thickness unit', 'Area of group (m²)'];
var L_HEAD = ['Record ID', 'Project', 'Building ID', 'Landmark (student)', 'Latitude', 'Longitude', 'Updated', 'GPS accuracy (m)', 'Address (Google Maps)', 'Google Maps link'];

function saveBuilding_(body) {
  var b = body.building, r = body.results || {};
  if (!b || !b.id) throw new Error('No building record.');
  var project = clean_(b.project || 'Unassigned');
  var pf = child_(root_(), project);
  var ss = projectSheet_(pf, project);
  var bs = ss.getSheetByName('Buildings');

  // Keep building codes unique within the project.
  var code = clean_(b.code || 'NO-CODE'), note = '';
  var data = bs.getDataRange().getValues();
  var row = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === b.id) row = i + 1;
  }
  for (var j = 1; j < data.length; j++) {
    if (data[j][0] !== b.id && String(data[j][1]) === code) {
      code = code + '-' + b.id.slice(-4);
      note = 'Building code ' + b.code + ' was already used by another phone, so this one was saved as ' + code + '. Agree a new code with your group and edit it.';
      break;
    }
  }

  var folder = child_(pf, code);
  var json = JSON.stringify({ building: b, results: r, uploaded: new Date() }, null, 1);
  var existing = folder.getFilesByName(code + '_data.json');
  if (existing.hasNext()) existing.next().setContent(json); else folder.createFile(code + '_data.json', json, MimeType.PLAIN_TEXT);

  var ck = b.checks || {};
  var vals = [b.id, code, b.project, b.status, b.date, b.surveyors, b.system, b.storeys, b.level, b.basement, n_(b.N),
    n_(r.Ap_m2), n_(r.Aft_m2), n_(r.columnsEntered), n_(b.statedColumns), n_(r.Acol_m2),
    n_(r.rcX), n_(r.masX), n_(r.effX), n_(r.rcY), n_(r.masY), n_(r.effY),
    n_(r.CI), n_(r.WIX), n_(r.WIY), n_(r.WImin), r.dir || '', n_(r.PI), n_(r.CD), n_(r.WDX), n_(r.WDY),
    n_(r.PI_B), n_(r.WImin_B), r.sensitive ? 'Yes' : 'No', ck.permission || '', ck.transfer || '', ck.weaker || '',
    n_(r.plasterMm), (r.warnings || []).join(' | '), b.notes || '', (b.photos || []).length,
    b.updated || '', new Date(), body.app || '', folder.getUrl()];
  if (row > 0) bs.getRange(row, 1, 1, vals.length).setValues([vals]);
  else bs.appendRow(vals);

  replaceRows_(ss.getSheetByName('Columns'), b.id, (b.columns || []).map(function (c, k) {
    var w = num_(c.b) * (LEN[c.unit] || 1), d = num_(c.d) * (LEN[c.unit] || 1);
    return [b.id, code, k + 1, n_(c.qty), n_(c.b), n_(c.d), c.unit || '', c.plaster || '', n_(w), n_(d), n_(num_(c.qty) * w * d)];
  }));
  replaceRows_(ss.getSheetByName('Walls'), b.id, (b.walls || []).map(function (w, k) {
    var L = num_(w.L) * (LEN[w.Lunit] || 1), t = num_(w.t) * (LEN[w.tunit] || 1);
    return [b.id, code, k + 1, w.type || '', w.caseB || '', w.dir || '', n_(w.qty), n_(w.L), w.Lunit || '', n_(w.t), w.tunit || '', n_(num_(w.qty) * L * t)];
  }));

  var loc = body.location || {};
  if (loc.text || loc.lat || loc.lon) {
    var ls = locationSheet_();
    var lat = num_(loc.lat), lon = num_(loc.lon), addr = '', link = '';
    if (isFinite(lat) && isFinite(lon)) {
      link = 'https://www.google.com/maps?q=' + lat + ',' + lon;
      addr = address_(lat, lon);
    }
    replaceRows_(ls, b.id, [[b.id, b.project, code, loc.text || '', n_(loc.lat), n_(loc.lon), new Date(), n_(loc.acc), addr, link]]);
  }
  return { ok: true, code: code, note: note };
}

function savePhoto_(body) {
  if (!body.data || !body.name) throw new Error('No photo data.');
  var pf = child_(root_(), clean_(body.project || 'Unassigned'));
  var folder = child_(pf, clean_(body.code || 'NO-CODE'));
  var name = clean_(body.name);
  if (!folder.getFilesByName(name).hasNext()) {
    var blob = Utilities.newBlob(Utilities.base64Decode(body.data), 'image/jpeg', name);
    folder.createFile(blob).setDescription(body.label || '');
  }
  return { ok: true };
}

/** Street address for a GPS point, from Google Maps (built-in Apps Script service, no API key). */
function address_(lat, lon) {
  try {
    var g = Maps.newGeocoder().reverseGeocode(lat, lon);
    if (g && g.status === 'OK' && g.results && g.results.length) return g.results[0].formatted_address;
  } catch (e) {}
  return '';
}

/* ---------- Drive and Sheets helpers ---------- */

function root_() {
  var it = DriveApp.getRootFolder().getFoldersByName(ROOT_NAME);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(ROOT_NAME);
}
function child_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function projectSheet_(folder, project) {
  var name = project + ' - Hassan data';
  var it = folder.getFilesByName(name);
  if (it.hasNext()) return SpreadsheetApp.open(it.next());
  var ss = SpreadsheetApp.create(name);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  var first = ss.getSheets()[0];
  first.setName('Buildings');
  head_(first, B_HEAD);
  head_(ss.insertSheet('Columns'), C_HEAD);
  head_(ss.insertSheet('Walls'), W_HEAD);
  return ss;
}
function locationSheet_() {
  var root = root_(), name = 'Location Key (private)';
  var it = root.getFilesByName(name), ss;
  if (it.hasNext()) ss = SpreadsheetApp.open(it.next());
  else {
    ss = SpreadsheetApp.create(name);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    ss.getSheets()[0].setName('Locations');
    head_(ss.getSheets()[0], L_HEAD);
  }
  var sh = ss.getSheets()[0];
  if (sh.getLastColumn() < L_HEAD.length) head_(sh, L_HEAD);
  return sh;
}
function head_(sh, head) {
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
  sh.setFrozenRows(1);
}
function replaceRows_(sh, id, rows) {
  var last = sh.getLastRow();
  if (last > 1) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] === id) sh.deleteRow(i + 2);
  }
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
function num_(v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; }
function n_(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : ''; }
function clean_(s) { return String(s).replace(/[\\\/:*?"<>|#%]+/g, '-').trim().slice(0, 80) || 'Unnamed'; }
