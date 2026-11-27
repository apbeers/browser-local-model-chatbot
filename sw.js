// Service worker: makes the app work offline and serves custom UIs.
//
// 1. App shell: every file in ASSETS is cached on install, so the app opens
//    with no network. Model weights are NOT cached here: they come from
//    Hugging Face and WebLLM stores them in OPFS itself.
// 2. Custom UIs (see js/core/variants.js): for css/*.css and js/ui/*.js the
//    worker first looks in Cache "ui-<id>" for the UI this tab is using, and
//    falls back to the default file. Which UI a tab uses:
//      ?safe          -> always the default UI (recovery)
//      ?ui=<id>       -> that UI (used for previews in Studio)
//      otherwise      -> the active UI stored in Cache "ui-meta" at "__ui/active"
//    A request with ?__default=1 always gets the default file.
// VERSION and ASSETS are rewritten by tools/build_sw.mjs.

const VERSION = "60bc4f0fefec";
const ASSETS = [
  "./",
  "index.html",
  "recover.html",
  "pin.html",
  "manifest.webmanifest",
  "models.json",
  "css/app.css",
  "css/custom.css",
  "js/core/agent.js",
  "js/core/api.js",
  "js/core/app-runtime.js",
  "js/core/appkit/appkit.css",
  "js/core/appkit/appkit.js",
  "js/core/apps.js",
  "js/core/benchmark.js",
  "js/core/builder.js",
  "js/core/catalog.js",
  "js/core/chats.js",
  "js/core/device.js",
  "js/core/engine.js",
  "js/core/install.js",
  "js/core/llm-worker.js",
  "js/core/memory.js",
  "js/core/models.js",
  "js/core/opfs.js",
  "js/core/pin-host.js",
  "js/core/pins.js",
  "js/core/projects.js",
  "js/core/retention.js",
  "js/core/stats.js",
  "js/core/storage.js",
  "js/core/themes.js",
  "js/core/tools.js",
  "js/core/usage.js",
  "js/core/variants.js",
  "js/core/version.js",
  "js/ui/charts.js",
  "js/ui/chat/chat-actions.js",
  "js/ui/chat/chat-view.js",
  "js/ui/chat/empty-state.js",
  "js/ui/chat/message.js",
  "js/ui/chat/model-picker.js",
  "js/ui/chat/stats-strip.js",
  "js/ui/diff.js",
  "js/ui/dom.js",
  "js/ui/install-help.js",
  "js/ui/layout.js",
  "js/ui/main.js",
  "js/ui/markdown.js",
  "js/ui/sidebar.js",
  "js/ui/state.js",
  "js/ui/studio/adapters.js",
  "js/ui/studio/agent-panel.js",
  "js/ui/studio/changes-tab.js",
  "js/ui/studio/console-tab.js",
  "js/ui/studio/files-tab.js",
  "js/ui/studio/personalize.js",
  "js/ui/studio/pin.js",
  "js/ui/studio/preview-tab.js",
  "js/ui/studio/workspace.js",
  "js/ui/views/benchmark.js",
  "js/ui/views/dashboard-charts.js",
  "js/ui/views/dashboard-memory.js",
  "js/ui/views/dashboard-tables.js",
  "js/ui/views/dashboard.js",
  "js/ui/views/models.js",
  "js/ui/views/run.js",
  "js/ui/views/settings.js",
  "js/ui/views/storage.js",
  "js/ui/views/studio-model.js",
  "js/ui/views/studio.js",
  "js/ui/views/theme-maker.js",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/icon.svg",
  "vendor/web-llm/index.js",
  "docs/API.md",
  "docs/APPKIT.md",
  "docs/APPKIT_SHORT.md",
  "docs/APP_RULES.md",
  "docs/ARCHITECTURE.md",
  "docs/CSS_CLASSES.md",
  "docs/STUDIO_RULES.md",
  "docs/THEMING.md",
  "docs/components/chat-actions.md",
  "docs/components/chat-view.md",
  "docs/components/dom.md",
  "docs/components/empty-state.md",
  "docs/components/helpers.md",
  "docs/components/layout.md",
  "docs/components/main.md",
  "docs/components/message.md",
  "docs/components/model-picker.md",
  "docs/components/sidebar.md",
  "docs/components/stats-strip.md",
  "docs/components/views.md",
  "docs/files.json",
  "docs/patterns/ai-stream.md",
  "docs/patterns/canvas-game.md",
  "docs/patterns/chart.md",
  "docs/patterns/form.md",
  "docs/patterns/index.json",
  "docs/patterns/list-storage.md",
  "docs/patterns/table.md",
  "docs/patterns/timer.md",
  "docs/templates/ai.html",
  "docs/templates/blank.html",
  "docs/templates/calculator.html",
  "docs/templates/game.html",
  "docs/templates/index.json",
  "docs/templates/list.html",
  "docs/templates/notes.html",
  "docs/templates/tracker.html",
];
const CACHE = `shell-${VERSION}`;
const SCOPE = self.registration.scope;
const OVERRIDABLE = /^(css\/[\w./-]+\.css|js\/ui\/[\w./-]+\.js)$/;
const clientUI = new Map(); // clientId -> variant id

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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "ui-changed" && event.source) clientUI.delete(event.source.id);
});

async function activeUI() {
  try {
    const r = await (await caches.open("ui-meta")).match(SCOPE + "__ui/active");
    return r ? (await r.json()).id || "default" : "default";
  } catch {
    return "default";
  }
}

async function uiFor(event) {
  if (clientUI.has(event.clientId)) return clientUI.get(event.clientId);
  // The map is lost when the browser stops an idle worker: re-derive it from the tab's URL.
  const client = event.clientId && (await self.clients.get(event.clientId));
  if (client && client.type === "window") {
    const p = new URL(client.url).searchParams;
    const id = p.has("safe") ? "default" : p.get("ui") || (await activeUI());
    clientUI.set(event.clientId, id);
    return id;
  }
  return activeUI(); // workers use the active UI
}

async function shell(req, path) {
  const cached = await caches.match(new URL(path, SCOPE).href, { ignoreSearch: true });
  if (cached) return cached;
  return fetch(req);
}

// Customizable files must never be reused from the browser's memory cache,
// or switching UIs and reloading could mix old and new files.
async function noStore(res) {
  const headers = new Headers(res.headers);
  headers.set("cache-control", "no-store");
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!url.href.startsWith(SCOPE)) return; // Hugging Face, GitHub and other origins
  const path = url.href.slice(SCOPE.length).split(/[?#]/)[0];

  // Pinned apps: pins/<id>/ is the locked host page; manifest and icons come from Cache "pins".
  const pin = path.match(/^pins\/([\w-]+)\/(.*)$/);
  if (pin) {
    event.respondWith(
      (async () => {
        if (!pin[2] || pin[2] === "index.html") {
          const page = await shell(new Request(new URL("pin.html", SCOPE)), "pin.html");
          const html = (await page.text()).replaceAll("__PIN_ID__", pin[1]);
          return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
        }
        const hit = await (await caches.open("pins")).match(SCOPE + path);
        return hit || new Response("Not found", { status: 404 });
      })(),
    );
    return;
  }

  // Page loads: decide which UI this tab uses, then serve the page.
  if (req.mode === "navigate") {
    const p = url.searchParams;
    event.respondWith(
      (async () => {
        const id = p.has("safe") ? "default" : p.get("ui") || (await activeUI());
        if (event.resultingClientId) clientUI.set(event.resultingClientId, id);
        return shell(req, path === "recover.html" ? "recover.html" : "index.html");
      })(),
    );
    return;
  }

  // The model list: network first so updates show up, cached copy offline.
  if (path === "models.json") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(new URL(path, SCOPE).href, copy));
          }
          return res;
        })
        .catch(() => caches.match(new URL(path, SCOPE).href)),
    );
    return;
  }

  // Customizable files: the tab's custom UI first, then the default.
  if (OVERRIDABLE.test(path) && !url.searchParams.has("__default")) {
    event.respondWith(
      (async () => {
        const id = await uiFor(event);
        let res = null;
        if (id && id !== "default") res = await (await caches.open("ui-" + id)).match(SCOPE + path);
        if (!res) res = await shell(req, path);
        return noStore(res);
      })(),
    );
    return;
  }

  // Everything else in the app: cache first, then network.
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
