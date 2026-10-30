// Web (iPhone / browser) version of the Android app's native bridge.
// Gives the shared app the same abilities through browser features:
//   offline saving  -> Cache Storage (served back by sw.js, with seeking support)
//   lock screen     -> Media Session API
//   keep screen on  -> Screen Wake Lock API
//   PDF pages       -> PDF.js (vendor/, added when the site is published)
// In the Android app window.Native already exists, so this file does nothing there.
(function () {
  'use strict';
  if (window.Native || location.protocol === 'file:') return;

  const FILES = 'songpoint-files-v1';
  const hasCache = 'caches' in window;
  const ids = new Set();
  let sizes = {};
  try { sizes = JSON.parse(localStorage.getItem('savedSizes') || '{}'); } catch { sizes = {}; }
  const saveSizes = () => { try { localStorage.setItem('savedSizes', JSON.stringify(sizes)); } catch {} };
  const idFromUrl = u => { const m = u.match(/\/files\/([^/?]+)\?alt=media/); return m ? decodeURIComponent(m[1]) : null; };
  const call = (name, ...args) => { try { window[name] && window[name](...args); } catch (e) { console.warn(e); } };

  const ready = hasCache
    ? caches.open(FILES).then(c => c.keys()).then(keys => { keys.forEach(r => { const id = idFromUrl(r.url); if (id) ids.add(id); }); })
        .catch(() => {})
    : Promise.resolve();

  // Download one file at a time so phones on slow connections stay responsive.
  const queue = [];
  let busy = false;
  async function pump() {
    if (busy || !queue.length) return;
    busy = true;
    const { id, url } = queue.shift();
    let ok = false;
    try {
      const r = await fetch(url);
      if (r.ok) {
        const blob = await r.blob();
        const cache = await caches.open(FILES);
        await cache.put(url, new Response(blob, { headers: {
          'Content-Type': r.headers.get('Content-Type') || blob.type || 'application/octet-stream',
          'Content-Length': String(blob.size) } }));
        ids.add(id); sizes[id] = blob.size; saveSizes(); ok = true;
      }
    } catch (e) { console.warn('save failed', e); }
    busy = false;
    call('onNativeDownload', id, ok);
    pump();
  }

  // ---------------------------------------------------------------- lock screen controls
  const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
  if (ms) {
    const click = sel => () => { const b = document.querySelector(sel); if (b) b.click(); };
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
    set('play', () => { const a = document.getElementById('audio'); if (a && a.paused) call('togglePlay'); });
    set('pause', () => { const a = document.getElementById('audio'); if (a && !a.paused) call('togglePlay'); });
    set('seekbackward', click('#back5Btn'));   // lock screen: 5-second skips (no next/previous track)
    set('seekforward', click('#fwd5Btn'));
  }

  // ---------------------------------------------------------------- keep screen on
  let wake = null;
  async function wakeOn() {
    try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch {}
  }
  let wantWake = false;
  document.addEventListener('visibilitychange', () => { if (wantWake && document.visibilityState === 'visible') wakeOn(); });

  // ---------------------------------------------------------------- PDF pages via PDF.js
  let pdfLib = null;
  async function loadPdfJs() {
    if (!pdfLib) {
      pdfLib = await import('./vendor/pdf.min.mjs');
      pdfLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', location.href).href;
    }
    return pdfLib;
  }

  window.WebNative = {
    isAndroid: () => false,
    isWeb: true,
    ready,
    canSave: hasCache,
    localUrl: () => '',            // saved files are served at their normal address by sw.js
    downloadedIds: () => JSON.stringify([...ids]),
    downloadedBytes: () => Object.values(sizes).reduce((a, b) => a + b, 0),
    download(id, url) { this.downloadAs(id, url, 'mp3'); },
    downloadAs(id, url) {
      if (!hasCache) { setTimeout(() => call('onNativeDownload', id, false)); return; }
      queue.push({ id, url }); pump();
    },
    remove(id) {
      ids.delete(id); delete sizes[id]; saveSizes();
      if (hasCache) caches.open(FILES).then(c => c.keys().then(keys => keys.forEach(r => { if (idFromUrl(r.url) === id) c.delete(r); })));
    },
    removeAll() { ids.clear(); sizes = {}; saveSizes(); if (hasCache) caches.delete(FILES); },
    playbackState(playing, title, subtitle) {
      if (!ms) return;
      try {
        ms.metadata = new MediaMetadata({ title, artist: subtitle, album: document.title,
          artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
        ms.playbackState = playing ? 'playing' : 'paused';
      } catch {}
    },
    stopPlayback() {},
    keepScreenOn(on) {
      wantWake = on;
      if (on) wakeOn(); else if (wake) { wake.release().catch(() => {}); wake = null; }
    },
    setSystemBars(color) {
      document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', color));
    },
    async renderPdf(id, url) {
      try {
        const lib = await loadPdfJs();
        const data = await (await fetch(url)).arrayBuffer();
        const doc = await lib.getDocument({ data }).promise;
        const urls = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: 1500 / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
          urls.push(URL.createObjectURL(blob));
          canvas.width = canvas.height = 0;
        }
        call('onNativePdf', id, true, JSON.stringify(urls));
      } catch (e) {
        console.warn('pdf failed', e);
        call('onNativePdf', id, false, '[]');
      }
    },
    openUrl(url) { window.open(url, '_blank', 'noopener'); },
  };

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
  }
})();
