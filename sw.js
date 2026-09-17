// Service worker for the Pilkades console.
//
// Two rules decide everything here:
//   1. The app shell (HTML/CSS/JS/icons) is cached so the console opens instantly
//      and still opens at a polling station with no signal.
//   2. Vote data is NEVER cached. Supabase REST/Realtime/Auth requests always go
//      to the network — a stale tally shown as if it were live would be worse
//      than no tally at all. Offline input is already handled by the app's own
//      persisted vote queue, which is the only thing allowed to replay writes.

const VERSION = 'v1';
const SHELL_CACHE = `pilkades-shell-${VERSION}`;
const RUNTIME_CACHE = `pilkades-runtime-${VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './login.html',
  './live/tps.html',
  './admin/input.html',
  './admin/tps.html',
  './admin/candidates.html',
  './admin/logs.html',
  './admin/export.html',
  './admin/snapshots.html',
  './admin/settings.html',
  './admin/tally.html',
  './css/variables.css',
  './css/base.css',
  './css/nav.css',
  './css/live.css',
  './css/admin.css',
  './css/tps.css',
  './css/candidates.css',
  './css/logs.css',
  './css/export.css',
  './css/snapshots.css',
  './css/tally.css',
  './js/supabase.js',
  './js/utils.js',
  './js/nav.js',
  './js/auth.js',
  './js/live-dashboard.js',
  './js/live-tps.js',
  './js/vote-input.js',
  './js/tps-manage.js',
  './js/candidates.js',
  './js/logs.js',
  './js/export.js',
  './js/snapshots.js',
  './js/tally-input.js',
  './js/settings-manage.js',
  './manifest.webmanifest',
  './assets/images/logo-header.png',
  './assets/images/icon-192.png',
  './assets/images/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // One missing file must not abort the whole install, so each asset is
      // cached on its own and failures are tolerated.
      .then((cache) => Promise.all(
        SHELL_ASSETS.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isSupabase(url) {
  return url.hostname.endsWith('.supabase.co');
}

function isCdn(url) {
  return url.hostname === 'cdn.jsdelivr.net';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Live data and auth: always the network, never a cached answer.
  if (isSupabase(url)) return;

  // Navigations: network first so a deployed change lands immediately, cache as
  // the offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Pinned CDN libraries are immutable: serve from cache, fill it on first use.
  if (isCdn(url)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Same-origin assets: stale-while-revalidate — instant paint, fresh next load.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
