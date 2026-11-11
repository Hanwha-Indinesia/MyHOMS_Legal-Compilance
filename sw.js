/* Service Worker HMSI-LCMS. Naikkan VERSI_CACHE setiap kali berkas statis berubah. */
const VERSI_CACHE = 'hmsi-lcms-v2.0.1';
const STATIS = ['./', './index.html', './css/style.css', './js/config.js', './js/pwa.js', './js/app.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSI_CACHE).then(c => c.addAll(STATIS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;                       // POST ke API tidak disentuh
  const u = new URL(r.url);
  // Data API (script.google.com / googleusercontent) TIDAK PERNAH di-cache
  if (/(^|\.)script\.google(usercontent)?\.com$/.test(u.hostname) || u.hostname.endsWith('googleusercontent.com')) return;
  // Navigasi: jaringan dulu → fallback shell offline
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).catch(() => caches.match('./index.html')));
    return;
  }
  // Statis & CDN (font, Chart.js): cache dulu, perbarui di latar (stale-while-revalidate)
  e.respondWith(caches.match(r).then(hit => {
    const net = fetch(r).then(res => {
      if (res && (res.ok || res.type === 'opaque') && (u.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(u.hostname))) {
        const salin = res.clone(); caches.open(VERSI_CACHE).then(c => c.put(r, salin));
      }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
