// Service Worker: hält die App-Dateien offline vor. Karten, Routing und Campingplatz-Abfragen brauchen Netz.
const CACHE = 'gespann-etappen-v54';
const TILES = 'gespann-kacheln',
  MAX_TILES = 2500; // angesehene Kartenkacheln für unterwegs (offline)
const ASSETS = [
  './',
  'index.html',
  'styles.css?v=54',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  // App-Skripte (Reihenfolge wie in index.html; ?v= zusammen mit CACHE hochzählen)
  'js/basis.js?v=54',
  'js/dienste.js?v=54',
  'js/daten.js?v=54',
  'js/recherche.js?v=54',
  'js/google.js?v=54',
  'js/etappe.js?v=54',
  'js/planung.js?v=54',
  'js/karte.js?v=54',
  'js/panel.js?v=54',
  'js/ziele.js?v=54',
  'js/onlinespeicher.js?v=54',
  'js/export.js?v=54',
  'js/reiseplan.js?v=54',
  'js/start.js?v=54',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
];
const LIVE = ['openrouteservice.org', 'overpass', 'api.github.com', 'photon.komoot.io', 'project-osrm.org', 'googleapis.com'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// Kartenkacheln: Netz zuerst; jede angesehene Kachel wird gespeichert und ohne Netz von dort geliefert.
let puts = 0;
async function tile(req) {
  const cache = await caches.open(TILES);
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      if (++puts % 100 === 0) {
        const keys = await cache.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
      }
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method === 'GET' && (req.url.includes('tile.openstreetmap.org') || req.url.includes('server.arcgisonline.com'))) {
    e.respondWith(tile(req));
    return;
  }
  if (req.method !== 'GET' || LIVE.some(h => req.url.includes(h))) return;
  // Netz zuerst (damit Updates ankommen), sonst Cache
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
