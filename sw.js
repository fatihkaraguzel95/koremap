/* Koremap service worker — kabuk icin cache-first, harita karolari icin stale-while-revalidate. */

const VERSION = 'koremap-v2';
const SHELL = [
  './', './index.html', './app.css', './app.js', './parse.js',
  './data/places.json', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.min.css',
];
const TILES = VERSION + '-tiles';
const TILE_LIMIT = 900;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // Tek bir CDN hatasi kurulumu bozmasin.
    await Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION && k !== TILES).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** Karo onbellegini kabaca sinirla (FIFO). */
async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length > TILE_LIMIT) {
    await Promise.all(keys.slice(0, keys.length - TILE_LIMIT).map(k => c.delete(k)));
  }
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Nominatim gibi canli servisleri onbellege alma
  if (url.hostname.includes('nominatim')) return;

  // Harita karolari: once onbellek, arkada tazele
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(request);
      const net = fetch(request).then(res => {
        if (res.ok) { c.put(request, res.clone()); trimTiles(); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  // Gezinme: once ag, cevrimdisiyken kabuk
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Diger her sey: once onbellek
  e.respondWith((async () => {
    const hit = await caches.match(request, { ignoreSearch: false });
    if (hit) return hit;
    try {
      const res = await fetch(request);
      if (res.ok && url.origin === location.origin) {
        (await caches.open(VERSION)).put(request, res.clone());
      }
      return res;
    } catch (err) {
      return hit || Response.error();
    }
  })());
});
