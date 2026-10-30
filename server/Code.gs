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
function doGet() { return json_({ ok: true, app: 'MMC SongPoint server', version: 3 }); }

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
  if (a === 'bugReport') return bugReport_(me, d);
  if (a === 'getTextDocs') return { ok: true, textDocs: textDocs_() };

  if (!me.admin) return { ok: false, error: 'Only admins can do that.' };
  if (a === 'listUsers') return { ok: true, users: users_().map(publicUser_) };
  if (a === 'createUser') return createUser_(d);
  if (a === 'resetPassword') return resetPassword_(d);
  if (a === 'setAdmin') return setAdmin_(me, d);
  if (a === 'setDisabled') return setDisabled_(me, d);
  if (a === 'getIgnored') return { ok: true, ignored: ignored_() };
  if (a === 'setIgnored') return setIgnored_(me, d);
  if (a === 'setTextDoc') return setTextDoc_(me, d);
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

function buildSlides_(me, d) {
  var files = (d.files || []).filter(function (f) { return f && f.id; });
  if (!files.length) return { ok: false, error: 'None of these songs have slides yet.' };
  if (files.length > 40) return { ok: false, error: 'That\'s too many songs for one slideshow (max 40).' };
  var title = String(d.title || 'SongPoint').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'SongPoint';
  var ids = files.map(function (f) { return converted_(f.id); });
  var out = folder_('SongPoint Slideshows');
  var copy = DriveApp.getFileById(ids[0]).makeCopy(title + ' (building)', out);
  var pres = SlidesApp.openById(copy.getId());
  for (var i = 1; i < ids.length; i++) {
    SlidesApp.openById(ids[i]).getSlides().forEach(function (s) { pres.appendSlide(s); });
  }
  pres.saveAndClose();
  var resp = UrlFetchApp.fetch('https://docs.google.com/presentation/d/' + copy.getId() + '/export/pptx',
    { headers: auth_(), muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Export failed (' + resp.getResponseCode() + ')');
  var blob = resp.getBlob().setName(title + '.pptx')
    .setContentType('application/vnd.openxmlformats-officedocument.presentationml.presentation');
  var saved = out.createFile(blob);
  copy.setTrashed(true);
  if (!d.noLog) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    appendRows_(rowsFor_(me, { id: Utilities.getUuid(), at: new Date().toISOString(), event: 'slides built',
      noteTitle: d.noteTitle || title, noteId: d.noteId || '', dateUsed: d.dateUsed || '', device: d.device || '',
      comment: saved.getName(), songs: d.songs || [] }));
  } finally { lock.releaseLock(); }
  }
  return { ok: true, name: saved.getName(), fileId: saved.getId(), url: saved.getUrl(), size: blob.getBytes().length,
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
