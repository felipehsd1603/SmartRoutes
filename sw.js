// Smart Routes - Service Worker
const CACHE_NAME = 'smartroutes-v2';
const OFFLINE_URL = 'offline.html';

// Arquivos essenciais para cache
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './offline.html'
];

// Instalar Service Worker e fazer cache inicial
self.addEventListener('install', event => {
  console.log('[SW] Instalando Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Cache aberto, adicionando arquivos...');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[SW] Arquivos em cache!');
        return self.skipWaiting();
      })
      .catch(err => {
        console.log('[SW] Erro no cache:', err);
      })
  );
});

// Ativar e limpar caches antigos
self.addEventListener('activate', event => {
  console.log('[SW] Ativando Service Worker...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Service Worker ativo!');
      return self.clients.claim();
    })
  );
});

// Estratégia de cache: Network First, fallback to Cache
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requisições não-GET
  if (request.method !== 'GET') return;

  // Para arquivos GPX, usar Cache First (são estáticos)
  if (url.pathname.endsWith('.gpx')) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then(response => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Para outros recursos, Network First
  event.respondWith(
    fetch(request)
      .then(response => {
        // Se a resposta for válida, salvar no cache
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Se offline, tentar buscar do cache
        return caches.match(request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Se for navegação e não tiver cache, mostrar página offline
          if (request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
        });
      })
  );
});

// Cache dinâmico de GPX quando acessados
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Recebido SKIP_WAITING, atualizando...');
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CACHE_ROUTES') {
    const routes = event.data.routes;
    caches.open(CACHE_NAME).then(cache => {
      routes.forEach(route => {
        const url = `./routes/${route}`;
        fetch(url).then(response => {
          if (response.ok) {
            cache.put(url, response);
            console.log('[SW] Rota em cache:', route);
          }
        }).catch(() => {});
      });
    });
  }
});
