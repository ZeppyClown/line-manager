// Caches the team game so "/?offline" still loads when the Wi-Fi is down.
const CACHE = 'line-manager-v3';
const FILES = ['/', '/style.css', '/engine.js', '/team.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (!(url.pathname === '/' || FILES.includes(url.pathname))) return;
  // Network first (so updates arrive), cache as fallback.
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(url.pathname, copy));
      return res;
    }).catch(() => caches.match(url.pathname))
  );
});
