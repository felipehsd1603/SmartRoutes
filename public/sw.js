const CACHE_NAME = 'sdm-links-v8';
const STATIC_ASSETS = [
  '/manifest.json',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first para HTML e API; cache-first para assets estáticos
const OFFLINE_RESPONSE = () => new Response('Offline', {
  status: 503,
  headers: { 'Content-Type': 'text/plain; charset=utf-8' }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Só trata GET same-origin; resto passa direto pro browser
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Rotas admin: network-only (sessão/autenticação dinâmica)
  if (url.pathname.startsWith('/admin')) {
    return;
  }

  // HTML e API: network-first com fallback no cache
  if (url.pathname === '/' || url.pathname.startsWith('/post/') ||
      url.pathname.startsWith('/api/') || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request).then(c => c || OFFLINE_RESPONSE()))
    );
    return;
  }

  // Assets estáticos: cache-first com fallback na rede
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          if (response && response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => OFFLINE_RESPONSE());
    })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'SDM Links', body: 'Novo drop disponível', url: '/' };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch { data.body = event.data.text() || data.body; }
  }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    image: data.image || undefined,
    tag: data.tag || 'sdm-drop',
    renotify: true,
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
