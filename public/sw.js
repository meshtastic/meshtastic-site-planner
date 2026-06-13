/* Service worker for the Meshtastic Site Planner PWA (#11).
 *
 * Strategy (no build-time precache manifest, so it stays dependency-free):
 *  - Navigations: network-first, falling back to the cached app shell so the
 *    app opens offline and online visitors always get the latest index.html.
 *  - Same-origin GET assets (the hashed JS/CSS/wasm/worker, icons): cache-first,
 *    populated on first fetch. Hashed names make stale assets impossible.
 *  - Cross-origin requests (basemap tiles, SRTM terrain) bypass the worker;
 *    terrain has its own Cache API (terrain-v1) and tiles need the network.
 *
 * After the first online load every app asset is cached, so the UI, the WASM
 * engine, and any already-fetched terrain work offline. Bump CACHE to evict.
 */

const CACHE = 'mt-app-v1';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // tiles/terrain -> network

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./').then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
