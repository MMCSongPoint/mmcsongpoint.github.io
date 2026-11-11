// MMC SongPoint for Windows. It opens the web app (https://mmcsongpoint.github.io) in its own window, so every change
// to the web app arrives without reinstalling, and adds what a browser can't do on its own:
//  - the slideshow opens full screen on the projector straight away (no "manage windows" prompt, no extra click),
//    and moves there if the projector is plugged in later
//  - videos play with sound on the projector without a click first
//  - the PowerPoint helper is built in: it starts with the app (unless one is already running) and stops with it
//  - the computer and projector stay awake while the slideshow is open, and (if turned on in Settings) a laptop keeps
//    going with its lid closed: Windows' "when I close the lid" is set to "do nothing" during the slideshow, then put back
//  - the app updates itself: a new version downloads in the background and installs when the app closes
const { app, BrowserWindow, screen, shell, session, ipcMain, powerSaveBlocker, Menu } = require('electron');
const path = require('path'), fs = require('fs'), net = require('net'), { spawn } = require('child_process');

const SITE = 'https://mmcsongpoint.github.io/';
const ORIGIN = new URL(SITE).origin;
const HELPER_PORT = 47321;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');   // video sound on the projector
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let main = null, proj = null, helper = null, awake = -1;

// ---- settings kept between runs (which screen is the projector)
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
function prefs() { try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); } catch { return {}; } }
function savePrefs(p) { try { fs.writeFileSync(prefsFile(), JSON.stringify(p)); } catch {} }

const ours = u => { try { const x = new URL(u); return x.origin === ORIGIN || x.protocol === 'file:'; } catch { return false; } };

// ---- the projector: the screen picked in Settings, otherwise the biggest screen that isn't the one SongPoint is on
function projectorDisplay() {
  const all = screen.getAllDisplays(), want = prefs().projector;
  const picked = all.find(d => String(d.id) === String(want)); if (picked) return picked;
  const here = main ? screen.getDisplayMatching(main.getBounds()) : screen.getPrimaryDisplay();
  return all.filter(d => d.id !== here.id).sort((a, b) => b.size.width * b.size.height - a.size.width * a.size.height)[0] || null;
}
function placeProjector() {
  if (!proj || proj.isDestroyed()) return;
  let d = projectorDisplay();
  // down to one screen during a show (a laptop's lid closed, its own screen off): the show stays full screen there
  if (!d && proj.isFullScreen() && screen.getAllDisplays().length === 1) d = screen.getAllDisplays()[0];
  if (!d) { if (proj.isFullScreen()) proj.setFullScreen(false); proj.setBounds({ width: 960, height: 540 }); proj.center(); return; }
  if (proj.isFullScreen()) proj.setFullScreen(false);
  proj.setBounds(d.bounds);
  proj.setFullScreen(true);
}
// ---- laptop lid: Windows' lid setting (power plan: Buttons › Lid close action) set to "do nothing" during a show.
// What it was is saved first, and put back when the show ends, when the app closes, or the next time it starts.
const PC = args => new Promise(res => { try { const p = spawn('powercfg', args, { windowsHide: true }); let out = ''; p.stdout.on('data', d => out += d); p.on('close', () => res(out)); p.on('error', () => res('')); } catch { res(''); } });
async function lidHold(on) {
  if (process.platform !== 'win32') return;
  const p = prefs();
  if (on && !p.lidRestore && p.lidAwake) {
    const hex = ((await PC(['/q', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION'])).match(/0x[0-9a-f]{8}/gi) || []).slice(-2);
    if (hex.length < 2) return;
    p.lidRestore = { ac: parseInt(hex[0], 16), dc: parseInt(hex[1], 16) }; savePrefs(p);
    await PC(['/setacvalueindex', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', '0']);
    await PC(['/setdcvalueindex', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', '0']);
    await PC(['/setactive', 'SCHEME_CURRENT']);
  } else if (!on && p.lidRestore) {
    await PC(['/setacvalueindex', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', String(p.lidRestore.ac)]);
    await PC(['/setdcvalueindex', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', String(p.lidRestore.dc)]);
    await PC(['/setactive', 'SCHEME_CURRENT']);
    delete p.lidRestore; savePrefs(p);
  }
}
function keepAwake(on) {
  if (on && awake < 0) awake = powerSaveBlocker.start('prevent-display-sleep');
  if (!on && awake >= 0) { powerSaveBlocker.stop(awake); awake = -1; }
}

function createMain() {
  main = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 500, show: false, backgroundColor: '#181316', title: 'MMC SongPoint',
    icon: path.join(__dirname, 'offline', 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  main.once('ready-to-show', () => { main.maximize(); main.show(); });
  main.loadURL(SITE);
  // no internet and nothing saved yet: the copy that came with the app
  main.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3 && !url.startsWith('file:')) main.loadFile(path.join(__dirname, 'offline', 'index.html')).catch(() => {});
  });
  main.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (!ours(url)) { shell.openExternal(url); return { action: 'deny' }; }
    if (frameName === 'songpoint-projector' || /projector\.html/.test(url)) {
      const d = projectorDisplay(), b = d ? d.bounds : null;
      return { action: 'allow', overrideBrowserWindowOptions: Object.assign({
        backgroundColor: '#000000', autoHideMenuBar: true, title: 'SongPoint · Projector', show: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
      }, b ? { x: b.x, y: b.y, width: b.width, height: b.height, frame: false, fullscreen: true } : { width: 960, height: 540 }) };
    }
    return { action: 'allow' };
  });
  main.webContents.on('did-create-window', (w, { url, frameName }) => {
    if (!(frameName === 'songpoint-projector' || /projector\.html/.test(url))) return;
    proj = w; keepAwake(true); lidHold(true);
    w.setMenuBarVisibility(false);
    setTimeout(placeProjector, 50);
    w.on('closed', () => { proj = null; keepAwake(false); lidHold(false); });
  });
  // links to other sites open in the normal browser
  main.webContents.on('will-navigate', (e, url) => { if (!ours(url)) { e.preventDefault(); shell.openExternal(url); } });
  main.on('closed', () => { main = null; if (proj && !proj.isDestroyed()) proj.close(); });
}

// ---- the PowerPoint helper (the same script as the separate download), started hidden with the app
function portInUse(port) {
  return new Promise(res => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); res(true); });
    s.on('error', () => res(false)); s.setTimeout(800, () => { s.destroy(); res(false); });
  });
}
async function startHelper() {
  if (process.platform !== 'win32') return;
  const script = path.join(process.resourcesPath, 'helper', 'SongPoint-PowerPoint.ps1');
  if (!fs.existsSync(script) || await portInUse(HELPER_PORT)) return;   // missing, or already running (the separate helper)
  try {
    helper = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Hidden'],
      { windowsHide: true, stdio: 'ignore' });
    helper.on('exit', () => { helper = null; });
  } catch { helper = null; }
}
function stopHelper() {
  if (!helper) return;
  try { spawn('taskkill', ['/pid', String(helper.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  helper = null;
}

// ---- updates: checked at start and every few hours; a new version installs when the app is closed
function checkUpdates() {
  if (!app.isPackaged) return;
  let au; try { au = require('electron-updater').autoUpdater; } catch { return; }
  au.autoDownload = true; au.autoInstallOnAppQuit = true;
  au.on('error', () => {});
  const go = () => au.checkForUpdates().catch(() => {});
  go(); setInterval(go, 4 * 3600 * 1000);
}

ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('screens', () => {
  const p = prefs(), primary = screen.getPrimaryDisplay().id, auto = projectorDisplay();
  return { picked: p.projector || '', auto: auto ? String(auto.id) : '', screens: screen.getAllDisplays().map((d, i) => ({
    id: String(d.id), label: d.label || `Screen ${i + 1}`, primary: d.id === primary, width: d.size.width, height: d.size.height })) };
});
ipcMain.handle('set-projector', (e, id) => { const p = prefs(); p.projector = id || ''; savePrefs(p); placeProjector(); return true; });
ipcMain.handle('lid', (e, on) => { const p = prefs(); if (on !== undefined) { p.lidAwake = !!on; savePrefs(p); if (proj) lidHold(!!on); } return !!prefs().lidAwake; });
ipcMain.handle('keep-awake', (e, on) => { keepAwake(on || !!proj); return true; });

app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // the web app may use the screens, full screen, the microphone (voice notes) and this computer's PowerPoint helper
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(ours((details && details.requestingUrl) || wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => ours(origin) || origin === 'null');
  lidHold(false);   // the app closed during a show last time: put the lid setting back
  createMain();
  startHelper();
  checkUpdates();
  // a projector plugged in (or unplugged) while the slideshow is open: move it there
  screen.on('display-added', () => setTimeout(placeProjector, 800));
  screen.on('display-removed', () => setTimeout(placeProjector, 800));
});
app.on('window-all-closed', () => app.quit());
let quitting = false;
app.on('before-quit', e => {
  stopHelper();
  if (!quitting && prefs().lidRestore) { quitting = true; e.preventDefault(); lidHold(false).finally(() => app.quit()); }
});
