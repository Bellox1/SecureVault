// SecureVault Service Worker
const CACHE_NAME = 'securevault-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // On laisse passer les requêtes normalement
  event.respondWith(fetch(event.request));
});
