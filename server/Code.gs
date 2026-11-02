/* MMC SongPoint server (v2). Bound to the "SongPoint Log" Google Sheet; deployed as a web app.
   Every request is a POST with a JSON body { action: "...", token: "...", ... }.

   Tabs:  Log    one row per song in each saved song list / built slideshow
          Users  accounts (passwords stored only as salted, repeated SHA-256 hashes)
          SlideCache  converted copies of .ppt/.pptx files (so each converts once)   */

var TAB = 'Log', USERS = 'Users', CACHE = 'SlideCache';
var HEAD = ['Logged at', 'Date used', 'Leader', 'Event', 'Note', 'Note ID', 'Version', 'Position', 'Book', 'Number',
  'Title', 'Song key', 'Device', 'Comment', 'Entry ID', 'Username'];
var UHEAD = ['Username', 'Name', 'Admin', 'Salt', 'Hash', 'Must change password', 'Created', 'Last sign-in',
  'Signed out before', 'Disabled'];
var ROUNDS = 2000;
var SHARED_SLIDES_FOLDER = '1A_h83VBsar3VD4j2LQ2js8sbdrBAIGQc';   // built PowerPoints are saved here (PowerPoint Presentations)

// ------------------------------------------------------------------ sheets
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tab_(name, head) {
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
    var first = ss.getSheetByName('Sheet1');
    if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  } else if (sh.getLastColumn() < head.length) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  }
  return sh;
}
function logTab_() { return tab_(TAB, HEAD); }
function usersTab_() { return tab_(USERS, UHEAD); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function setup() { logTab_(); usersTab_(); tab_(CACHE, ['Source ID', 'Source updated', 'Converted ID', 'Name']); }

/** Run once from the editor so Google asks for all the permissions the server needs. */
function authorize() {
  setup();
  DriveApp.getRootFolder();
  SlidesApp.getActivePresentation;
  UrlFetchApp.getRequest('https://www.googleapis.com/');
  return 'ok';
}

// ------------------------------------------------------------------ passwords and tokens
function key_() {
  var p = PropertiesService.getScriptProperties(), k = p.getProperty('KEY');
  if (!k) { k = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('KEY', k); }
  return k;
}
function b64_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function hash_(password, salt) {
  var saltBytes = Utilities.newBlob(salt).getBytes();
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8);
  for (var i = 0; i < ROUNDS; i++) d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d.concat(saltBytes));
  return b64_(d);
}
function newSalt_() { return Utilities.getUuid().replace(/-/g, ''); }
function tempPassword_() {
  var words = ['amen', 'anthem', 'bell', 'choir', 'chord', 'dove', 'grace', 'harp', 'hymn', 'joy', 'lamb', 'light',
    'lyre', 'psalm', 'rest', 'river', 'song', 'staff', 'tenor', 'tune', 'verse', 'voice', 'zion'];
  var pick = function () { return words[Math.floor(Math.random() * words.length)]; };
  return pick() + '-' + pick() + '-' + (100 + Math.floor(Math.random() * 900));
}
function token_(username) {
  var payload = username + '|' + Date.now();
  return b64_(Utilities.newBlob(payload).getBytes()) + '.' + b64_(Utilities.computeHmacSha256Signature(payload, key_()));
}
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  var x = 0;
  for (var i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

// ------------------------------------------------------------------ users
function users_() {
  var v = usersTab_().getDataRange().getValues();
  v.shift();
  return v.map(function (r, i) {
    return { row: i + 2, username: String(r[0]), name: String(r[1]), admin: r[2] === true || r[2] === 'TRUE',
      salt: String(r[3]), hash: String(r[4]), mustChange: r[5] === true || r[5] === 'TRUE',
      created: r[6], lastLogin: r[7], validAfter: Number(r[8]) || 0, disabled: r[9] === true || r[9] === 'TRUE' };
  }).filter(function (u) { return u.username; });
}
function findUser_(username) {
  username = String(username || '').trim().toLowerCase();
  return users_().filter(function (u) { return u.username === username; })[0] || null;
}
function saveUser_(u) {
  var row = [u.username, u.name, u.admin, u.salt, u.hash, u.mustChange, u.created || new Date(), u.lastLogin || '',
    u.validAfter || 0, u.disabled];
  if (u.row) usersTab_().getRange(u.row, 1, 1, row.length).setValues([row]);
  else usersTab_().appendRow(row);
}
function publicUser_(u) {
  return { username: u.username, name: u.name, admin: u.admin, mustChange: u.mustChange, disabled: u.disabled,
    lastLogin: u.lastLogin ? new Date(u.lastLogin).toISOString() : '' };
}
function checkToken_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  var payload;
  try { payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString(); } catch (e) { return null; }
  if (!sameText_(b64_(Utilities.computeHmacSha256Signature(payload, key_())), parts[1])) return null;
  var bits = payload.split('|'), u = findUser_(bits[0]);
  if (!u || u.disabled || Number(bits[1]) < u.validAfter) return null;
  return u;
}
function validUsername_(s) { return /^[a-z0-9][a-z0-9._-]{1,29}$/.test(s); }
function validPassword_(s) { return typeof s === 'string' && s.length >= 6 && s.length <= 100; }

function tooManyTries_(username) {
  var c = CacheService.getScriptCache(), n = Number(c.get('fail:' + username) || 0);
  return n >= 6;
}
function failed_(username) {
  var c = CacheService.getScriptCache(), k = 'fail:' + username;
  c.put(k, String(Number(c.get(k) || 0) + 1), 600);
}

// ------------------------------------------------------------------ request handling
function doGet() { return json_({ ok: true, app: 'MMC SongPoint server', version: 14 }); }

function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  try {
    return json_(handle_(d));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function handle_(d) {
  var a = d.action;
  if (a === 'status') return { ok: true, needsSetup: users_().length === 0 };
  if (a === 'setup') return setupAdmin_(d);
  if (a === 'login') return login_(d);

  var me = checkToken_(d.token);
  if (!me) return { ok: false, error: 'Please sign in again.', signedOut: true };
  if (a === 'me') return { ok: true, user: publicUser_(me) };
  if (a === 'changePassword') return changePassword_(me, d);
  if (me.mustChange) return { ok: false, error: 'Please choose a new password first.', mustChange: true };
  if (a === 'log') return log_(me, d);
  if (a === 'usage') return usage_(me, d);
  if (a === 'buildSlides') return buildSlides_(me, d);
  if (a === 'slidesExists') return slidesExists_(me, d);
  if (a === 'replaceSlides') return replaceSlides_(me, d);
  if (a === 'finalizeSlides') return finalizeSlides_(me, d);
  if (a === 'bugReport') return bugReport_(me, d);
  if (a === 'getTextDocs') return { ok: true, textDocs: textDocs_() };
  if (a === 'file') return file_(d);
  if (a === 'perfHost') return perfHost_(me);
  if (a === 'perfJoin') return perfJoin_(d);
  if (a === 'perfSend') return perfSend_(d);
  if (a === 'perfPoll') return perfPoll_(d);
  if (a === 'perfState') return perfState_(d);
  if (a === 'perfEnd') return perfEnd_(d);
  if (a === 'getArrangements') return { ok: true, arrangements: arrangements_() };
  if (a === 'setArrangement') return setArrangement_(me, d);
  if (a === 'deleteArrangement') return deleteArrangement_(me, d);

  if (!me.admin) return { ok: false, error: 'Only admins can do that.' };
  if (a === 'listUsers') return { ok: true, users: users_().map(publicUser_) };
  if (a === 'createUser') return createUser_(d);
  if (a === 'resetPassword') return resetPassword_(d);
  if (a === 'setAdmin') return setAdmin_(me, d);
  if (a === 'setDisabled') return setDisabled_(me, d);
  if (a === 'getIgnored') return { ok: true, ignored: ignored_() };
  if (a === 'setIgnored') return setIgnored_(me, d);
  if (a === 'setTextDoc') return setTextDoc_(me, d);
  if (a === 'logRecords') return logRecords_();
  if (a === 'deleteLog') return deleteLog_(me, d);
  return { ok: false, error: 'Unknown action' };
}

function setupAdmin_(d) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (users_().length) return { ok: false, error: 'Setup is already done. Please sign in.' };
    var username = String(d.username || '').trim().toLowerCase();
    if (!validUsername_(username)) return { ok: false, error: 'Usernames use 2–30 letters, numbers, dots or dashes.' };
    if (!validPassword_(d.password)) return { ok: false, error: 'Passwords need at least 6 characters.' };
    var salt = newSalt_();
    var u = { username: username, name: String(d.name || username).trim().slice(0, 40), admin: true, salt: salt,
      hash: hash_(d.password, salt), mustChange: false, created: new Date(), lastLogin: new Date(), validAfter: 0, disabled: false };
    saveUser_(u);
    return { ok: true, token: token_(username), user: publicUser_(u) };
  } finally { lock.releaseLock(); }
}

function login_(d) {
  var username = String(d.username || '').trim().toLowerCase();
  if (tooManyTries_(username)) return { ok: false, error: 'Too many tries. Wait 10 minutes and try again.' };
  var u = findUser_(username);
  if (!u || u.disabled || !sameText_(hash_(String(d.password || ''), u.salt), u.hash)) {
    failed_(username);
    Utilities.sleep(700);
    return { ok: false, error: 'Wrong username or password.' };
  }
  u.lastLogin = new Date(); saveUser_(u);
  return { ok: true, token: token_(u.username), user: publicUser_(u) };
}

function changePassword_(me, d) {
  if (!sameText_(hash_(String(d.current || ''), me.salt), me.hash)) return { ok: false, error: 'Your current password isn\'t right.' };
  if (!validPassword_(d.password)) return { ok: false, error: 'Passwords need at least 6 characters.' };
  me.salt = newSalt_(); me.hash = hash_(d.password, me.salt); me.mustChange = false;
  me.validAfter = Date.now() - 1; saveUser_(me);           // signs out other devices
  return { ok: true, token: token_(me.username), user: publicUser_(me) };
}

function createUser_(d) {
  var username = String(d.username || '').trim().toLowerCase();
  if (!validUsername_(username)) return { ok: false, error: 'Usernames use 2–30 letters, numbers, dots or dashes.' };
  if (findUser_(username)) return { ok: false, error: 'That username is taken.' };
  var temp = tempPassword_(), salt = newSalt_();
  saveUser_({ username: username, name: String(d.name || username).trim().slice(0, 40), admin: !!d.admin, salt: salt,
    hash: hash_(temp, salt), mustChange: true, created: new Date(), lastLogin: '', validAfter: 0, disabled: false });
  return { ok: true, username: username, tempPassword: temp };
}

function resetPassword_(d) {
  var u = findUser_(d.username);
  if (!u) return { ok: false, error: 'No such user.' };
  var temp = tempPassword_();
  u.salt = newSalt_(); u.hash = hash_(temp, u.salt); u.mustChange = true; u.validAfter = Date.now();
  saveUser_(u);
  return { ok: true, username: u.username, tempPassword: temp };
}

function setAdmin_(me, d) {
  var u = findUser_(d.username);
  if (!u) return { ok: false, error: 'No such user.' };
  if (!d.admin && users_().filter(function (x) { return x.admin && !x.disabled; }).length <= 1 && u.admin)
    return { ok: false, error: 'There has to be at least one admin.' };
  u.admin = !!d.admin; saveUser_(u);
  return { ok: true };
}

function setDisabled_(me, d) {
  var u = findUser_(d.username);
  if (!u) return { ok: false, error: 'No such user.' };
  if (u.username === me.username) return { ok: false, error: 'You can\'t turn off your own account.' };
  u.disabled = !!d.disabled; u.validAfter = Date.now(); saveUser_(u);
  return { ok: true };
}

// ------------------------------------------------------------------ log
function appendRows_(rows) {
  if (!rows.length) return;
  var sh = logTab_();
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEAD.length).setValues(rows);
  sh.getRange(2, 2, sh.getLastRow() - 1, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, 10, sh.getLastRow() - 1, 1).setNumberFormat('@');
}
function rowsFor_(me, x) {
  var songs = x.songs && x.songs.length ? x.songs : [null];
  return songs.map(function (s, i) {
    return [new Date(x.at || Date.now()), x.dateUsed || '', me.name, x.event || '', x.noteTitle || '', x.noteId || '',
      x.version || '', s ? i + 1 : '', s ? s.book || '' : '', s ? String(s.number || '') : '', s ? s.title || '' : '',
      s ? s.key || '' : '', x.device || '', x.comment || '', x.id || '', me.username];
  });
}
function log_(me, d) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = logTab_(), seen = {}, last = sh.getLastRow();
    if (last > 1) {
      var start = Math.max(2, last - 3000);
      sh.getRange(start, 15, last - start + 1, 1).getValues().forEach(function (r) { seen[r[0]] = true; });
    }
    var rows = [], done = [];
    (d.entries || []).forEach(function (x) {
      done.push(x.id);
      if (!seen[x.id]) rows = rows.concat(rowsFor_(me, x));
    });
    appendRows_(rows);
    return { ok: true, saved: done, rows: rows.length };
  } finally { lock.releaseLock(); }
}

function day_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '');
}

function usage_(me, d) {
  var everyone = me.admin && d.scope === 'all';
  var values = logTab_().getDataRange().getValues();
  values.shift();
  values = values.filter(function (r) {
    if (r[3] !== 'note saved') return false;
    if (everyone) return true;
    return r[15] ? String(r[15]) === me.username : String(r[2]) === me.name;
  });
  var latest = {};
  values.forEach(function (r) { var v = Number(r[6]) || 0; if (latest[r[5]] === undefined || v > latest[r[5]]) latest[r[5]] = v; });
  var songs = {}, notes = {};
  values.forEach(function (r) {
    if ((Number(r[6]) || 0) !== latest[r[5]]) return;
    var date = day_(r[1]);
    var n = notes[r[5]] || (notes[r[5]] = { id: r[5], title: r[4], date: date, leader: r[2], username: r[15], songs: [] });
    if (!r[10]) return;
    n.songs.push({ book: r[8], number: String(r[9]), title: r[10], key: r[11] });
    var key = r[11] || (r[8] + '|' + String(r[10]).toLowerCase());
    var s = songs[key] || (songs[key] = { key: key, book: r[8], number: String(r[9]), title: r[10], count: 0, last: '', leaders: {} });
    s.count++;
    if (date > s.last) s.last = date;
    s.leaders[r[2]] = (s.leaders[r[2]] || 0) + 1;
  });
  var list = Object.keys(songs).map(function (k) { return songs[k]; });
  list.sort(function (a, b) { return b.count - a.count || (a.last < b.last ? 1 : -1); });
  var nl = Object.keys(notes).map(function (k) { return notes[k]; });
  nl.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return { ok: true, scope: everyone ? 'all' : 'me', songs: list, notes: nl, updated: new Date().toISOString() };
}

// ------------------------------------------------------------------ PowerPoint builder
function home_() {
  var parents = DriveApp.getFileById(ss_().getId()).getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}
function folder_(name) {
  var home = home_(), it = home.getFoldersByName(name);
  return it.hasNext() ? it.next() : home.createFolder(name);
}
function auth_() { return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }; }

/** Google Slides copy of a .ppt/.pptx in Drive (converted once, reused until the source changes). */
function converted_(fileId) {
  var src = DriveApp.getFileById(fileId), updated = src.getLastUpdated().getTime();
  var sh = tab_(CACHE, ['Source ID', 'Source updated', 'Converted ID', 'Name']);
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] === fileId && Number(v[i][1]) === updated) {
      try { if (!DriveApp.getFileById(v[i][2]).isTrashed()) return v[i][2]; } catch (e) { /* gone: convert again */ }
    }
  }
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '/copy?supportsAllDrives=true&fields=id', {
    method: 'post', contentType: 'application/json', headers: auth_(), muteHttpExceptions: true,
    payload: JSON.stringify({ name: src.getName().replace(/\.pptx?$/i, ''), mimeType: 'application/vnd.google-apps.presentation',
      parents: [folder_('SongPoint slide cache').getId()] })
  });
  if (r.getResponseCode() !== 200) throw new Error('Could not convert ' + src.getName() + ': ' + r.getContentText().slice(0, 200));
  var id = JSON.parse(r.getContentText()).id;
  sh.appendRow([fileId, updated, id, src.getName()]);
  return id;
}

function slidesBase_(me, title) {
  return title + ' (' + String(me.name || me.username).replace(/[\\/:*?"<>|]+/g, ' ').trim() + ')';
}
/** Is there already a PowerPoint with this name (title + leader) in the PowerPoint Presentations folder? */
function slidesExists_(me, d) {
  var title = String(d.title || 'SongPoint').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'SongPoint';
  var name = slidesBase_(me, title) + '.pptx', dest;
  try { dest = DriveApp.getFolderById(SHARED_SLIDES_FOLDER); } catch (e) { dest = folder_('SongPoint Slideshows'); }
  return { ok: true, exists: dest.getFilesByName(name).hasNext(), name: name };
}
/** After a build saved "Name (2).pptx": replace the older "Name.pptx" with it (old one goes to Drive's trash). */
function replaceSlides_(me, d) {
  var file = DriveApp.getFileById(String(d.fileId || '')), name = String(d.name || '');
  if (!/\.pptx$/i.test(name) || !/\.pptx$/i.test(file.getName())) return { ok: false, error: 'Not a PowerPoint.' };
  var parents = file.getParents(); if (!parents.hasNext()) return { ok: false, error: 'File has no folder.' };
  var folder = parents.next(), old = folder.getFilesByName(name), n = 0;
  while (old.hasNext()) { var f = old.next(); if (f.getId() !== file.getId()) { f.setTrashed(true); n++; } }
  file.setName(name);
  return { ok: true, name: name, replaced: n };
}
/** Moves a parked PowerPoint into the shared folder: 'replace' trashes the older same-named file(s) first,
    otherwise it's saved alongside as "Name (2).pptx", "(3)"... */
function finalizeSlides_(me, d) {
  var file = DriveApp.getFileById(String(d.fileId || '')), want = String(d.name || file.getName());
  if (!/\.pptx$/i.test(want)) return { ok: false, error: 'Not a PowerPoint.' };
  var dest; try { dest = DriveApp.getFolderById(SHARED_SLIDES_FOLDER); dest.getName(); } catch (e) { dest = folder_('SongPoint Slideshows'); }
  var name = want, base = want.replace(/\.pptx$/i, ''), trashed = 0;
  if (d.mode === 'replace') {
    var old = dest.getFilesByName(want);
    while (old.hasNext()) { var f = old.next(); if (f.getId() !== file.getId()) { f.setTrashed(true); trashed++; } }
  } else {
    for (var k = 2; dest.getFilesByName(name).hasNext() && k < 200; k++) name = base + ' (' + k + ').pptx';
  }
  file.setName(name);
  file.moveTo(dest);
  return { ok: true, name: name, replaced: trashed };
}
/** Editor test for finalizeSlides_ (makes and cleans up a small dummy file). */
function testFinalize() {
  var me = { name: 'Test', username: 'test' }, work = folder_('SongPoint slide cache');
  var a = DriveApp.getFolderById(SHARED_SLIDES_FOLDER).createFile('zz-songpoint-test.pptx', 'old', 'application/octet-stream');
  var b = work.createFile('zz-songpoint-test.pptx', 'new', 'application/octet-stream');
  var r = finalizeSlides_(me, { fileId: b.getId(), name: 'zz-songpoint-test.pptx', mode: 'replace' });
  var ok = a.isTrashed() && DriveApp.getFileById(b.getId()).getParents().next().getId() === SHARED_SLIDES_FOLDER && r.name === 'zz-songpoint-test.pptx';
  DriveApp.getFileById(b.getId()).setTrashed(true);
  if (!ok) throw new Error('finalize test failed: ' + JSON.stringify(r));
  return 'finalize ok';
}
function buildSlides_(me, d) {
  var files = (d.files || []).filter(function (f) { return f && f.id; });
  if (!files.length) return { ok: false, error: 'None of these songs have slides yet.' };
  if (files.length > 40) return { ok: false, error: 'That\'s too many songs for one slideshow (max 40).' };
  var title = String(d.title || 'SongPoint').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'SongPoint';
  var ids = files.map(function (f) { return converted_(f.id); });
  var work = folder_('SongPoint slide cache');           // temporary working copy (thrown away below)
  var copy = DriveApp.getFileById(ids[0]).makeCopy(title + ' (building)', work);
  var pres = SlidesApp.openById(copy.getId());
  for (var i = 1; i < ids.length; i++) {
    SlidesApp.openById(ids[i]).getSlides().forEach(function (s) { pres.appendSlide(s); });
  }
  pres.saveAndClose();
  var resp = UrlFetchApp.fetch('https://docs.google.com/presentation/d/' + copy.getId() + '/export/pptx',
    { headers: auth_(), muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Export failed (' + resp.getResponseCode() + ')');
  // Save to the shared "PowerPoint Presentations" folder as "Title (Leader).pptx"; only if that fails, fall back to
  // SongPoint Slideshows. A file with the same name is replaced if the user chose that, otherwise numbered (2), (3)...
  var dest, shared = 'ok';
  try { dest = DriveApp.getFolderById(SHARED_SLIDES_FOLDER); dest.getName(); }
  catch (e) { shared = String(e && e.message || e); dest = folder_('SongPoint Slideshows'); }
  var base = slidesBase_(me, title), name = base + '.pptx', pending = false;
  // Same name already there? Don't touch the shared folder yet: park the new file in the working folder and let
  // the app ask "Replace or keep both?" (finalizeSlides_ then moves it in).
  if (dest.getFilesByName(name).hasNext()) pending = true;
  var blob = resp.getBlob().setName(name)
    .setContentType('application/vnd.openxmlformats-officedocument.presentationml.presentation');
  var saved = (pending ? work : dest).createFile(blob);
  copy.setTrashed(true);
  if (!d.noLog) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    appendRows_(rowsFor_(me, { id: Utilities.getUuid(), at: new Date().toISOString(), event: 'slides built',
      noteTitle: d.noteTitle || title, noteId: d.noteId || '', dateUsed: d.dateUsed || '', device: d.device || '',
      comment: saved.getName(), songs: d.songs || [] }));
  } finally { lock.releaseLock(); }
  }
  return { ok: true, name: saved.getName(), wanted: base + '.pptx', pending: pending, fileId: saved.getId(), url: saved.getUrl(), size: blob.getBytes().length, shared: shared,
    data: Utilities.base64Encode(blob.getBytes()) };
}

/** Editor test: builds a slideshow from the first two files in a slides folder. */
function testBuild() {
  var folder = DriveApp.getFolderById('14piomFAoPOo8nBAOT2qs3majiEtZunLq');
  var books = folder.getFolders(), files = [];
  while (books.hasNext() && files.length < 3) {
    var it = books.next().getFiles();
    while (it.hasNext() && files.length < 3) { var f = it.next(); if (/\.pptx?$/i.test(f.getName())) files.push({ id: f.getId() }); }
  }
  var admin = users_().filter(function (u) { return u.admin; })[0] || { name: 'Test', username: 'test' };
  var r = buildSlides_(admin, { files: files, title: 'SongPoint test build', noteTitle: 'Test build', device: 'editor', noLog: true });
  Logger.log('%s: %s bytes, %s', r.name, r.size, r.url);
  return r.name;
}

// ------------------------------------------------------------------ problem reports
/** "Report a problem" from the app: a row in the Bug Reports tab, plus the voice memo saved to Drive. */
function bugReport_(me, d) {
  var text = String(d.text || '').slice(0, 5000), link = '';
  if (!text && !d.audio) return { ok: false, error: 'Type a note or record a voice memo first.' };
  if (d.audio) {
    var bytes = Utilities.base64Decode(String(d.audio));
    if (bytes.length > 15 * 1024 * 1024) return { ok: false, error: 'That voice memo is too long.' };
    var ext = /mp4|m4a|aac/.test(d.audioType || '') ? 'm4a' : /ogg/.test(d.audioType || '') ? 'ogg' : 'webm';
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm');
    var file = folder_('SongPoint Problem Reports').createFile(
      Utilities.newBlob(bytes, d.audioType || 'audio/webm', stamp + ' ' + (me.name || me.username) + '.' + ext));
    link = file.getUrl();
  }
  var sh = tab_('Bug Reports', ['Time', 'Name', 'Username', 'Problem', 'Voice memo', 'Where', 'App version', 'Device', 'Status']);
  sh.appendRow([new Date(), me.name || '', me.username, text, link, String(d.where || '').slice(0, 300),
    String(d.version || ''), String(d.device || '').slice(0, 300), 'New']);
  return { ok: true };
}

// ------------------------------------------------------------------ library check (admins)
/** Songs admins have marked "ignore" on the Library check screen (shared by all admins). */
var IGNORE = 'Library Ignore', IHEAD = ['Song', 'Title', 'Book', 'Marked by', 'When'];
function ignored_() {
  var sh = tab_(IGNORE, IHEAD), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); }).filter(String);
}
function setIgnored_(me, d) {
  var key = String(d.key || ''); if (!key) return { ok: false, error: 'No song given.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = tab_(IGNORE, IHEAD), n = sh.getLastRow() - 1;
    var keys = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    var i = keys.indexOf(key);
    if (d.ignored && i < 0) sh.appendRow([key, String(d.title || ''), String(d.book || ''), me.name || me.username, new Date()]);
    if (!d.ignored && i >= 0) sh.deleteRow(i + 2);
  } finally { lock.releaseLock(); }
  return { ok: true, ignored: ignored_() };
}

/** Songs admins marked "Text doc" (readings etc.): no MP3 or key expected, and the app hides the key button. */
var TEXTDOCS = 'Text Docs';
function textDocs_() {
  var sh = tab_(TEXTDOCS, IHEAD), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); }).filter(String);
}
function setTextDoc_(me, d) {
  var key = String(d.key || ''); if (!key) return { ok: false, error: 'No song given.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = tab_(TEXTDOCS, IHEAD), n = sh.getLastRow() - 1;
    var keys = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    var i = keys.indexOf(key);
    if (d.textDoc && i < 0) sh.appendRow([key, String(d.title || ''), String(d.book || ''), me.name || me.username, new Date()]);
    if (!d.textDoc && i >= 0) sh.deleteRow(i + 2);
  } finally { lock.releaseLock(); }
  return { ok: true, textDocs: textDocs_() };
}

// ------------------------------------------------------------------ usage records (admins)
/** Every logged song list (all versions together) and every PowerPoint build, newest first. */
function logRecords_() {
  var v = logTab_().getDataRange().getValues(); v.shift();
  var groups = {}, order = [];
  v.forEach(function (r) {
    var event = String(r[3] || ''), noteId = String(r[5] || ''), entry = String(r[14] || '');
    var key = event === 'note saved' && noteId ? 'n:' + noteId : 'e:' + (entry || Utilities.getUuid());
    var g = groups[key];
    if (!g) {
      g = groups[key] = { key: key, kind: event === 'note saved' ? 'list' : 'slides', noteId: noteId, entryId: entry,
        title: String(r[4] || ''), leader: String(r[2] || ''), username: String(r[15] || ''), dateUsed: day_(r[1]),
        logged: '', versions: {}, latest: 0, songs: [], rows: 0, device: String(r[12] || ''), comment: String(r[13] || '') };
      order.push(key);
    }
    g.rows++;
    var ver = Number(r[6]) || 0; g.versions[ver] = true;
    var at = r[0] instanceof Date ? r[0].toISOString() : String(r[0] || '');
    if (at > g.logged) g.logged = at;
    if (ver > g.latest || (ver === g.latest && g.kind === 'list' && !g.songs.length)) {
      if (ver > g.latest) g.songs = [];
      g.latest = ver; g.title = String(r[4] || g.title); g.dateUsed = day_(r[1]) || g.dateUsed; g.leader = String(r[2] || g.leader);
    }
    if ((Number(r[6]) || 0) === g.latest && r[10]) g.songs.push(String(r[9] ? r[9] + '. ' : '') + String(r[10]));
  });
  var list = order.map(function (k) { var g = groups[k]; g.versions = Object.keys(g.versions).length; return g; });
  list.sort(function (a, b) { return a.logged < b.logged ? 1 : -1; });
  return { ok: true, records: list };
}

/** Deletes whole song-list records (every version) and/or single entries. Deleted rows go to a "Deleted log" tab. */
function deleteLog_(me, d) {
  var noteIds = {}, entryIds = {}, n = 0;
  (d.noteIds || []).forEach(function (x) { if (x) noteIds[String(x)] = true; });
  (d.entryIds || []).forEach(function (x) { if (x) entryIds[String(x)] = true; });
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = logTab_(), last = sh.getLastRow();
    if (last < 2) return { ok: true, deleted: 0 };
    var v = sh.getRange(2, 1, last - 1, HEAD.length).getValues(), keep = [], gone = [];
    v.forEach(function (r) {
      var del = (String(r[3]) === 'note saved' && noteIds[String(r[5])]) || entryIds[String(r[14])];
      (del ? gone : keep).push(r);
    });
    if (!gone.length) return { ok: true, deleted: 0 };
    var bin = tab_('Deleted log', HEAD.concat(['Deleted at', 'Deleted by']));
    var stamp = new Date(), by = me.name || me.username;
    bin.getRange(bin.getLastRow() + 1, 1, gone.length, HEAD.length + 2).setValues(gone.map(function (r) { return r.concat([stamp, by]); }));
    sh.getRange(2, 1, last - 1, HEAD.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, HEAD.length).setValues(keep);
    if (keep.length && last - 1 > keep.length) sh.deleteRows(keep.length + 2, last - 1 - keep.length);
    n = gone.length;
  } finally { lock.releaseLock(); }
  return { ok: true, deleted: n };
}

/** Editor check: can the server save into the shared PowerPoints folder? */
function checkSharedFolder() {
  var f = DriveApp.getFolderById(SHARED_SLIDES_FOLDER), t = f.createFile('songpoint-access-check.txt', 'ok');
  t.setTrashed(true);
  Logger.log('Can save to: ' + f.getName());
  return f.getName();
}

// ------------------------------------------------------------------ file relay
// Google sometimes blocks the app's direct Drive downloads from a busy network ("automated queries").
// The app then asks the server for the song (or sheet music image) instead. Only library media is served.
function file_(d) {
  var f = DriveApp.getFileById(String(d.id || ''));
  var mime = f.getMimeType();
  var chordFile = /\.(cho|crd|chopro|chordpro|pro|onsong)$/i.test(f.getName());
  if (!chordFile && !/^(audio\/|image\/|application\/pdf$)/.test(mime)) return { ok: false, error: 'Not a song or sheet music file.' };
  if (f.getSize() > 30 * 1024 * 1024) return { ok: false, error: 'File is too large.' };
  return { ok: true, mime: mime, name: f.getName(), data: Utilities.base64Encode(f.getBlob().getBytes()) };
}

// ------------------------------------------------------------------ chord chart arrangements
// One shared section order (and key) per chord chart. The chart file itself is never changed.
var ARR = 'Arrangements', AHEAD = ['Chart ID', 'Song key', 'Title', 'Book', 'Order', 'Key', 'Updated by', 'Updated', 'Note'];
function arrangements_() {
  var sh = tab_(ARR, AHEAD), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, AHEAD.length).getValues().filter(function (r) { return r[0]; }).map(function (r) {
    var order = []; try { order = JSON.parse(r[4] || '[]'); } catch (e) {}
    return { chartId: String(r[0]), songKey: String(r[1]), order: order, key: String(r[5] || ''), by: String(r[6] || ''),
      at: r[7] instanceof Date ? r[7].toISOString() : String(r[7] || ''), note: String(r[8] || '') };
  });
}
function setArrangement_(me, d) {
  var id = String(d.chartId || ''); if (!id) return { ok: false, error: 'No chart given.' };
  var order = (d.order || []).slice(0, 60).map(function (x) { return { i: Number(x.i) || 0, label: String(x.label || '').slice(0, 60) }; });
  if (!order.length) return { ok: false, error: 'Choose at least one section.' };
  var row = [id, String(d.songKey || ''), String(d.title || '').slice(0, 120), String(d.book || '').slice(0, 60), JSON.stringify(order),
    String(d.key || '').slice(0, 8), me.name || me.username, new Date(), String(d.note || '').slice(0, 1000)];
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = tab_(ARR, AHEAD), n = sh.getLastRow() - 1;
    var ids = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    var i = ids.indexOf(id);
    if (i >= 0) sh.getRange(i + 2, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
  } finally { lock.releaseLock(); }
  return { ok: true, arrangements: arrangements_() };
}
function deleteArrangement_(me, d) {
  var id = String(d.chartId || '');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = tab_(ARR, AHEAD), n = sh.getLastRow() - 1;
    var ids = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    var i = ids.indexOf(id);
    if (i >= 0) sh.deleteRow(i + 2);
  } finally { lock.releaseLock(); }
  return { ok: true, arrangements: arrangements_() };
}

// ------------------------------------------------------------------ performance mode (devices following a host)
// The server only introduces devices to each other (a short mailbox for connection details), then they talk
// directly. If a direct connection isn't possible, the host's current position is kept here for them to poll.
// Everything lives in the script cache and expires on its own (sessions after 6 hours, messages after 10 minutes).
function pc_() { return CacheService.getScriptCache(); }
function perfSession_(code) { var v = pc_().get('ps:' + code); return v ? JSON.parse(v) : null; }
function perfHost_(me) {
  var c = pc_(), code = '';
  for (var i = 0; i < 30; i++) { code = String(1000 + Math.floor(Math.random() * 9000)); if (!c.get('ps:' + code)) break; }
  var s = { host: me.name || me.username, hostPeer: 'h' + Utilities.getUuid().slice(0, 8), at: Date.now() };
  c.put('ps:' + code, JSON.stringify(s), 21600);
  return { ok: true, code: code, peer: s.hostPeer };
}
function perfJoin_(d) {
  var code = String(d.code || '').replace(/\D/g, ''), s = perfSession_(code);
  if (!s) return { ok: false, error: 'No session with that code. Check the number on the host\'s screen.' };
  return { ok: true, code: code, host: s.host, hostPeer: s.hostPeer, peer: 'p' + Utilities.getUuid().slice(0, 8) };
}
function perfSend_(d) {
  var code = String(d.code || ''), to = String(d.to || ''); if (!perfSession_(code)) return { ok: false, ended: true };
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var k = 'pm:' + code + ':' + to, list = JSON.parse(pc_().get(k) || '[]');
    list.push(d.msg); if (list.length > 20) list = list.slice(-20);
    pc_().put(k, JSON.stringify(list), 600);
  } finally { lock.releaseLock(); }
  return { ok: true };
}
function perfPoll_(d) {
  var code = String(d.code || ''), peer = String(d.peer || '');
  if (!perfSession_(code)) return { ok: true, ended: true, msgs: [] };
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  var msgs = [];
  try { var k = 'pm:' + code + ':' + peer; msgs = JSON.parse(pc_().get(k) || '[]'); if (msgs.length) pc_().remove(k); }
  finally { lock.releaseLock(); }
  return { ok: true, msgs: msgs };
}
function perfState_(d) {
  var code = String(d.code || '');
  if (!perfSession_(code)) return { ok: true, ended: true };
  if (d.state) { pc_().put('pst:' + code, JSON.stringify(d.state), 21600); return { ok: true }; }
  var v = pc_().get('pst:' + code);
  return { ok: true, state: v ? JSON.parse(v) : null };
}
function perfEnd_(d) { var code = String(d.code || ''); pc_().removeAll(['ps:' + code, 'pst:' + code]); return { ok: true }; }
