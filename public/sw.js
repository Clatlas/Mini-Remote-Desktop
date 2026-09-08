const CACHE = 'mrd-v0.6.3-hyperv-access';
const APP_SHELL = [
  '/', '/index.html',
  '/styles.css?v=0.5.0', '/iphone-safearea.css?v=0.5.0',
  '/bootstrap.js?v=0.5.0', '/app.js?v=0.5.0', '/chrome-window.js?v=0.5.0', '/secret-client.js?v=0.5.0',
  '/app-manager.js?v=0.5.0', '/extras.js?v=0.5.1',
  '/manifest.webmanifest', '/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(APP_SHELL.map(async asset => {
      const response = await fetch(asset, { cache: 'reload' });
      if (!response.ok) throw new Error(`Could not refresh ${asset}: HTTP ${response.status}`);
      await cache.put(asset, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/guacamole/') || url.pathname === '/update-result.json') return;

  const reloadPaths = new Set([
    '/app.js',
    '/chrome-window.js',
    '/secret-client.js',
    '/app-manager.js',
    '/extras.js'
  ]);
  const request = reloadPaths.has(url.pathname)
    ? new Request(event.request, { cache: 'reload' })
    : event.request;

  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html')))
  );
});
