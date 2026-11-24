const CACHE_PREFIX = 'chronos-web-';
const CACHE = CACHE_PREFIX + BUILD;
const page = new URL('index.html', self.registration.scope).href;
const assets = new Set(FILES.map(path => new URL(path, self.registration.scope).href));

function assetURL(requestURL) {
  // Metro emits route chunk URLs containing literal brackets for dynamic Expo routes.
  const url = new URL(requestURL);
  url.pathname = url.pathname.replaceAll('[', '%5B').replaceAll(']', '%5D');
  return url.href;
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll([...assets].map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(page)) ?? fetch(request)));
  } else {
    const url = assetURL(request.url);
    if (assets.has(url)) event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url)) ?? fetch(request)));
  }
});
