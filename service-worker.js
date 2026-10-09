const CACHE_NAME = 'dailyrep-v5';
const CDN_CACHE = 'dailyrep-cdn-v1';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/rep-detector.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './sounds/beep.wav'
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com'];

self.addEventListener('install', (event) => {
  // Add individually: one missing file must not leave the whole cache empty.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(ASSETS.map((a) => cache.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) => cache.match(request).then((cached) => {
    const network = fetch(request).then((response) => {
      if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
      return response;
    });
    if (cached) {
      network.catch(() => {});
      return cached;
    }
    return network;
  }));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
            return response;
          })
          .catch(() => caches.match('./index.html'))
      );
      return;
    }
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
    return;
  }

  // Ionic loads components lazily from the CDN; cache them so the app works offline after first use.
  if (CDN_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
});
