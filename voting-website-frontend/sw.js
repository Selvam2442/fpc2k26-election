const CACHE_NAME = 'kc-fpc-shell-v10';
const APP_SHELL = [
  './',
  './index.html',
  './dashboard.html',
  './students.html',
  './staff.html',
  './staff-vote.html',
  './admin.html',
  './portal.css',
  './portal.js',
  './manifest.webmanifest',
  './app-icon-192.png',
  './app-icon-512.png',
  './apple-touch-icon.png',
  './kc.png',
  './FACE_Prep_Logo-7fc4a872-2088-4df9-ab2f-72cded203db8.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(async () => (
          await caches.match(request) ||
          await caches.match('./index.html')
        ))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
      return cached || network;
    })
  );
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch (_) { data = { body: event.data?.text() || '' }; }
  const title = data.title || 'New campus announcement';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'A new announcement is now live.',
    icon: './app-icon-192.png',
    badge: './app-icon-192.png',
    tag: data.tag || 'campus-announcement',
    renotify: true,
    requireInteraction: data.priority === 'URGENT',
    silent: false,
    timestamp: Date.now(),
    vibrate: data.priority === 'URGENT' ? [180, 90, 180] : [140],
    lang: 'en-IN',
    actions: [{ action: 'view', title: 'View announcement' }],
    data: { url: data.url || './dashboard.html#announcements', official: true }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './dashboard.html#announcements', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin)) {
          await client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
