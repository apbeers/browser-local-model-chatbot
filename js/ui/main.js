// Entry point of the default UI. Loaded by index.html.
// Order matters: build the layout, tell the watchdog we're alive (app.ready),
// then initialise the core (model list, GPU, storage) and fill in the views.
import { app } from "../core/api.js";
import { state, $, lsGet, lsSet } from "./state.js";
import { buildLayout, setSidebar } from "./layout.js";
import { toast } from "./dom.js";
import { installCopyHandler } from "./markdown.js";
import { initSidebar, renderSidebar } from "./sidebar.js";
import { initChatView, showChat, showBanner } from "./chat/chat-view.js";
import { initModelPicker } from "./chat/model-picker.js";
import { renderStats } from "./chat/stats-strip.js";

const VIEWS = {
  models: () => import("./views/models.js"),
  dashboard: () => import("./views/dashboard.js"),
  benchmark: () => import("./views/benchmark.js"),
  studio: () => import("./views/studio.js"),
  settings: () => import("./views/settings.js"),
  run: () => import("./views/run.js"),
  storage: () => import("./views/storage.js"),
};
const TITLES = { chat: "Chat", models: "Models", dashboard: "Stats dashboard", benchmark: "Benchmark", studio: "Studio", settings: "Settings", run: "App", storage: "Storage" };

async function route() {
  const [, view = "chat", id, ...rest] = (location.hash || "#/chat").split("/");
  const v = TITLES[view] ? view : "chat";
  state.view = v;
  for (const [name, el] of Object.entries($("views"))) el.hidden = name !== v;
  for (const a of document.querySelectorAll(".nav a")) a.classList.toggle("active", a.dataset.nav === v);
  $("modelBar").hidden = v !== "chat";
  $("statsToggle").hidden = v !== "chat";
  $("title").textContent = TITLES[v];
  // Studio workspaces and running apps use the full width on desktop.
  $("app").classList.toggle("focus-mode", (v === "studio" && !!id) || v === "run");
  setSidebar(false);
  app.emit("usage", { event: "page", page: v, mobile: matchMedia("(max-width: 820px)").matches, wide: innerWidth >= 1800 });
  if (v === "chat") {
    await showChat(id ? decodeURIComponent(id) : null);
  } else {
    const mod = await VIEWS[v]();
    await mod.render($("views")[v], [id, ...rest].filter(Boolean).map(decodeURIComponent));
  }
  renderSidebar();
}
app.route = route;

function bindChrome() {
  $("openSidebar").onclick = () => setSidebar(true);
  $("closeSidebar").onclick = () => setSidebar(false);
  $("scrim").onclick = () => setSidebar(false);
  const strip = $("statsStrip");
  const toggle = $("statsToggle");
  if (lsGet("showStats", "1") === "0") {
    toggle.setAttribute("aria-pressed", "false");
    strip.classList.add("collapsed");
  }
  toggle.onclick = () => {
    const on = toggle.getAttribute("aria-pressed") !== "true";
    toggle.setAttribute("aria-pressed", String(on));
    strip.classList.toggle("collapsed", !on);
    lsSet("showStats", on ? "1" : "0");
  };
  window.addEventListener("pagehide", () => app.llm.session && app.llm.session.endSoon());
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) return;
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker registration failed", e));
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) toast("App updated. Reload to use the new version.", 5000);
  });
}

async function updateFoot() {
  try {
    const e = await navigator.storage.estimate();
    const fmt = app.models.fmtBytes;
    $("sidebarFoot").textContent = `Storage used: ${fmt(e.usage)} of ${fmt(e.quota)}`;
  } catch {
    $("sidebarFoot").textContent = "";
  }
}
app.on("models-changed", updateFoot);

async function start() {
  buildLayout(document.getElementById("root"));
  bindChrome();
  installCopyHandler($("messages"));
  app.ready(); // the UI code loaded and rendered: stop the startup watchdog
  registerSW();

  await app.init();
  if (!app.opfsAvailable()) showBanner("This browser can't save files (no Origin Private File System), so chats, stats and model downloads won't be kept.", true);
  if (app.catalogError) showBanner("Could not load the model list: " + app.catalogError.message, true);
  if (!app.gpu || !app.gpu.available) {
    showBanner(`WebGPU isn't available in this browser (${(app.gpu && app.gpu.reason) || "unsupported"}). Use a recent Chrome or Edge, or Safari 26+ on iPhone, iPad or Mac.`, true);
    app.recordUnsupportedOnce();
  }
  if (window.__safe) toast("Safe mode: showing the default UI.", 5000);
  if (lsGet("uiRolledBack") === "1") {
    lsSet("uiRolledBack", "0");
    showBanner("Your custom UI didn't start last time, so the default UI is back. Fix or switch UIs in Studio.", true);
  }
  app.on("auto-deleted", ({ models, chats }) => {
    const parts = [];
    if (models.length) parts.push(`${models.length} model(s)`);
    if (chats.length) parts.push(`${chats.length} chat(s)`);
    toast(`Auto-deleted ${parts.join(" and ")} not used recently`, 5000);
  });
  initSidebar();
  initModelPicker();
  initChatView();
  renderStats();
  window.addEventListener("hashchange", route);
  await route();
  updateFoot();
}

start();
