/* MMC SongPoint log. Bound to the "SongPoint Log" Google Sheet; deployed as a web app.
   POST: the app sends song lists when a note is saved -> rows in the Log tab.
   GET ?action=usage: song usage summary for the app's Usage screen. */
var SECRET = 'cc85c1a96dffb0ec870badd6424035ff854532061ceca48db95fb8233781810f';
var TAB = 'Log';
var HEAD = ['Logged at', 'Date used', 'Leader', 'Event', 'Note', 'Note ID', 'Version', 'Position', 'Book', 'Number', 'Title', 'Song key', 'Device', 'Comment', 'Entry ID'];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB);
  if (!sh) {
    sh = ss.insertSheet(TAB, 0);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEAD.length).setFontWeight('bold');
    var first = ss.getSheetByName('Sheet1');
    if (first && first.getLastRow() === 0) ss.deleteSheet(first);
  }
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function setup() {
  sheet_();
}

function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (d.secret !== SECRET) return json_({ ok: false, error: 'not allowed' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_();
    var seen = {};
    var last = sh.getLastRow();
    if (last > 1) {
      var start = Math.max(2, last - 3000);
      sh.getRange(start, 15, last - start + 1, 1).getValues().forEach(function (r) { seen[r[0]] = true; });
    }
    var rows = [];
    var done = [];
    (d.entries || []).forEach(function (x) {
      done.push(x.id);
      if (seen[x.id]) return;
      var songs = x.songs && x.songs.length ? x.songs : [null];
      songs.forEach(function (s, i) {
        rows.push([new Date(x.at || Date.now()), x.dateUsed || '', x.leader || '', x.event || '', x.noteTitle || '',
          x.noteId || '', x.version || '', s ? i + 1 : '', s ? s.book || '' : '', s ? String(s.number || '') : '',
          s ? s.title || '' : '', s ? s.key || '' : '', x.device || '', x.comment || '', x.id || '']);
      });
    });
    if (rows.length) {
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEAD.length).setValues(rows);
      sh.getRange(2, 2, sh.getLastRow() - 1, 1).setNumberFormat('yyyy-mm-dd');
      sh.getRange(2, 10, sh.getLastRow() - 1, 1).setNumberFormat('@');
    }
    return json_({ ok: true, saved: done, rows: rows.length });
  } finally {
    lock.releaseLock();
  }
}

function day_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '');
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.secret !== SECRET) return json_({ ok: false, error: 'not allowed' });
  var values = sheet_().getDataRange().getValues();
  values.shift();
  var latest = {};
  values.forEach(function (r) {
    if (r[3] !== 'note saved') return;
    var v = Number(r[6]) || 0;
    if (latest[r[5]] === undefined || v > latest[r[5]]) latest[r[5]] = v;
  });
  var songs = {};
  var notes = {};
  values.forEach(function (r) {
    if (r[3] !== 'note saved' || (Number(r[6]) || 0) !== latest[r[5]]) return;
    var date = day_(r[1]);
    var n = notes[r[5]] || (notes[r[5]] = { id: r[5], title: r[4], date: date, leader: r[2], device: r[12], songs: [] });
    if (!r[10]) return;
    n.songs.push({ book: r[8], number: String(r[9]), title: r[10], key: r[11] });
    var key = r[11] || (r[8] + '|' + String(r[10]).toLowerCase());
    var s = songs[key] || (songs[key] = { key: key, book: r[8], number: String(r[9]), title: r[10], count: 0, last: '', first: '', leaders: {} });
    s.count++;
    if (date > s.last) s.last = date;
    if (!s.first || date < s.first) s.first = date;
    s.leaders[r[2]] = (s.leaders[r[2]] || 0) + 1;
  });
  var list = Object.keys(songs).map(function (k) { return songs[k]; });
  list.sort(function (a, b) { return b.count - a.count || (a.last < b.last ? 1 : -1); });
  var nl = Object.keys(notes).map(function (k) { return notes[k]; });
  nl.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return json_({ ok: true, songs: list, notes: nl, updated: new Date().toISOString() });
}
