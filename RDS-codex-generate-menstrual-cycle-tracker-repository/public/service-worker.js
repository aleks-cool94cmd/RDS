const CACHE = 'cycleflow-v37';
const OFFLINE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './i18n/ru.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(OFFLINE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isNavigation = event.request.mode === 'navigate';
  const isCoreAsset = isSameOrigin
    && (
      requestUrl.pathname === '/'
      || requestUrl.pathname.endsWith('/index.html')
      || requestUrl.pathname.startsWith('/js/')
      || requestUrl.pathname.startsWith('/css/')
      || requestUrl.pathname.startsWith('/i18n/')
    );

  if (isNavigation || isCoreAsset) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          return cached || caches.match('./index.html');
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : { title: 'CycleFlow', body: 'Новое уведомление' };
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body }));
});
