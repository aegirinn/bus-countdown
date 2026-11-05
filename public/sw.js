// Makes the app installable and lets it open instantly (and offline, minus live data).
// Bus times always come from the network. Cached here: the app's own files, and the
// OpenStreetMap map images (tiles) people have already looked at.
const CACHE = 'next-bus-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

// ---- map tiles ----
const TILE_CACHE = 'osm-tiles-v1';
const TILE_HOST = 'tile.openstreetmap.org';
const TILE_FRESH_MS = 14 * 24 * 60 * 60 * 1000; // after 2 weeks, refresh in the background
const TILE_MAX = 1500; // ~15–25 MB; the oldest are dropped beyond this
const STAMP = 'x-sw-cached-at';
const KEEP = [CACHE, TILE_CACHE];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  if (url.hostname === TILE_HOST) {
    e.respondWith(tile(e.request, e));
    return;
  }

  if (url.origin !== location.origin) return;
  // bus times always come live from the server; only the map's stop list may come from the phone
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/map') return;

  // Network first so updates show up straight away; fall back to the cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/'))),
  );
});

/**
 * Map tiles: use the stored copy if there is one (instant, no download). Copies older than
 * TILE_FRESH_MS are still shown, but replaced in the background. Only tiles someone actually
 * looked at are stored — OpenStreetMap doesn't allow downloading areas in advance.
 */
async function tile(request, event) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request.url);
  if (hit) {
    const age = Date.now() - Number(hit.headers.get(STAMP) || 0);
    if (age > TILE_FRESH_MS) event.waitUntil(download(cache, request).catch(() => {}));
    return hit;
  }
  try {
    return await download(cache, request);
  } catch {
    return Response.error();
  }
}

let stored = 0;
async function download(cache, request) {
  const res = await fetch(request);
  if (!res.ok || res.type === 'opaque') return res; // only keep proper, readable images
  const body = await res.clone().blob();
  const headers = new Headers(res.headers);
  headers.set(STAMP, String(Date.now()));
  await cache.put(request.url, new Response(body, { status: 200, headers }));
  if (++stored % 50 === 0) trim(cache);
  return res;
}

// Keep the tile cache from growing without limit: drop the oldest entries.
async function trim(cache) {
  const keys = await cache.keys(); // oldest first
  const extra = keys.length - TILE_MAX;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}
