const CACHE = 'ingchat-v1';
const STATIC = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/chat.js',
  '/js/media.js',
  '/js/socket.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache API, socket, or upload endpoints
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/socket.io/') ||
      url.pathname.startsWith('/uploads/')) {
    return;
  }

  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    }).catch(() => {
      // Offline fallback for navigation
      if (e.request.mode === 'navigate') return caches.match('/index.html');
    })
  );
});

// Push notifications (future feature placeholder)
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'IngChat', {
      body: data.body || 'New message',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      data: data
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
