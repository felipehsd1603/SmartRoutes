// Firebase Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyB8AJNjdAut01MZebHa_-I6Q6WeK9w4qP4",
    authDomain: "smartroutedb.firebaseapp.com",
    projectId: "smartroutedb",
    storageBucket: "smartroutedb.firebasestorage.app",
    messagingSenderId: "536579624706",
    appId: "1:536579624706:web:6d0490cfda8747059efc1b"
});

const messaging = firebase.messaging();

// Receber notificacoes em background
messaging.onBackgroundMessage((payload) => {
    console.log('[FCM] Mensagem em background:', payload);

    const notificationTitle = payload.notification?.title || 'Depende Route Club';
    const notificationOptions = {
        body: payload.notification?.body || 'Nova notificacao',
        icon: './icons/icon-192.png',
        badge: './icons/icon-72.png',
        tag: payload.data?.tag || 'default',
        data: payload.data,
        vibrate: [200, 100, 200],
        actions: [
            { action: 'open', title: 'Abrir App' },
            { action: 'dismiss', title: 'Fechar' }
        ]
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Clique na notificacao
self.addEventListener('notificationclick', (event) => {
    console.log('[FCM] Clique na notificacao:', event);

    event.notification.close();

    if (event.action === 'dismiss') return;

    // Abrir ou focar na janela do app
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Se ja tem uma janela aberta, focar nela
            for (const client of clientList) {
                if (client.url.includes('SmartRoutes') && 'focus' in client) {
                    return client.focus();
                }
            }
            // Senao, abrir nova janela
            if (clients.openWindow) {
                return clients.openWindow('./');
            }
        })
    );
});
