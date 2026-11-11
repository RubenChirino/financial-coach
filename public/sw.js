// Offline-fallback service worker.
//
// Privacy invariant: Cache Storage never holds a response from an
// authenticated route or from /api/*. Cache Storage outlives lock and
// sign-out, so caching an app page would leave financial data readable
// offline after the user locked the app.
//
// - Precache only static files that carry no user data.
// - Navigations are network-only; when the network fails the user gets the
//   static offline page, never a cached app page.
// - Nothing is cached at runtime.
//
// Bumping CACHE makes `activate` delete every older cache, including the
// v1 cache that held the dashboard HTML.
const CACHE = "fc-static-v2";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then((r) => r ?? new Response("Offline", { status: 503 })),
    ),
  );
});
