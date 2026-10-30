// MMC SongPoint service worker: opens offline, and plays/shows songs saved for offline use.
const VERSION = '__BUILD__';
const SHELL = 'songpoint-shell-' + VERSION;
const FILES = 'songpoint-files-v1';
const SHELL_FILES = ['./', 'index.html', 'config.js', 'web.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('songpoint-shell-') && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

// Answer "bytes=a-b" requests from a saved file, so seeking works offline (needed by iPhone audio).
async function ranged(request, response) {
  const range = request.headers.get('range');
  if (!range) return response;
  const buf = await response.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : buf.byteLength - 1;
  if (!m[1] && m[2]) { start = Math.max(0, buf.byteLength - +m[2]); end = buf.byteLength - 1; }
  end = Math.min(end, buf.byteLength - 1);
  return new Response(buf.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
    'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
    'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Songs and sheet music: use the saved copy if there is one.
  if (url.pathname.includes('/drive/v3/files/') && url.searchParams.get('alt') === 'media') {
    e.respondWith((async () => {
      const cache = await caches.open(FILES);
      const hit = await cache.match(req.url);
      return hit ? ranged(req, hit) : fetch(req);
    })());
    return;
  }

  // The app itself: try the network first (to get updates), fall back to the saved copy offline.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) { const c = await caches.open(SHELL); c.put(req, fresh.clone()); }
        return fresh;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('index.html')) || Response.error();
      }
    })());
  }
});
