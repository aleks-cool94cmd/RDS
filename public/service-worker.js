const CACHE = 'cycleflow-v1';
const OFFLINE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './i18n/ru.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_ASSETS)));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : { title: 'CycleFlow', body: 'Новое уведомление' };
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body }));
});
