// Service worker: caches the app shell so the app opens offline.
// Model weights are NOT cached here; WebLLM stores them in OPFS itself.
// VERSION and ASSETS are rewritten by tools/build_sw.mjs.

const VERSION = "b942df8c0371";
const ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "models/catalog.json",
  "css/app.css",
  "js/app.js",
  "js/catalog.js",
  "js/charts.js",
  "js/chats.js",
  "js/device.js",
  "js/engine.js",
  "js/llm-worker.js",
  "js/markdown.js",
  "js/models.js",
  "js/opfs.js",
  "js/stats.js",
  "js/ui.js",
  "js/views/dashboard.js",
  "js/views/models-view.js",
  "js/views/settings.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/icon.svg",
  "vendor/web-llm/index.js",
];
const CACHE = `shell-${VERSION}`;
const SCOPE = self.registration.scope;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS.map((a) => new Request(new URL(a, SCOPE), { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!url.href.startsWith(SCOPE)) return; // other origins / the large-models site
  const path = url.href.slice(SCOPE.length).split("?")[0];

  // Model files go straight to the network (WebLLM caches them in OPFS).
  if (path.startsWith("models/") && path !== "models/catalog.json") return;

  // The catalog: network first so new models show up, cache as fallback.
  if (path === "models/catalog.json") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(new URL(path, SCOPE).href, res.clone()));
          return res;
        })
        .catch(() => caches.match(new URL(path, SCOPE).href)),
    );
    return;
  }

  // Navigations: serve the cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match(new URL("index.html", SCOPE).href).then((cached) => cached || fetch(req)),
    );
    return;
  }

  // Everything else in the shell: cache first, fall back to network.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
