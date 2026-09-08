const CACHE = 'mrd-v0.4.1-complete-features';
const APP_SHELL = [
  '/', '/index.html',
  '/styles.css?v=0.4.1', '/iphone-safearea.css?v=0.4.1',
  '/app.js?v=0.4.1', '/browser-engine.js?v=0.4.1', '/secret-client.js?v=0.4.1',
  '/app-manager.js?v=0.4.1', '/extras.js?v=0.4.1',
  '/manifest.webmanifest', '/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/guacamole/') || url.pathname === '/update-result.json') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html')))
  );
});
