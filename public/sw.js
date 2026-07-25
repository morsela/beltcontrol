// Offline shell.
//
// The app is entirely local — the BLE link is browser-to-treadmill over the radio and
// the server only ever ships static files — so there is no reason for the UI to stop
// working when the network does. Previously the manifest promised an installable app
// with no service worker behind it, which meant the installed PWA was fully
// network-dependent.
//
// Strategy: network-first for navigations (so a deploy is picked up immediately),
// cache-first for hashed build assets (which are immutable by construction).

// Stamped at build time from the hashed asset filenames (see the stamp-service-worker
// plugin in vite.config.ts). It was a hand-written 'wp-v1' that never moved, so the
// activate handler — which deletes every cache whose key is not VERSION — had nothing
// to delete, ever. A cached entry that went bad stayed cached across every deploy, and
// /assets/ is served without revalidating, so nothing would have replaced it.
// The literal placeholder survives in dev builds, where no service worker registers.
const VERSION = 'wp-__BUILD_ID__';
const SHELL = ['/', '/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Only successful, complete, same-origin responses are worth keeping. Without this
// check a 404 or a 502 was stored like any other response and then served as the
// offline fallback — so one bad minute from the host could be handed back as the app
// for as long as the cache survived. Cache.put also rejects outright on a 206, which
// took the whole handler down with an unhandled rejection.
const worthCaching = (res) => res && res.ok && res.type === 'basic';

function store(req, res) {
  if (!worthCaching(res)) return;
  const copy = res.clone();
  void caches.open(VERSION).then((c) => c.put(req, copy).catch(() => {}));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Hashed assets never change under the same name, so a hit is served without
  // revalidating. That is also why a poisoned or truncated entry would persist
  // indefinitely: nothing ever re-fetches it. Hence caching only clean responses, and
  // a VERSION that moves when the build does.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            store(req, res);
            return res;
          })
      )
    );
    return;
  }

  // Everything else: try the network, fall back to whatever was cached.
  event.respondWith(
    fetch(req)
      .then((res) => {
        store(req, res);
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? caches.match('/')))
  );
});
