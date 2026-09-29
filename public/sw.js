const CACHE = 'nextlevel-v8';
const ASSETS = ['./', 'index.html', 'manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // The app shell (the page itself + JS/CSS) always goes to the network
  // first. This is a PWA you update by uploading files to GitHub, not by
  // bumping a version number — cache-first here was serving the SAME
  // index.html forever after the first install, which pointed at the SAME
  // old JS bundle forever, silently hiding every future fix. Cache is only
  // a fallback now, for when there's genuinely no connection.
  const isAppShell = e.request.mode === 'navigate' ||
    e.request.destination === 'script' ||
    e.request.destination === 'style';

  if (isAppShell) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
