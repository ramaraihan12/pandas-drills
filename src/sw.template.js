/* Service worker for pandas drills. Generated into dist/sw.js by the build (see vite.config.ts).
   Two caches, each versioned:
   - the app shell, named after the build
   - the pinned Pyodide and pandas files, named after the Pyodide version */
const SHELL_CACHE = "drills-shell-__BUILD_ID__";
const PYODIDE_CACHE = "drills-pyodide-__PYODIDE_VERSION__";
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v__PYODIDE_VERSION__/full/";
const SHELL_FILES = __SHELL_FILES__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("drills-") && k !== SHELL_CACHE && k !== PYODIDE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: false });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(request, { ignoreSearch: true })) || (await cache.match(new URL("./", self.registration.scope).href));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.url.startsWith(PYODIDE_BASE)) {
    event.respondWith(cacheFirst(req, PYODIDE_CACHE));
    return;
  }
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
    event.respondWith(url.pathname.includes("/assets/") ? cacheFirst(req, SHELL_CACHE) : networkFirst(req));
  }
});

// The page tells us which Pyodide files it fetched, so we store them even when this
// worker was not active yet during the very first download.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "cache-urls" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(PYODIDE_CACHE).then(async (cache) => {
      for (const url of data.urls) {
        if (typeof url !== "string" || !url.startsWith(PYODIDE_BASE)) continue;
        if (await cache.match(url)) continue;
        try {
          const res = await fetch(url, { mode: "cors" });
          if (res.ok) await cache.put(url, res);
        } catch (e) {
          /* offline or blocked: try again on the next visit */
        }
      }
    }),
  );
});
