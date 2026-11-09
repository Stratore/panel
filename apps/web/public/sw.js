// Panel service worker, hand-written (SPEC § 10).
// - App shell and hashed assets: cache-first (assets are immutable).
// - API reads: network-first, falling back to the last response (offline banner in the UI).
// - Never cached: the live stream, authentication, and anything that is not a same-origin GET.

const SHELL_CACHE = 'panel-shell-v1';
const API_CACHE = 'panel-api-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];
const NEVER_CACHE = ['/api/stream', '/api/auth/', '/api/export'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ type: 'about:blank', title: 'Offline', status: 503 }), {
      status: 503,
      headers: { 'content-type': 'application/problem+json' },
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
  } else if (request.mode === 'navigate') {
    // SPA: every navigation is served by the shell, from the network when possible.
    event.respondWith(
      fetch(request).catch(async () => (await caches.match('/')) ?? Response.error()),
    );
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  }
});
